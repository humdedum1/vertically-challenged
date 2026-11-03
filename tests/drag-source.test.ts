import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../src/shared/types';
import type { DragContext } from '../src/sidepanel/model/drag-source';
import { canBeEssential, dragName, dragOf } from '../src/sidepanel/model/drag-source';
import type { Row } from '../src/sidepanel/model/rows';

const tab = (id: number, windowId = 1) =>
  ({ id, windowId, title: `T${id}`, pinned: false }) as TabInfo;
const ctx = (over: Partial<DragContext>): DragContext => ({
  view: [],
  searching: false,
  selection: new Set(),
  tabById: new Map([
    [1, tab(1)],
    [2, tab(2, 2)],
  ]),
  groupById: new Map(),
  layoutTabIds: new Set(),
  windowIds: [],
  homeId: 1,
  layoutOf: () => undefined,
  isIncognito: (id) => id === 2,
  movableTargets: (t) => [t.id],
  ...over,
});
const el = {} as Element;

describe('drag source', () => {
  it('does not drag while searching', () => {
    const view = [{ kind: 'tab', tab: tab(1) }] as Row[];
    expect(dragOf(ctx({ view, searching: true }), 0, el)).toBeNull();
    expect(dragOf(ctx({ view }), 0, el)).toEqual({ kind: 'tabs', tabIds: [1] });
  });

  it('keeps tabs of the other incognito kind out of the grid', () => {
    expect(canBeEssential(ctx({}), { kind: 'tabs', tabIds: [1] })).toBe(true);
    expect(canBeEssential(ctx({}), { kind: 'tabs', tabIds: [2] })).toBe(false);
    expect(canBeEssential(ctx({}), { kind: 'group', groupId: 1 })).toBe(false);
  });

  it('names one tab by title and several by count', () => {
    expect(dragName(ctx({}), { kind: 'tabs', tabIds: [1] })).toBe('T1');
    expect(dragName(ctx({}), { kind: 'tabs', tabIds: [1, 2] })).toBe('2 tabs');
  });
});
