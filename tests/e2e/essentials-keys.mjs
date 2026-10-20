// Real-Chrome keyboard checks for the Essentials grid: Up/Down keep the column across a
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

// Widen the panel until the five Essentials lay out as 4 + 1 (tiles grow from 64px, so
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
  'five Essentials lay out as 4 + 1',
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

await close();
finish();
