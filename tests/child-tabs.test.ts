import { expect, it } from 'vitest';
import { buildChildRows } from '../src/sidepanel/model/child-tabs';
import { buildRows } from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

it('nests link-opened siblings and grandchildren in browser order', () => {
  const rows = buildChildRows(
    buildRows(
      [
        tab(1),
        tab(2, { openerTabId: 1 }),
        tab(3, { openerTabId: 2 }),
        tab(4, { openerTabId: 1 }),
        tab(5),
      ],
      [],
    ),
    new Set(),
  );
  expect(rows.map((r) => [r.key, r.level, r.pos, r.size])).toEqual([
    ['t1', 1, 1, 2],
    ['t2', 2, 1, 2],
    ['t3', 3, 1, 1],
    ['t4', 2, 2, 2],
    ['t5', 1, 2, 2],
  ]);
  expect(rows[0]).toMatchObject({ hasChildren: true, collapsed: false });
  expect(rows[2]).toMatchObject({ parentTabId: 2, childDepth: 2 });
});

it('collapses branches without closing their tabs and reveals active descendants', () => {
  const tabs = [tab(1), tab(2, { openerTabId: 1 }), tab(3, { openerTabId: 2 }), tab(4)];
  expect(buildChildRows(buildRows(tabs, []), new Set([1])).map((r) => r.key)).toEqual(['t1', 't4']);
  expect(buildChildRows(buildRows(tabs, []), new Set([2])).map((r) => r.key)).toEqual([
    't1',
    't2',
    't4',
  ]);
  tabs[2] = tab(3, { openerTabId: 2, active: true });
  expect(buildChildRows(buildRows(tabs, []), new Set([1, 2])).map((r) => r.key)).toEqual([
    't1',
    't2',
    't3',
    't4',
  ]);
});

it('keeps moved, orphaned, pinned and cross-group tabs out of unrelated branches', () => {
  const tabs = [
    tab(1, { pinned: true }),
    tab(2, { openerTabId: 1 }),
    tab(3),
    tab(4, { openerTabId: 2 }),
    tab(5, { openerTabId: 99 }),
    tab(6, { groupId: 7 }),
    tab(7, { groupId: 7, openerTabId: 6 }),
    tab(8, { openerTabId: 7 }),
  ];
  const rows = buildChildRows(buildRows(tabs, [group(7)]), new Set());
  expect(rows.map((r) => r.level)).toEqual([1, 1, 1, 1, 1, 1, 2, 3, 1]);
  expect(rows.map((r) => r.key)).toEqual(['t1', 't2', 't3', 't4', 't5', 'g7', 't6', 't7', 't8']);
});

it('promotes a child when its parent is closed and does not mutate input rows', () => {
  const source = buildRows([tab(2, { openerTabId: 1 }), tab(3, { openerTabId: 2 })], []);
  const copy = structuredClone(source);
  expect(buildChildRows(source, new Set()).map((r) => r.level)).toEqual([1, 2]);
  expect(source).toEqual(copy);
});

it('handles deeply nested tabs without recursive traversal', () => {
  const tabs = Array.from({ length: 2000 }, (_, i) => tab(i + 1, i ? { openerTabId: i } : {}));
  const rows = buildChildRows(buildRows(tabs, []), new Set());
  expect(rows.at(-1)?.level).toBe(2000);
});

it('does not treat an extension page as a browsing parent', () => {
  const rows = buildChildRows(
    buildRows(
      [tab(1, { url: 'chrome-extension://panel/sidepanel.html' }), tab(2, { openerTabId: 1 })],
      [],
    ),
    new Set(),
  );
  expect(rows.map((r) => r.level)).toEqual([1, 1]);
});
