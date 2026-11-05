// Measures one build in the running fixture (see fixture.mjs): open times, event
// latencies, scrolling, search, memory, drag and CPU-throttled variants. The panel runs in
// a tab (so it can be instrumented before it loads); side-panel.mjs measures the real panel.
//   node bench/measure.mjs [--build a|b] [--out name] <phase...>
// Phases: open sizes events scroll search mem drag trace throttle4 memburst
// Results are merged into bench/.out/<name>.json (default results-<build>.json).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  browserCDP,
  lit,
  median,
  OUT,
  pct,
  pickBuild,
  r2,
  readState,
  sleep,
  stat,
  waitSW,
  wakeSW,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const BUILD = flag('--build') ?? 'a';
const RESULTS = path.join(OUT, `${flag('--out') ?? `results-${BUILD}`}.json`);
process.argv = [...process.argv.slice(0, 2), '--build', BUILD];

/** Resident memory of Chrome's process tree (Linux only; elsewhere left out). */
function chromeRss(rootPid) {
  if (process.platform !== 'linux') return { rss_note: 'process memory is only read on Linux' };
  const rows = execSync('ps -eo pid=,ppid=,rss=,args=')
    .toString()
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .map(([pid, ppid, rss, ...a]) => ({ pid: +pid, ppid: +ppid, rss: +rss, args: a.join(' ') }));
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (!tree.has(r.pid) && tree.has(r.ppid)) {
        tree.add(r.pid);
        grew = true;
      }
    }
  }
  const mine = rows.filter((r) => tree.has(r.pid));
  return {
    chrome_total_rss_mb: Math.round(mine.reduce((n, r) => n + r.rss, 0) / 1024),
    chrome_processes: mine.length,
    extension_process_rss_mb: mine
      .filter((r) => r.args.includes('--extension-process'))
      .map((r) => Math.round(r.rss / 1024)),
  };
}

// ---------------------------------------------------------------- panel page instrumentation
const INSTR = `(() => {
  if (window.__p) return;
  const P = window.__p = { msgs: [], heights: [], firstRow: null, lastMut: null, sizeMode: !!window.__sizeMode, titles: {}, lastOrder: null };
  const now = () => performance.now();
  const orig = chrome.runtime.connect.bind(chrome.runtime);
  chrome.runtime.connect = (...a) => {
    P.connectAt = now();
    const port = orig(...a);
    const post = port.postMessage.bind(port);
    port.postMessage = (m) => { if (m && m.type === 'subscribe' && P.subscribeAt === undefined) P.subscribeAt = now(); return post(m); };
    port.onMessage.addListener((m) => {
      const t = now();
      const rec = { t, type: m.type };
      if (m.type === 'snapshot') { rec.windowId = m.windowId; rec.n = m.tabs.length; }
      if (m.type === 'patch') { const p = m.patch; rec.windowId = p.windowId; rec.up = p.upserts ? p.upserts.length : 0; rec.rm = p.removed ? p.removed.length : 0; rec.order = p.order ? p.order.length : 0; rec.groups = p.groups ? p.groups.length : 0;
        if (p.order) P.lastOrder = p.order;
        if (p.upserts) for (const u of p.upserts) P.titles[u.id] = u.title; }
      if (window.__sizeMode) rec.bytes = JSON.stringify(m).length;
      P.msgs.push(rec);
      const ch = new MessageChannel(); ch.port1.onmessage = () => { rec.tEnd = now(); ch.port1.close(); }; ch.port2.postMessage(0);
    });
    return port;
  };
  const treeSpacer = () => { const tr = document.querySelector('[role=tree]'); return tr && tr.firstElementChild; };
  let lastH = null;
  new MutationObserver(() => {
    const t = now(); P.lastMut = t;
    if (P.firstRow === null && document.querySelector('[role=treeitem]')) P.firstRow = t;
    const sp = treeSpacer(); if (sp) { const h = sp.style.height; if (h !== lastH) { lastH = h; P.heights.push([t, h]); } }
  }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
})();`;

// ---------------------------------------------------------------- measurement helpers
async function attachMeasure() {
  const cdp = await browserCDP();
  const st = readState();
  const build = pickBuild(st);
  st.extId = build.extId;
  const sw = await wakeSW(cdp, build.extId);
  return { cdp, st, sw };
}
async function ensurePanel(ctx) {
  const { cdp, st, sw } = ctx;
  const { targetInfos } = await cdp.send('Target.getTargets');
  let t;
  {
    const known = new Set(targetInfos.map((x) => x.targetId));
    await cdp.evalIn(
      sw.sessionId,
      `chrome.tabs.create({windowId:${st.A},url:'about:blank',active:true}).then(t=>t.id)`,
    );
    await sleep(500);
    const after = (await cdp.send('Target.getTargets')).targetInfos;
    t = after.find((x) => x.type === 'page' && !known.has(x.targetId));
  }
  const sess = await cdp.attach(t.targetId);
  for (const m of ['Page.enable', 'Runtime.enable', 'Performance.enable'])
    await cdp.send(m, {}, sess);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 380, height: 900, deviceScaleFactor: 1, mobile: false },
    sess,
  );
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sess);
  await cdp.send('Page.bringToFront', {}, sess);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTR }, sess);
  ctx.panel = { targetId: t.targetId, sess };
}
const panelUrl = (ctx) => `chrome-extension://${ctx.st.extId}/sidepanel.html`;

async function stopWorker(ctx) {
  const { cdp } = ctx;
  const sess = ctx.panel.sess;
  await cdp.send('ServiceWorker.enable', {}, sess).catch(() => {});
  await cdp
    .send('ServiceWorker.stopAllWorkers', {}, sess)
    .catch((e) => console.log('stopAll:', e.message));
  for (let i = 0; i < 80; i++) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    if (
      !targetInfos.some(
        (t) =>
          t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${ctx.st.extId}/`),
      )
    )
      return true;
    await sleep(500);
  }
  return false;
}

/** Fresh navigation of the panel; returns the page-side timeline plus the harness's own t_nav. */
async function openPanelOnce(ctx, { cold, sizeMode = false }) {
  const { cdp, panel } = ctx;
  await cdp.send('Page.navigate', { url: 'about:blank' }, panel.sess);
  await sleep(400);
  if (cold) {
    await cdp.send('Target.detachFromTarget', { sessionId: ctx.sw.sessionId }).catch(() => {});
    if (!(await stopWorker(ctx))) throw new Error('worker did not stop');
    await sleep(500);
  }
  if (sizeMode)
    await cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: 'window.__sizeMode = true' },
      panel.sess,
    );
  const tNav = Date.now();
  await cdp.send('Page.navigate', { url: panelUrl(ctx) }, panel.sess);
  let ok = false;
  for (let i = 0; i < 300; i++) {
    await sleep(100);
    const r = await cdp
      .evalIn(
        panel.sess,
        "window.__p ? JSON.stringify({fr: window.__p.firstRow, h: window.__p.heights.at(-1), now: performance.now()}) : 'null'",
      )
      .catch(() => 'null');
    const o = JSON.parse(r);
    if (o && o.fr !== null && o.h && o.now - o.h[0] > 800) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new Error('panel never settled');
  const data = JSON.parse(
    await cdp.evalIn(
      panel.sess,
      "JSON.stringify({p: window.__p, origin: performance.timeOrigin, fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime ?? null, nav: (n => ({dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, respEnd: n.responseEnd}))(performance.getEntriesByType('navigation')[0]), res: performance.getEntriesByType('resource').filter(r => /\\.(js|css)/.test(r.name)).map(r => [r.name.split('/').pop(), r.startTime, r.responseEnd])})",
    ),
  );
  if (cold || !ctx.sw) ctx.sw = await waitSW(cdp, ctx.st.extId, 20);
  const marks = JSON.parse(await cdp.evalIn(ctx.sw.sessionId, 'JSON.stringify(globalThis.__m)'));
  return { tNav, data, marks };
}

function summariseOpen(run) {
  const { tNav, data, marks } = run;
  const P = data.p;
  const org = data.origin;
  const ep = (t) => org + t;
  const msgT = (type, pred = () => true) => {
    const x = P.msgs.find((q) => q.type === type && pred(q));
    return x ? ep(x.t) : null;
  };
  const homeSnapT = msgT('snapshot', (q) => q.n > 1000);
  const heights = P.heights.map(([t, h]) => [ep(t), h]);
  const finalH = heights.at(-1);
  const out = {
    nav_to_docStart: r2(org - tNav),
    nav_to_connect: r2(ep(P.connectAt) - tNav),
    nav_to_subscribe: r2(ep(P.subscribeAt) - tNav),
    nav_to_firstWindowsMsg: r2(msgT('windows') - tNav),
    nav_to_firstSnapshotMsg: r2(msgT('snapshot') - tNav),
    nav_to_homeSnapshotMsg: homeSnapT ? r2(homeSnapT - tNav) : null,
    nav_to_layoutMsg: r2(msgT('layout') - tNav),
    nav_to_firstRowDom: r2(ep(P.firstRow) - tNav),
    nav_to_allRowsBuilt: r2(finalH[0] - tNav),
    nav_to_fcp: data.fcp ? r2(org + data.fcp - tNav) : null,
    nav_to_dcl: r2(org + data.nav.dcl - tNav),
    nav_to_loadEnd: r2(org + data.nav.load - tNav),
    nav_to_lastScriptCssEnd: r2(org + Math.max(...data.res.map((x) => x[2])) - tNav),
    scripts_css_loaded: data.res.length,
    final_spacer: finalH[1],
    spacer_changes: heights.length,
    snapshot_task_ms: P.msgs
      .filter((q) => q.type === 'snapshot')
      .map((q) => r2((q.tEnd ?? q.t) - q.t)),
    layout_task_ms: P.msgs.filter((q) => q.type === 'layout').map((q) => r2((q.tEnd ?? q.t) - q.t)),
    windows_task_ms: P.msgs
      .filter((q) => q.type === 'windows')
      .map((q) => r2((q.tEnd ?? q.t) - q.t)),
    msg_order: P.msgs.map((q) => `${q.type}${q.n ? `(${q.n})` : ''}`).join(','),
    msgs_bytes: P.msgs.some((q) => q.bytes)
      ? P.msgs.map((q) => ({ type: q.type, windowId: q.windowId, n: q.n, bytes: q.bytes }))
      : undefined,
  };
  if (marks.tStart !== undefined) {
    // Worker marks from fixture.mjs, in the worker's clock (origin + offset).
    const abs = (n) => marks.origin + marks[n];
    const has = (...n) => n.every((k) => marks[k] !== undefined);
    const w = {};
    for (const n of ['tStart', 'tQ0', 'tQ1', 'tG', 'tPost0', 'tSnap'])
      if (marks[n] !== undefined) w[`${n}_rel_nav`] = abs(n) - tNav;
    if (has('tQ0', 'tQ1')) w.d_tabsQuery = marks.tQ1 - marks.tQ0;
    if (has('tQ1', 'tG')) w.d_groupsQuery = marks.tG - marks.tQ1;
    if (has('tStart', 'tG')) w.d_start_to_queries_done = marks.tG - marks.tStart;
    if (has('tG', 'tPost0')) w.d_queries_to_post = marks.tPost0 - marks.tG;
    if (has('tPost0')) {
      w.post0_to_firstSnapshotMsg = msgT('snapshot') - abs('tPost0');
      w.post0_to_firstRow = ep(P.firstRow) - abs('tPost0');
    }
    w.start_to_firstRow = ep(P.firstRow) - abs('tStart');
    for (const k of Object.keys(w)) w[k] = r2(w[k]);
    out.worker = w;
  }
  return out;
}
const agg = (runs, getter) => stat(runs.map(getter).filter((x) => typeof x === 'number'));

// ---------------------------------------------------------------- phases
const PHASES = {};

PHASES.open = async (ctx) => {
  const res = { warm: [], cold: [] };
  for (let i = 0; i < 10; i++) {
    res.warm.push(summariseOpen(await openPanelOnce(ctx, { cold: false })));
    console.log('warm', i, res.warm.at(-1).nav_to_firstRowDom);
    res.cold.push(summariseOpen(await openPanelOnce(ctx, { cold: true })));
    console.log('cold', i, res.cold.at(-1).nav_to_firstRowDom);
  }
  const keys = [
    'nav_to_dcl',
    'nav_to_loadEnd',
    'nav_to_lastScriptCssEnd',
    'nav_to_docStart',
    'nav_to_connect',
    'nav_to_subscribe',
    'nav_to_firstWindowsMsg',
    'nav_to_firstSnapshotMsg',
    'nav_to_homeSnapshotMsg',
    'nav_to_layoutMsg',
    'nav_to_firstRowDom',
    'nav_to_allRowsBuilt',
    'nav_to_fcp',
  ];
  res.summary = {};
  for (const mode of ['warm', 'cold']) {
    res.summary[mode] = {};
    for (const k of keys) res.summary[mode][k] = agg(res[mode], (r) => r[k]);
    for (const k of Object.keys(res[mode][0].worker ?? {}))
      res.summary[mode][`worker.${k}`] = agg(res[mode], (r) => r.worker?.[k]);
    res.summary[mode].snapshot_task_ms_first = agg(res[mode], (r) => r.snapshot_task_ms[0]);
    res.summary[mode].snapshot_task_ms_second = agg(res[mode], (r) => r.snapshot_task_ms[1]);
    res.summary[mode].layout_task_ms_first = agg(res[mode], (r) => r.layout_task_ms[0]);
  }
  return res;
};

PHASES.sizes = async (ctx) => {
  const run = await openPanelOnce(ctx, { cold: false, sizeMode: true });
  const s = summariseOpen(run);
  return { msgs_bytes: s.msgs_bytes, msg_order: s.msg_order };
};

async function heap(ctx, sess) {
  await ctx.cdp.send('HeapProfiler.enable', {}, sess).catch(() => {});
  await ctx.cdp.send('HeapProfiler.collectGarbage', {}, sess).catch(() => {});
  await sleep(300);
  const h = await ctx.cdp.send('Runtime.getHeapUsage', {}, sess);
  return { usedMB: r2(h.usedSize / 1048576), totalMB: r2(h.totalSize / 1048576) };
}
const freshPanel = (ctx) => openPanelOnce(ctx, { cold: false });

PHASES.events = async (ctx) => {
  const { cdp, panel, st } = ctx;
  await freshPanel(ctx);
  await sleep(1000);
  const res = { single: [], burstTitles: [], burstMoves: [] };
  const rowIds = async () =>
    JSON.parse(
      await cdp.evalIn(
        panel.sess,
        "JSON.stringify([...document.querySelectorAll('[role=treeitem]')].map(e=>e.id).filter(i=>i.startsWith('vc-row-t')).map(i=>Number(i.slice(8))))",
      ),
    );
  const { targetInfos } = await cdp.send('Target.getTargets');
  const tabs = JSON.parse(
    await cdp.evalIn(
      ctx.sw.sessionId,
      'chrome.tabs.query({}).then(t=>JSON.stringify(t.map(x=>[x.id,x.url,x.windowId,x.index])))',
    ),
  );
  const idToUrl = new Map(tabs.map((t) => [t[0], t[1]]));
  const urlToTarget = new Map(
    targetInfos.filter((t) => t.type === 'page').map((t) => [t.url, t.targetId]),
  );
  const visible = await rowIds();
  console.log('visible tab rows', visible.length);
  for (let i = 0; i < 12; i++) {
    const id = visible[i % visible.length];
    const tid = urlToTarget.get(idToUrl.get(id));
    if (!tid) {
      console.log('no target for', id);
      continue;
    }
    const s = await cdp.attach(tid);
    const title = `ZZTITLE-${i}-${Date.now()}`;
    await cdp.evalIn(
      panel.sess,
      `(() => { const P = window.__p; P.watch = { found: null }; const row = document.getElementById('vc-row-t${Number(id)}'); P.mo && P.mo.disconnect(); P.mo = new MutationObserver(() => { if (P.watch.found === null && row.textContent.includes(${lit(title)})) { P.watch.found = performance.now(); P.watch.foundEpoch = performance.timeOrigin + P.watch.found; requestAnimationFrame(() => { P.watch.raf = performance.timeOrigin + performance.now(); }); } }); P.mo.observe(document.querySelector('[role=tree]'), { subtree: true, childList: true, characterData: true, attributes: true }); P.msgs.length = 0; return 1 })()`,
    );
    const t0 = Date.now();
    await cdp.evalIn(s, `document.title=${lit(title)}`);
    const t1 = Date.now();
    await sleep(400);
    const r = JSON.parse(
      await cdp.evalIn(
        panel.sess,
        "JSON.stringify({w: window.__p.watch, org: performance.timeOrigin, msgs: window.__p.msgs.filter(m=>m.type==='patch')})",
      ),
    );
    await cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {});
    if (r.w.found === null) {
      console.log('title not seen', id);
      continue;
    }
    const patch = r.msgs[0];
    const mid = (t0 + t1) / 2;
    res.single.push({
      set_to_dom_ms: r2(r.w.foundEpoch - mid),
      set_to_dom_upper_ms: r2(r.w.foundEpoch - t0),
      set_to_patchRecv_ms: patch ? r2(r.org + patch.t - mid) : null,
      patchRecv_to_dom_ms: patch ? r2(r.w.found - patch.t) : null,
      patch_task_ms: patch?.tEnd ? r2(patch.tEnd - patch.t) : null,
      set_to_raf_ms: r.w.raf ? r2(r.w.raf - mid) : null,
      patches: r.msgs.length,
      up: patch?.up,
      order: patch?.order,
    });
  }
  const home = tabs
    .filter((t) => t[2] === st.A && urlToTarget.has(t[1]))
    .sort((a, b) => a[3] - b[3]);
  for (let rep = 0; rep < 5; rep++) {
    await cdp.evalIn(panel.sess, "document.querySelector('[role=tree]').scrollTop = 1200; 1");
    await sleep(300);
    const shown = new Set(await rowIds());
    const chosen = [
      ...home.filter((t) => shown.has(t[0])),
      ...home.filter((t) => !shown.has(t[0]) && t[3] > 20),
    ].slice(0, 200);
    const sess = [];
    for (const t of chosen) sess.push([t[0], await cdp.attach(urlToTarget.get(t[1]))]);
    await cdp.evalIn(
      panel.sess,
      '(() => { const P = window.__p; P.msgs.length = 0; P.titles = {}; P.lastMut = null; return 1 })()',
    );
    const stamp = `BURST${rep}-${Date.now()}`;
    const t0 = Date.now();
    await Promise.all(
      sess.map(([id, s]) => cdp.evalIn(s, `document.title=${JSON.stringify(`${stamp}-${id}`)}`)),
    );
    const t1 = Date.now();
    const q = `JSON.stringify({org: performance.timeOrigin, msgs: window.__p.msgs.filter(m=>m.type==='patch'), n: Object.values(window.__p.titles).filter(v=>v.startsWith(${JSON.stringify(stamp)})).length, lastMut: window.__p.lastMut})`;
    let r;
    for (let i = 0; i < 100; i++) {
      await sleep(50);
      r = JSON.parse(await cdp.evalIn(panel.sess, q));
      if (r.n >= 200) break;
    }
    await sleep(300);
    r = JSON.parse(await cdp.evalIn(panel.sess, q));
    const rowsWithStamp = await cdp.evalIn(
      panel.sess,
      `[...document.querySelectorAll('[role=treeitem]')].filter(e => e.textContent.includes(${JSON.stringify(stamp)})).length`,
    );
    const last = r.msgs.at(-1);
    res.burstTitles.push({
      seen: r.n,
      rowsWithStamp,
      patches: r.msgs.length,
      upserts_total: r.msgs.reduce((a, m) => a + m.up, 0),
      set_to_firstPatch_ms: r2(r.org + r.msgs[0].t - t0),
      set_to_lastPatch_ms: r2(r.org + last.t - t0),
      set_to_lastDomMutation_ms: r.lastMut ? r2(r.org + r.lastMut - t0) : null,
      cdp_fire_ms: t1 - t0,
      patch_task_ms: r.msgs.map((m) => r2((m.tEnd ?? m.t) - m.t)),
      patch_up: r.msgs.map((m) => m.up),
    });
    for (const [, s] of sess)
      await cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {});
    await sleep(500);
  }
  for (let rep = 0; rep < 5; rep++) {
    await cdp.evalIn(
      panel.sess,
      '(() => { const P = window.__p; P.msgs.length = 0; P.lastOrder = null; P.lastMut = null; return 1 })()',
    );
    const t0 = Date.now();
    const info = JSON.parse(
      await cdp.evalIn(
        ctx.sw.sessionId,
        `(async()=>{
      const t0=Date.now();
      const tabs=(await chrome.tabs.query({windowId:${st.A},pinned:false})).filter(t=>t.groupId===-1).sort((a,b)=>a.index-b.index);
      const n=tabs.length; // ungrouped, unpinned tabs; 200 moves to the end cycle through them
      await Promise.all(Array.from({length:200},(_,k)=>chrome.tabs.move(tabs[(k*7+${rep}*3)%n].id,{index:-1})));
      const final=(await chrome.tabs.query({windowId:${st.A}})).sort((a,b)=>a.index-b.index).map(t=>t.id);
      return JSON.stringify({ms:Date.now()-t0,final});
    })()`,
      ),
    );
    let r;
    let prevN = -1;
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      r = JSON.parse(
        await cdp.evalIn(
          panel.sess,
          "JSON.stringify({org: performance.timeOrigin, msgs: window.__p.msgs.filter(m=>m.type==='patch'), lo: window.__p.lastOrder, lastMut: window.__p.lastMut})",
        ),
      );
      if (r.msgs.length === prevN && r.msgs.length > 0) break;
      prevN = r.msgs.length;
    }
    const lastOrderPatch = [...r.msgs].reverse().find((m) => m.order);
    res.burstMoves.push({
      worker_move_calls_ms: info.ms,
      patches: r.msgs.length,
      order_patches: r.msgs.filter((m) => m.order).length,
      panel_matches_final_order: JSON.stringify(r.lo) === JSON.stringify(info.final),
      start_to_lastPatch_ms: lastOrderPatch ? r2(r.org + lastOrderPatch.t - t0) : null,
      start_to_lastDomMutation_ms: r.lastMut ? r2(r.org + r.lastMut - t0) : null,
      patch_task_ms: r.msgs.map((m) => r2((m.tEnd ?? m.t) - m.t)),
    });
    await sleep(500);
  }
  res.burstMovesB = [];
  for (let rep = 0; rep < 5; rep++) {
    await cdp.evalIn(
      panel.sess,
      '(() => { const P = window.__p; P.msgs.length = 0; P.lastOrder = null; P.lastMut = null; return 1 })()',
    );
    const t0 = Date.now();
    const info = JSON.parse(
      await cdp.evalIn(
        ctx.sw.sessionId,
        `(async()=>{
      const t0=Date.now();
      const tabs=(await chrome.tabs.query({windowId:${st.B}})).sort((a,b)=>a.index-b.index);
      const n=tabs.length;
      await Promise.all(Array.from({length:200},(_,i)=>chrome.tabs.move(tabs[(i*13+${rep})%n].id,{index:(i*29+${rep}*7)%n})));
      const final=(await chrome.tabs.query({windowId:${st.B}})).sort((a,b)=>a.index-b.index).map(t=>t.id);
      return JSON.stringify({ms:Date.now()-t0,final});
    })()`,
      ),
    );
    let r;
    let prevN = -1;
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      r = JSON.parse(
        await cdp.evalIn(
          panel.sess,
          "JSON.stringify({org: performance.timeOrigin, msgs: window.__p.msgs.filter(m=>m.type==='patch'), lo: window.__p.lastOrder, lastMut: window.__p.lastMut})",
        ),
      );
      if (r.msgs.length === prevN && r.msgs.length > 0) break;
      prevN = r.msgs.length;
    }
    const lastOrderPatch = [...r.msgs].reverse().find((m) => m.order);
    res.burstMovesB.push({
      worker_move_calls_ms: info.ms,
      patches: r.msgs.length,
      order_patches: r.msgs.filter((m) => m.order).length,
      panel_matches_final_order: JSON.stringify(r.lo) === JSON.stringify(info.final),
      start_to_lastPatch_ms: lastOrderPatch ? r2(r.org + lastOrderPatch.t - t0) : null,
      patch_task_ms: r.msgs.map((m) => r2((m.tEnd ?? m.t) - m.t)),
      first_patch_ms: r.msgs[0] ? r2(r.org + r.msgs[0].t - t0) : null,
    });
    await sleep(500);
  }
  const f = (arr, k) => stat(arr.map((x) => x[k]).filter((x) => typeof x === 'number'));
  res.summary = {
    single: Object.fromEntries(
      [
        'set_to_dom_ms',
        'set_to_patchRecv_ms',
        'patchRecv_to_dom_ms',
        'patch_task_ms',
        'set_to_raf_ms',
      ].map((k) => [k, f(res.single, k)]),
    ),
    burstTitles: Object.fromEntries(
      ['set_to_lastPatch_ms', 'set_to_lastDomMutation_ms', 'patches', 'seen'].map((k) => [
        k,
        f(res.burstTitles, k),
      ]),
    ),
    burstMoves: Object.fromEntries(
      [
        'start_to_lastPatch_ms',
        'start_to_lastDomMutation_ms',
        'patches',
        'order_patches',
        'worker_move_calls_ms',
      ].map((k) => [k, f(res.burstMoves, k)]),
    ),
    burstMovesAllMatch: res.burstMoves.every((x) => x.panel_matches_final_order),
    burstMovesB: Object.fromEntries(
      [
        'start_to_lastPatch_ms',
        'first_patch_ms',
        'patches',
        'order_patches',
        'worker_move_calls_ms',
      ].map((k) => [k, f(res.burstMovesB, k)]),
    ),
    burstMovesBAllMatch: res.burstMovesB.every((x) => x.panel_matches_final_order),
  };
  return res;
};

const FRAME_JS = `(() => {
  window.__loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ dur: e.duration, block: e.blockingDuration, script: e.scripts.reduce((a, s) => a + s.duration, 0) }); }).observe({ type: 'long-animation-frame' }); } catch {}
  window.__frames = (ms, mode) => new Promise((res) => {
    const el = document.querySelector('[role=tree]'); const max = el.scrollHeight - el.clientHeight;
    const frames = []; let last = performance.now(); const start = last; el.scrollTop = 0;
    function f(t) { frames.push(t - last); last = t; const p = (t - start) / ms; const x = p < 0.5 ? p * 2 : (1 - p) * 2; if (mode === 'scroll') el.scrollTop = Math.max(0, x * max); if (t - start < ms) requestAnimationFrame(f); else res({ frames, max, rows: el.querySelectorAll('[role=treeitem]').length }); }
    requestAnimationFrame(f);
  });
})()`;
const METRICS = [
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'TaskDuration',
  'LayoutCount',
  'RecalcStyleCount',
  'JSHeapUsedSize',
  'Nodes',
];
async function metrics(ctx) {
  const { metrics: ms } = await ctx.cdp.send('Performance.getMetrics', {}, ctx.panel.sess);
  return Object.fromEntries(
    ms.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]),
  );
}
function frameStats(frames) {
  const f = frames.slice(2);
  return {
    frames: f.length,
    median_ms: r2(median(f)),
    p95_ms: r2(pct(f, 0.95)),
    p99_ms: r2(pct(f, 0.99)),
    max_ms: r2(Math.max(...f)),
    over16_7: f.filter((x) => x > 16.7).length,
    over20: f.filter((x) => x > 20).length,
    over33: f.filter((x) => x > 33.4).length,
    over50: f.filter((x) => x > 50).length,
    mean_ms: r2(f.reduce((a, b) => a + b, 0) / f.length),
  };
}
const FIELDS = [
  'median_ms',
  'p95_ms',
  'p99_ms',
  'max_ms',
  'over16_7',
  'over20',
  'over33',
  'over50',
  'frames',
  'mean_ms',
];

PHASES.scroll = async (ctx) => {
  const { cdp, panel } = ctx;
  await freshPanel(ctx);
  await sleep(800);
  await cdp.evalIn(panel.sess, FRAME_JS);
  const res = { idle: [], scroll3s: [], scroll8s: [] };
  for (let i = 0; i < (ctx.reps ?? 5); i++) {
    const idle = await cdp.evalIn(panel.sess, "__frames(2000,'idle')");
    res.idle.push(frameStats(idle.frames));
    for (const [name, ms] of ctx.skip8
      ? [['scroll3s', 3000]]
      : [
          ['scroll3s', 3000],
          ['scroll8s', 8000],
        ]) {
      const m0 = await metrics(ctx);
      await cdp.evalIn(panel.sess, 'window.__loaf.length = 0');
      const r = await cdp.evalIn(panel.sess, `__frames(${ms * 2},'scroll')`, { timeout: 60000 });
      const m1 = await metrics(ctx);
      const loaf = JSON.parse(await cdp.evalIn(panel.sess, 'JSON.stringify(window.__loaf)'));
      res[name].push({
        ...frameStats(r.frames),
        scrollPx: r.max,
        durationMs: ms * 2,
        rowsInDom: r.rows,
        cdp: Object.fromEntries(Object.keys(m0).map((k) => [k, r2(m1[k] - m0[k])])),
        loaf_count: loaf.length,
        loaf_max_ms: loaf.length ? r2(Math.max(...loaf.map((x) => x.dur))) : 0,
        loaf_script_total_ms: r2(loaf.reduce((a, x) => a + x.script, 0)),
      });
    }
  }
  res.summary = {};
  for (const k of ['idle', 'scroll3s', 'scroll8s'].filter((k) => res[k].length))
    res.summary[k] = Object.fromEntries(FIELDS.map((f) => [f, stat(res[k].map((x) => x[f]))]));
  for (const k of ['scroll3s', 'scroll8s'].filter((k) => res[k].length)) {
    res.summary[k].cdp = {};
    for (const m of [
      'ScriptDuration',
      'LayoutDuration',
      'RecalcStyleDuration',
      'TaskDuration',
      'LayoutCount',
      'RecalcStyleCount',
    ])
      res.summary[k].cdp[m] = stat(res[k].map((x) => x.cdp[m]));
    res.summary[k].scrollPx = res[k][0].scrollPx;
    res.summary[k].rowsInDom = res[k][0].rowsInDom;
    res.summary[k].loaf_count = stat(res[k].map((x) => x.loaf_count));
    res.summary[k].loaf_max_ms = stat(res[k].map((x) => x.loaf_max_ms));
  }
  return res;
};

async function typeChar(ctx, ch) {
  const { cdp, panel } = ctx;
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch, code: `Key${ch.toUpperCase()}` },
    panel.sess,
  );
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: ch, code: `Key${ch.toUpperCase()}` },
    panel.sess,
  );
}
async function backspace(ctx) {
  const { cdp, panel } = ctx;
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    panel.sess,
  );
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    panel.sess,
  );
}
const SEARCH_JS = `(() => {
  const input = document.querySelector('input[role=searchbox]');
  const S = window.__s = { ev: [], timing: [] };
  input.addEventListener('input', (e) => {
    const rec = { value: input.value, t0: e.timeStamp, tIn: performance.now(), tDom: null, tRaf: null, tRaf2: null, rows: null };
    S.ev.push(rec);
    const mo = new MutationObserver(() => { mo.disconnect(); if (rec.tDom === null) { rec.tDom = performance.now(); rec.rows = document.querySelectorAll('[role=treeitem]').length; requestAnimationFrame(() => { rec.tRaf = performance.now(); requestAnimationFrame(() => { rec.tRaf2 = performance.now(); }); }); } });
    mo.observe(document.querySelector('[role=tree]') || document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    setTimeout(() => { mo.disconnect(); if (rec.tDom === null) rec.tDom = -1; }, 400);
  }, true);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'input' || e.name === 'keydown') S.timing.push({ name: e.name, dur: e.duration, proc: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
})()`;

PHASES.search = async (ctx) => {
  const { cdp, panel } = ctx;
  await freshPanel(ctx);
  await sleep(800);
  await cdp.evalIn(panel.sess, SEARCH_JS);
  await cdp.evalIn(panel.sess, "document.querySelector('input[role=searchbox]').focus()");
  const out = { github: [], doc: [] };
  for (const q of ['github', 'doc', 'github', 'doc', 'github', 'doc', 'github', 'doc']) {
    await cdp.evalIn(panel.sess, 'window.__s.ev.length = 0; window.__s.timing.length = 0; 1');
    const m0 = await metrics(ctx);
    for (const ch of q) {
      await typeChar(ctx, ch);
      await sleep(350);
    }
    const evs = JSON.parse(await cdp.evalIn(panel.sess, 'JSON.stringify(window.__s.ev)'));
    const tim = JSON.parse(await cdp.evalIn(panel.sess, 'JSON.stringify(window.__s.timing)'));
    const m1 = await metrics(ctx);
    await cdp.evalIn(panel.sess, 'window.__s.ev.length = 0; 1');
    for (let i = 0; i < q.length; i++) {
      await backspace(ctx);
      await sleep(350);
    }
    const evb = JSON.parse(await cdp.evalIn(panel.sess, 'JSON.stringify(window.__s.ev)'));
    out[q].push({
      typed: evs.map((e) => ({
        prefix: e.value,
        rows: e.rows,
        input_to_dom_ms: r2(e.tDom - e.t0),
        handler_to_dom_ms: r2(e.tDom - e.tIn),
        input_to_raf_ms: e.tRaf ? r2(e.tRaf - e.t0) : null,
        input_to_raf2_ms: e.tRaf2 ? r2(e.tRaf2 - e.t0) : null,
      })),
      erased: evb.map((e) => ({
        prefix: e.value,
        rows: e.rows,
        input_to_dom_ms: r2(e.tDom - e.t0),
        input_to_raf_ms: e.tRaf ? r2(e.tRaf - e.t0) : null,
      })),
      eventTiming: tim,
      cdpTyped: Object.fromEntries(Object.keys(m0).map((k) => [k, r2(m1[k] - m0[k])])),
    });
  }
  const per = {};
  for (const q of ['github', 'doc']) {
    for (let i = 0; i < q.length; i++) {
      const g = (k) =>
        stat(out[q].map((r) => r.typed[i]?.[k]).filter((x) => typeof x === 'number'));
      per[q.slice(0, i + 1)] = {
        rows: out[q][0].typed[i]?.rows,
        input_to_dom_ms: g('input_to_dom_ms'),
        handler_to_dom_ms: g('handler_to_dom_ms'),
        input_to_raf_ms: g('input_to_raf_ms'),
        input_to_raf2_ms: g('input_to_raf2_ms'),
      };
    }
  }
  const all = (f) =>
    out.github
      .concat(out.doc)
      .flatMap((r) => r.typed.map(f))
      .filter((x) => typeof x === 'number');
  out.summary = {
    perKeystroke: per,
    allKeystrokes_input_to_dom_ms: stat(all((e) => e.input_to_dom_ms)),
    allKeystrokes_input_to_raf_ms: stat(all((e) => e.input_to_raf_ms)),
    allKeystrokes_input_to_raf2_ms: stat(all((e) => e.input_to_raf2_ms)),
    allBackspaces_input_to_dom_ms: stat(
      out.github.concat(out.doc).flatMap((r) => r.erased.map((e) => e.input_to_dom_ms)),
    ),
    eventTimingEntries_ge16ms: out.github.concat(out.doc).flatMap((r) => r.eventTiming).length,
  };
  return out;
};

PHASES.mem = async (ctx) => {
  const { cdp, panel } = ctx;
  const res = {};
  await freshPanel(ctx);
  await sleep(1500);
  res.panel_after_load = await heap(ctx, panel.sess);
  res.worker = await heap(ctx, ctx.sw.sessionId);
  res.panel_nodes = (await metrics(ctx)).Nodes;
  res.panel_dom_treeitems = await cdp.evalIn(
    panel.sess,
    "document.querySelectorAll('[role=treeitem]').length",
  );
  Object.assign(res, chromeRss(ctx.st.chromePid));
  return res;
};

PHASES.drag = async (ctx) => {
  const { cdp, panel } = ctx;
  await freshPanel(ctx);
  await sleep(1000);
  await cdp.evalIn(panel.sess, FRAME_JS);
  const res = { sweeps: [], autoscroll: [] };
  const geo = JSON.parse(
    await cdp.evalIn(
      panel.sess,
      `JSON.stringify((()=>{const tr=document.querySelector('[role=tree]').getBoundingClientRect();const rows=[...document.querySelectorAll('[role=treeitem]')].map(e=>({id:e.id,r:e.getBoundingClientRect()})).filter(x=>x.id.startsWith('vc-row-t')&&x.r.top>tr.top+10&&x.r.bottom<tr.bottom);return {top:tr.top,bottom:tr.bottom,left:tr.left,right:tr.right,rowH:rows.length>1?rows[1].r.top-rows[0].r.top:0,first:rows[0]?.r.top??0,n:rows.length}})())`,
    ),
  );
  console.log('geo', geo);
  const x = (geo.left + geo.right) / 2 - 20;
  const mouse = (type, y, extra = {}) =>
    cdp.send(
      'Input.dispatchMouseEvent',
      {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1,
        pointerType: 'mouse',
        ...extra,
      },
      panel.sess,
    );
  for (let rep = 0; rep < 5; rep++) {
    const startY = geo.first + geo.rowH / 2;
    await mouse('mouseMoved', startY, { buttons: 0 });
    await mouse('mousePressed', startY);
    await cdp.evalIn(
      panel.sess,
      '(() => { window.__rec = { frames: [], on: true, last: performance.now() }; const f = (t) => { if (!window.__rec.on) return; window.__rec.frames.push(t - window.__rec.last); window.__rec.last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); window.__loaf.length = 0; return 1 })()',
    );
    const m0 = await metrics(ctx);
    let y = startY;
    let crossings = 0;
    let dir = 1;
    const lim = geo.bottom - 70;
    const t0 = Date.now();
    while (crossings < 110) {
      y += dir * geo.rowH;
      crossings++;
      if (y > lim) {
        y = lim;
        dir = -1;
      }
      if (y < geo.top + 80) {
        y = geo.top + 80;
        dir = 1;
      }
      await mouse('mouseMoved', y);
      await sleep(12);
    }
    const sweepMs = Date.now() - t0;
    const rec = JSON.parse(
      await cdp.evalIn(
        panel.sess,
        "JSON.stringify({f: window.__rec.frames, loaf: window.__loaf.slice(), ghost: !!document.querySelector('[class*=ghost]')})",
      ),
    );
    const m1 = await metrics(ctx);
    res.sweeps.push({
      ...frameStats(rec.f),
      crossings,
      sweepMs,
      ghostSeen: rec.ghost,
      loaf: rec.loaf.length,
      cdp: Object.fromEntries(Object.keys(m0).map((k) => [k, r2(m1[k] - m0[k])])),
    });
    await cdp.evalIn(
      panel.sess,
      'window.__rec.frames.length = 0; window.__loaf.length = 0; window.__rec.last = performance.now(); 1',
    );
    const before = await cdp.evalIn(panel.sess, "document.querySelector('[role=tree]').scrollTop");
    const t1 = Date.now();
    while (Date.now() - t1 < 3000) {
      await mouse('mouseMoved', geo.bottom - 4 - (Date.now() % 3));
      await sleep(12);
    }
    const after = await cdp.evalIn(panel.sess, "document.querySelector('[role=tree]').scrollTop");
    const rec2 = JSON.parse(
      await cdp.evalIn(
        panel.sess,
        'JSON.stringify({f: window.__rec.frames, loaf: window.__loaf.slice()})',
      ),
    );
    res.autoscroll.push({
      ...frameStats(rec2.f),
      scrolledPx: after - before,
      loaf: rec2.loaf.length,
    });
    await cdp.send(
      'Input.dispatchKeyEvent',
      { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      panel.sess,
    );
    await cdp.send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      panel.sess,
    );
    await cdp.evalIn(panel.sess, 'window.__rec.on = false; 1');
    await mouse('mouseReleased', geo.bottom - 4);
    await cdp.evalIn(panel.sess, "document.querySelector('[role=tree]').scrollTop = 0; 1");
    await sleep(500);
  }
  res.summary = {
    sweep: Object.fromEntries(FIELDS.map((f) => [f, stat(res.sweeps.map((x) => x[f]))])),
    autoscroll: Object.fromEntries(FIELDS.map((f) => [f, stat(res.autoscroll.map((x) => x[f]))])),
  };
  res.summary.sweep.cdp = {};
  for (const m of ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'])
    res.summary.sweep.cdp[m] = stat(res.sweeps.map((x) => x.cdp[m]));
  res.summary.sweep.ghostSeen = res.sweeps.map((x) => x.ghostSeen);
  res.summary.autoscroll.scrolledPx = stat(res.autoscroll.map((x) => x.scrolledPx));
  return res;
};

async function traced(ctx, work) {
  const { cdp } = ctx;
  const events = [];
  const done = new Promise((res) => cdp.on('Tracing.tracingComplete', res));
  cdp.on('Tracing.dataCollected', (p) => {
    for (const e of p.value) events.push(e);
  });
  await cdp.send('Tracing.start', {
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'v8.execute',
        'blink.user_timing',
        'disabled-by-default-devtools.timeline',
      ],
    },
    transferMode: 'ReportEvents',
  });
  const r = await work();
  await cdp.send('Tracing.end');
  await done;
  // Panel main thread = the CrRendererMain thread that ran the most FireAnimationFrame events.
  const names = new Map();
  for (const e of events)
    if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  const count = new Map();
  for (const e of events)
    if (e.name === 'FireAnimationFrame')
      count.set(`${e.pid}:${e.tid}`, (count.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const evs = events
    .filter((e) => `${e.pid}:${e.tid}` === main && e.ph === 'X' && e.dur !== undefined)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map();
  const stack = [];
  for (const e of evs) {
    while (stack.length && stack.at(-1).end <= e.ts) stack.pop();
    const node = { name: e.name, end: e.ts + e.dur, child: 0 };
    if (stack.length) stack.at(-1).child += e.dur;
    stack.push(node);
    e._node = node;
  }
  for (const e of evs) self.set(e.name, (self.get(e.name) ?? 0) + (e.dur - e._node.child) / 1000);
  const top = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([n, ms]) => [n, r2(ms)]);
  const span = evs.length ? (evs.at(-1).ts + evs.at(-1).dur - evs[0].ts) / 1000 : 0;
  const frames = evs.filter((e) => e.name === 'FireAnimationFrame').length;
  const busy = [...self.values()].reduce((a, b) => a + b, 0);
  return {
    result: r,
    mainThread: names.get(main),
    spanMs: r2(span),
    busySelfMs: r2(busy),
    animationFrames: frames,
    topSelfMs: top,
  };
}

PHASES.trace = async (ctx) => {
  const { cdp, panel } = ctx;
  await freshPanel(ctx);
  await sleep(1000);
  await cdp.evalIn(panel.sess, FRAME_JS);
  const out = {};
  out.idle = await traced(ctx, () =>
    cdp.evalIn(panel.sess, "__frames(2000,'idle')").then((r) => r.frames.length),
  );
  out.scroll = await traced(ctx, () =>
    cdp
      .evalIn(panel.sess, "__frames(6000,'scroll')", { timeout: 60000 })
      .then((r) => r.frames.length),
  );
  await sleep(500);
  await cdp.evalIn(panel.sess, SEARCH_JS);
  await cdp.evalIn(panel.sess, "document.querySelector('input[role=searchbox]').focus()");
  out.search_g = await traced(ctx, async () => {
    await typeChar(ctx, 'g');
    await sleep(500);
  });
  for (let i = 0; i < 1; i++) await backspace(ctx);
  await sleep(500);
  out.search_github = await traced(ctx, async () => {
    for (const ch of 'github') {
      await typeChar(ctx, ch);
      await sleep(300);
    }
  });
  out.summary = Object.fromEntries(
    Object.entries(out).map(([k, v]) => [
      k,
      {
        spanMs: v.spanMs,
        busySelfMs: v.busySelfMs,
        frames: v.animationFrames,
        top: v.topSelfMs.slice(0, 10),
      },
    ]),
  );
  return out;
};

PHASES.throttle4 = async (ctx) => {
  // Same scroll / search / drag work with the panel's CPU slowed 4x (a rough stand-in for a low-end laptop).
  await ctx.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }, ctx.panel.sess);
  ctx.reps = 3;
  ctx.skip8 = true;
  try {
    const out = {
      scroll: await PHASES.scroll(ctx),
      search: await PHASES.search(ctx),
      drag: await PHASES.drag(ctx),
    };
    out.summary = {
      scroll3s: out.scroll.summary.scroll3s,
      search: {
        all_input_to_dom_ms: out.search.summary.allKeystrokes_input_to_dom_ms,
        all_input_to_raf_ms: out.search.summary.allKeystrokes_input_to_raf_ms,
        all_input_to_raf2_ms: out.search.summary.allKeystrokes_input_to_raf2_ms,
        first_g: out.search.summary.perKeystroke.g,
        first_d: out.search.summary.perKeystroke.d,
      },
      drag: out.drag.summary,
    };
    return out;
  } finally {
    await ctx.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }, ctx.panel.sess);
    ctx.reps = undefined;
    ctx.skip8 = false;
  }
};

PHASES.memburst = async (ctx) => {
  const { panel } = ctx;
  await freshPanel(ctx);
  await sleep(800);
  const res = {
    before: { panel: await heap(ctx, panel.sess), worker: await heap(ctx, ctx.sw.sessionId) },
  };
  const ev = await PHASES.events(ctx); // re-opens the panel, so "after" is measured on a panel that also saw the bursts below
  res.events_summary = ev.summary;
  res.note =
    'events() opens a fresh panel first, then fires the bursts; "after" is that panel after the bursts';
  await sleep(1000);
  res.after = { panel: await heap(ctx, panel.sess), worker: await heap(ctx, ctx.sw.sessionId) };
  return res;
};

async function measure(names) {
  const ctx = await attachMeasure();
  if (!ctx.sw) throw new Error('no SW; is serve running?');
  await ensurePanel(ctx);
  const all = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : {};
  for (const n of names) {
    console.log('== phase', n);
    const t = Date.now();
    all[n] = await PHASES[n](ctx);
    console.log('   done in', Date.now() - t, 'ms');
    fs.writeFileSync(RESULTS, JSON.stringify(all, null, 1));
    console.log(JSON.stringify(all[n].summary ?? all[n], null, 1).slice(0, 7000));
  }
  await ctx.cdp.send('Target.closeTarget', { targetId: ctx.panel.targetId }).catch(() => {});
  console.log('results in', RESULTS);
  process.exit(0);
}

/** Replaces the loaded build in the running Chrome (same profile, same tabs) and reloads it. */

if (args.length === 0) {
  console.log('usage: node bench/measure.mjs [--build a|b] [--out name] <phase...>');
  console.log(`phases: ${Object.keys(PHASES).join(' ')}`);
  process.exit(2);
}
for (const n of args) {
  if (!PHASES[n]) {
    console.error(`unknown phase ${n}; have ${Object.keys(PHASES).join(' ')}`);
    process.exit(2);
  }
}
await measure(args);
