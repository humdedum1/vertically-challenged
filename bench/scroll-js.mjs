// JavaScript cost of one scroll step in the panel (the scroll handler plus Svelte's
// update), for one or two builds loaded side by side, alternating, at 1x and 4x CPU.
// Layout and paint are excluded on purpose: this isolates the row re-render work.
//   node bench/scroll-js.mjs [build dir] [second build dir] [--tabs 1500]
import path from 'node:path';
import { launchBuilds, median, ROOT, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const tabsAt = args.indexOf('--tabs');
const TABS = tabsAt === -1 ? 1500 : Number(args.splice(tabsAt, 2)[1]);
const dirs = (args.length ? args : [path.join(ROOT, '.output', 'chrome-mv3')]).map((d) =>
  path.resolve(d),
);
const { ctx, ids, close } = await launchBuilds(dirs);

const opener = await ctx.newPage();
await opener.goto(`chrome-extension://${ids[0]}/manifest.json`);
await opener.evaluate(async (n) => {
  const ps = [];
  for (let i = 0; i < n; i++)
    ps.push(chrome.tabs.create({ url: `about:blank#t${i}`, active: false }));
  await Promise.all(ps);
}, TABS);
await sleep(5000);
const pages = [];
for (const id of ids) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/sidepanel.html`);
  await p.waitForSelector('[role=treeitem]');
  pages.push(p);
}
await sleep(2000);

/** 300 steps of `rows` rows each; per step: set scrollTop, fire scroll, let Svelte flush. */
const sweep = async (rows) => {
  const el = document.querySelector('[role=tree]');
  const rh = el.querySelector('[role=treeitem]').getBoundingClientRect().height;
  el.scrollTop = 0;
  el.dispatchEvent(new Event('scroll'));
  await new Promise((r) => setTimeout(r, 50));
  const times = [];
  for (let i = 1; i <= 300; i++) {
    const t0 = performance.now();
    // Wraps at the end of the list so every step moves (a small fixture runs out of rows).
    el.scrollTop = (i * rows * rh) % (el.scrollHeight - el.clientHeight);
    el.dispatchEvent(new Event('scroll'));
    // Svelte queued its flush during the dispatch, so this microtask runs after it.
    await new Promise((r) => queueMicrotask(r));
    times.push(performance.now() - t0);
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  times.sort((a, b) => a - b);
  return { median: times[150], p95: times[284], total: times.reduce((a, b) => a + b, 0) };
};

const res = dirs.map(() => ({ one: [], ten: [] }));
for (const throttle of [1, 4]) {
  for (const p of pages) {
    const c = await ctx.newCDPSession(p);
    await c.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  for (let r = 0; r < 6; r++) {
    const order = r % 2 ? [...pages.keys()].reverse() : [...pages.keys()];
    for (const i of order) {
      await pages[i].bringToFront();
      res[i].one.push({ throttle, ...(await pages[i].evaluate(sweep, 1)) });
      res[i].ten.push({ throttle, ...(await pages[i].evaluate(sweep, 10)) });
    }
  }
}
for (const throttle of [1, 4]) {
  for (const k of ['one', 'ten']) {
    dirs.forEach((d, i) => {
      const rs = res[i][k].filter((x) => x.throttle === throttle);
      const m = (f) => median(rs.map(f));
      console.log(
        `${throttle}x CPU, ${k === 'one' ? '1-row' : '10-row'} steps, ${path.relative(ROOT, d) || d}: ` +
          `step median ${m((x) => x.median).toFixed(2)} ms, p95 ${m((x) => x.p95).toFixed(2)} ms, ` +
          `300 steps ${m((x) => x.total).toFixed(1)} ms`,
      );
    });
  }
}
await close();
