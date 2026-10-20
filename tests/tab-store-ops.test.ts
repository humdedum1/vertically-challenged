import { describe, expect, it } from 'vitest';
import { ChangeSet, type TabOp, TabStore } from '../src/background/tab-store';
import type { TabInfo, WindowPatch } from '../src/shared/types';
import { tab } from './helpers';

function load(store: TabStore, entries: [number, TabInfo[]][]) {
  const cs = new ChangeSet();
  for (const [w] of entries) cs.resync.add(w);
  return store.apply(cs, new Map(entries));
}

/**
 * Applies ops the way the worker's flush does: `resync` windows (a tab was attached
 * there) and unreplayable ones are given the truth instead.
 */
function flush(
  store: TabStore,
  ops: TabOp[],
  truth?: Map<number, TabInfo[]>,
  resync: Iterable<number> = [],
) {
  const cs = new ChangeSet();
  cs.ops.push(...ops);
  for (const op of ops) if (op.kind === 'remove') cs.removed.add(op.tabId);
  for (const w of resync) cs.resync.add(w);
  const bad = store.unreplayable(cs);
  for (const w of cs.resync) bad.add(w);
  const resynced = new Map<number, TabInfo[]>();
  for (const w of bad) resynced.set(w, truth?.get(w) ?? []);
  for (const w of resynced.keys()) cs.resync.add(w);
  return { bad, patches: store.apply(cs, resynced) };
}

const ids = (store: TabStore, w: number) => store.snapshot(w).tabs.map((t) => t.id);
const patchFor = (patches: WindowPatch[], w: number) => patches.find((p) => p.windowId === w);

describe('TabStore local ops', () => {
  it('applies a move without a query', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3), tab(4)]]]);
    const { bad, patches } = flush(store, [
      { kind: 'move', windowId: 1, tabId: 1, from: 0, to: 2 },
    ]);
    expect(bad.size).toBe(0);
    expect(ids(store, 1)).toEqual([2, 3, 1, 4]);
    expect(patches).toEqual([{ windowId: 1, order: [2, 3, 1, 4] }]);
  });

  it('replays several moves in event order', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3)]]]);
    flush(store, [
      { kind: 'move', windowId: 1, tabId: 3, from: 2, to: 0 },
      { kind: 'move', windowId: 1, tabId: 1, from: 1, to: 2 },
    ]);
    expect(ids(store, 1)).toEqual([3, 2, 1]);
  });

  it('inserts a created tab at its index and sends it', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2)]]]);
    const t = tab(9);
    const { patches } = flush(store, [{ kind: 'create', windowId: 1, tab: t, index: 1 }]);
    expect(ids(store, 1)).toEqual([1, 9, 2]);
    expect(patchFor(patches, 1)).toEqual({ windowId: 1, upserts: [t], order: [1, 9, 2] });
  });

  it('creates the first tab of a window the store has not seen', () => {
    const store = new TabStore();
    const t = tab(5, { windowId: 7 });
    flush(store, [{ kind: 'create', windowId: 7, tab: t, index: 0 }]);
    expect(ids(store, 7)).toEqual([5]);
  });

  it('removes before later indices are used', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3), tab(4)]]]);
    const { bad } = flush(store, [
      { kind: 'remove', windowId: 1, tabId: 1 },
      { kind: 'move', windowId: 1, tabId: 4, from: 2, to: 0 },
    ]);
    expect(bad.size).toBe(0);
    expect(ids(store, 1)).toEqual([4, 2, 3]);
    expect(store.get(1)).toBeUndefined();
  });

  it('drops the order of a window whose last tab closed', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const { patches } = flush(store, [{ kind: 'remove', windowId: 1, tabId: 1 }]);
    expect(store.order(1)).toEqual([]);
    expect(patchFor(patches, 1)).toEqual({ windowId: 1, removed: [1], order: [] });
  });

  it('moves a tab between windows: detached here, queried there', () => {
    const store = new TabStore();
    load(store, [
      [1, [tab(1), tab(2)]],
      [2, [tab(3, { windowId: 2 })]],
    ]);
    const { patches } = flush(
      store,
      [{ kind: 'detach', windowId: 1, tabId: 2, position: 1 }],
      new Map([[2, [tab(2, { windowId: 2 }), tab(3, { windowId: 2 })]]]),
      [2],
    );
    expect(ids(store, 1)).toEqual([1]);
    expect(ids(store, 2)).toEqual([2, 3]);
    expect(store.get(2)?.windowId).toBe(2);
    expect(patchFor(patches, 1)).toEqual({ windowId: 1, removed: [2], order: [1] });
    expect(patchFor(patches, 2)).toEqual({
      windowId: 2,
      upserts: [tab(2, { windowId: 2 })],
      order: [2, 3],
    });
  });

  it('a pinned tab that Chrome unpins on the way arrives unpinned', () => {
    // Chrome reports the unpin against the old window, then detaches and attaches.
    const store = new TabStore();
    load(store, [
      [1, [tab(1), tab(2, { pinned: true })]],
      [2, [tab(3, { windowId: 2 })]],
    ]);
    const cs = new ChangeSet();
    cs.upserts.set(2, tab(2, { pinned: false }));
    cs.resync.add(1);
    cs.resync.add(2);
    store.apply(
      cs,
      new Map([
        [1, [tab(1)]],
        [2, [tab(2, { windowId: 2 }), tab(3, { windowId: 2 })]],
      ]),
    );
    expect(store.get(2)).toEqual(tab(2, { windowId: 2 }));
    expect(ids(store, 1)).toEqual([1]);
  });

  it('flags a move whose index does not match the store', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3)]]]);
    const truth = new Map([[1, [tab(3), tab(1), tab(2)]]]);
    const { bad } = flush(store, [{ kind: 'move', windowId: 1, tabId: 1, from: 2, to: 0 }], truth);
    expect([...bad]).toEqual([1]);
    expect(ids(store, 1)).toEqual([3, 1, 2]);
  });

  it('flags a create the store already has (the query already saw it)', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2)]]]);
    const { bad } = flush(store, [{ kind: 'create', windowId: 1, tab: tab(2), index: 1 }]);
    expect([...bad]).toEqual([1]);
  });

  it('flags windows with unlogged events and skips resynced ones', () => {
    const store = new TabStore();
    load(store, [
      [1, [tab(1), tab(2)]],
      [2, [tab(3, { windowId: 2 })]],
    ]);
    const cs = new ChangeSet();
    cs.ops.push({ kind: 'move', windowId: 1, tabId: 1, from: 0, to: 1 });
    cs.ops.push({ kind: 'move', windowId: 2, tabId: 9, from: 5, to: 0 });
    cs.unlogged.add(1);
    cs.resync.add(2);
    expect([...store.unreplayable(cs)]).toEqual([1]);
  });

  it('a bad window does not stop another window from replaying', () => {
    const store = new TabStore();
    load(store, [
      [1, [tab(1), tab(2)]],
      [2, [tab(3, { windowId: 2 }), tab(4, { windowId: 2 })]],
    ]);
    const truth = new Map([[1, [tab(2), tab(1)]]]);
    const { bad } = flush(
      store,
      [
        { kind: 'move', windowId: 1, tabId: 1, from: 1, to: 0 },
        { kind: 'move', windowId: 2, tabId: 3, from: 0, to: 1 },
      ],
      truth,
    );
    expect([...bad]).toEqual([1]);
    expect(ids(store, 1)).toEqual([2, 1]);
    expect(ids(store, 2)).toEqual([4, 3]);
  });

  it('upserts in the same flush update a created tab', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const cs = new ChangeSet();
    cs.ops.push({ kind: 'create', windowId: 1, tab: tab(2, { loading: true }), index: 1 });
    cs.upserts.set(2, tab(2, { title: 'Loaded' }));
    store.apply(cs, new Map());
    expect(store.get(2)?.title).toBe('Loaded');
    expect(store.get(2)?.loading).toBe(false);
  });

  it('matches Chrome over random event sequences', () => {
    // A tiny model of Chrome's tab strip produces the same events the worker logs.
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const chrome = new Map<number, number[]>([
        [1, [1, 2, 3, 4, 5]],
        [2, [6, 7, 8]],
      ]);
      const info = new Map<number, TabInfo>();
      for (const [w, list] of chrome) for (const id of list) info.set(id, tab(id, { windowId: w }));
      const store = new TabStore();
      load(
        store,
        [...chrome].map(([w, list]) => [w, list.map((id) => info.get(id) as TabInfo)]),
      );
      let next = 100;
      for (let batch = 0; batch < 5; batch++) {
        const ops: TabOp[] = [];
        // A window a tab was attached to is queried; its later events aren't logged.
        const queried = new Set<number>();
        const log = (op: TabOp) => {
          if (!queried.has(op.windowId)) ops.push(op);
        };
        for (let k = 0; k < 1 + rand(8); k++) {
          const w = 1 + rand(2);
          const list = chrome.get(w) as number[];
          const choice = rand(4);
          if (choice === 0 || list.length < 2) {
            const id = next++;
            const index = rand(list.length + 1);
            list.splice(index, 0, id);
            const t = tab(id, { windowId: w });
            info.set(id, t);
            log({ kind: 'create', windowId: w, tab: t, index });
          } else if (choice === 1) {
            const from = rand(list.length);
            const to = rand(list.length);
            if (from === to) continue;
            const [id] = list.splice(from, 1) as [number];
            list.splice(to, 0, id);
            log({ kind: 'move', windowId: w, tabId: id, from, to });
          } else if (choice === 2) {
            const [id] = list.splice(rand(list.length), 1) as [number];
            log({ kind: 'remove', windowId: w, tabId: id });
          } else {
            const other = w === 1 ? 2 : 1;
            const target = chrome.get(other) as number[];
            const position = rand(list.length);
            const [id] = list.splice(position, 1) as [number];
            log({ kind: 'detach', windowId: w, tabId: id, position });
            const at = rand(target.length + 1);
            target.splice(at, 0, id);
            info.set(id, { ...(info.get(id) as TabInfo), windowId: other });
            queried.add(other);
          }
        }
        const truth = new Map(
          [...chrome].map(([w, list]) => [w, list.map((id) => info.get(id) as TabInfo)]),
        );
        const { bad } = flush(store, ops, truth, queried);
        // Only the queried windows; every logged op replays.
        expect([...bad].every((w) => queried.has(w))).toBe(true);
        for (const [w, list] of chrome) {
          expect(ids(store, w)).toEqual(list);
          for (const id of list) expect(store.get(id)?.windowId).toBe(w);
        }
      }
    }
  });
});
