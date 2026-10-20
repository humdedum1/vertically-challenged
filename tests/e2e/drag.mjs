// Real-Chrome drag checks: reordering by drag, dropping onto another window's mini
// Essentials row, and the list changing under a pointer that holds still mid-drag (the
// drop must follow the row now under the pointer, not the one that was there).
//   node tests/e2e/drag.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');

const api = (fn, arg) => page.evaluate(fn, arg);
const winA = await api(async () => (await chrome.windows.getCurrent()).id);
for (let i = 1; i <= 4; i++)
  await api((n) => chrome.tabs.create({ url: `about:blank#a${n}`, active: false }), i);
const winB = await api(
  async () => (await chrome.windows.create({ url: 'about:blank#b0', focused: false })).id,
);
const bTabs = [];
for (let i = 1; i <= 3; i++)
  bTabs.push(
    await api(
      async ([w, n]) =>
        (await chrome.tabs.create({ windowId: w, url: `about:blank#b${n}`, active: false })).id,
      [winB, i],
    ),
  );

// Layout messages for both windows, read from a port of our own.
await api(
  (ids) => {
    globalThis.__layouts = {};
    const port = chrome.runtime.connect({ name: 'vc-panel' });
    port.onMessage.addListener((m) => {
      if (m.type === 'layout') globalThis.__layouts[m.windowId] = m.layout;
    });
    port.postMessage({ type: 'subscribe', windowId: ids[0] });
    globalThis.__send = (msg) => port.postMessage(msg);
  },
  [winA, winB],
);
await sleep(500);
// Two of window B's tabs become its Essentials, so A's panel shows B's mini tiles row.
await api(
  ([w, ids]) =>
    globalThis.__send({
      type: 'pinTabs',
      tabIds: ids,
      windowId: w,
      dest: { zone: 'essentials', index: 0 },
    }),
  [winB, bTabs.slice(0, 2)],
);
await page.waitForSelector(`#vc-row-x${winB}-0 .tile`, { timeout: 10000 });
await sleep(500);

const order = (w) =>
  api(
    async (id) =>
      (await chrome.tabs.query({ windowId: id }))
        .sort((a, b) => a.index - b.index)
        .map((t) => t.id),
    w,
  );
const box = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no element ${sel}`);
  return b;
};
/** Presses on a row and drags past the threshold, ending at (x, y). */
async function dragFrom(sel, x, y) {
  const from = await box(sel);
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  const steps = 12;
  const sx = from.x + 40;
  const sy = from.y + from.height / 2;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + ((x - sx) * i) / steps, sy + ((y - sy) * i) / steps);
    await sleep(16);
  }
  await sleep(150);
}

// --- 1. Reorder by drag: the last of A's tabs dropped above the first.
{
  const ids = await order(winA);
  const last = ids.at(-1);
  const first = await box(`#vc-row-t${ids[0]}`);
  await dragFrom(`#vc-row-t${last}`, first.x + 40, first.y + 3);
  check((await page.locator('.drop-line').count()) === 1, 'a drop line shows while dragging');
  await page.mouse.up();
  await sleep(800);
  const after = await order(winA);
  check(after[0] === last, 'dragging a tab above the first moves it there', JSON.stringify(after));
}

// --- 2. Onto B's mini Essentials row: the tile bar shows, and the drop adds an Essential.
{
  const ids = (await order(winA)).filter((id) => id !== undefined);
  const tile = await box(`#vc-row-x${winB}-0 .tile`);
  const tabId = ids.at(-1);
  await dragFrom(`#vc-row-t${tabId}`, tile.x + 2, tile.y + tile.height / 2);
  check((await page.locator('.tiles-bar').count()) === 1, 'the bar between mini tiles shows');
  await page.mouse.up();
  await sleep(1200);
  const l = await api((w) => globalThis.__layouts[w], winB);
  check(
    l?.essentials.some((i) => i.tabId === tabId),
    'dropping between mini tiles makes the tab one of that window’s Essentials',
    JSON.stringify(l?.essentials.map((i) => i.tabId)),
  );
}

// --- 3. Hold still over the mini tiles while a new tab pushes the list down a row.
{
  const before = await api((w) => globalThis.__layouts[w].essentials.length, winB);
  const ids = await order(winA);
  const tabId = ids.find((id) => id !== ids[0]) ?? ids[0];
  const tile = await box(`#vc-row-x${winB}-0 .tile`);
  await dragFrom(`#vc-row-t${tabId}`, tile.x + 2, tile.y + tile.height / 2);
  check((await page.locator('.tiles-bar').count()) === 1, 'held: the tile bar shows first');
  await api(() => chrome.tabs.create({ url: 'about:blank#pushed', active: false }));
  await sleep(800);
  // The row under the pointer is no longer the tiles row.
  const under = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[role=treeitem]')?.id ?? null,
    [tile.x + 2, tile.y + tile.height / 2],
  );
  check(under !== `vc-row-x${winB}-0`, 'the list moved under the pointer', String(under));
  check(
    (await page.locator('.tiles-bar').count()) === 0,
    'the tile bar goes once the tiles row has moved away',
  );
  await page.mouse.up();
  await sleep(1200);
  const after = await api((w) => globalThis.__layouts[w].essentials.length, winB);
  check(
    after === before,
    'the drop follows the row now under the pointer, not the stale tiles',
    `${before} -> ${after}`,
  );
}

await close();
finish();
