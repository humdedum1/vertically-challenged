import { describe, expect, it } from 'vitest';
import type { WindowInfo } from '../src/shared/types';
import { buildRows, buildWindowRows, rowWindowId } from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

const win = (id: number, over: Partial<WindowInfo> = {}): WindowInfo => ({
  id,
  incognito: false,
  focused: false,
  ...over,
});

const w1 = {
  info: win(1),
  tabs: [
    tab(1, { windowId: 1, pinned: true }),
    tab(2, { windowId: 1 }),
    tab(3, { windowId: 1, groupId: 7 }),
    tab(4, { windowId: 1, groupId: 7 }),
  ],
  groups: [group(7, { windowId: 1 })],
};
const w2 = {
  info: win(2, { incognito: true }),
  tabs: [tab(5, { windowId: 2 }), tab(6, { windowId: 2 })],
  groups: [],
};

describe('buildWindowRows', () => {
  it('emits a header per window in the given order, each followed by its tree', () => {
    const rows = buildWindowRows([w2, w1], 1, new Set());
    expect(rows.map((r) => r.key)).toEqual(['w2', 't5', 't6', 'w1', 't1', 't2', 'g7', 't3', 't4']);
  });

  it('window headers carry number, isHome, count, collapsed and pos/size', () => {
    const rows = buildWindowRows([w1, w2], 2, new Set([2]));
    const headers = rows.filter((r) => r.kind === 'window');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({
      key: 'w1',
      number: 1,
      isHome: false,
      count: 4,
      collapsed: false,
      level: 1,
      pos: 1,
      size: 2,
    });
    expect(headers[1]).toMatchObject({
      key: 'w2',
      number: 2,
      isHome: true,
      count: 2,
      collapsed: true,
      level: 1,
      pos: 2,
      size: 2,
    });
    expect(headers[0]?.kind === 'window' && headers[0].info).toBe(w1.info);
  });

  it('numbers follow display order, not window id', () => {
    const rows = buildWindowRows([w2, w1], null, new Set());
    const headers = rows.filter((r) => r.kind === 'window');
    expect(headers.map((h) => h.kind === 'window' && [h.info.id, h.number])).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  it('homeId null or unknown marks no header as home', () => {
    for (const home of [null, 99]) {
      const rows = buildWindowRows([w1, w2], home, new Set());
      expect(rows.some((r) => r.kind === 'window' && r.isHome)).toBe(false);
    }
  });

  it('shifts levels by one: window 1, tab 2, group 2, group child 3', () => {
    const rows = buildWindowRows([w1], 1, new Set());
    const level = Object.fromEntries(rows.map((r) => [r.key, r.level]));
    expect(level).toEqual({ w1: 1, t1: 2, t2: 2, g7: 2, t3: 3, t4: 3 });
  });

  it('keeps per-window pos/size for the tree under each header', () => {
    const rows = buildWindowRows([w1, w2], 1, new Set());
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    // w1: pinned t1, t2, group g7 are three top-level siblings; t3/t4 children of g7.
    expect(by.t1).toMatchObject({ pos: 1, size: 3 });
    expect(by.t2).toMatchObject({ pos: 2, size: 3 });
    expect(by.g7).toMatchObject({ pos: 3, size: 3 });
    expect(by.t3).toMatchObject({ pos: 1, size: 2 });
    expect(by.t4).toMatchObject({ pos: 2, size: 2 });
    // w2 restarts at 1.
    expect(by.t5).toMatchObject({ pos: 1, size: 2, level: 2 });
    expect(by.t6).toMatchObject({ pos: 2, size: 2, level: 2 });
  });

  it('collapsed windows emit only the header, others are unaffected', () => {
    const rows = buildWindowRows([w1, w2], 1, new Set([1]));
    expect(rows.map((r) => r.key)).toEqual(['w1', 'w2', 't5', 't6']);
  });

  it('a collapsed group inside a window still hides its children', () => {
    const rows = buildWindowRows(
      [{ ...w1, groups: [group(7, { windowId: 1, collapsed: true })] }],
      1,
      new Set(),
    );
    expect(rows.map((r) => r.key)).toEqual(['w1', 't1', 't2', 'g7']);
  });

  it('empty window list and empty windows', () => {
    expect(buildWindowRows([], null, new Set())).toEqual([]);
    const rows = buildWindowRows([{ info: win(3), tabs: [], groups: [] }], 3, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'window', count: 0, isHome: true });
  });
});

describe('rowWindowId', () => {
  it('resolves tab, group and window rows to their window', () => {
    const rows = buildWindowRows([w1, w2], 1, new Set());
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rowWindowId(by.w1 as never)).toBe(1);
    expect(rowWindowId(by.t2 as never)).toBe(1);
    expect(rowWindowId(by.g7 as never)).toBe(1);
    expect(rowWindowId(by.w2 as never)).toBe(2);
    expect(rowWindowId(by.t6 as never)).toBe(2);
  });
});

describe('buildRows levelOffset', () => {
  const tabs = [tab(1), tab(2, { groupId: 7 })];
  const groups = [group(7)];

  it('defaults to 0 offset', () => {
    expect(buildRows(tabs, groups).map((r) => r.level)).toEqual([1, 1, 2]);
    expect(buildRows(tabs, groups, 0)).toEqual(buildRows(tabs, groups));
  });

  it('adds the offset to every level and changes nothing else', () => {
    const base = buildRows(tabs, groups);
    const shifted = buildRows(tabs, groups, 2);
    expect(shifted.map((r) => r.level)).toEqual([3, 3, 4]);
    expect(shifted.map(({ level: _l, ...r }) => r)).toEqual(base.map(({ level: _l, ...r }) => r));
  });
});
