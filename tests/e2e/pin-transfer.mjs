// Real-Chrome check for pinned tabs moved between windows outside the panel (dragging in
// Chrome's tab strip sends the same tab events as tabs.move to another window): the item
// goes along with its tab, keeps its id, and is never left behind or doubled.
//   node tests/e2e/pin-transfer.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
const api = (fn, arg) => page.evaluate(fn, arg);

const winA = await api(async () => (await chrome.windows.getCurrent()).id);
const make = (w, n) =>
  api(
    async ([windowId, url]) => (await chrome.tabs.create({ windowId, url, active: false })).id,
    [w, `about:blank#${n}`],
  );
const winB = await api(
  async () => (await chrome.windows.create({ url: 'about:blank#b-home', focused: false })).id,
);
const e1 = await make(winA, 'e1');
const p1 = await make(winA, 'p1');
const p2 = await make(winA, 'p2');
const b1 = await make(winB, 'b1');

await api(() => {
  globalThis.__layouts = {};
  const port = chrome.runtime.connect({ name: 'vc-panel' });
  port.onMessage.addListener((m) => {
    if (m.type === 'layout') globalThis.__layouts[m.windowId] = m.layout;
  });
  chrome.windows.getCurrent().then((w) => port.postMessage({ type: 'subscribe', windowId: w.id }));
  globalThis.__send = (msg) => port.postMessage(msg);
});
await sleep(500);
const send = (msg) => api((m) => globalThis.__send(m), msg);
await send({
  type: 'pinTabs',
  tabIds: [e1],
  windowId: winA,
  dest: { zone: 'essentials', index: 0 },
});
await send({
  type: 'pinTabs',
  tabIds: [p1, p2],
  windowId: winA,
  dest: { zone: 'pinned', folderId: null, index: 0 },
});
await send({
  type: 'pinTabs',
  tabIds: [b1],
  windowId: winB,
  dest: { zone: 'pinned', folderId: null, index: 0 },
});
await sleep(1200);

const layouts = () => api(() => globalThis.__layouts);
const items = (l) => {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) n.kind === 'item' ? out.push(n) : walk(n.children);
  };
  out.push(...(l?.essentials ?? []));
  walk(l?.pinned ?? []);
  return out;
};
const itemOf = async (w, tabId) => items((await layouts())[w]).find((i) => i.tabId === tabId);
const p2Item = (await itemOf(winA, p2))?.id;
const e1Item = (await itemOf(winA, e1))?.id;
check(p2Item && e1Item, 'setup: window A has the Essential and the pinned tabs');

/** Every item across both layouts, once each; tab ids bound at most once. */
async function noDuplicates(label) {
  const all = Object.values(await layouts()).flatMap(items);
  const ids = all.map((i) => i.id);
  const tabs = all.map((i) => i.tabId).filter((t) => t !== null);
  check(
    new Set(ids).size === ids.length && new Set(tabs).size === tabs.length,
    `${label}: no item or tab appears twice`,
    JSON.stringify(all.map((i) => [i.id, i.tabId])),
  );
}

// --- A pinned tab moved to window B, as a tab-strip drag would.
await api(([t, w]) => chrome.tabs.move(t, { windowId: w, index: 0 }), [p2, winB]);
await sleep(1500);
const p2Tab = await api((t) => chrome.tabs.get(t), p2);
check(p2Tab.windowId === winB, 'Chrome moved the tab to window B', JSON.stringify(p2Tab));
if (p2Tab.pinned) {
  const moved = await itemOf(winB, p2);
  check(moved?.id === p2Item, 'its item went along to window B, same item');
  check((await itemOf(winA, p2)) === undefined, 'and is gone from window A');
} else {
  // Chrome unpinned it on the way: then it is a normal tab and no layout keeps it.
  check(
    (await itemOf(winA, p2)) === undefined && (await itemOf(winB, p2)) === undefined,
    'unpinned on the move, it left both layouts',
  );
}
await noDuplicates('after moving a pinned tab');
if (process.env.DEBUG)
  console.log(
    JSON.stringify({
      p2,
      A: items((await layouts())[winA]).map((i) => [i.id, i.tabId]),
      B: items((await layouts())[winB]).map((i) => [i.id, i.tabId]),
    }),
  );

// --- An Essential's tab moved the same way, and back again.
await api(([t, w]) => chrome.tabs.move(t, { windowId: w, index: 0 }), [e1, winB]);
await sleep(1500);
const e1Tab = await api((t) => chrome.tabs.get(t), e1);
if (e1Tab.pinned) {
  check((await itemOf(winB, e1))?.id === e1Item, 'an Essential’s item goes along to window B');
  check((await itemOf(winA, e1)) === undefined, 'and leaves window A');
}
await noDuplicates('after moving an Essential');
await api(([t, w]) => chrome.tabs.move(t, { windowId: w, index: 0 }), [e1, winA]);
await sleep(1500);
if ((await api((t) => chrome.tabs.get(t), e1)).pinned) {
  check((await itemOf(winA, e1))?.id === e1Item, 'moved back, the same item returns to window A');
  check((await itemOf(winB, e1)) === undefined, 'and leaves window B');
}
await noDuplicates('after moving it back');

// --- Chrome's pinned order in each window matches its layout.
for (const [w, name] of [
  [winA, 'A'],
  [winB, 'B'],
]) {
  const chromeOrder = await api(
    async (id) =>
      (await chrome.tabs.query({ windowId: id, pinned: true }))
        .sort((x, y) => x.index - y.index)
        .map((t) => t.id),
    w,
  );
  const layoutOrder = items((await layouts())[w])
    .map((i) => i.tabId)
    .filter((t) => t !== null);
  check(
    JSON.stringify(chromeOrder) === JSON.stringify(layoutOrder),
    `window ${name}: Chrome's pinned tabs are in layout order`,
    `${JSON.stringify(chromeOrder)} vs ${JSON.stringify(layoutOrder)}`,
  );
}

await close();
finish();
