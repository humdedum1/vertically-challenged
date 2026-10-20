// Sampled CPU profile of a full scroll sweep (down and back up, 6 s) at 4x CPU, with the
// top functions by self time. The sweep's own frame callback (`frame`) includes the
// layout that setting scrollTop forces. For readable names, profile an unminified build: add
// `vite: () => ({ build: { minify: false } })` to wxt.config.ts temporarily and rebuild.
//   node bench/cpu-profile.mjs [build dir] [--tabs 1500]
import path from 'node:path';
import { launchBuilds, ROOT, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const tabsAt = args.indexOf('--tabs');
const TABS = tabsAt === -1 ? 1500 : Number(args.splice(tabsAt, 2)[1]);
const dir = path.resolve(args[0] ?? path.join(ROOT, '.output', 'chrome-mv3'));
const { ctx, ids, close } = await launchBuilds([dir]);

const opener = await ctx.newPage();
await opener.goto(`chrome-extension://${ids[0]}/manifest.json`);
await opener.evaluate(async (n) => {
  const ps = [];
  for (let i = 0; i < n; i++)
    ps.push(
      chrome.tabs.create({ url: `about:blank#tab-${i}-${'x'.repeat(i % 40)}`, active: false }),
    );
  await Promise.all(ps);
}, TABS);
await sleep(5000);
const page = await ctx.newPage();
await page.goto(`chrome-extension://${ids[0]}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
await page.bringToFront();
await sleep(2000);

const c = await ctx.newCDPSession(page);
await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await c.send('Profiler.enable');
await c.send('Profiler.setSamplingInterval', { interval: 200 });
await c.send('Profiler.start');
await page.evaluate(
  () =>
    new Promise((done) => {
      const el = document.querySelector('[role=tree]');
      const max = el.scrollHeight - el.clientHeight;
      let t0 = null;
      const frame = (t) => {
        t0 ??= t;
        const p = (t - t0) / 3000;
        if (p >= 2) return done();
        el.scrollTop = (p < 1 ? p : 2 - p) * max;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }),
);
const { profile } = await c.send('Profiler.stop');

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
let total = 0;
profile.samples.forEach((id, i) => {
  const f = byId.get(id).callFrame;
  const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
  const dt = profile.timeDeltas[i] ?? 0;
  self.set(key, (self.get(key) ?? 0) + dt);
  total += dt;
});
console.log(`sampled ${(total / 1000).toFixed(0)} ms; top self time (ms):`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 40))
  console.log((v / 1000).toFixed(1).padStart(8), k);
await close();
