// Node benchmarks of the pure functions at 1,500 tabs, on the same synthetic tabs as the
// Chrome fixture: row building, search, the worker store and message sizes. Each bench is
// a Vitest test that times its function (30 warm-up calls, then up to 400 calls or 1 s)
// and the results are printed as one table at the end.
//   npm run bench:pure
import { afterAll, describe, test } from 'vitest';
import { ChangeSet, type TabOp, TabStore } from '../src/background/tab-store';
import { FuzzyIndex } from '../src/lib/search/fuzzy-index';
import type { PinItem, WindowLayout } from '../src/shared/layout';
import type { GroupColor, GroupInfo, TabInfo } from '../src/shared/types';
import { buildPanelRows, buildRows, buildSearchRows, reuseRows } from '../src/sidepanel/model/rows';
import { fixtureFor } from './fixture-data.mjs';

const A = 1;
const B = 2;
const COLORS: GroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

const mkTab = (
  id: number,
  windowId: number,
  groupId: number,
  pinned: boolean,
  active = false,
): TabInfo => {
  const f = fixtureFor(id);
  return {
    id,
    windowId,
    title: f.title,
    url: f.url,
    pinned,
    active,
    audible: false,
    muted: false,
    discarded: false,
    loading: false,
    groupId,
    incognito: false,
  };
};

// Window A: 20 pinned, 28 groups of 10-30 tabs, 1,400 in all. Window B: 100, 2 groups.
const tabsA: TabInfo[] = [];
const groupsA: GroupInfo[] = [];
{
  let id = 1000;
  for (let i = 0; i < 20; i++) tabsA.push(mkTab(id++, A, -1, true));
  for (let i = 0; i < 20; i++) tabsA.push(mkTab(id++, A, -1, false, i === 0));
  for (let g = 0; g < 28; g++) {
    const gid = 500 + g;
    groupsA.push({
      id: gid,
      windowId: A,
      title: `Group A${g}`,
      color: COLORS[g % 9] as GroupColor,
      collapsed: false,
    });
    for (let i = 0; i < 10 + ((g * 7) % 21); i++) tabsA.push(mkTab(id++, A, gid, false));
    for (let i = 0; i < 8; i++) tabsA.push(mkTab(id++, A, -1, false));
  }
  while (tabsA.length < 1400) tabsA.push(mkTab(id++, A, -1, false));
  tabsA.length = 1400;
}
const tabsB: TabInfo[] = [];
const groupsB: GroupInfo[] = [];
{
  let id = 5000;
  for (let g = 0; g < 2; g++)
    groupsB.push({
      id: 700 + g,
      windowId: B,
      title: `Group B${g}`,
      color: 'blue',
      collapsed: false,
    });
  for (let i = 0; i < 5; i++) tabsB.push(mkTab(id++, B, -1, false));
  for (let g = 0; g < 2; g++)
    for (let i = 0; i < 12; i++) tabsB.push(mkTab(id++, B, 700 + g, false));
  while (tabsB.length < 100) tabsB.push(mkTab(id++, B, -1, false));
}

const item = (i: number, tabId: number): PinItem => ({
  kind: 'item',
  id: `i${String(i).padStart(10, '0')}`,
  homeUrl: fixtureFor(tabId).url,
  lastUrl: fixtureFor(tabId).url,
  title: fixtureFor(tabId).title,
  tabId,
});
const layoutA: WindowLayout = {
  id: 'l0000000001',
  name: '',
  collapsed: [],
  incognito: false,
  lastUsed: 0,
  essentials: Array.from({ length: 8 }, (_, i) => item(i, 1000 + i)),
  pinned: [
    {
      kind: 'folder',
      id: 'f0000000001',
      name: 'Work',
      icon: 'work',
      collapsed: false,
      children: Array.from({ length: 6 }, (_, i) => item(10 + i, 1008 + i)),
    },
    {
      kind: 'folder',
      id: 'f0000000002',
      name: 'Reading',
      icon: 'book',
      collapsed: false,
      children: Array.from({ length: 6 }, (_, i) => item(20 + i, 1014 + i)),
    },
  ],
};
const layoutB: WindowLayout = {
  id: 'l0000000002',
  name: '',
  collapsed: [],
  incognito: false,
  lastUsed: 0,
  essentials: [],
  pinned: [],
};
const wins = [
  {
    info: { id: A, incognito: false, focused: true },
    tabs: tabsA,
    groups: groupsA,
    layout: layoutA,
  },
  {
    info: { id: B, incognito: false, focused: false },
    tabs: tabsB,
    groups: groupsB,
    layout: layoutB,
  },
];
const docs = [...tabsA, ...tabsB];

const results: { name: string; median: number; p95: number; max: number; calls: number }[] = [];
let group = '';
function bench(name: string, fn: () => void): void {
  const label = `${group} › ${name}`;
  test(name, () => {
    for (let i = 0; i < 30; i++) fn();
    const times: number[] = [];
    const end = performance.now() + 1000;
    while (times.length < 400 && performance.now() < end) {
      const t0 = performance.now();
      fn();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const at = (q: number) =>
      times[Math.min(times.length - 1, Math.floor(q * times.length))] as number;
    results.push({ name: label, median: at(0.5), p95: at(0.95), max: at(1), calls: times.length });
  });
}
const section = (name: string, body: () => void) =>
  describe(name, () => {
    group = name;
    body();
  });
afterAll(() => {
  const ms = (x: number) => x.toFixed(3).padStart(8);
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map(
    (r) =>
      `${r.name.padEnd(width)} ${ms(r.median)} ${ms(r.p95)} ${ms(r.max)} ${String(r.calls).padStart(6)}`,
  );
  console.log(
    [`${'benchmark'.padEnd(width)}   median      p95      max  calls (ms per call)`, ...lines].join(
      '\n',
    ),
  );
});

section('panel rows (1,500 tabs, 2 windows)', () => {
  bench('buildPanelRows', () => {
    buildPanelRows(wins, A, { tilesPerRow: 8 });
  });
  bench('buildPanelRows, no layouts yet', () => {
    buildPanelRows(
      wins.map((w) => ({ ...w, layout: undefined })),
      A,
      { tilesPerRow: 8 },
    );
  });
  bench('buildRows, 1,400 unpinned', () => {
    buildRows(
      tabsA.filter((t) => !t.pinned),
      groupsA,
      0,
    );
  });
  // What a single-title patch costs the panel before Svelte: rebuild, then keep the
  // unchanged rows' objects so only the changed row re-renders.
  let prev = buildPanelRows(wins, A, { tilesPerRow: 8 });
  let n = 0;
  bench('buildPanelRows + reuseRows after one title change', () => {
    const tabs = tabsA.slice();
    tabs[700] = { ...(tabs[700] as TabInfo), title: `T${n++}` };
    prev = reuseRows(
      prev,
      buildPanelRows([{ ...wins[0], tabs } as (typeof wins)[0], wins[1] as (typeof wins)[0]], A, {
        tilesPerRow: 8,
      }),
    );
  });
});

section('search (1,500 tabs)', () => {
  const index = new FuzzyIndex();
  index.replaceAll(docs);
  bench('replaceAll, cold', () => {
    new FuzzyIndex().replaceAll(docs);
  });
  bench('replaceAll, warm cache', () => {
    index.replaceAll(docs);
  });
  for (const q of ['g', 'github', 'doc', 'e', 'github pull', 'zzzzzz']) {
    bench(`search "${q}" + buildSearchRows`, () => {
      buildSearchRows(docs, index.search(q));
    });
  }
});

section('worker store (1,400-tab window)', () => {
  const fresh = () => {
    const store = new TabStore();
    const cs = new ChangeSet();
    cs.resync.add(A);
    cs.resync.add(B);
    store.apply(
      cs,
      new Map([
        [A, tabsA],
        [B, tabsB],
      ]),
      new Map([
        [A, groupsA],
        [B, groupsB],
      ]),
    );
    return store;
  };
  const store = fresh();
  let k = 0;
  bench('snapshot of window A', () => {
    store.snapshot(A);
  });
  bench('one title upsert', () => {
    const cs = new ChangeSet();
    const t = tabsA[100 + (k++ % 50)] as TabInfo;
    cs.upserts.set(t.id, { ...t, title: `x${k}` });
    store.apply(cs, new Map());
  });
  bench('200 title upserts', () => {
    const cs = new ChangeSet();
    for (let i = 0; i < 200; i++) {
      const t = tabsA[100 + i] as TabInfo;
      cs.upserts.set(t.id, { ...t, title: `y${k}-${i}` });
    }
    k++;
    store.apply(cs, new Map());
  });
  // A move as the worker handled it before local ops: replace the window from a query.
  const moved = tabsA.slice();
  bench('move by resync (full window replace)', () => {
    const i = 100 + (k++ % 400);
    const [t] = moved.splice(i, 1);
    moved.splice(i + 7, 0, t as TabInfo);
    const cs = new ChangeSet();
    cs.resync.add(A);
    store.apply(cs, new Map([[A, moved.slice()]]));
  });
  // The same move as a local op (no tabs.query; that query alone is about 37 ms in Chrome).
  bench('move by local op', () => {
    const order = store.order(A);
    const from = 100 + (k++ % 400);
    const op: TabOp = {
      kind: 'move',
      windowId: A,
      tabId: order[from] as number,
      from,
      to: from + 7,
    };
    const cs = new ChangeSet();
    cs.ops.push(op);
    store.unreplayable(cs);
    store.apply(cs, new Map());
  });
});

section('wire (JSON stands in for Chrome message serialisation)', () => {
  const store = new TabStore();
  const cs = new ChangeSet();
  cs.resync.add(A);
  store.apply(cs, new Map([[A, tabsA]]));
  const snap = { type: 'snapshot', windowId: A, ...store.snapshot(A) };
  const json = JSON.stringify(snap);
  bench(`stringify snapshot of window A (${Math.round(json.length / 1024)} KB)`, () => {
    JSON.stringify(snap);
  });
  bench('parse snapshot of window A', () => {
    JSON.parse(json);
  });
});
