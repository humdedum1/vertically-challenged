import { describe, expect, it } from 'vitest';
import type { WindowInfo } from '../src/shared/types';
import { buildPanelRows, buildRows, rowWindowId } from '../src/sidepanel/model/rows';
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

describe('rowWindowId', () => {
  it('resolves tab, group and window rows to their window', () => {
    // homeId null: every window gets a header, including window 1.
    const rows = buildPanelRows(
      [w1, w2].map((w) => ({ ...w, layout: undefined })),
      null,
      { tilesPerRow: 4 },
    );
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
