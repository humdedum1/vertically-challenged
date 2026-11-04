// Shared setup for the real-Chrome checks in this folder. Each script loads the built
// extension unpacked into a fresh, throwaway profile, prints PASS/FAIL lines and exits
// non-zero on any failure.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The unpacked extension: the first CLI argument, else the production build. */
export function extensionDir() {
  const dir = path.resolve(process.argv[2] ?? path.join(ROOT, '.output', 'chrome-mv3'));
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.error(`No built extension at ${dir}. Run "npm run build" first.`);
    process.exit(2);
  }
  return dir;
}

/**
 * Chrome to drive: CHROME_BIN, else Playwright's own Chromium. Branded Google Chrome
 * ignores --load-extension (since Chrome 137), so it can't be used here.
 */
export function chromeBinary() {
  const bin = process.env.CHROME_BIN || chromium.executablePath();
  if (!bin || !fs.existsSync(bin)) {
    console.error(
      'No Chromium found. Install one with "npx playwright-core install chromium",\n' +
        'or point CHROME_BIN at a Chromium / Chrome for Testing binary.',
    );
    process.exit(2);
  }
  return bin;
}

/**
 * A headless Chromium with only this extension, plus its id. Pass `profile` to reuse a
 * profile across launches (it is then left in place on close); `args` adds flags and
 * `scale` sets the device pixel ratio (for sharper screenshots); `headed` shows a
 * real window (headless Chromium often fails to load favicons).
 */
export async function launch(
  ext,
  { width = 400, height = 1400, scale = 1, profile, headed = false, args: extra = [] } = {},
) {
  const own = profile === undefined;
  profile ??= fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-'));
  const args = [
    ...(headed ? [] : ['--headless=new']),
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    ...extra,
  ];
  // Chromium can't sandbox as root, nor on Ubuntu 24.04 CI runners (AppArmor blocks user namespaces).
  if (process.getuid?.() === 0 || process.env.CI) args.push('--no-sandbox');
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromeBinary(),
    headless: false,
    args,
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const close = async () => {
    await ctx.close();
    if (own) fs.rmSync(profile, { recursive: true, force: true });
  };
  return { ctx, extId: new URL(sw.url()).host, close };
}

let failures = 0;
export function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
}

export function finish() {
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Tab ids of the panel's tab rows, in on-screen order (only the rows that are rendered). */
export const tabRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[id^="vc-row-t"]')].map((e) => Number(e.id.slice(8))),
  );

/**
 * Runs in an extension page: an independent mirror of the worker's patch stream, kept per
 * window like the panel's (a tab moving windows is upserted in one window's patch and
 * removed in the other's, in either order). Read back from globalThis.__mirror.
 */
export function startMirror(windowId) {
  const M = { order: {}, tabs: {} };
  globalThis.__mirror = M;
  const port = chrome.runtime.connect({ name: 'vc-panel' });
  port.onMessage.addListener((m) => {
    if (m.type === 'snapshot') {
      M.order[m.windowId] = m.order;
      M.tabs[m.windowId] = Object.fromEntries(m.tabs.map((t) => [t.id, t]));
    } else if (m.type === 'patch') {
      const p = m.patch;
      M.tabs[p.windowId] ??= {};
      const byId = M.tabs[p.windowId];
      for (const id of p.removed ?? []) delete byId[id];
      for (const t of p.upserts ?? []) byId[t.id] = t;
      if (p.order) M.order[p.windowId] = p.order;
    }
  });
  port.postMessage({ type: 'subscribe', windowId });
}

/**
 * Chrome's own id for an unpacked extension loaded from `dir` (from the path), so a
 * profile can be prepared for it before launch (e.g. incognito access).
 */
export function unpackedId(dir) {
  const hex = crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join('');
}

/**
 * Raw CDP on a browser launched with --remote-debugging-port=0, for targets Playwright
 * doesn't expose (the real side panel, incognito pages). Port from the profile's
 * DevToolsActivePort file.
 */
export async function rawCDP(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 50 && !fs.existsSync(file); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    const w = d.id && waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    if (d.error) w.rej(new Error(d.error.message));
    else w.res(d.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  return {
    send,
    targets: async () => (await send('Target.getTargets')).targetInfos,
    attach: async (targetId) =>
      (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId,
    /** Evaluates in a session; returns the value, throws on an exception. */
    eval: async (sessionId, expression, { userGesture = false } = {}) => {
      const r = await send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true, userGesture },
        sessionId,
      );
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    },
    close: () => ws.close(),
  };
}
