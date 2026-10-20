// Real-Chrome checks for the panel's boot-connection fallback: the early port is dead
// before the panel takes it over, the boot script never ran, and the worker being stopped
// at random moments while the panel loads. In every case the panel must end up connected
// and matching Chrome.
//   node tests/e2e/boot-handoff.mjs [extension dir]
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

// --- 1. Forced: kill the boot port as the boot script publishes it and flag it, the
// state a worker drop leaves behind. The panel must open its own connection.
const forced = await ctx.newPage();
forced.on('pageerror', (e) => check(false, 'forced: no page errors', e.message));
await forced.addInitScript(() => {
  let boot;
  Object.defineProperty(globalThis, '__vcBoot', {
    configurable: true,
    get: () => boot,
    set: (b) => {
      boot = b;
      if (b && !globalThis.__dropped) {
        globalThis.__dropped = true;
        b.port.disconnect();
        b.disconnected = true;
      }
    },
  });
  const connect = chrome.runtime.connect.bind(chrome.runtime);
  globalThis.__connects = 0;
  chrome.runtime.connect = (...a) => {
    globalThis.__connects++;
    return connect(...a);
  };
});
await forced.goto(panelUrl);
await forced.waitForSelector('[role=treeitem]', { timeout: 10000 }).catch(() => {});
await sleep(800);
check(
  await forced.evaluate(() => globalThis.__dropped === true),
  'forced: boot port was dropped before takeover',
);
const connects = await forced.evaluate(() => globalThis.__connects);
check(connects === 2, 'forced: panel opened its own connection', `connects: ${connects}`);
check(await matches(forced), 'forced: rows match Chrome');
await helper.evaluate(async (w) => {
  await chrome.tabs.create({ windowId: w, url: 'about:blank#after', active: false, index: 0 });
}, win);
await sleep(800);
check(await matches(forced), 'forced: live updates still arrive');
await forced.close();

// --- 2. The boot script never ran (no __vcBoot at all): the normal connect path.
const noBoot = await ctx.newPage();
await noBoot.addInitScript(() =>
  Object.defineProperty(globalThis, '__vcBoot', {
    configurable: true,
    get: () => undefined,
    set: (b) => b?.port.disconnect(),
  }),
);
await noBoot.goto(panelUrl);
await noBoot.waitForSelector('[role=treeitem]', { timeout: 10000 }).catch(() => {});
await sleep(800);
check(await matches(noBoot), 'no boot script: panel connects normally');
await noBoot.close();

// --- 3. Real race: stop the worker 0-200 ms into a load, 30 times. A tab opened right
// after must still show up once the panel has reconnected. Each tab is closed again so
// the window keeps fitting on screen (rows outside the viewport aren't rendered).
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
