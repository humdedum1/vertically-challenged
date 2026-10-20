// Opens Chrome's real side panel (not a tab) in the running fixture and times it, cold
// (worker stopped first) and warm. With two builds loaded, runs alternate between them,
// so both see the same machine load; the paired differences are printed too.
//   node bench/side-panel.mjs [runs] [--out name]
// Times are ms from the panel's navigation start. Worker marks (w*) are cold runs only.
import fs from 'node:fs';
import path from 'node:path';
import { browserCDP, median, OUT, pct, readState, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const NAME = outAt === -1 ? 'side-panel' : args.splice(outAt, 2)[1];
const RUNS = Number(args[0] ?? 20);
const st = readState();
const cdp = await browserCDP();
const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
const prefix = (b) => `chrome-extension://${b.extId}/`;

// Close every extension page (their ports keep workers awake), then open a port-free
// page per build to drive chrome.sidePanel from.
for (const t of await targets())
  if (t.type === 'page' && t.url.startsWith('chrome-extension://'))
    await cdp.send('Target.closeTarget', { targetId: t.targetId });
const openers = {};
for (const b of st.builds) {
  const { targetId } = await cdp.send('Target.createTarget', { url: `${prefix(b)}manifest.json` });
  openers[b.key] = { targetId, sess: await cdp.attach(targetId) };
}
await sleep(800);

async function stopWorkers(b) {
  const sess = openers[b.key].sess;
  await cdp.send('ServiceWorker.enable', {}, sess);
  await cdp.send('ServiceWorker.stopAllWorkers', {}, sess);
  for (let i = 0; i < 60; i++) {
    const t = await targets();
    if (
      !t.some(
        (x) => x.type === 'service_worker' && st.builds.some((y) => x.url.startsWith(prefix(y))),
      )
    )
      return;
    await sleep(250);
  }
  throw new Error('worker did not stop');
}

async function closePanel(b) {
  // sidePanel.close needs Chrome 141; toggling the panel off and on closes it before that.
  await cdp.evalIn(
    openers[b.key].sess,
    'chrome.windows.getCurrent().then(w => chrome.sidePanel.close ? chrome.sidePanel.close({windowId: w.id}) : chrome.sidePanel.setOptions({enabled:false}).then(()=>chrome.sidePanel.setOptions({enabled:true}))).then(()=>1,()=>0)',
  );
  for (let i = 0; i < 40; i++) {
    if (!(await targets()).some((t) => t.url.startsWith(`${prefix(b)}sidepanel.html`))) return;
    await sleep(100);
  }
  throw new Error('panel did not close');
}

async function openOnce(b, cold) {
  for (const o of st.builds) await closePanel(o);
  await sleep(500);
  if (cold) {
    await stopWorkers(b);
    await sleep(500);
  }
  // sidePanel.open needs a user gesture; CDP can supply one.
  const r = await cdp.evalIn(
    openers[b.key].sess,
    'chrome.windows.getCurrent().then(w=>chrome.sidePanel.open({windowId:w.id})).then(()=>"ok",e=>"err "+e.message)',
    { userGesture: true },
  );
  if (r !== 'ok') throw new Error(r);
  let panel;
  for (let i = 0; i < 50 && !panel; i++) {
    panel = (await targets()).find((t) => t.url.startsWith(`${prefix(b)}sidepanel.html`));
    if (!panel) await sleep(50);
  }
  const s = await cdp.attach(panel.targetId);
  for (let i = 0; i < 100; i++) {
    const p = await cdp
      .evalIn(s, 'window.__p && window.__p.firstRow !== null ? JSON.stringify(window.__p) : null')
      .catch(() => null);
    if (p) {
      const run = JSON.parse(p);
      const origin = await cdp.evalIn(s, 'performance.timeOrigin');
      await cdp.send('Target.detachFromTarget', { sessionId: s });
      if (cold) {
        const sw = (await targets()).find(
          (t) => t.type === 'service_worker' && t.url.startsWith(prefix(b)),
        );
        const ws = await cdp.attach(sw.targetId);
        const m = JSON.parse(await cdp.evalIn(ws, 'JSON.stringify(globalThis.__m)'));
        await cdp.send('Target.detachFromTarget', { sessionId: ws });
        const rel = (t) => (t === undefined ? undefined : m.origin + t - origin);
        Object.assign(run, {
          build: m.build,
          wOrigin: m.origin - origin,
          wStart: rel(m.tStart),
          wQ1: rel(m.tQ1),
          wQueries: rel(m.tG),
          wPost: rel(m.tPost0),
        });
      }
      return run;
    }
    await sleep(100);
  }
  throw new Error('no rows');
}

const out = Object.fromEntries(st.builds.map((b) => [b.key, { cold: [], warm: [] }]));
for (const b of st.builds) await openOnce(b, false); // settle
for (let i = 0; i < RUNS; i++) {
  const order = i % 2 ? [...st.builds].reverse() : st.builds;
  for (const b of order) {
    const c = await openOnce(b, true);
    if (c.build !== b.key) throw new Error(`cold run of ${b.key} ran build ${c.build}`);
    out[b.key].cold.push(c);
    out[b.key].warm.push(await openOnce(b, false));
  }
  process.stdout.write('.');
}
console.log();
for (const b of st.builds) await closePanel(b);
for (const o of Object.values(openers))
  await cdp.send('Target.closeTarget', { targetId: o.targetId });

const KEYS = ['connectAt', 'wOrigin', 'wStart', 'wQ1', 'wQueries', 'wPost', 'snapAt', 'firstRow'];
const fmt = (a) => (a.length ? `${median(a).toFixed(1)} (p95 ${pct(a, 0.95).toFixed(1)})` : '-');
const summary = {};
for (const b of st.builds) {
  summary[b.key] = { src: b.src };
  for (const mode of ['cold', 'warm']) {
    summary[b.key][mode] = Object.fromEntries(
      KEYS.map((k) => [
        k,
        fmt(out[b.key][mode].map((r) => r[k]).filter((x) => typeof x === 'number')),
      ]),
    );
  }
}
if (st.builds.length === 2) {
  summary.paired = {};
  for (const mode of ['cold', 'warm']) {
    const d = out.a[mode].map((r, i) => out.b[mode][i].firstRow - r.firstRow);
    summary.paired[mode] = {
      b_minus_a_firstRow_median: median(d).toFixed(1),
      iqr: [pct(d, 0.25).toFixed(1), pct(d, 0.75).toFixed(1)],
      b_faster_in: `${d.filter((x) => x < 0).length} of ${d.length}`,
    };
  }
}
const file = path.join(OUT, `${NAME}.json`);
fs.writeFileSync(file, JSON.stringify({ summary, runs: out }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('results in', file);
process.exit(0);
