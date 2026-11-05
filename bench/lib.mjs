// Shared pieces of the Chrome benchmarks: paths, the CDP client, stats and the fixture's
// synthetic sites. Everything they write goes to bench/.out (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { chromeBinary } from '../tests/e2e/harness.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'bench', '.out');
export const STATE = path.join(OUT, 'state.json');
/** Debugging port of the fixture Chrome, and the port of its local page server. */
export const PORT = 9333;
export const SRV = 18099;

fs.mkdirSync(OUT, { recursive: true });

/** JSON literal that is also safe to splice into evaluated code (no `<`, `>`, `/`, U+2028/9). */
export const lit = (v) =>
  JSON.stringify(v).replace(
    /[<>/\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : Number.NaN;
};
export const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : Number.NaN;
};
export const r2 = (x) => Math.round(x * 100) / 100;
export const stat = (a) => ({
  n: a.length,
  median: r2(median(a)),
  p95: r2(pct(a, 0.95)),
  min: r2(Math.min(...a)),
  max: r2(Math.max(...a)),
});

export function readState() {
  if (!fs.existsSync(STATE)) {
    console.error('No fixture running. Start one with "node bench/fixture.mjs" first.');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

/** Which loaded build to measure: --build b picks the second one given to fixture.mjs. */
export function pickBuild(st, argv = process.argv) {
  const i = argv.indexOf('--build');
  const which = i === -1 ? 'a' : argv[i + 1];
  const build = st.builds.find((b) => b.key === which);
  if (!build) {
    console.error(
      `No build "${which}" in the running fixture (have ${st.builds.map((b) => b.key)}).`,
    );
    process.exit(2);
  }
  return build;
}

/** Raw CDP over WebSocket; Playwright attaching to 1,500 tabs would be the benchmark. */
export class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.cb = new Map();
    this.ev = [];
  }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id) {
        const c = this.cb.get(d.id);
        if (!c) return;
        this.cb.delete(d.id);
        if (d.error) c.rej(new Error(`${c.method}: ${d.error.message}`));
        else c.res(d.result);
      } else for (const [name, fn] of this.ev) if (name === d.method) fn(d.params, d.sessionId);
    };
    return this;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.cb.set(id, { res, rej, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(name, fn) {
    this.ev.push([name, fn]);
  }
  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return sessionId;
  }
  async evalIn(
    sessionId,
    expression,
    { awaitPromise = true, timeout = 180000, userGesture = false } = {},
  ) {
    const r = await Promise.race([
      this.send(
        'Runtime.evaluate',
        { expression, awaitPromise, returnByValue: true, userGesture },
        sessionId,
      ),
      sleep(timeout).then(() => {
        throw new Error(`evaluate timeout: ${expression.slice(0, 80)}`);
      }),
    ]);
    if (r.exceptionDetails) {
      const why = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`eval error: ${JSON.stringify(why).slice(0, 400)}`);
    }
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

export async function jget(p) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
  return r.json();
}

export async function browserCDP() {
  const v = await jget('/json/version').catch(() => null);
  if (!v) {
    console.error(`No fixture Chrome on port ${PORT}. Start one with "node bench/fixture.mjs".`);
    process.exit(2);
  }
  return new CDP(v.webSocketDebuggerUrl).open();
}

/** The service worker session of a loaded build (found by extension id). */
export async function swSession(cdp, extId) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const sw = targetInfos.find(
    (t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`,
  );
  if (!sw) return null;
  return { targetId: sw.targetId, sessionId: await cdp.attach(sw.targetId), extId };
}

export async function waitSW(cdp, extId, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const s = await swSession(cdp, extId);
    if (s) return s;
    await sleep(500);
  }
  throw new Error(`no service worker for ${extId}`);
}

/** Wakes a stopped worker by opening one of its pages, then returns its session. */
export async function wakeSW(cdp, extId) {
  const existing = await swSession(cdp, extId);
  if (existing) return existing;
  const { targetId } = await cdp.send('Target.createTarget', {
    url: `chrome-extension://${extId}/manifest.json`,
  });
  const s = await waitSW(cdp, extId);
  await cdp.send('Target.closeTarget', { targetId });
  return s;
}

import { fixtureFor, SITES, siteFor, WORDS } from './fixture-data.mjs';

export { fixtureFor, SITES, siteFor, WORDS };
/** Source text defining SITES, WORDS, siteFor and fixtureFor inside a page. */
export const FIXTURE_SRC = `const SITES=${lit(SITES)};const WORDS=${lit(WORDS)};${siteFor.toString()};${fixtureFor.toString()};`;

/**
 * A Playwright-driven headless Chromium with the given builds loaded side by side, for
 * the self-contained benchmarks (no fixture needed). Returns the extension id per build.
 */
export async function launchBuilds(dirs, { width = 380, height = 900 } = {}) {
  const { chromium } = await import('playwright-core');
  const { chromeBinary } = await import('../tests/e2e/harness.mjs');
  const os = await import('node:os');
  for (const d of dirs) {
    if (!fs.existsSync(path.join(d, 'manifest.json'))) {
      console.error(`No built extension at ${d}. Run "npm run build" first.`);
      process.exit(2);
    }
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-bench-'));
  const list = dirs.join(',');
  const args = [
    '--headless=new',
    `--disable-extensions-except=${list}`,
    `--load-extension=${list}`,
  ];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromeBinary(),
    headless: false,
    viewport: { width, height },
    args,
  });
  for (let i = 0; i < 40 && ctx.serviceWorkers().length < dirs.length; i++) await sleep(250);
  const ids = ctx.serviceWorkers().map((w) => new URL(w.url()).host);
  // Workers register in any order; match each directory to an id by its sidepanel.html,
  // which names the build's hashed chunks.
  const byDir = new Map();
  for (const d of dirs) {
    const want = fs.readFileSync(path.join(d, 'sidepanel.html'), 'utf8');
    for (const id of ids) {
      if ([...byDir.values()].includes(id)) continue;
      const page = await ctx.newPage();
      const got = await page
        .goto(`chrome-extension://${id}/sidepanel.html`)
        .then(() => page.evaluate(() => fetch(location.href).then((r) => r.text())))
        .catch(() => '');
      await page.close();
      if (got === want) {
        byDir.set(d, id);
        break;
      }
    }
    if (!byDir.has(d)) throw new Error(`could not find the extension loaded from ${d}`);
  }
  const close = async () => {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return { ctx, ids: dirs.map((d) => byDir.get(d)), close };
}
