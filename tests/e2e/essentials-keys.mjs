// Real-Chrome keyboard checks for the Staples grid: Up/Down keep the column across a
// run (Down to a lone full-width tile, then Up, returns where you started), and any other
// way of focusing a tile starts a new column.
//   node tests/e2e/essentials-keys.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 300, height: 900 });
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');

const win = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
const ids = [];
for (let i = 0; i < 5; i++)
  ids.push(
    await page.evaluate(
      async (n) => (await chrome.tabs.create({ url: `about:blank#e${n}`, active: false })).id,
      i,
    ),
  );
await page.evaluate(
  ([w, tabIds]) => {
    const port = chrome.runtime.connect({ name: 'vc-panel' });
    port.postMessage({ type: 'subscribe', windowId: w });
    setTimeout(
      () =>
        port.postMessage({
          type: 'pinTabs',
          tabIds,
          windowId: w,
          dest: { zone: 'essentials', index: 0 },
        }),
      300,
    );
  },
  [win, ids],
);
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 5);
await sleep(500);

// Widen the panel until the five Staples lay out as 4 + 1 (tiles grow from 64px, so
// the exact width depends on the theme's paddings).
const topsNow = () =>
  page.evaluate(() => [...document.querySelectorAll('[role=option]')].map((e) => e.offsetTop));
let tops = await topsNow();
for (let w = 300; w <= 500; w += 5) {
  await page.setViewportSize({ width: w, height: 900 });
  await sleep(50);
  tops = await topsNow();
  if (new Set(tops.slice(0, 4)).size === 1 && tops[4] > tops[0]) break;
}
check(
  new Set(tops.slice(0, 4)).size === 1 && tops[4] > tops[0],
  'five Staples lay out as 4 + 1',
  JSON.stringify(tops),
);
const tile = (i) => page.locator(`[role=option][data-index="${i}"]`);
const focused = () =>
  page.evaluate(() => Number(document.activeElement?.closest('[role=option]')?.dataset.index));

// A run of Up/Down keeps its column.
await tile(0).focus();
await page.keyboard.press('ArrowDown');
check((await focused()) === 4, 'Down from the first tile reaches the lone last tile');
await page.keyboard.press('ArrowUp');
check((await focused()) === 0, 'Up comes back to the tile the run started on');

// Focus from elsewhere (as Tab or the list would give) starts a new column.
await page.keyboard.press('ArrowDown');
await tile(2).focus();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
check((await focused()) === 2, 'after focusing another tile, Up/Down use that tile’s column');

// So does a right-click (the menu), once the menu is closed.
await tile(0).focus();
await page.keyboard.press('ArrowDown');
await tile(3).click({ button: 'right' });
await sleep(200);
await page.keyboard.press('Escape');
await sleep(200);
await tile(3).focus();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
check((await focused()) === 3, 'after a right-click, Up/Down use that tile’s column');

// Range actions use the same selection on pinned and regular tab context menus.
const added = await page.evaluate(async (windowId) => {
  const port = chrome.runtime.connect({ name: 'vc-panel' });
  port.onMessage.addListener((message) => {
    if (message.type === 'layout' && message.windowId === windowId)
      globalThis.__rangeLayout = message.layout;
  });
  port.postMessage({ type: 'subscribe', windowId });
  const pinned = [];
  const normal = [];
  for (let i = 0; i < 3; i++) {
    pinned.push(
      (
        await chrome.tabs.create({
          windowId,
          url: `about:blank#pin-range-${i}`,
          pinned: true,
          active: false,
        })
      ).id,
    );
    normal.push(
      (await chrome.tabs.create({ windowId, url: `about:blank#normal-range-${i}`, active: false }))
        .id,
    );
  }
  return { pinned, normal };
}, win);
await page.waitForFunction(() => globalThis.__rangeLayout?.pinned.length === 3);
const pinItems = await page.evaluate(() => globalThis.__rangeLayout.pinned.map((item) => item.id));
const pinRow = (i) => page.locator(`#vc-row-p${pinItems[i]}`);
const normalRow = (i) => page.locator(`#vc-row-t${added.normal[i]}`);
const addEssentials = async (row) => {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to Staples', exact: true }).click();
};
await pinRow(0).click({ modifiers: ['Control'] });
await pinRow(2).click({ modifiers: ['Shift'] });
await addEssentials(pinRow(1));
await page.waitForFunction(() => globalThis.__rangeLayout.essentials.length === 8);
check(
  await page.evaluate(
    (ids) =>
      ids.every((id) => globalThis.__rangeLayout.essentials.some((item) => item.tabId === id)),
    added.pinned,
  ),
  'Add to Staples moves the whole pinned range',
);
await normalRow(0).click({ modifiers: ['Control'] });
await normalRow(1).click({ modifiers: ['Shift'] });
await addEssentials(normalRow(2));
await page.waitForFunction(() => globalThis.__rangeLayout.essentials.length === 9);
check(
  await page.evaluate(([a, b, c]) => {
    const ids = globalThis.__rangeLayout.essentials.map((item) => item.tabId);
    return ids.includes(c) && !ids.includes(a) && !ids.includes(b);
  }, added.normal),
  'right-click outside the range adds only the clicked tab',
);
await addEssentials(normalRow(0));
await page.waitForFunction(() => globalThis.__rangeLayout.essentials.length === 11);
check(
  await page.evaluate(
    (ids) =>
      ids.every((id) => globalThis.__rangeLayout.essentials.some((item) => item.tabId === id)),
    added.normal,
  ),
  'Add to Staples moves the whole regular-tab range',
);

await close();
finish();
