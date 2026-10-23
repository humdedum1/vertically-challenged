// Real-Chrome discard checks (Chrome's own tab discarding, not a stub): suspending a tab
// from the panel, closing an Essential (which suspends it and keeps the tile), opening a
// suspended Essential again, and an Essential whose tab is really closed coming back at
// its home URL in its place.
//   node tests/e2e/discard.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');

const api = (fn, arg) => page.evaluate(fn, arg);
// Chrome may give a tab a new id when it discards it (onReplaced); follow those.
await api(() => {
  globalThis.__now = {};
  chrome.tabs.onReplaced.addListener((added, removed) => {
    globalThis.__now[removed] = added;
  });
});
const current = (id) =>
  api((t) => {
    let x = t;
    while (globalThis.__now[x] !== undefined) x = globalThis.__now[x];
    return x;
  }, id);
const win = await api(async () => (await chrome.windows.getCurrent()).id);
const make = (n) =>
  api(async (u) => (await chrome.tabs.create({ url: u, active: false })).id, `about:blank#${n}`);
const plain = await make('plain');
const e1 = await make('e1');
const e2 = await make('e2');
const tabOf = async (id) =>
  api(async (t) => chrome.tabs.get(t).catch(() => null), await current(id));
const waitFor = async (what, fn, ms = 5000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await sleep(100);
  }
  check(false, what, 'timed out');
  return false;
};

// A port of our own for layouts and commands, like the panel's.
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

// --- 1. Suspend a normal tab from the panel: Chrome discards it, the row says so.
await send({ type: 'discard', tabIds: [plain] });
await waitFor('the tab is discarded', async () => (await tabOf(plain))?.discarded === true);
const plainNow = await current(plain);
await waitFor('its row shows it suspended', () =>
  page.evaluate(
    (id) => document.getElementById(`vc-row-t${id}`)?.classList.contains('discarded'),
    plainNow,
  ),
);
// Clicking the row brings it back.
await page.click(`#vc-row-t${plainNow}`);
await waitFor('clicking a suspended row reloads it', async () => {
  const t = await tabOf(plain);
  return t?.active && !t.discarded;
});

// --- 2. Essentials: closing one suspends it and keeps the tile.
await send({
  type: 'pinTabs',
  tabIds: [e1, e2],
  windowId: win,
  dest: { zone: 'essentials', index: 0 },
});
await waitFor('two Essentials', async () => (await layout())?.essentials.length === 2);
const [i1, i2] = (await layout()).essentials;
await send({ type: 'pinClose', windowId: win, itemIds: [i1.id] });
await waitFor(
  'closing an Essential discards its tab',
  async () => (await tabOf(e1))?.discarded === true,
);
await sleep(800);
{
  const l = await layout();
  const e1Now = await current(e1);
  console.log(`  (Chrome ${e1Now === e1 ? 'kept' : 'replaced'} the discarded tab's id)`);
  check(l.essentials.length === 2, 'the tile stays', JSON.stringify(l.essentials));
  check(
    l.essentials[0]?.id === i1.id && l.essentials[0]?.tabId === e1Now,
    'the tile still holds its (discarded) tab, even if Chrome gave it a new id',
    `${JSON.stringify(l.essentials[0])} vs tab ${e1Now}`,
  );
  check(
    l.pinned.length === 0,
    'no second item appears for the discarded tab',
    JSON.stringify(l.pinned),
  );
}
await waitFor('the tile shows it suspended', () =>
  page.evaluate(() =>
    document.querySelector('[role=option][data-index="0"]')?.classList.contains('unloaded'),
  ),
);
await send({ type: 'pinOpen', windowId: win, itemId: i1.id });
await waitFor('opening it again reloads it', async () => {
  const t = await tabOf(e1);
  return t?.active && !t.discarded;
});

// --- 3. Really closing an Essential's tab leaves a dormant tile that comes back in place.
await api((t) => chrome.tabs.remove(t), e2);
await waitFor(
  'the tile turns dormant',
  async () => (await layout())?.essentials[1]?.tabId === null,
);
check((await layout()).essentials[1]?.id === i2.id, 'the dormant tile is the same item');
await send({ type: 'pinOpen', windowId: win, itemId: i2.id });
await waitFor(
  'opening a dormant tile creates its tab',
  async () => (await layout())?.essentials[1]?.tabId !== null,
);
const back = await tabOf((await layout()).essentials[1].tabId);
check(
  back?.url === i2.homeUrl && back.pinned,
  'it opens at its home URL, pinned',
  JSON.stringify(back),
);
const pinnedOrder = await api(
  async (w) =>
    (await chrome.tabs.query({ windowId: w, pinned: true }))
      .sort((x, y) => x.index - y.index)
      .map((t) => t.id),
  win,
);
check(
  JSON.stringify(pinnedOrder) === JSON.stringify((await layout()).essentials.map((i) => i.tabId)),
  'and in its place in Chrome’s pinned tabs',
  JSON.stringify(pinnedOrder),
);

// Group suspend keeps the active tab and tabs outside the group loaded.
const grouped = await Promise.all([make('group-active'), make('group-idle')]);
const outside = await make('outside-group');
const groupId = await api((ids) => chrome.tabs.group({ tabIds: ids }), grouped);
await api((id) => chrome.tabs.update(id, { active: true }), grouped[0]);
const header = page.locator(`#vc-row-g${groupId}`);
await header.click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Suspend all', exact: true }).click();
await waitFor(
  'group suspend discards its inactive tab',
  async () => (await tabOf(grouped[1]))?.discarded === true,
);
check(!(await tabOf(grouped[0]))?.discarded, 'group suspend keeps its active tab loaded');
check(!(await tabOf(outside))?.discarded, 'group suspend leaves other tabs loaded');

await close();
finish();
