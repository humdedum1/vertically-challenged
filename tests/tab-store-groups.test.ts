import { describe, expect, it } from 'vitest';
import { ChangeSet, TabStore } from '../src/background/tab-store';
import type { GroupInfo, TabInfo, WindowPatch } from '../src/shared/types';
import { group, tab } from './helpers';

function load(store: TabStore, windowId: number, tabs: TabInfo[], groups: GroupInfo[] = []) {
  const cs = new ChangeSet();
  cs.resync.add(windowId);
  cs.groupWindows.add(windowId);
  return store.apply(cs, new Map([[windowId, tabs]]), new Map([[windowId, groups]]));
}

function groupsOnly(store: TabStore, windowId: number, groups: GroupInfo[]): WindowPatch[] {
  const cs = new ChangeSet();
  cs.groupWindows.add(windowId);
  return store.apply(cs, new Map(), new Map([[windowId, groups]]));
}

describe('ChangeSet.groupWindows', () => {
  it('makes isEmpty false', () => {
    const cs = new ChangeSet();
    expect(cs.isEmpty).toBe(true);
    cs.groupWindows.add(1);
    expect(cs.isEmpty).toBe(false);
  });
});

describe('TabStore groups', () => {
  it('initial load patches groups and snapshot includes them', () => {
    const store = new TabStore();
    const g = group(10, { title: 'Work' });
    const patches = load(store, 1, [tab(1, { groupId: 10 }), tab(2)], [g]);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.groups).toEqual([g]);
    expect(store.snapshot(1).groups).toEqual([g]);
    expect(store.groups(1)).toEqual([g]);
  });

  it('unchanged group list produces no patch', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], [group(10)]);
    expect(groupsOnly(store, 1, [group(10)])).toEqual([]);
  });

  it('title, colour and collapsed changes patch the list', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], [group(10)]);
    for (const change of [{ title: 'New' }, { color: 'red' as const }, { collapsed: true }]) {
      const next = group(10, change);
      const patches = groupsOnly(store, 1, [next]);
      expect(patches).toEqual([{ windowId: 1, groups: [next] }]);
      expect(store.groups(1)).toEqual([next]);
    }
  });

  it('adding, removing and reordering groups patches the list', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], [group(10)]);
    const both = [group(10), group(11)];
    expect(groupsOnly(store, 1, both)[0]?.groups).toEqual(both);
    const swapped = [group(11), group(10)];
    expect(groupsOnly(store, 1, swapped)[0]?.groups).toEqual(swapped);
    expect(groupsOnly(store, 1, [group(11)])[0]?.groups).toEqual([group(11)]);
  });

  it('an empty list deletes the groups and still emits groups: []', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], [group(10)]);
    const patches = groupsOnly(store, 1, []);
    expect(patches).toEqual([{ windowId: 1, groups: [] }]);
    expect(store.groups(1)).toEqual([]);
    expect(store.snapshot(1).groups).toEqual([]);
    // Empty again: nothing changed.
    expect(groupsOnly(store, 1, [])).toEqual([]);
  });

  it('group patch merges with tab patch for the same window', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], []);
    const cs = new ChangeSet();
    cs.resync.add(1);
    cs.groupWindows.add(1);
    const g = group(10);
    const patches = store.apply(cs, new Map([[1, [tab(1, { groupId: 10 })]]]), new Map([[1, [g]]]));
    expect(patches).toHaveLength(1);
    expect(patches[0]?.groups).toEqual([g]);
    expect(patches[0]?.upserts?.[0]?.groupId).toBe(10);
  });

  it('groups are tracked per window', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], [group(10)]);
    load(store, 2, [tab(2, { windowId: 2 })], [group(20, { windowId: 2 })]);
    expect(store.snapshot(1).groups.map((g) => g.id)).toEqual([10]);
    expect(store.snapshot(2).groups.map((g) => g.id)).toEqual([20]);
    expect(store.snapshot(3).groups).toEqual([]);
  });

  it('groupsResynced defaults to none', () => {
    const store = new TabStore();
    const cs = new ChangeSet();
    cs.resync.add(1);
    const patches = store.apply(cs, new Map([[1, [tab(1)]]]));
    expect(patches[0]?.groups).toBeUndefined();
  });
});

describe('TabStore.order / snapshot copies', () => {
  it('order() returns a copy', () => {
    const store = new TabStore();
    load(store, 1, [tab(1), tab(2)]);
    const o = store.order(1);
    expect(o).toEqual([1, 2]);
    o.push(99);
    expect(store.order(1)).toEqual([1, 2]);
    expect(store.order(42)).toEqual([]);
  });

  it('snapshot order and groups are copies', () => {
    const store = new TabStore();
    load(store, 1, [tab(1)], [group(10)]);
    const s = store.snapshot(1);
    s.order.push(5);
    s.groups.push(group(11));
    expect(store.snapshot(1).order).toEqual([1]);
    expect(store.snapshot(1).groups).toHaveLength(1);
  });
});
