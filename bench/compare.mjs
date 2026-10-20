// Side-by-side table of the key numbers from measure.mjs result files, as Markdown.
//   node bench/compare.mjs bench/.out/results-a.json bench/.out/results-b.json
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('usage: node bench/compare.mjs <results.json>...');
  process.exit(2);
}
const data = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const get = (d, p) =>
  p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);
const fmt = (v) =>
  v && typeof v === 'object' && 'median' in v
    ? `${v.median} (${v.p95})`
    : v === undefined
      ? '-'
      : String(v);

/** Extension time after Chrome's own move calls, from the medians. */
const tail = (d, w) => {
  const a = get(d, `events.summary.${w}.start_to_lastPatch_ms`);
  const b = get(d, `events.summary.${w}.worker_move_calls_ms`);
  return a && b ? Math.round((a.median - b.median) * 10) / 10 : undefined;
};

const ROWS = [
  ['cold: nav → connect', 'open.summary.cold.nav_to_connect'],
  ['cold: nav → home snapshot', 'open.summary.cold.nav_to_homeSnapshotMsg'],
  ['cold: nav → first row', 'open.summary.cold.nav_to_firstRowDom'],
  ['cold: worker tabs.query', 'open.summary.cold.worker.d_tabsQuery'],
  ['warm: nav → connect', 'open.summary.warm.nav_to_connect'],
  ['warm: nav → first row', 'open.summary.warm.nav_to_firstRowDom'],
  ['1 title: set → DOM', 'events.summary.single.set_to_dom_ms'],
  ['1 title: patch → DOM', 'events.summary.single.patchRecv_to_dom_ms'],
  ['1 title: panel task', 'events.summary.single.patch_task_ms'],
  ['200 titles: set → last DOM', 'events.summary.burstTitles.set_to_lastDomMutation_ms'],
  ['200 moves A: Chrome move calls', 'events.summary.burstMoves.worker_move_calls_ms'],
  ['200 moves A: extension after Chrome', (d) => tail(d, 'burstMoves')],
  ['moves B: extension after Chrome', (d) => tail(d, 'burstMovesB')],
  ['scroll 3s: script s', 'scroll.summary.scroll3s.cdp.ScriptDuration'],
  ['scroll 3s: task s', 'scroll.summary.scroll3s.cdp.TaskDuration'],
  ['scroll 3s: frames > 20 ms', 'scroll.summary.scroll3s.over20'],
  ['search: keystroke → DOM', 'search.summary.allKeystrokes_input_to_dom_ms'],
  ['4x scroll: p95 frame', 'throttle4.summary.scroll3s.p95_ms'],
  ['4x scroll: frames > 20 ms', 'throttle4.summary.scroll3s.over20'],
  ['4x scroll: frames > 33 ms', 'throttle4.summary.scroll3s.over33'],
  ['4x scroll: script s', 'throttle4.summary.scroll3s.cdp.ScriptDuration'],
  ['4x search: keystroke → DOM', 'throttle4.summary.search.all_input_to_dom_ms'],
  ['panel heap after load (MB)', 'mem.panel_after_load.usedMB'],
];

console.log(`| metric (median (p95), ms) | ${files.map((f) => path.basename(f)).join(' | ')} |`);
console.log(`| --- |${files.map(() => ' --- |').join('')}`);
for (const [name, p] of ROWS) {
  const cells = data.map((d) => fmt(typeof p === 'function' ? p(d) : get(d, p)));
  if (cells.every((c) => c === '-')) continue;
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
