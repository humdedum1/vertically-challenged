// Real-Chrome check of the folder menu's "New tab in folder": a pinned, focused new-tab
// page lands as the folder's last item (in Chrome's strip too), and the first real page
// it navigates to becomes the item's home.
//   node tests/e2e/folder-new-tab.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');

const api = (fn, arg) => page.evaluate(fn, arg);
const waitFor = async (what, fn, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await sleep(100);
  }
  check(false, what, 'timed out');
  return false;
};
const win = await api(async () => (await chrome.windows.getCurrent()).id);
await api((w) => {
  globalThis.__layout = null;
  const port = chrome.runtime.connect({ name: 'vc-panel' });
  port.onMessage.addListener((m) => {
    if (m.type === 'layout' && m.windowId === w) globalThis.__layout = m.layout;
  });
  port.postMessage({ type: 'subscribe', windowId: w });
  globalThis.__send = (msg) => port.postMessage(msg);
}, win);
await sleep(500);
const send = (msg) => api((m) => globalThis.__send(m), msg);
const layout = () => api(() => globalThis.__layout);

// A folder holding one pinned tab, followed by a pinned tab outside it.
const [inside, after] = await Promise.all(
  ['in', 'after'].map((n) =>
    api(async (u) => (await chrome.tabs.create({ url: u, active: false })).id, `about:blank#${n}`),
  ),
);
await send({
  type: 'pinTabs',
  tabIds: [inside, after],
  windowId: win,
  dest: { zone: 'pinned', folderId: null, index: 0 },
});
await waitFor('two pinned items', async () => (await layout())?.pinned.length === 2);
const first = (await layout()).pinned[0];
await send({
  type: 'folderCreate',
  windowId: win,
  name: 'Work',
  dest: { zone: 'pinned', folderId: null, index: 0 },
  itemIds: [first.id],
});
await waitFor('the folder exists', async () => (await layout())?.pinned[0]?.kind === 'folder');
const folderId = (await layout()).pinned[0].id;

await page.locator(`#vc-row-f${folderId}`).click({ button: 'right' });
await page.getByRole('menuitem', { name: 'New tab in folder', exact: true }).click();
await waitFor(
  'the folder gets a second item',
  async () => (await layout())?.pinned[0]?.children?.length === 2,
);
const fresh = (await layout()).pinned[0].children[1];
const tab = await api((id) => chrome.tabs.get(id), fresh.tabId);
check(tab.pinned && tab.active, 'the new tab is pinned and focused', JSON.stringify(tab));
check(/newtab/.test(fresh.homeUrl), 'its home starts as the new-tab page', fresh.homeUrl);
await waitFor('Chrome shows it between the folder and the next pin', async () => {
  const s = await api(
    async (w) => (await chrome.tabs.query({ windowId: w, pinned: true })).map((t) => t.id),
    win,
  );
  return JSON.stringify(s) === JSON.stringify([inside, fresh.tabId, after]);
});
check((await layout()).pinned.length === 2, 'no extra item at the pinned root');

await api((id) => chrome.tabs.update(id, { url: 'about:blank#site' }), fresh.tabId);
await waitFor(
  'the first real page becomes its home',
  async () => (await layout())?.pinned[0]?.children?.[1]?.homeUrl === 'about:blank#site',
);

await close();
finish();
