// Shared setup for the real-Chrome checks in this folder. Each script loads the built
// extension unpacked into a fresh, throwaway profile, prints PASS/FAIL lines and exits
// non-zero on any failure.
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

/** A headless Chromium with only this extension, plus its id. */
export async function launch(ext, { width = 400, height = 1400 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-'));
  const args = ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`];
  // Chromium refuses to start sandboxed as root (CI containers).
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromeBinary(),
    headless: false,
    args,
    viewport: { width, height },
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const close = async () => {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
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
