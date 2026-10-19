import { describe, expect, it } from 'vitest';
import { ChangeSet, TabStore, tabsEqual } from '../src/background/tab-store';
import type { TabInfo, WindowPatch } from '../src/shared/types';
import { tab } from './helpers';

const resync = (...entries: [number, TabInfo[]][]) => new Map(entries);

function load(store: TabStore, entries: [number, TabInfo[]][]) {
  const cs = new ChangeSet();
  for (const [w] of entries) cs.resync.add(w);
  return store.apply(cs, resync(...entries));
}

const patchFor = (patches: WindowPatch[], windowId: number) =>
  patches.find((p) => p.windowId === windowId);

describe('ChangeSet', () => {
  it('isEmpty reflects all four collections', () => {
    expect(new ChangeSet().isEmpty).toBe(true);
    const a = new ChangeSet();
    a.removed.add(1);
    expect(a.isEmpty).toBe(false);
    const b = new ChangeSet();
    b.activations.set(1, 2);
    expect(b.isEmpty).toBe(false);
    const c = new ChangeSet();
    c.resync.add(1);
    expect(c.isEmpty).toBe(false);
    const d = new ChangeSet();
    d.upserts.set(1, tab(1));
    expect(d.isEmpty).toBe(false);
  });
});

describe('tabsEqual', () => {
  it('compares all fields', () => {
    expect(tabsEqual(tab(1), tab(1))).toBe(true);
    expect(tabsEqual(tab(1), tab(1, { title: 'x' }))).toBe(false);
    expect(tabsEqual(tab(1), tab(1, { windowId: 2 }))).toBe(false);
    expect(tabsEqual(tab(1), tab(1, { groupId: 3 }))).toBe(false);
  });
});

describe('TabStore', () => {
  it('initial load yields upserts and order per window', () => {
    const store = new TabStore();
    const w1 = [tab(1), tab(2)];
    const w2 = [tab(3, { windowId: 2 })];
    const patches = load(store, [
      [1, w1],
      [2, w2],
    ]);
    expect(patches).toHaveLength(2);
    expect(patchFor(patches, 1)).toEqual({ windowId: 1, upserts: w1, order: [1, 2] });
    expect(patchFor(patches, 2)).toEqual({ windowId: 2, upserts: w2, order: [3] });
  });

  it('snapshot returns tabs in order and a copy of the order', () => {
    const store = new TabStore();
    load(store, [[1, [tab(2), tab(1), tab(3)]]]);
    const snap = store.snapshot(1);
    expect(snap.order).toEqual([2, 1, 3]);
    expect(snap.tabs.map((t) => t.id)).toEqual([2, 1, 3]);
    snap.order.push(99);
    expect(store.snapshot(1).order).toEqual([2, 1, 3]);
    expect(store.snapshot(42)).toEqual({ tabs: [], order: [] });
    expect(store.get(2)?.id).toBe(2);
    expect(store.get(99)).toBeUndefined();
  });

  it('no-op resync returns []', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2)]]]);
    expect(load(store, [[1, [tab(1), tab(2)]]])).toEqual([]);
  });

  it('empty ChangeSet returns []', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    expect(store.apply(new ChangeSet(), new Map())).toEqual([]);
  });

  it('title change sends only that tab and no order', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3)]]]);
    const cs = new ChangeSet();
    cs.upserts.set(2, tab(2, { title: 'New' }));
    const patches = store.apply(cs, new Map());
    expect(patches).toEqual([{ windowId: 1, upserts: [tab(2, { title: 'New' })] }]);
    expect(patches[0]).not.toHaveProperty('order');
    expect(store.get(2)?.title).toBe('New');
  });

  it('identical upsert is a no-op', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const cs = new ChangeSet();
    cs.upserts.set(1, tab(1));
    expect(store.apply(cs, new Map())).toEqual([]);
  });

  it('removal emits removed and the new order', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3)]]]);
    const cs = new ChangeSet();
    cs.removed.add(2);
    expect(store.apply(cs, new Map())).toEqual([{ windowId: 1, removed: [2], order: [1, 3] }]);
    expect(store.get(2)).toBeUndefined();
    expect(store.snapshot(1).order).toEqual([1, 3]);
  });

  it('removing an unknown id is a no-op', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const cs = new ChangeSet();
    cs.removed.add(999);
    expect(store.apply(cs, new Map())).toEqual([]);
    expect(store.snapshot(1).order).toEqual([1]);
  });

  it('removal beats an upsert for the same id in the same ChangeSet', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2)]]]);
    const cs = new ChangeSet();
    cs.removed.add(2);
    cs.upserts.set(2, tab(2, { title: 'late' }));
    const patches = store.apply(cs, new Map());
    expect(patches).toEqual([{ windowId: 1, removed: [2], order: [1] }]);
  });

  it('activation flips exactly the old and new active tabs', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1, { active: true }), tab(2), tab(3)]]]);
    const cs = new ChangeSet();
    cs.activations.set(1, 3);
    const patches = store.apply(cs, new Map());
    expect(patches).toHaveLength(1);
    const ups = patches[0]?.upserts ?? [];
    expect(ups.map((t) => [t.id, t.active]).sort()).toEqual([
      [1, false],
      [3, true],
    ]);
    expect(patches[0]).not.toHaveProperty('order');
    expect(store.get(1)?.active).toBe(false);
    expect(store.get(2)?.active).toBe(false);
    expect(store.get(3)?.active).toBe(true);
  });

  it('activating the already-active tab is a no-op', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1, { active: true }), tab(2)]]]);
    const cs = new ChangeSet();
    cs.activations.set(1, 1);
    expect(store.apply(cs, new Map())).toEqual([]);
  });

  it('activation for an unknown window is ignored', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const cs = new ChangeSet();
    cs.activations.set(7, 1);
    expect(store.apply(cs, new Map())).toEqual([]);
  });

  it('stale upsert with active:false after activation does not deactivate', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1, { active: true }), tab(2)]]]);
    const act = new ChangeSet();
    act.activations.set(1, 2);
    store.apply(act, new Map());
    expect(store.get(2)?.active).toBe(true);

    const stale = new ChangeSet();
    stale.upserts.set(2, tab(2, { active: false, title: 'loaded' }));
    const patches = store.apply(stale, new Map());
    expect(store.get(2)?.active).toBe(true);
    expect(store.get(2)?.title).toBe('loaded');
    expect(patches[0]?.upserts?.[0]?.active).toBe(true);
  });

  it('stale upsert with active:true cannot activate an inactive tab', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1, { active: true }), tab(2)]]]);
    const cs = new ChangeSet();
    cs.upserts.set(2, tab(2, { active: true }));
    expect(store.apply(cs, new Map())).toEqual([]);
    expect(store.get(2)?.active).toBe(false);
  });

  it('upsert and activation in same ChangeSet: activation wins', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1, { active: true }), tab(2)]]]);
    const cs = new ChangeSet();
    cs.upserts.set(2, tab(2, { active: false, title: 't' }));
    cs.activations.set(1, 2);
    store.apply(cs, new Map());
    expect(store.get(2)).toMatchObject({ active: true, title: 't' });
    expect(store.get(1)?.active).toBe(false);
  });

  it('resynced windows win over per-tab events', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2)]]]);
    const cs = new ChangeSet();
    cs.resync.add(1);
    cs.upserts.set(1, tab(1, { title: 'stale event' }));
    cs.activations.set(1, 2);
    const fresh = [tab(1, { title: 'fresh' }), tab(2, { active: false })];
    const patches = store.apply(cs, resync([1, fresh]));
    expect(patches).toEqual([{ windowId: 1, upserts: [tab(1, { title: 'fresh' })] }]);
    expect(store.get(1)?.title).toBe('fresh');
    // activation skipped for resynced window: query truth stands
    expect(store.get(2)?.active).toBe(false);
  });

  it('resync with a removed tab emits removed and order', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2)]]]);
    const patches = load(store, [[1, [tab(1)]]]);
    expect(patches).toEqual([{ windowId: 1, removed: [2], order: [1] }]);
    expect(store.get(2)).toBeUndefined();
  });

  it('resync reorder sends order only', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1), tab(2), tab(3)]]]);
    const patches = load(store, [[1, [tab(3), tab(1), tab(2)]]]);
    expect(patches).toEqual([{ windowId: 1, order: [3, 1, 2] }]);
  });

  it('upsert for an unknown tab is ignored until resync', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const cs = new ChangeSet();
    cs.upserts.set(50, tab(50));
    expect(store.apply(cs, new Map())).toEqual([]);
    expect(store.get(50)).toBeUndefined();
    expect(store.snapshot(1).order).toEqual([1]);
  });

  it('upsert claiming a different window than the stored one is ignored', () => {
    const store = new TabStore();
    load(store, [[1, [tab(1)]]]);
    const cs = new ChangeSet();
    cs.upserts.set(1, tab(1, { windowId: 2 }));
    expect(store.apply(cs, new Map())).toEqual([]);
    expect(store.get(1)?.windowId).toBe(1);
  });

  describe('moving a tab between windows', () => {
    const setup = () => {
      const store = new TabStore();
      load(store, [
        [1, [tab(1), tab(2), tab(3)]],
        [2, [tab(10, { windowId: 2 })]],
      ]);
      return store;
    };
    const w1After = [tab(1), tab(3)];
    const w2After = [tab(10, { windowId: 2 }), tab(2, { windowId: 2 })];

    const check = (store: TabStore) => {
      expect(store.get(2)?.windowId).toBe(2);
      expect(store.snapshot(1).order).toEqual([1, 3]);
      expect(store.snapshot(2).order).toEqual([10, 2]);
      const all = [...store.snapshot(1).tabs, ...store.snapshot(2).tabs].filter((t) => t.id === 2);
      expect(all).toHaveLength(1);
      expect(all[0]?.windowId).toBe(2);
    };

    it('source window resynced first', () => {
      const store = setup();
      const cs = new ChangeSet();
      cs.resync.add(1).add(2);
      const patches = store.apply(cs, resync([1, w1After], [2, w2After]));
      check(store);
      expect(patchFor(patches, 1)).toEqual({ windowId: 1, removed: [2], order: [1, 3] });
      expect(patchFor(patches, 2)).toEqual({
        windowId: 2,
        upserts: [tab(2, { windowId: 2 })],
        order: [10, 2],
      });
    });

    it('destination window resynced first', () => {
      const store = setup();
      const cs = new ChangeSet();
      cs.resync.add(1).add(2);
      const patches = store.apply(cs, resync([2, w2After], [1, w1After]));
      check(store);
      expect(patchFor(patches, 1)).toEqual({ windowId: 1, removed: [2], order: [1, 3] });
      expect(patchFor(patches, 2)).toEqual({
        windowId: 2,
        upserts: [tab(2, { windowId: 2 })],
        order: [10, 2],
      });
    });

    it('only the destination window resynced', () => {
      const store = setup();
      const cs = new ChangeSet();
      cs.resync.add(2);
      const patches = store.apply(cs, resync([2, w2After]));
      check(store);
      expect(patchFor(patches, 1)).toEqual({ windowId: 1, removed: [2], order: [1, 3] });
      expect(patchFor(patches, 2)?.upserts?.map((t) => t.id)).toEqual([2]);
    });

    it('only the source window resynced removes the tab', () => {
      const store = setup();
      const cs = new ChangeSet();
      cs.resync.add(1);
      const patches = store.apply(cs, resync([1, w1After]));
      expect(patches).toEqual([{ windowId: 1, removed: [2], order: [1, 3] }]);
      expect(store.get(2)).toBeUndefined();
    });
  });

  it('closing a window (resync with []) removes all its tabs', () => {
    const store = new TabStore();
    load(store, [
      [1, [tab(1), tab(2)]],
      [2, [tab(3, { windowId: 2 })]],
    ]);
    const patches = load(store, [[1, []]]);
    expect(patches).toEqual([{ windowId: 1, removed: [1, 2], order: [] }]);
    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBeUndefined();
    expect(store.snapshot(1)).toEqual({ tabs: [], order: [] });
    expect(store.get(3)).toBeDefined();
  });

  it('closing an already-empty window is a no-op', () => {
    const store = new TabStore();
    expect(load(store, [[9, []]])).toEqual([]);
  });

  it('patches never contain empty arrays', () => {
    const store = new TabStore();
    const all: WindowPatch[] = [];
    all.push(...load(store, [[1, [tab(1), tab(2)]]]));
    const t = new ChangeSet();
    t.upserts.set(1, tab(1, { title: 'a' }));
    all.push(...store.apply(t, new Map()));
    const r = new ChangeSet();
    r.removed.add(2);
    all.push(...store.apply(r, new Map()));
    all.push(...load(store, [[1, []]]));
    all.push(...load(store, [[3, [tab(5, { windowId: 3 })]]]));
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      for (const k of ['upserts', 'removed'] as const) {
        if (k in p) expect(p[k]?.length).toBeGreaterThan(0);
      }
      // order may legitimately be [] only when a window becomes empty
      expect(p.upserts || p.removed || p.order).toBeDefined();
    }
    const first = all[0];
    expect(first).not.toHaveProperty('removed');
  });

  it('scale: one title change among 1,500 tabs sends 1 upsert and no order', () => {
    const store = new TabStore();
    const tabs = Array.from({ length: 1500 }, (_, i) => tab(i + 1));
    const initial = load(store, [[1, tabs]]);
    expect(initial[0]?.upserts).toHaveLength(1500);
    expect(initial[0]?.order).toHaveLength(1500);

    const cs = new ChangeSet();
    cs.upserts.set(777, tab(777, { title: 'changed' }));
    const patches = store.apply(cs, new Map());
    expect(patches).toHaveLength(1);
    expect(patches[0]?.upserts).toHaveLength(1);
    expect(patches[0]?.upserts?.[0]?.id).toBe(777);
    expect(patches[0]).not.toHaveProperty('order');
    expect(patches[0]).not.toHaveProperty('removed');
  });
});
