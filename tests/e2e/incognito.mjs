// Real-Chrome incognito checks, in Chrome's real side panel: with the extension allowed
// in incognito, the incognito window's panel lists only incognito tabs and a normal panel
// none of them; Essentials work in incognito; and no incognito URL is ever written to
// storage.local, also after the incognito window closes.
//   node tests/e2e/incognito.mjs [extension dir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  check,
  extensionDir,
  finish,
  launch,
  rawCDP,
  sleep,
  tabRows,
  unpackedId,
} from './harness.mjs';

const ext = extensionDir();
const SECRET = 'incognito-secret';
// "Allow in incognito", set the way the extensions page stores it.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-incognito-'));
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'Default', 'Preferences'),
  JSON.stringify({ extensions: { settings: { [unpackedId(ext)]: { incognito: true } } } }),
);
const { ctx, extId, close } = await launch(ext, { profile, args: ['--remote-debugging-port=0'] });
const cdp = await rawCDP(profile);

// The normal window's panel, in a tab.
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'normal panel: no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
const api = (fn, arg) => page.evaluate(fn, arg);
check(
  await api(() => chrome.extension.isAllowedIncognitoAccess()),
  'the extension is allowed in incognito',
);
await api(() => chrome.tabs.create({ url: 'about:blank#normal-1', active: false }));

const inc = await api(
  async (u) => (await chrome.windows.create({ incognito: true, url: u })).id,
  `about:blank#${SECRET}-0`,
);
for (let i = 1; i <= 2; i++)
  await api(
    ([w, u]) => chrome.tabs.create({ windowId: w, url: u, active: false }),
    [inc, `about:blank#${SECRET}-${i}`],
  );
await sleep(800);
const incTabs = await api(
  async (w) =>
    (await chrome.tabs.query({ windowId: w })).sort((a, b) => a.index - b.index).map((t) => t.id),
  inc,
);

// --- Chrome's real side panel in the incognito window (opening it needs a user gesture).
const normalTarget = (await cdp.targets()).find((t) => t.url === page.url());
const normalSess = await cdp.attach(normalTarget.targetId);
const opened = await cdp.eval(
  normalSess,
  `chrome.sidePanel.open({windowId: ${inc}}).then(() => 'ok', (e) => e.message)`,
  { userGesture: true },
);
check(opened === 'ok', 'the side panel opens in the incognito window', opened);
let panel;
for (let i = 0; i < 50 && !panel; i++) {
  panel = (await cdp.targets()).find(
    (t) =>
      t.url.startsWith(`chrome-extension://${extId}/sidepanel.html`) &&
      t.targetId !== normalTarget.targetId,
  );
  if (!panel) await sleep(100);
}
const ps = await cdp.attach(panel.targetId);
const incRows = async () => {
  for (let i = 0; i < 50; i++) {
    const ids = await cdp.eval(
      ps,
      `[...document.querySelectorAll('[id^="vc-row-t"]')].map((e) => Number(e.id.slice(8)))`,
    );
    if (ids.length > 0) return ids;
    await sleep(100);
  }
  return [];
};
check(
  (await cdp.eval(ps, 'chrome.windows.getCurrent().then((w) => w.incognito)')) === true,
  'that panel runs for the incognito window',
);
check(
  JSON.stringify(await incRows()) === JSON.stringify(incTabs),
  'the incognito panel lists exactly the incognito window’s tabs',
  JSON.stringify(await incRows()),
);
await sleep(500);
const normalRows = await tabRows(page);
check(
  normalRows.length > 0 && !normalRows.some((id) => incTabs.includes(id)),
  'the normal panel shows none of the incognito tabs',
  JSON.stringify(normalRows),
);

// --- An Essential in incognito, made through the incognito panel's own connection.
await cdp.eval(
  ps,
  `new Promise((done) => {
    const port = chrome.runtime.connect({ name: 'vc-panel' });
    port.postMessage({ type: 'subscribe', windowId: ${inc} });
    setTimeout(() => {
      port.postMessage({ type: 'pinTabs', tabIds: [${incTabs[1]}], windowId: ${inc}, dest: { zone: 'essentials', index: 0 } });
      setTimeout(done, 1500);
    }, 500);
  })`,
);
const tiles = await cdp.eval(ps, `document.querySelectorAll('[role=option]').length`);
check(tiles === 1, 'the incognito panel shows its new Essential', String(tiles));
check(
  (await api((t) => chrome.tabs.get(t).then((x) => x.pinned), incTabs[1])) === true,
  'the Essential is a pinned tab in the incognito window',
);
await sleep(800);
const local = JSON.stringify(await api(() => chrome.storage.local.get(null)));
check(!local.includes(SECRET), 'storage.local holds no incognito URL');
const session = JSON.stringify(await api(() => chrome.storage.session.get(null)));
check(session.includes(SECRET), 'the incognito layout lives in storage.session only');

// --- Closing the incognito window keeps it out of storage.local and the saved setups.
await api((w) => chrome.windows.remove(w), inc);
await sleep(1500);
const localAfter = JSON.stringify(await api(() => chrome.storage.local.get(null)));
check(!localAfter.includes(SECRET), 'after closing it, storage.local still holds no incognito URL');

cdp.close();
await close();
fs.rmSync(profile, { recursive: true, force: true });
finish();
