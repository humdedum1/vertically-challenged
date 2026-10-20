// Real-Chrome check that the panel recovers when the worker is stopped (as Chrome does
// when it suspends it) at 30 different moments while the panel loads: each time the panel
// must reconnect and match Chrome, including a tab opened right after the stop.
//   node tests/e2e/reconnect.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep, tabRows } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
const panelUrl = `chrome-extension://${extId}/sidepanel.html`;

// A non-panel extension page for chrome.* calls; it holds no port of its own.
const helper = await ctx.newPage();
await helper.goto(`chrome-extension://${extId}/manifest.json`);
const win = await helper.evaluate(async () => (await chrome.windows.getCurrent()).id);
await helper.evaluate(async (w) => {
  for (let i = 0; i < 12; i++)
    await chrome.tabs.create({ windowId: w, url: `about:blank#t${i}`, active: false });
}, win);
const truth = () =>
  helper.evaluate(
    async (w) =>
      (await chrome.tabs.query({ windowId: w })).sort((a, b) => a.index - b.index).map((t) => t.id),
    win,
  );
const matches = async (page) =>
  JSON.stringify(await tabRows(page)) === JSON.stringify(await truth());
const cdp = await ctx.newCDPSession(helper);
await cdp.send('ServiceWorker.enable');

// Stop the worker 0-200 ms into a load. A tab opened right after must still show up once
// the panel has reconnected. Each tab is closed again so the window keeps fitting on
// screen (rows outside the viewport aren't rendered).
const RUNS = 30;
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'race: no page errors', e.message));
let recovered = 0;
const failedAt = [];
for (let i = 0; i < RUNS; i++) {
  const delay = (i * 37) % 200;
  await page.goto('about:blank');
  const nav = page.goto(panelUrl);
  await sleep(delay);
  await cdp.send('ServiceWorker.stopAllWorkers');
  await nav;
  const made = await helper.evaluate(
    async ([w, n]) =>
      (await chrome.tabs.create({ windowId: w, url: `about:blank#race${n}`, active: false })).id,
    [win, i],
  );
  let ok = false;
  for (let k = 0; k < 40 && !ok; k++) {
    await sleep(150);
    ok = await matches(page);
  }
  await helper.evaluate((t) => chrome.tabs.remove(t), made);
  await sleep(300);
  if (ok) recovered++;
  else failedAt.push(delay);
}
check(
  recovered === RUNS,
  `race: panel recovered and matched Chrome in ${recovered}/${RUNS} loads`,
  `failed with the worker stopped at ${failedAt.join(', ')} ms`,
);

await close();
finish();
