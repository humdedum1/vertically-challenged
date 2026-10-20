// Single structural events in window A of the running fixture: time from Chrome finishing
// a tabs.move / create / remove call to the worker's patch reaching a subscribed page.
// Measure each build in a fixture of its own: with two builds loaded, one worker's
// window queries slow Chrome down for the other as well.
//   node bench/tab-ops.mjs [--build a|b] [runs]
import fs from 'node:fs';
import path from 'node:path';
import { browserCDP, median, OUT, pct, pickBuild, readState, sleep } from './lib.mjs';

const st = readState();
const build = pickBuild(st);
const RUNS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 24);
const cdp = await browserCDP();
const { targetId } = await cdp.send('Target.createTarget', {
  url: `chrome-extension://${build.extId}/manifest.json`,
});
const s = await cdp.attach(targetId);
await sleep(1000);
await cdp.evalIn(
  s,
  `(() => {
  const P = (globalThis.__lat = { waits: [] });
  const port = chrome.runtime.connect({ name: 'vc-panel' });
  port.onMessage.addListener((m) => {
    if (m.type !== 'patch' || m.patch.windowId !== ${st.A}) return;
    const t = performance.now();
    for (const w of P.waits.splice(0)) w(t);
  });
  port.postMessage({ type: 'subscribe', windowId: ${st.A} });
  P.next = () => new Promise((r) => P.waits.push(r));
  return 1;
})()`,
);
await sleep(3000);

// Moves stay among ungrouped, unpinned tabs so no group or pin change is involved.
const OPS = {
  move: `const ix=(await chrome.tabs.query({windowId:${st.A}})).filter(t=>!t.pinned&&t.groupId===-1).map(t=>t.index);
    const [t]=await chrome.tabs.query({windowId:${st.A},index:ix[(200+i*37)%ix.length]});
    await chrome.tabs.move(t.id,{index:ix[(100+i*53)%ix.length]});`,
  create: `globalThis.__made=(await chrome.tabs.create({windowId:${st.A},url:'about:blank',active:false,index:300+i})).id;`,
  remove: 'await chrome.tabs.remove(globalThis.__made);',
};
const res = {};
for (let i = 0; i < RUNS; i++) {
  for (const [kind, code] of Object.entries(OPS)) {
    const wait = cdp.evalIn(s, 'globalThis.__lat.next()');
    const done = await cdp.evalIn(
      s,
      `(async()=>{const i=${i};${code} return performance.now()})()`,
    );
    res[kind] ??= [];
    res[kind].push((await wait) - done);
    await sleep(250);
  }
}
await cdp.send('Target.closeTarget', { targetId });
const summary = {};
for (const [kind, a] of Object.entries(res)) {
  summary[kind] = { median: +median(a).toFixed(1), p95: +pct(a, 0.95).toFixed(1), n: a.length };
  console.log(
    `${build.key} ${kind}: call done to patch ${summary[kind].median} ms (p95 ${summary[kind].p95})`,
  );
}
const file = path.join(OUT, `tab-ops-${build.key}.json`);
fs.writeFileSync(file, JSON.stringify({ build: build.src, summary, runs: res }, null, 1));
console.log('results in', file);
process.exit(0);
