import { describe, expect, it } from 'vitest';
import type { GroupInfo, TabInfo, WindowInfo } from '../src/shared/types';
import {
  type Drag,
  type DropContext,
  type MultiDropContext,
  planDrop,
  planDropMulti,
} from '../src/sidepanel/model/drop-plan';
import { buildPanelRows, type Row } from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

interface W {
  info: WindowInfo;
  tabs: TabInfo[];
  groups: GroupInfo[];
}
const win = (id: number, incognito = false): WindowInfo => ({ id, incognito, focused: false });

// Window 1: tabs 1,2 ungrouped then group 7 (tabs 3,4). Window 2: tabs 5,6. Window 3 (incognito): tab 7.
const windows: W[] = [
  {
    info: win(1),
    tabs: [
      tab(1, { windowId: 1 }),
      tab(2, { windowId: 1 }),
      tab(3, { windowId: 1, groupId: 7 }),
      tab(4, { windowId: 1, groupId: 7 }),
    ],
    groups: [group(7, { windowId: 1 })],
  },
  {
    info: win(2),
    tabs: [tab(5, { windowId: 2 }), tab(6, { windowId: 2 })],
    groups: [],
  },
  { info: win(3, true), tabs: [tab(7, { windowId: 3, incognito: true })], groups: [] },
];

const multi: MultiDropContext = {
  ctxFor: (id) => {
    const w = windows.find((x) => x.info.id === id);
    return w ? { windowId: id, tabs: w.tabs } : null;
  },
  tab: (id) => windows.flatMap((w) => w.tabs).find((t) => t.id === id),
  isIncognito: (id) => windows.find((w) => w.info.id === id)?.info.incognito ?? false,
};

// homeId null gives every window a header (w1 included), which the header cases below need.
const rows: Row[] = buildPanelRows(
  windows.map((w) => ({ ...w, layout: undefined })),
  null,
  { tilesPerRow: 4 },
);
const idx = (key: string) => {
  const i = rows.findIndex((r) => r.key === key);
  if (i < 0) throw new Error(`no row ${key}`);
  return i;
};

describe('planDropMulti: tabs', () => {
  it('a tab from another window dropped before a tab moves into the target window', () => {
    expect(planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5] }, idx('t2'), 'before')).toEqual({
      type: 'move',
      tabIds: [5],
      target: { windowId: 1, beforeTabId: 2, groupId: -1, pinned: false },
    });
  });

  it('dropped after a tab resolves to the next tab in the target window', () => {
    const m = planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5] }, idx('t1'), 'after');
    expect(m).toMatchObject({ type: 'move', target: { windowId: 1, beforeTabId: 2 } });
  });

  it('dropped on a grouped tab joins that group', () => {
    const m = planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5] }, idx('t3'), 'before');
    expect(m).toMatchObject({ type: 'move', target: { windowId: 1, beforeTabId: 3, groupId: 7 } });
  });

  it('keeps several dragged tabs in drag order, not strip order', () => {
    const m = planDropMulti(multi, rows, { kind: 'tabs', tabIds: [6, 5] }, idx('t1'), 'before');
    expect(m).toMatchObject({
      type: 'move',
      tabIds: [6, 5],
      target: { windowId: 1, beforeTabId: 1 },
    });
  });

  it('dropping onto a header of another window appends', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [1, 2] }, idx('w2'), 'inside'),
    ).toEqual({
      type: 'move',
      tabIds: [1, 2],
      target: { windowId: 2, beforeTabId: null, groupId: -1, pinned: null },
    });
  });

  it('the header drop ignores the zone', () => {
    for (const zone of ['before', 'after', 'inside'] as const)
      expect(
        planDropMulti(multi, rows, { kind: 'tabs', tabIds: [1] }, idx('w2'), zone),
      ).toMatchObject({
        type: 'move',
        target: { windowId: 2, beforeTabId: null },
      });
  });

  it('a mixed-window drag onto a header moves all of them, in drag order', () => {
    const m = planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5, 1] }, idx('w2'), 'inside');
    expect(m).toMatchObject({ tabIds: [5, 1], target: { windowId: 2 } });
  });

  it('dropping onto your own window header is a no-op', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [1, 2] }, idx('w1'), 'inside'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5, 6] }, idx('w2'), 'before'),
    ).toBeNull();
  });

  it('within a window it behaves like planDrop', () => {
    const ctx: DropContext = { windowId: 1, tabs: windows[0]?.tabs ?? [] };
    const drag: Drag = { kind: 'tabs', tabIds: [1] };
    expect(planDropMulti(multi, rows, drag, idx('t2'), 'after')).toEqual(
      planDrop(ctx, rows, drag, idx('t2'), 'after'),
    );
  });

  it('refuses incognito <-> normal in both directions', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [7] }, idx('t1'), 'before'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [7] }, idx('w1'), 'inside'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [1] }, idx('t7'), 'before'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [1] }, idx('w3'), 'inside'),
    ).toBeNull();
  });

  it('refuses a mixed incognito/normal drag', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5, 7] }, idx('t1'), 'before'),
    ).toBeNull();
  });

  it('unknown dragged tab (even among known ones) -> null', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [99] }, idx('t1'), 'before'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'tabs', tabIds: [5, 99] }, idx('w1'), 'inside'),
    ).toBeNull();
  });

  it('out-of-range index or unloaded window -> null', () => {
    const drag: Drag = { kind: 'tabs', tabIds: [5] };
    expect(planDropMulti(multi, rows, drag, 999, 'before')).toBeNull();
    expect(planDropMulti(multi, rows, drag, -1, 'before')).toBeNull();
    expect(
      planDropMulti({ ...multi, ctxFor: () => null }, rows, drag, idx('t1'), 'before'),
    ).toBeNull();
  });
});

describe('planDropMulti: groups', () => {
  it('a group dragged within its window works', () => {
    expect(planDropMulti(multi, rows, { kind: 'group', groupId: 7 }, idx('t1'), 'before')).toEqual({
      type: 'moveGroup',
      groupId: 7,
      windowId: 1,
      beforeTabId: 1,
    });
  });

  it('a group dropped after a tab in its window goes before the next tab', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'group', groupId: 7 }, idx('t1'), 'after'),
    ).toMatchObject({
      type: 'moveGroup',
      beforeTabId: 2,
    });
  });

  it('a group dropped across windows -> null', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'group', groupId: 7 }, idx('t5'), 'before'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'group', groupId: 7 }, idx('w2'), 'inside'),
    ).toBeNull();
    expect(
      planDropMulti(multi, rows, { kind: 'group', groupId: 7 }, idx('t7'), 'before'),
    ).toBeNull();
  });

  it('a group dropped on any window header (even its own) -> null', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'group', groupId: 7 }, idx('w1'), 'inside'),
    ).toBeNull();
  });

  it('an unknown group -> null', () => {
    expect(
      planDropMulti(multi, rows, { kind: 'group', groupId: 999 }, idx('t1'), 'before'),
    ).toBeNull();
  });
});

describe('planDrop with window rows and cross-window drags', () => {
  const ctx1: DropContext = { windowId: 1, tabs: windows[0]?.tabs ?? [] };

  it('returns null when the target is a window row', () => {
    expect(planDrop(ctx1, rows, { kind: 'tabs', tabIds: [1] }, idx('w1'), 'inside')).toBeNull();
    expect(planDrop(ctx1, rows, { kind: 'tabs', tabIds: [5] }, idx('w2'), 'before')).toBeNull();
    expect(planDrop(ctx1, rows, { kind: 'group', groupId: 7 }, idx('w1'), 'before')).toBeNull();
  });

  it('keeps dragged ids that are not in ctx.tabs, in drag order, and does not shortcut', () => {
    const m = planDrop(ctx1, rows, { kind: 'tabs', tabIds: [6, 5] }, idx('t2'), 'after');
    expect(m).toMatchObject({
      type: 'move',
      tabIds: [6, 5],
      target: { windowId: 1, beforeTabId: 3 },
    });
  });

  it('a mixed local/foreign drag keeps drag order and is never treated as unchanged', () => {
    // Tab 2 alone dropped right after tab 1 would be a no-op ...
    expect(planDrop(ctx1, rows, { kind: 'tabs', tabIds: [2] }, idx('t1'), 'after')).toBeNull();
    // ... but with a foreign tab in the drag it must go through.
    const m = planDrop(ctx1, rows, { kind: 'tabs', tabIds: [2, 5] }, idx('t1'), 'after');
    expect(m).toMatchObject({
      type: 'move',
      tabIds: [2, 5],
      target: { windowId: 1, beforeTabId: 3 },
    });
  });

  it('a local-only drag keeps strip order and still shortcuts no-ops', () => {
    expect(
      planDrop(ctx1, rows, { kind: 'tabs', tabIds: [2, 1] }, idx('t3'), 'before'),
    ).toMatchObject({
      tabIds: [1, 2],
    });
    expect(planDrop(ctx1, rows, { kind: 'tabs', tabIds: [1] }, idx('t2'), 'before')).toBeNull();
  });

  it('duplicate ids in a cross-window drag are collapsed', () => {
    const m = planDrop(ctx1, rows, { kind: 'tabs', tabIds: [5, 5, 6] }, idx('t1'), 'before');
    expect(m).toMatchObject({ tabIds: [5, 6] });
  });

  it('dropping onto a dragged tab is still null', () => {
    expect(planDrop(ctx1, rows, { kind: 'tabs', tabIds: [1, 5] }, idx('t1'), 'before')).toBeNull();
  });
});
