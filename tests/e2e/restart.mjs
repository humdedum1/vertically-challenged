// Real-Chrome restart check: two windows with their own Essentials, pinned tabs and a
// folder; the browser is closed and started again on the same profile, which restores
// the session with new tab and window ids. Each window must get its own layout back, with
// every item attached to its restored tab and no setup left over.
//   node tests/e2e/restart.mjs [extension dir]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>${req.url.slice(1)}</title>`);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${srv.address().port}`;

// Restore the previous session on startup ("Continue where you left off").
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-restart-'));
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'Default', 'Preferences'),
  JSON.stringify({ session: { restore_on_startup: 1 } }),
);
const ext = extensionDir();

/** Opens a port-holding extension page that records every layout and the setups. */
async function observer(ctx, extId) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/manifest.json`);
  await page.evaluate(async () => {
    const w = (await chrome.windows.getCurrent()).id;
    globalThis.__layouts = {};
    globalThis.__setups = null;
    const port = chrome.runtime.connect({ name: 'vc-panel' });
    port.onMessage.addListener((m) => {
      if (m.type === 'layout') globalThis.__layouts[m.windowId] = m.layout;
      if (m.type === 'setups') globalThis.__setups = m.setups;
    });
    port.postMessage({ type: 'subscribe', windowId: w });
    globalThis.__send = (msg) => port.postMessage(msg);
  });
  await sleep(800);
  return page;
}

const flat = (l) => {
  const out = [];
  const walk = (nodes, folder) => {
    for (const n of nodes) {
      if (n.kind === 'item') out.push({ id: n.id, url: n.homeUrl, tabId: n.tabId, folder });
      else walk(n.children, n.name);
    }
  };
  for (const e of l.essentials) out.push({ id: e.id, url: e.homeUrl, tabId: e.tabId, zone: 'ess' });
  walk(l.pinned, null);
  return out;
};

// --- First run: build the two windows' layouts.
let run = await launch(ext, { profile });
let page = await observer(run.ctx, run.extId);
const api = (fn, arg) => page.evaluate(fn, arg);
const open = (w, name) =>
  api(
    async ([windowId, url]) => (await chrome.tabs.create({ windowId, url, active: false })).id,
    [w, `${SITE}/${name}`],
  );
const winA = await api(async () => (await chrome.windows.getCurrent()).id);
const winB = await api(
  async (url) => (await chrome.windows.create({ url, focused: false })).id,
  `${SITE}/b-home`,
);
const a = [];
for (const n of ['a1', 'a2', 'a3', 'a4']) a.push(await open(winA, n));
const b = [];
for (const n of ['b1', 'b2']) b.push(await open(winB, n));
await sleep(1500);
const send = (msg) => api((m) => globalThis.__send(m), msg);
await send({
  type: 'pinTabs',
  tabIds: a.slice(0, 2),
  windowId: winA,
  dest: { zone: 'essentials', index: 0 },
});
await send({
  type: 'pinTabs',
  tabIds: b.slice(0, 1),
  windowId: winB,
  dest: { zone: 'essentials', index: 0 },
});
await sleep(800);
await send({
  type: 'pinTabs',
  tabIds: a.slice(2),
  windowId: winA,
  dest: { zone: 'pinned', folderId: null, index: 0 },
});
await send({
  type: 'pinTabs',
  tabIds: b.slice(1),
  windowId: winB,
  dest: { zone: 'pinned', folderId: null, index: 0 },
});
await sleep(800);
const a4Item = await api(
  ([w, t]) => globalThis.__layouts[w].pinned.find((n) => n.kind === 'item' && n.tabId === t)?.id,
  [winA, a[3]],
);
await send({
  type: 'folderCreate',
  windowId: winA,
  name: 'Folder',
  dest: { zone: 'pinned', folderId: null, index: 1 },
  itemIds: [a4Item],
});
await sleep(1500);
const before = await api(
  ([x, y]) => [globalThis.__layouts[x], globalThis.__layouts[y]],
  [winA, winB],
);
check(
  flat(before[0]).length === 4 && flat(before[1]).length === 2,
  'first run: both windows have their layouts',
  JSON.stringify(before.map(flat)),
);
await run.close();

// --- Second run: Chrome restores both windows with new ids.
run = await launch(ext, { profile, args: ['--restore-last-session'] });
await sleep(4000);
page = await observer(run.ctx, run.extId);
const wins = await api(async () =>
  (await chrome.windows.getAll({ populate: true })).map((w) => ({
    id: w.id,
    urls: w.tabs.map((t) => t.url),
  })),
);
const winOf = (url) => wins.find((w) => w.urls.includes(url))?.id;
const newA = winOf(`${SITE}/a1`);
const newB = winOf(`${SITE}/b1`);
check(
  newA !== undefined && newB !== undefined && newA !== newB,
  'both windows were restored',
  JSON.stringify(wins),
);
const oldTabIds = new Set([...a, ...b]);
const restoredIds = await api(async () => (await chrome.tabs.query({})).map((t) => t.id));
check(
  newA !== winA && newB !== winB && !restoredIds.some((id) => oldTabIds.has(id)),
  'the restored windows and tabs have new ids (a real restart)',
);
const after = await api(
  ([x, y]) => [globalThis.__layouts[x], globalThis.__layouts[y]],
  [newA, newB],
);
const tabsNow = await api(async () =>
  Object.fromEntries(
    (await chrome.tabs.query({})).map((t) => [t.id, { url: t.url, pinned: t.pinned }]),
  ),
);
for (const [k, name] of [
  [0, 'A'],
  [1, 'B'],
]) {
  const was = before[k];
  const now = after[k];
  check(now?.id === was.id, `window ${name} got its own layout back`, `${now?.id} vs ${was.id}`);
  const wasItems = flat(was).map(({ id, url, folder, zone }) => ({ id, url, folder, zone }));
  const nowItems = now ? flat(now) : [];
  check(
    JSON.stringify(nowItems.map(({ id, url, folder, zone }) => ({ id, url, folder, zone }))) ===
      JSON.stringify(wasItems),
    `window ${name}: same Essentials, pinned tabs and folder`,
    JSON.stringify(nowItems),
  );
  check(
    nowItems.every(
      (i) => i.tabId !== null && tabsNow[i.tabId]?.url === i.url && tabsNow[i.tabId]?.pinned,
    ),
    `window ${name}: every item is attached to its restored pinned tab`,
    JSON.stringify(nowItems),
  );
}
const setups = await api(() => globalThis.__setups);
check(
  Array.isArray(setups) && setups.length === 0,
  'no layout was left over as a saved setup',
  JSON.stringify(setups),
);

await run.close();
srv.close();
fs.rmSync(profile, { recursive: true, force: true });
finish();
