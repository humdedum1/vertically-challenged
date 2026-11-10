// Real-Chrome checks for the in-page popup (Display setting):
// - the setting switches Chrome's toolbar behaviour between side panel and popup;
// - the popup-toggle script shows the panel over a web page, listing that window's tabs,
//   in a closed shadow root the page can't reach, and toggles off when injected again;
// - it closes on a click outside, Escape in the page, Escape and the close button in the
//   panel, and when its tab is hidden by switching tabs from the list;
// - other sites can't frame the panel (only the dynamic URL loads);
// - the popup window used on pages that can't host the overlay lists the browser window
//   it was opened for, not itself.
// Headless Chrome can't click the toolbar button, which is what grants activeTab, so the
// script is injected from the worker into a copy of the build that also has a host
// permission (test only). The background's routing is covered by tests/display.test.ts.
//   node tests/e2e/popup.mjs [extension dir]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const built = extensionDir();
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-popup-ext-'));
fs.cpSync(built, ext, { recursive: true });
const manifestPath = path.join(ext, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

const server = http
  .createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    // Strictest page policy: frames, styles and scripts all forbidden to the page itself.
    if (req.url === '/strict')
      res.setHeader('content-security-policy', "default-src 'none'; frame-src 'none'");
    res.end(
      `<!doctype html><title>${req.url.replace(/[<>&"]/g, '')}</title><h1>page ${req.url.replace(/[<>&"]/g, '')}</h1>`,
    );
  })
  .listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { ctx, extId, close } = await launch(ext, { width: 1200, height: 900 });
const [sw] = ctx.serviceWorkers();

/**
 * Every call into the service worker. A call that never returns (seen once or twice in CI, cause
 * unknown) would stall the script until the runner kills it after 3 minutes with no clue where;
 * this fails after 15 s and names the call.
 */
const swEval = (fn, arg, what = fn.toString().slice(0, 60).replace(/\s+/g, ' ')) =>
  Promise.race([
    sw.evaluate(fn, arg),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`service worker call did not return in 15 s: ${what}`)),
        15_000,
      ),
    ),
  ]);

const behavior = () =>
  swEval(async () => (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick);
const setMode = (mode) =>
  swEval(async (m) => {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({
      settings: { ...settings, version: 6, display: { mode: m } },
    });
  }, mode);
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(50);
  }
}

// --- The setting drives Chrome's toolbar behaviour --------------------------------------
check(
  (await until(async () => (await behavior()) === true)) === true,
  'side panel mode by default: the toolbar button opens the side panel',
);
await setMode('popup');
check(
  await until(async () => (await behavior()) === false),
  'popup mode: Chrome no longer opens the side panel itself',
);
await setMode('sidebar');
check(await until(async () => (await behavior()) === true), 'back to side panel mode');
await setMode('popup');

// --- The overlay --------------------------------------------------------------------------
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${origin}/one`);
const other = await ctx.newPage();
await other.goto(`${origin}/two`);
await page.bringToFront();

const tabIdOf = (url) => swEval(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
const pageTab = await tabIdOf(`${origin}/one`);
const toggle = () =>
  swEval(
    (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['/popup-toggle.js'] }),
    pageTab,
  );
const panelFrame = () =>
  page.frames().find((f) => f.url().includes('sidepanel.html?surface=popup'));
const hostCount = () =>
  page.evaluate(() => [...document.body.children].filter((e) => e.tagName === 'DIV').length);

await toggle();
const frame = await until(async () => {
  const f = panelFrame();
  if (!f) return null;
  const n = await f
    .evaluate(() => document.querySelectorAll('[role=treeitem]').length)
    .catch(() => 0);
  return n > 0 ? f : null;
}, 5000);
check(!!frame, 'the popup shows the panel over the page');
if (frame) {
  const titles = await frame.evaluate(() =>
    [...document.querySelectorAll('[role=treeitem]')].map((e) => e.textContent ?? ''),
  );
  check(
    titles.some((t) => t.includes('/one')) && titles.some((t) => t.includes('/two')),
    "it lists this window's tabs",
    JSON.stringify(titles),
  );
  check(
    await frame.evaluate(() => !!document.querySelector('button[aria-label="Close"]')),
    'the panel has a close button in the popup',
  );
}
check(
  await page.evaluate(() => {
    const host = [...document.body.children].find((e) => e.tagName === 'DIV');
    return !!host && host.shadowRoot === null;
  }),
  "the page can't reach into the popup (closed shadow root)",
);

await toggle();
check(
  await until(async () => !panelFrame() && (await hostCount()) === 0),
  'injecting again closes it (toggle)',
);

// Click outside
await toggle();
await until(() => panelFrame());
await page.mouse.click(100, 400);
check(
  await until(async () => !panelFrame() && (await hostCount()) === 0),
  'a click outside closes it',
);

// Escape in the page
await toggle();
await until(() => panelFrame());
await page.evaluate(() => document.body.focus());
await page.keyboard.press('Escape');
check(await until(() => !panelFrame()), 'Escape in the page closes it');

// Escape inside the panel with nothing to cancel, and the close button
for (const how of ['Escape in the panel', 'the close button']) {
  await toggle();
  const f = await until(async () => {
    const x = panelFrame();
    return x && (await x.$('[role=treeitem]').catch(() => null)) ? x : null;
  }, 5000);
  if (!f) {
    check(false, `${how} closes it`, 'popup did not open');
    continue;
  }
  if (how === 'the close button') await f.click('button[aria-label="Close"]');
  else {
    await f.focus('[role=tree]');
    await page.keyboard.press('Escape');
  }
  check(await until(() => !panelFrame()), `${how} closes it`);
}

// The page tampering with the host (clickjacking: hide it, move it, restyle it) closes it
const tampers = {
  'an inline style change': (h) => {
    h.style.opacity = '0';
  },
  'a class change': (h) => h.classList.add('x'),
  'moving the host': (h) => document.documentElement.append(h),
  'removing the host': (h) => h.remove(),
};
for (const [how, fn] of Object.entries(tampers)) {
  await toggle();
  await until(() => panelFrame());
  await page.evaluate(`(${fn})([...document.querySelectorAll('#vertically-challenged')].pop())`);
  check(
    await until(async () => !panelFrame() && (await page.$('#vertically-challenged')) === null),
    `${how} by the page closes it`,
  );
}
// Page stylesheets: a rule on the host can't hide or fade it; fading the page under it closes it.
await toggle();
await until(() => panelFrame());
await page.addStyleTag({
  content:
    '#vertically-challenged{opacity:0!important;visibility:hidden!important;display:none!important;transform:translateX(9999px)!important}',
});
await sleep(800);
check(
  !!panelFrame() &&
    (await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#vertically-challenged'));
      return (
        s.opacity === '1' &&
        s.visibility === 'visible' &&
        s.display !== 'none' &&
        s.transform === 'none'
      );
    })),
  "a page stylesheet rule on the host can't hide, fade or move it",
);
await page.evaluate(() =>
  document.querySelectorAll('style').forEach((s) => {
    s.remove();
  }),
);
// A page faded when the popup opens can't host it, and fading it later closes it.
for (const [how, css] of [
  ['body opacity', 'body{opacity:.05!important}'],
  ['html visibility', 'html{visibility:hidden!important}'],
]) {
  if (panelFrame()) {
    await toggle();
    await until(() => !panelFrame());
  }
  const tag = await page.addStyleTag({ content: css });
  await toggle();
  await sleep(800);
  check(
    !panelFrame() && (await page.$('#vertically-challenged')) === null,
    `a page with ${how} set before opening closes it`,
  );
  await tag.evaluate((t) => t.remove());
}
await toggle();
await until(() => panelFrame());
const fade = await page.addStyleTag({ content: 'body{opacity:.5!important}' });
check(
  await until(async () => !panelFrame() && (await page.$('#vertically-challenged')) === null),
  'a fade the page starts after opening closes it',
);
await fade.evaluate((t) => t.remove());
await toggle();
check(!!(await until(() => panelFrame())), 'it opens again once the page is no longer faded');
// Moving the page under it (an ancestor transform shifts the fixed host) closes it.
const shift = await page.addStyleTag({
  content: 'body{transform:translate(300px,200px)!important}',
});
check(
  await until(async () => !panelFrame() && (await page.$('#vertically-challenged')) === null),
  'an ancestor transform that moves it closes it',
);
await shift.evaluate((t) => t.remove());
if (!panelFrame()) {
  await toggle();
  await until(() => panelFrame());
}
await toggle();
await until(() => !panelFrame());

// Closed by tampering, the next injection opens it again rather than toggling off.
await toggle();
check(!!(await until(() => panelFrame())), 'it opens again after a tamper close');
await toggle();
await until(() => !panelFrame());

// Activating another tab from the list hides this one, which closes the popup
await toggle();
const f2 = await until(async () => {
  const x = panelFrame();
  return x && (await x.$('[role=treeitem]').catch(() => null)) ? x : null;
}, 5000);
if (f2) {
  const otherTab = await tabIdOf(`${origin}/two`);
  await f2.click(`#vc-row-t${otherTab}`);
  const active = await until(
    async () => (await swEval(async (id) => (await chrome.tabs.get(id)).active, otherTab)) || null,
  );
  check(active === true, 'clicking a tab in the popup activates it');
  // Playwright emulates focus, so its pages stay "visible" after a tab switch; the popup's
  // close-on-hidden can only be checked where the page really reports hidden.
  const hidden = await until(
    async () => (await page.evaluate(() => document.visibilityState)) === 'hidden',
    1500,
  );
  if (hidden) check(await until(() => !panelFrame()), 'the popup closes when its tab is hidden');
  else {
    console.log('SKIP the popup closes when its tab is hidden (pages never report hidden here)');
    await toggle();
  }
  await page.bringToFront();
} else check(false, 'popup reopened for tab activation');

// --- Strict CSP pages, and what a page can learn ----------------------------------------
const strict = await ctx.newPage();
await strict.goto(`${origin}/strict`);
const strictTab = await tabIdOf(`${origin}/strict`);
await swEval(
  (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['/popup-toggle.js'] }),
  strictTab,
);
const strictFrame = await until(async () => {
  const f = strict.frames().find((x) => x.url().includes('surface=popup'));
  return f && (await f.$('[role=treeitem]').catch(() => null)) ? f : null;
}, 5000);
check(!!strictFrame, 'the popup works on a page with a strict Content-Security-Policy');
if (strictFrame) {
  await sleep(300); // past the 140 ms slide-in
  const box = await (await strictFrame.frameElement()).boundingBox();
  const vw = strict.viewportSize().width;
  check(
    !!box &&
      Math.round(box.width) === 360 &&
      Math.round(box.x + box.width) === vw - 8 &&
      Math.round(box.y) === 8,
    'and is laid out there (CSP does not strip its styles)',
    JSON.stringify(box),
  );
  // The panel's dynamic URL is what keeps other sites from framing it: the page must not see it.
  const seen = await strict.evaluate(() => ({
    timing: performance
      .getEntriesByType('resource')
      .some((e) => e.name.startsWith('chrome-extension:')),
    frames: window.length,
    host: [...document.body.children].some((e) => e.shadowRoot),
  }));
  check(
    !seen.timing && seen.frames === 0 && !seen.host,
    "the page can't learn the panel URL (timing, frames, shadow root)",
    JSON.stringify(seen),
  );
}
await strict.close();

// --- Other sites can't frame the panel ---------------------------------------------------
const framed = await ctx.newPage();
await framed.goto(`${origin}/framer`);
await framed.evaluate((u) => {
  const f = document.createElement('iframe');
  f.src = u;
  document.body.append(f);
}, `chrome-extension://${extId}/sidepanel.html?surface=popup`);
await sleep(1500);
const child = framed.frames()[1];
check(
  !!child && !child.url().includes(extId),
  'a site framing the static panel URL is refused',
  child?.url(),
);
await framed.close();

// --- The popup window fallback ------------------------------------------------------------
const browserWindow = await swEval(async (id) => (await chrome.tabs.get(id)).windowId, pageTab);
const popupWin = await swEval(
  async ([u, w]) =>
    (await chrome.windows.create({ url: `${u}?surface=window&windowId=${w}`, type: 'popup' })).id,
  [`chrome-extension://${extId}/sidepanel.html`, browserWindow],
);
const winPage = await until(
  () => ctx.pages().find((p) => p.url().includes('surface=window')),
  5000,
);
if (winPage) {
  await winPage.waitForSelector('[role=treeitem]', { timeout: 5000 }).catch(() => {});
  const titles = await winPage.evaluate(() =>
    [...document.querySelectorAll('[role=treeitem]')].map((e) => e.textContent ?? ''),
  );
  check(
    titles.some((t) => t.includes('/one')),
    'the popup window lists the browser window it was opened for',
    JSON.stringify(titles),
  );
  const subscribedTo = await winPage.evaluate(async () => (await chrome.windows.getCurrent()).id);
  check(subscribedTo === popupWin, 'and runs in its own popup window');
} else check(false, 'popup window opened');

check(errors.length === 0, 'no page errors', errors.join('; '));

await close();
server.close();
fs.rmSync(ext, { recursive: true, force: true });
finish();
