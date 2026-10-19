import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../src/lib/search/search-index';
import {
  buildRows,
  buildSearchRows,
  type GroupRow,
  type TabRow,
} from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe('buildRows', () => {
  it('returns [] for an empty window', () => {
    expect(buildRows([], [])).toEqual([]);
  });

  it('marks pinnedEnd only on the last pinned tab', () => {
    const rows = buildRows(
      [tab(1, { pinned: true }), tab(2, { pinned: true }), tab(3)],
      [],
    ) as TabRow[];
    expect(rows.map((r) => r.pinnedEnd)).toEqual([false, true, false]);
  });

  it('marks pinnedEnd when every tab is pinned', () => {
    const rows = buildRows([tab(1, { pinned: true })], []) as TabRow[];
    expect(rows[0]?.pinnedEnd).toBe(true);
  });

  it('puts a group header before its tabs with level 2 children', () => {
    const rows = buildRows([tab(1, { groupId: 10 }), tab(2, { groupId: 10 })], [group(10)]);
    expect(keys(rows)).toEqual(['g10', 't1', 't2']);
    expect(rows[0]).toMatchObject({ kind: 'group', level: 1, pos: 1, size: 1, count: 2 });
    expect(rows[1]).toMatchObject({ kind: 'tab', level: 2, pos: 1, size: 2 });
    expect(rows[2]).toMatchObject({ kind: 'tab', level: 2, pos: 2, size: 2 });
  });

  it('collapsed groups hide children but count still includes them', () => {
    const rows = buildRows(
      [tab(1, { groupId: 10 }), tab(2, { groupId: 10 }), tab(3)],
      [group(10, { collapsed: true })],
    );
    expect(keys(rows)).toEqual(['g10', 't3']);
    expect((rows[0] as GroupRow).count).toBe(2);
    expect(rows[1]).toMatchObject({ level: 1, pos: 2, size: 2 });
  });

  it('counts top-level items across pinned, ungrouped and group headers', () => {
    const tabs = [
      tab(1, { pinned: true }),
      tab(2, { pinned: true }),
      tab(3),
      tab(4, { groupId: 10 }),
      tab(5, { groupId: 10 }),
      tab(6, { groupId: 10 }),
      tab(7),
    ];
    const rows = buildRows(tabs, [group(10)]);
    expect(keys(rows)).toEqual(['t1', 't2', 't3', 'g10', 't4', 't5', 't6', 't7']);
    const top = rows.filter((r) => r.level === 1);
    expect(top.map((r) => [r.pos, r.size])).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    const kids = rows.filter((r) => r.level === 2);
    expect(kids.map((r) => [r.pos, r.size])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('numbers children per group for two adjacent different groups', () => {
    const tabs = [
      tab(1, { groupId: 10 }),
      tab(2, { groupId: 10 }),
      tab(3, { groupId: 20 }),
      tab(4, { groupId: 20 }),
      tab(5, { groupId: 20 }),
    ];
    const rows = buildRows(tabs, [group(10), group(20)]);
    expect(keys(rows)).toEqual(['g10', 't1', 't2', 'g20', 't3', 't4', 't5']);
    expect(rows.filter((r) => r.kind === 'group').map((r) => [r.pos, r.size])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(rows.filter((r) => r.level === 2).map((r) => [r.pos, r.size])).toEqual([
      [1, 2],
      [2, 2],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('renders tabs ungrouped when their group has no GroupInfo', () => {
    const rows = buildRows([tab(1, { groupId: 99 }), tab(2)], []);
    expect(keys(rows)).toEqual(['t1', 't2']);
    expect(rows.map((r) => [r.level, r.pos, r.size])).toEqual([
      [1, 1, 2],
      [1, 2, 2],
    ]);
  });

  it('still renders the group when the same group id reappears non-adjacently', () => {
    const rows = buildRows([tab(1, { groupId: 10 }), tab(2), tab(3, { groupId: 10 })], [group(10)]);
    expect(keys(rows)).toEqual(['g10', 't1', 't2', 'g10', 't3']);
  });

  it('keys are unique in a realistic window', () => {
    const tabs = [
      tab(1, { pinned: true }),
      tab(2),
      tab(3, { groupId: 10 }),
      tab(4, { groupId: 10 }),
      tab(5, { groupId: 20 }),
      tab(6),
    ];
    const ks = keys(buildRows(tabs, [group(10), group(20, { collapsed: true })]));
    expect(new Set(ks).size).toBe(ks.length);
  });

  it('count of a group is the number of its tabs', () => {
    const rows = buildRows(
      [tab(1, { groupId: 10 }), tab(2, { groupId: 20 }), tab(3, { groupId: 20 })],
      [group(10), group(20)],
    );
    expect(rows.filter((r): r is GroupRow => r.kind === 'group').map((r) => r.count)).toEqual([
      1, 2,
    ]);
  });
});

describe('buildSearchRows', () => {
  const tabs = [tab(1), tab(2), tab(3)];
  const hit = (id: number, t: [number, number][] = [], u: [number, number][] = []): SearchHit => ({
    id,
    score: 1,
    title: t,
    url: u,
  });

  it('follows hit order and carries highlights', () => {
    const rows = buildSearchRows(tabs, [hit(3, [[0, 2]]), hit(1, [], [[1, 4]])]);
    expect(keys(rows)).toEqual(['t3', 't1']);
    expect(rows[0]?.highlight).toEqual({ title: [[0, 2]], url: [] });
    expect(rows[1]?.highlight).toEqual({ title: [], url: [[1, 4]] });
    expect(rows.every((r) => r.level === 1 && !r.pinnedEnd)).toBe(true);
  });

  it('skips hits for unknown tabs and sizes by the rows produced', () => {
    const rows = buildSearchRows(tabs, [hit(2), hit(99), hit(1)]);
    expect(keys(rows)).toEqual(['t2', 't1']);
    expect(rows.map((r) => [r.pos, r.size])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('returns [] for no hits', () => {
    expect(buildSearchRows(tabs, [])).toEqual([]);
  });
});
