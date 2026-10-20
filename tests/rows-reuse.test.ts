import { describe, expect, it } from 'vitest';
import type { PinItem, WindowLayout } from '../src/shared/layout';
import { buildPanelRows, buildRows, type Row, reuseRows } from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

describe('reuseRows', () => {
  it('keeps the old objects for rows that did not change', () => {
    const tabs = [tab(1), tab(2), tab(3)];
    const prev = buildRows(tabs, []);
    const next = buildRows([tabs[0], { ...tab(2), title: 'New' }, tabs[2]] as typeof tabs, []);
    const out = reuseRows(prev, next);
    expect(out).toBe(next);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).not.toBe(prev[1]);
    expect(out[1]).toMatchObject({ tab: { title: 'New' } });
    expect(out[2]).toBe(prev[2]);
  });

  it('returns the previous array when nothing changed', () => {
    const tabs = [tab(1), tab(2)];
    const prev = buildRows(tabs, [group(5)]);
    expect(reuseRows(prev, buildRows(tabs, [group(5)]))).toBe(prev);
  });

  it('does not reuse a row whose position fields changed', () => {
    const prev = buildRows([tab(1), tab(2)], []);
    const out = reuseRows(prev, buildRows([tab(1), tab(2), tab(3)], []));
    // Every top-level row's setsize grew, so none can be reused.
    expect(out.some((r, i) => r === prev[i])).toBe(false);
    expect(out.map((r) => (r as { size: number }).size)).toEqual([3, 3, 3]);
  });

  it('handles reorders by key, not by position', () => {
    const a = tab(1);
    const b = tab(2);
    const prev = buildRows([a, b], []);
    const out = reuseRows(prev, buildRows([b, a], []));
    // pos swapped, so these are new objects with the right numbers.
    expect(out.map((r) => r.key)).toEqual(['t2', 't1']);
    expect(out.map((r) => (r as { pos: number }).pos)).toEqual([1, 2]);
  });

  it('compares tile rows item by item', () => {
    const item = (id: string, tabId: number): PinItem => ({
      kind: 'item',
      id,
      homeUrl: `https://e.com/${id}`,
      lastUrl: `https://e.com/${id}`,
      title: id,
      tabId,
    });
    const layout: WindowLayout = {
      id: 'L2',
      name: '',
      essentials: [item('a', 10), item('b', 11)],
      pinned: [],
      collapsed: [],
      incognito: false,
      lastUsed: 0,
    };
    const t10 = tab(10, { windowId: 2, pinned: true });
    const t11 = tab(11, { windowId: 2, pinned: true });
    const home = { id: 1, incognito: false, focused: true };
    const other = { id: 2, incognito: false, focused: false };
    const homeTabs = [tab(1)];
    const build = (tabs = [t10, t11]): Row[] =>
      buildPanelRows(
        [
          { info: home, tabs: homeTabs, groups: [], layout: undefined },
          { info: other, tabs, groups: [], layout },
        ],
        1,
        { tilesPerRow: 4 },
      );
    const prev = build();
    const tiles = prev.find((r) => r.kind === 'tiles');
    const out = reuseRows(prev, build());
    expect(out).toBe(prev);
    const changed = reuseRows(prev, build([t10, { ...t11, title: 'x' }]));
    expect(changed.find((r) => r.kind === 'tiles')).not.toBe(tiles);
  });

  it('starts from scratch with no previous rows', () => {
    const next = buildRows([tab(1)], []);
    expect(reuseRows([], next)).toBe(next);
  });
});
