// Real-Chrome checks for the worker's local tab ops and the panel's row reuse: after
// bursts of moves, creates, closes, cross-window moves, group and pin changes and a
// suspended worker, the worker's patch stream and the panel's rows must both match
// Chrome's real tab order.
//   node tests/e2e/tab-sync.mjs [extension dir]
import http from 'node:http';
import { check, extensionDir, finish, launch, sleep, startMirror, tabRows } from './harness.mjs';

// Pages with a chosen <title>, for title-change checks (no network access needed).
const srv = http.createServer((req, res) => {
  const title = new URL(req.url, 'http://x').searchParams.get('t') ?? 'Page';
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>${title}</title>`);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${srv.address().port}`;

const { ctx, extId, close } = await launch(extensionDir());
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('  [panel console]', m.text()));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');

// All chrome.* calls below run in the panel page (an extension page has the same APIs).
const api = (fn, arg) => page.evaluate(fn, arg);
const ordered = (w) =>
  api(
    async (id) =>
      (await chrome.tabs.query({ windowId: id }))
        .sort((x, y) => x.index - y.index)
        .map((t) => t.id),
    w,
  );
const winA = await api(async () => (await chrome.windows.getCurrent()).id);
const winB = await api(
  async () => (await chrome.windows.create({ url: 'about:blank?b0', focused: false })).id,
);
await api(
  async ({ a, b }) => {
    for (let i = 1; i <= 8; i++)
      await chrome.tabs.create({ windowId: a, url: `about:blank?a${i}`, active: false });
    for (let i = 1; i <= 6; i++)
      await chrome.tabs.create({ windowId: b, url: `about:blank?b${i}`, active: false });
  },
  { a: winA, b: winB },
);
await api(startMirror, winA);

async function compare(label) {
  await sleep(600);
  const truth = { [winA]: await ordered(winA), [winB]: await ordered(winB) };
  const m = await api(() => globalThis.__mirror);
  for (const w of [winA, winB]) {
    const name = w === winA ? 'A' : 'B';
    const byId = m.tabs[w] ?? {};
    const got = (m.order[w] ?? []).filter((id) => byId[id]);
    check(
      JSON.stringify(got) === JSON.stringify(truth[w]),
      `${label}: worker order matches Chrome (window ${name})`,
      `got ${JSON.stringify(got)} want ${JSON.stringify(truth[w])}`,
    );
    check(
      got.every((id) => byId[id].windowId === w),
      `${label}: tabs in window ${name} carry its windowId`,
    );
  }
  // No pins in this fixture, so every row is a tab row; both windows fit on screen.
  const rows = await tabRows(page);
  const want = [...truth[winA], ...truth[winB]];
  check(
    JSON.stringify(rows) === JSON.stringify(want),
    `${label}: panel rows match Chrome`,
    `got ${JSON.stringify(rows)} want ${JSON.stringify(want)}`,
  );
}

await compare('initial');

// --- 1. Local structural ops: single and burst moves, creates at indices, removes.
await api(async (a) => {
  const ids = (await chrome.tabs.query({ windowId: a }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);
  await chrome.tabs.move(ids[1], { index: 5 });
}, winA);
await compare('single move');

await api(async (a) => {
  const ids = (await chrome.tabs.query({ windowId: a }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);
  // Fired together: many events land in one flush.
  await Promise.all([
    chrome.tabs.move(ids[0], { index: -1 }),
    chrome.tabs.move(ids[3], { index: 0 }),
    chrome.tabs.move(ids[6], { index: 2 }),
    chrome.tabs.create({ windowId: a, url: 'about:blank?new1', index: 1, active: false }),
    chrome.tabs.remove(ids[4]),
    chrome.tabs.create({ windowId: a, url: 'about:blank?new2', index: 0, active: false }),
  ]);
}, winA);
await compare('burst of moves, creates and removes');

await api(async (a) => {
  for (let k = 0; k < 40; k++) {
    const ids = (await chrome.tabs.query({ windowId: a }))
      .sort((x, y) => x.index - y.index)
      .map((t) => t.id);
    void chrome.tabs.move(ids[(k * 7) % ids.length], { index: (k * 3) % ids.length });
  }
}, winA);
await compare('40 rapid moves');

// --- 2. Between windows (detach + attach), both directions in one burst.
await api(
  async ({ a, b }) => {
    const sorted = async (w) =>
      (await chrome.tabs.query({ windowId: w })).sort((x, y) => x.index - y.index).map((t) => t.id);
    const ia = await sorted(a);
    const ib = await sorted(b);
    await Promise.all([
      chrome.tabs.move(ia[2], { windowId: b, index: 1 }),
      chrome.tabs.move(ib[3], { windowId: a, index: 0 }),
    ]);
    await chrome.tabs.move(ia[2], { windowId: a, index: 3 });
  },
  { a: winA, b: winB },
);
await compare('moves between windows');

// --- 3. Group and pin changes still go through a full re-query and stay right.
await api(async (a) => {
  const ids = (await chrome.tabs.query({ windowId: a }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);
  const g = await chrome.tabs.group({ tabIds: [ids[4], ids[5]] });
  await chrome.tabGroups.update(g, { title: 'G' });
  void chrome.tabs.move(ids[7], { index: 1 });
}, winA);
await compare('group plus move');
await api(async (a) => {
  const ids = (await chrome.tabs.query({ windowId: a }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);
  await chrome.tabs.update(ids[6], { pinned: true });
  await chrome.tabs.update(ids[6], { pinned: false });
}, winA);
await sleep(400);
await compare('pin and unpin');

// --- 4. A title update re-renders only the changed row (row reuse): no row is replaced.
const before = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[id^="vc-row-t"]')];
  for (const r of rows) r.__keep = true;
  return rows.length;
});
await api(
  async ({ a, site }) => {
    const [t] = (await chrome.tabs.query({ windowId: a }))
      .sort((x, y) => x.index - y.index)
      .slice(-1);
    await chrome.tabs.update(t.id, { url: `${site}/?t=Renamed` });
  },
  { a: winA, site: SITE },
);
await sleep(800);
const after = await page.evaluate(() =>
  [...document.querySelectorAll('[id^="vc-row-t"]')].map((r) => [
    r.id,
    r.__keep === true,
    r.textContent.trim(),
  ]),
);
check(
  after.length === before && after.every(([, kept]) => kept),
  'title update keeps every row element',
  JSON.stringify(after.filter(([, kept]) => !kept)),
);
check(
  after.some(([, , text]) => text.includes('Renamed')),
  'renamed title is shown',
);

// --- 5. Search sees changes made while not searching (the index is fed lazily).
await page.fill('input', 'Renamed');
await sleep(300);
const hits = await page.evaluate(() =>
  [...document.querySelectorAll('[role=treeitem]')].map((e) => e.textContent.trim()),
);
check(
  hits.length === 1 && hits[0].includes('Renamed'),
  'search sees a title changed before searching',
  JSON.stringify(hits),
);
await api(
  async ({ a, site }) => {
    await chrome.tabs.create({ windowId: a, url: `${site}/?t=Renamed%20too`, active: false });
  },
  { a: winA, site: SITE },
);
await sleep(800);
const hitCount = await page.evaluate(() => document.querySelectorAll('[role=treeitem]').length);
check(hitCount === 2, 'search results update while searching', String(hitCount));
await page.fill('input', '');
await sleep(300);

// --- 6. Worker suspended: the events that wake it are applied; a cold reopen works.
const cdp = await ctx.newCDPSession(page);
const stopWorker = async () => {
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await sleep(800);
};
await stopWorker();
await api(async (a) => {
  const ids = (await chrome.tabs.query({ windowId: a }))
    .sort((x, y) => x.index - y.index)
    .map((t) => t.id);
  void chrome.tabs.move(ids[0], { index: 4 });
  void chrome.tabs.create({ windowId: a, url: 'about:blank?wake', index: 2, active: false });
}, winA);
await sleep(1500); // the panel's port reconnects with backoff
// The mirror's port died with the worker; start a new one.
await api(startMirror, winA);
await compare('after the worker was suspended');

await stopWorker();
await page.reload();
await page.waitForSelector('[role=treeitem]');
await sleep(800);
const coldWant = [...(await ordered(winA)), ...(await ordered(winB))];
check(
  JSON.stringify(await tabRows(page)) === JSON.stringify(coldWant),
  'cold open: panel rows match Chrome',
);

// --- 7. Closing window B removes its rows.
await api((b) => chrome.windows.remove(b), winB);
await sleep(1000);
check(
  JSON.stringify(await tabRows(page)) === JSON.stringify(await ordered(winA)),
  'closing a window removes its rows',
);

await close();
srv.close();
finish();
