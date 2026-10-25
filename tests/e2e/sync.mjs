// Real-Chrome checks for sync option 1. A second machine can't be signed in here, so the
// other device is played by writing its document into chrome.storage.sync in the published
// format (deflate-raw, base64, chunks under a header). Checks this device's own document,
// the Sessions panel's "Other devices" card, opening, applying and keeping another device's
// workspace and session, and the switches in Settings.
//   node tests/e2e/sync.mjs [extension dir]

import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${req.url.slice(1) || 'home'}</title>`);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${srv.address().port}`;

const { ctx, extId, close } = await launch(extensionDir(), { width: 380, height: 1100 });
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
const api = (fn, arg) => page.evaluate(fn, arg);
const win = await api(async () => (await chrome.windows.getCurrent()).id);
const tabs = [];
for (const n of ['mail', 'cal', 'docs', 'ordinary'])
  tabs.push(
    await api(
      (u) => chrome.tabs.create({ url: u, active: false }).then((t) => t.id),
      `${SITE}/${n}`,
    ),
  );
await sleep(800);

await api(() => {
  const port = chrome.runtime.connect({ name: 'vc-panel' });
  chrome.windows.getCurrent().then((w) => port.postMessage({ type: 'subscribe', windowId: w.id }));
  globalThis.__send = (m) => port.postMessage(m);
  globalThis.__layouts = {};
  port.onMessage.addListener((m) => {
    if (m.type === 'layout') globalThis.__layouts[m.windowId] = m.layout;
  });
});
await sleep(400);
const send = (m) => api((x) => globalThis.__send(x), m);
await send({
  type: 'pinTabs',
  tabIds: tabs.slice(0, 2),
  windowId: win,
  dest: { zone: 'essentials', index: 0 },
});
await send({
  type: 'pinTabs',
  tabIds: tabs.slice(2, 3),
  windowId: win,
  dest: { zone: 'pinned', folderId: null, index: 0 },
});
await sleep(800);

/** Every device document in sync storage, decoded in Node (independent of our code). */
async function docs() {
  const all = await api(() => chrome.storage.sync.get(null));
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    const m = /^dev:([a-z0-9]{10})$/.exec(k);
    if (!m) continue;
    let s = '';
    for (let i = 0; i < v.n; i++) s += all[`dev:${m[1]}:${i}`] ?? '';
    try {
      out[m[1]] = JSON.parse(zlib.inflateRawSync(Buffer.from(s, 'base64')).toString('utf8'));
    } catch {
      out[m[1]] = null;
    }
  }
  return out;
}
const me = async () => (await api(() => chrome.storage.local.get('vc:device')))['vc:device'];

// --- 1. This device publishes its workspace ("Sync now" skips the debounce).
await send({ type: 'syncNow' });
await sleep(1500);
const myId = (await me())?.id;
check(/^[a-z0-9]{10}$/.test(myId ?? ''), 'this device got an id', String(myId));
let mine = (await docs())[myId];
const ws = mine?.workspaces?.[0];
check(ws?.kind === 'window', 'its open window is published as a workspace', JSON.stringify(mine));
check(
  JSON.stringify(ws?.window.layout.essentials.map((i) => ws.window.tabs[i].url)) ===
    JSON.stringify([`${SITE}/mail`, `${SITE}/cal`]),
  'with its Staples',
);
check(!JSON.stringify(mine).includes('"tabId"'), 'without live tab ids');
check(
  ws?.window.tabs.some((t) => t.url === `${SITE}/ordinary` && !t.pinned),
  'ordinary tabs are published too',
);
check(
  !ws?.window.tabs.some((t) => t.url.startsWith('chrome-extension://')),
  'extension pages are excluded',
);

// A saved session joins it.
await send({ type: 'saveSession', scope: 'window', windowId: win, name: 'Research' });
await sleep(500);
await send({ type: 'syncNow' });
await sleep(1500);
mine = (await docs())[myId];
check(
  mine?.sessions?.some((s) => s.name === 'Research'),
  'saved sessions are published too',
);

// --- 2. Another device: a workspace with a folder, and a saved session.
const otherId = 'zzotherdev1'.slice(0, 10);
const other = {
  v: 1,
  device: { id: otherId, name: 'Work laptop', os: 'win' },
  updatedAt: Date.now() - 120_000,
  workspaces: [
    {
      id: 'lremotews01',
      name: 'Design',
      kind: 'window',
      lastUsed: 1,
      window: {
        tabs: [
          { url: `${SITE}/figma`, title: 'Figma', pinned: true, group: null },
          { url: `${SITE}/linear`, title: 'Linear', pinned: true, group: null },
          { url: `${SITE}/notion`, title: 'Notion', pinned: true, group: null },
          { url: `${SITE}/remote-ordinary`, title: 'Remote ordinary', pinned: false, group: 0 },
        ],
        groups: [{ title: 'Remote group', color: 'blue', collapsed: false }],
        layout: {
          essentials: [0],
          pinned: [
            {
              kind: 'folder',
              name: 'Tracking',
              icon: 'work',
              collapsed: false,
              children: [
                { kind: 'item', tab: 1 },
                { kind: 'item', tab: 2 },
              ],
            },
          ],
        },
      },
    },
  ],
  sessions: [
    {
      id: 'remotesession1',
      name: 'Reading list',
      createdAt: 1,
      windows: [
        {
          tabs: [
            { url: `${SITE}/article-1`, title: 'Article 1', pinned: false, group: null },
            { url: `${SITE}/article-2`, title: 'Article 2', pinned: false, group: null },
          ],
          groups: [],
        },
      ],
    },
  ],
  omitted: { workspaces: 0, sessions: 1 },
};
const b64 = zlib.deflateRawSync(Buffer.from(JSON.stringify(other))).toString('base64');
await api(
  ([id, s, at]) =>
    chrome.storage.sync.set({
      [`dev:${id}`]: { n: 1, updatedAt: at, name: 'Work laptop' },
      [`dev:${id}:0`]: s,
    }),
  [otherId, b64, other.updatedAt],
);

await page.getByRole('tab', { name: 'Sessions' }).click();
await page.waitForSelector('section[aria-label="Work laptop"]', { timeout: 5000 }).catch(() => {});
const card = page.locator('section[aria-label="Work laptop"]');
check((await card.count()) === 1, 'the other device shows in the Sessions panel');
const text = (await card.textContent()) ?? '';
check(
  text.includes('Design') && text.includes('1 Staple') && text.includes('1 folder'),
  'with its workspace and what it holds',
  text,
);
check(text.includes('Reading list') && text.includes('2 tabs'), 'and its saved session', text);
check(text.includes('1 more item'), 'and says what didn’t fit');
check(
  (await page
    .locator('section[aria-label="Work laptop"] img, section[aria-label="Work laptop"] svg')
    .count()) > 0,
  'with icons',
);

// --- 3. Open the workspace in a new window: its layout, items waiting to be opened.
const windowsBefore = await api(async () => (await chrome.windows.getAll()).length);
await card.getByRole('button', { name: 'Open in new window' }).click();
await sleep(1500);
const winsAfter = await api(async () => (await chrome.windows.getAll()).map((w) => w.id));
check(winsAfter.length === windowsBefore + 1, 'opening it makes a new window');
const newWin = winsAfter.find((id) => id !== win);
const l = await api((w) => globalThis.__layouts[w], newWin);
check(l?.name === 'Design', 'the new window has the workspace’s layout', JSON.stringify(l));
check(l?.essentials?.[0]?.homeUrl === `${SITE}/figma`, 'with its Staple');
check(l?.pinned?.[0]?.kind === 'folder' && l.pinned[0].children.length === 2, 'and its folder');
check(
  await api(
    async ([windowId, url]) =>
      (await chrome.tabs.query({ windowId })).some((t) => t.url === url && !t.pinned),
    [newWin, `${SITE}/remote-ordinary`],
  ),
  'opening a workspace restores its ordinary tabs',
);
check(
  await api(
    async (windowId) =>
      (await chrome.tabGroups.query({ windowId })).some((g) => g.title === 'Remote group'),
    newWin,
  ),
  'and their native groups',
);

// --- 4. Add it to this window instead; and keep a copy as a setup.
await card.getByRole('button', { name: 'Add to this window' }).click();
await sleep(1500);
const here = await api((w) => globalThis.__layouts[w], win);
const urls = (n) => (n.kind === 'item' ? [n.homeUrl] : n.children.flatMap(urls));
check(
  here.essentials.map((i) => i.homeUrl).includes(`${SITE}/figma`) &&
    here.pinned.flatMap(urls).includes(`${SITE}/linear`),
  'adding it puts its pinned tabs into this window, after what was there',
  JSON.stringify(here.essentials.map((i) => i.homeUrl)),
);
check(here.essentials[0]?.homeUrl === `${SITE}/mail`, 'and keeps this window’s own Staples first');
check(
  await api(
    async ([windowId, url]) => (await chrome.tabs.query({ windowId })).some((t) => t.url === url),
    [win, `${SITE}/remote-ordinary`],
  ),
  'adding a workspace also restores its ordinary tabs',
);
await card.getByRole('button', { name: 'Keep here' }).first().click();
await sleep(1200);
const setups = await page.locator('ul[aria-label="Window setups"] li').allTextContents();
check(
  setups.some((s) => s.includes('Design')),
  'keeping it adds it to Window setups',
  JSON.stringify(setups),
);

// --- 5. Restore the other device's session, and keep a copy.
const before = await api(async () => (await chrome.tabs.query({})).length);
await card.getByRole('button', { name: 'Restore' }).click();
await sleep(2000);
const opened = await api(
  async (s) =>
    (await chrome.tabs.query({})).filter((t) => t.url.startsWith(`${s}/article-`)).length,
  SITE,
);
check(opened === 2, 'restoring the session opens its tabs', `${opened} (had ${before} tabs)`);
await card.getByRole('button', { name: 'Keep here' }).nth(1).click();
await sleep(1200);
const local = await api(() => chrome.storage.local.get('sessions'));
check(
  local.sessions?.some(
    (s) =>
      s.name === 'Design' && s.windows[0].tabs.some((t) => t.url === `${SITE}/remote-ordinary`),
  ),
  'keeping a workspace saves its full snapshot, including ordinary tabs',
);
check(
  local.sessions?.some((s) => s.name === 'Reading list'),
  'keeping it adds it to Saved sessions',
);

// --- 6. A tampered document is ignored, not shown.
await api(([id]) => chrome.storage.sync.set({ [`dev:${id}:0`]: 'not base64 at all!' }), [otherId]);
await sleep(800);
check(
  (await page.locator('section[aria-label="Work laptop"]').count()) === 0,
  'a document that doesn’t decode is not shown',
);

// --- 7. Settings: status, and switching both off removes this device's document.
await page.getByRole('tab', { name: 'Settings' }).click();
await page.waitForSelector('#vc-device-name');
check(
  (await page.locator('#vc-sync-interval').inputValue()) === '1',
  'automatic sync displays its default interval',
);
const statusText =
  (await page
    .locator('[role="status"]')
    .filter({ hasText: /Synced.*100 KB/s })
    .first()
    .textContent()) ?? '';
check(
  /Synced[\s\S]* of 100 KB/.test(statusText),
  'Settings shows when it synced and the space used',
  statusText,
);
await page.selectOption('#vc-sync-interval', '5');
await sleep(500);
check(
  await api(async () => (await chrome.alarms.get('vc-auto-sync'))?.periodInMinutes === 5),
  'automatic sync uses the selected persistent alarm interval',
);
await page.selectOption('#vc-sync-interval', '0');
await sleep(500);
check(
  await api(async () => !(await chrome.alarms.get('vc-auto-sync'))),
  'manual-only sync removes its alarm',
);
check(
  await api(
    async () => (await chrome.storage.sync.get('settings')).settings.sync.intervalMinutes === 0,
  ),
  'sync timing preference is stored in Chrome Sync',
);
await page.selectOption('#vc-sync-interval', '1');
await sleep(500);
check(
  await api(async () => (await chrome.alarms.get('vc-auto-sync'))?.periodInMinutes === 1),
  'automatic sync can be re-enabled',
);
const publishedBeforeWake = (await docs())[myId].updatedAt;
await api(async (url) => {
  await chrome.tabs.create({ url, active: false });
  const stored = await chrome.storage.local.get('vc:syncStatus');
  await chrome.storage.local.set({
    'vc:syncStatus': { ...stored['vc:syncStatus'], publishedAt: Date.now() - 61_000 },
  });
  await chrome.alarms.create('vc-auto-sync', { when: Date.now() + 1500, periodInMinutes: 1 });
}, `${SITE}/after-worker-stop`);
const cdp = await ctx.newCDPSession(page);
await cdp.send('ServiceWorker.enable');
await cdp.send('ServiceWorker.stopAllWorkers');
await page.waitForFunction(
  async (previous) =>
    (await chrome.storage.local.get('vc:syncStatus'))['vc:syncStatus']?.publishedAt > previous,
  publishedBeforeWake,
  { timeout: 8000 },
);
let wokeWithTabs = false;
for (let attempt = 0; attempt < 30 && !wokeWithTabs; attempt++) {
  wokeWithTabs = Object.values(await docs()).some((d) =>
    d?.workspaces.some((w) => w.window.tabs.some((t) => t.url === `${SITE}/after-worker-stop`)),
  );
  if (!wokeWithTabs) await sleep(200);
}
check(
  wokeWithTabs,
  'automatic alarm publishes current tabs after the worker is stopped',
  JSON.stringify(await docs()),
);

const navigation = page.waitForEvent('load');
await page.getByRole('button', { name: 'Reload panel', exact: true }).click();
await navigation;
await page.getByRole('tab', { name: 'Settings' }).click();
await page.waitForSelector('#vc-device-name');
check(
  (await page.getByRole('button', { name: 'Reload panel', exact: true }).count()) === 1,
  'header reload reconnects the panel',
);
await api(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({
    settings: { ...settings, appearance: { ...settings.appearance, mode: 'dark' } },
  });
});
await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
check(true, 'incoming synced settings update the live panel');
const custom = JSON.parse(
  fs.readFileSync(new URL('../../src/themes/abyss.json', import.meta.url), 'utf8'),
);
custom.dark.mPrimary = '#123456';
await api(async (theme) => {
  await chrome.storage.sync.set({
    'theme:custom-synctest': { ...theme, name: 'Synced test theme' },
  });
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({
    settings: { ...settings, appearance: { ...settings.appearance, themeId: 'custom-synctest' } },
  });
}, custom);
await page.waitForFunction(
  () =>
    getComputedStyle(document.documentElement).getPropertyValue('--mPrimary').trim() === '#123456',
);
check(true, 'incoming custom themes and theme selection apply to the panel');
await page.getByRole('switch', { name: 'Sync workspaces' }).click();
await page.getByRole('switch', { name: 'Sync saved sessions' }).click();
await sleep(2500);
check(
  (await docs())[myId] === undefined,
  'with both switches off, this device’s document is removed',
);
check(
  (await page.locator('text=Not sharing anything from this device').count()) === 1,
  'and Settings says so',
);

// --- 8. Renaming this device republishes under the new name.
await page.getByRole('switch', { name: 'Sync workspaces' }).click();
await page.fill('#vc-device-name', 'Test rig');
await page.getByRole('button', { name: 'Rename', exact: true }).click();
await sleep(2000);
check(
  (await docs())[myId]?.device?.name === 'Test rig',
  'renaming this device republishes it under the new name',
);

await close();
srv.close();
finish();
