// Touch input on the tab list: tapping a row opens its tab, swiping scrolls the list, and a
// swipe, a second finger or a cancelled gesture never leaves the list stuck mid-drag.
// Touch is synthesized through CDP (Input.dispatchTouchEvent), so this covers Chromium only.
//   node tests/e2e/touch.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 600 });
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
for (let i = 0; i < 40; i++)
  await page.evaluate((n) => chrome.tabs.create({ url: `about:blank#t${n}`, active: false }), i);
await page.waitForFunction(() => document.querySelectorAll('[id^="vc-row-t"]').length >= 10);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const touch = (type, points) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id })),
  });
const center = async (sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
const scrollTop = () => page.evaluate(() => document.querySelector('.viewport').scrollTop);
/** A tab row that is fully inside the list's visible area (the Welcome card can leave little room). */
const visibleRow = (skip = 0) =>
  page.evaluate((n) => {
    const v = document.querySelector('.viewport').getBoundingClientRect();
    const rows = [...document.querySelectorAll('[id^="vc-row-t"]')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= v.top && r.bottom <= v.bottom;
    });
    return Number(rows[n]?.id.slice(8));
  }, skip);

const dragging = () => page.evaluate(() => !!document.querySelector('.ghost'));

// Control: a mouse drag does show the drag ghost, so the "not dragging" checks below can fail.
{
  const id = await visibleRow(0);
  const [mx, my] = await center(`#vc-row-t${id}`);
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx, my + 14, { steps: 4 });
  await sleep(150);
  check(await dragging(), 'control: a mouse drag shows the drag ghost');
  await page.mouse.up();
  await sleep(300);
  check(!(await dragging()), 'control: releasing the mouse ends the drag');
}

// Tap.
const target = await visibleRow(0);
const [tx, ty] = await center(`#vc-row-t${target}`);
await touch('touchStart', [[tx, ty]]);
await touch('touchEnd', []);
await sleep(400);
check(
  await page.evaluate((id) => chrome.tabs.get(id).then((t) => t.active), target),
  'a tap on a row activates that tab',
);

// Swipe up: the list scrolls and no drag starts.
const before = await scrollTop();
const box = await page.evaluate(() => {
  const r = document.querySelector('.viewport').getBoundingClientRect();
  return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
});
const x = box.x;
let y = box.bottom - 8;
await touch('touchStart', [[x, y]]);
for (let d = 0; d <= box.bottom - box.top - 20; d += 6) await touch('touchMove', [[x, y - d]]);
await touch('touchEnd', []);
await sleep(500);
check(
  (await scrollTop()) > before,
  'swiping scrolls the list',
  `${before} -> ${await scrollTop()}`,
);
check(!(await dragging()), 'a swipe does not leave a drag in progress');

// A second finger landing mid-gesture, then a cancel: the next tap still works.
const second = await visibleRow(1);
y = box.bottom - 8;
await touch('touchStart', [[x, y]]);
await touch('touchMove', [[x, y - 20]]);
await touch('touchStart', [
  [x, y - 20],
  [x + 80, y],
]);
await touch('touchCancel', []);
await sleep(300);
check(!(await dragging()), 'a second finger and a cancel leave nothing stuck');
const [sx, sy] = await center(`#vc-row-t${second}`);
await touch('touchStart', [[sx, sy]]);
await touch('touchEnd', []);
await sleep(400);
check(
  await page.evaluate((id) => chrome.tabs.get(id).then((t) => t.active), second),
  'a tap right after an interrupted gesture still works',
);

await close();
finish();
