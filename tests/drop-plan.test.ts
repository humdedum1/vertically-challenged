import { describe, expect, it } from 'vitest';
import { planMoves } from '../src/background/move-plan';
import type { PanelMessage } from '../src/shared/protocol';
import type { GroupInfo, TabInfo } from '../src/shared/types';
import { type Drag, type DropZone, planDrop } from '../src/sidepanel/model/drop-plan';
import { buildRows } from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

// Strip: P1(1) P2(2) | U1(3) U2(4) | G1(10): 5 6 7 | G2(20): 8 9 | 11 12
function makeWindow(g2Collapsed: boolean) {
  const tabs: TabInfo[] = [
    tab(1, { pinned: true }),
    tab(2, { pinned: true }),
    tab(3),
    tab(4),
    tab(5, { groupId: 10 }),
    tab(6, { groupId: 10 }),
    tab(7, { groupId: 10 }),
    tab(8, { groupId: 20 }),
    tab(9, { groupId: 20 }),
    tab(11),
    tab(12),
  ];
  const groups: GroupInfo[] = [group(10), group(20, { collapsed: g2Collapsed })];
  const rows = buildRows(tabs, groups);
  const ctx = { windowId: 1, tabs };
  const idx = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    if (i === -1) throw new Error(`no row ${key}`);
    return i;
  };
  const drop = (drag: Drag, key: string, zone: DropZone) =>
    planDrop(ctx, rows, drag, idx(key), zone);
  return { tabs, groups, rows, ctx, drop };
}

const tabsDrag = (...tabIds: number[]): Drag => ({ kind: 'tabs', tabIds });
const move = (
  tabIds: number[],
  beforeTabId: number | null,
  groupId: number | null,
  pinned: boolean | null,
): PanelMessage => ({
  type: 'move',
  tabIds,
  target: { windowId: 1, beforeTabId, groupId, pinned },
});

/** Applies a planned message to a window the way the worker would. */
function simulate(tabs: readonly TabInfo[], msg: PanelMessage): TabInfo[] {
  let cur = tabs.map((t) => ({ ...t }));
  if (msg.type === 'move') {
    const ids = new Set(msg.tabIds);
    for (const t of cur) {
      if (!ids.has(t.id)) continue;
      if (msg.target.pinned !== null) t.pinned = msg.target.pinned;
      if (t.pinned) t.groupId = -1;
      else if (msg.target.groupId !== null) t.groupId = msg.target.groupId;
    }
    const order = cur.map((t) => t.id);
    let sim = order;
    for (const m of planMoves(order, msg.tabIds, msg.target.beforeTabId)) {
      sim = sim.filter((x) => x !== m.tabId);
      sim.splice(m.index, 0, m.tabId);
    }
    cur = sim.map((id) => cur.find((t) => t.id === id) as TabInfo);
  } else if (msg.type === 'moveGroup') {
    const members = cur.filter((t) => t.groupId === msg.groupId);
    const rest = cur.filter((t) => t.groupId !== msg.groupId);
    const at = msg.beforeTabId === null ? -1 : rest.findIndex((t) => t.id === msg.beforeTabId);
    const i = at === -1 ? rest.length : at;
    cur = [...rest.slice(0, i), ...members, ...rest.slice(i)];
  }
  return cur;
}

function expectInvariants(tabs: readonly TabInfo[]) {
  const firstUnpinned = tabs.findIndex((t) => !t.pinned);
  if (firstUnpinned !== -1) expect(tabs.slice(firstUnpinned).some((t) => t.pinned)).toBe(false);
  const seen = new Set<number>();
  let prev = -1;
  for (const t of tabs) {
    if (t.groupId !== prev && t.groupId !== -1) {
      expect(seen.has(t.groupId), `group ${t.groupId} is split`).toBe(false);
      seen.add(t.groupId);
    }
    prev = t.groupId;
  }
}

describe('planDrop: tabs onto tabs', () => {
  const w = makeWindow(true);

  it('before / after an ungrouped tab', () => {
    expect(w.drop(tabsDrag(11), 't4', 'before')).toEqual(move([11], 4, -1, false));
    expect(w.drop(tabsDrag(11), 't3', 'after')).toEqual(move([11], 4, -1, false));
  });

  it('after the last tab of an expanded group joins it, before the tab after the group', () => {
    expect(w.drop(tabsDrag(3), 't7', 'after')).toEqual(move([3], 8, 10, false));
  });

  it('before the first tab of a group joins it', () => {
    expect(w.drop(tabsDrag(3), 't5', 'before')).toEqual(move([3], 5, 10, false));
  });

  it('onto the last row after => beforeTabId null', () => {
    expect(w.drop(tabsDrag(3), 't12', 'after')).toEqual(move([3], null, -1, false));
  });

  it('dropping onto a pinned tab pins', () => {
    expect(w.drop(tabsDrag(11), 't2', 'before')).toEqual(move([11], 2, -1, true));
    expect(w.drop(tabsDrag(11), 't2', 'after')).toEqual(move([11], 3, -1, true));
  });

  it('a pinned tab dropped among unpinned tabs unpins', () => {
    expect(w.drop(tabsDrag(1), 't3', 'after')).toEqual(move([1], 4, -1, false));
  });

  it('a grouped tab dropped on an ungrouped tab leaves its group', () => {
    expect(w.drop(tabsDrag(6), 't11', 'before')).toEqual(move([6], 11, -1, false));
  });

  it('dropping a tab onto itself is null', () => {
    expect(w.drop(tabsDrag(4), 't4', 'before')).toBeNull();
    expect(w.drop(tabsDrag(4), 't4', 'after')).toBeNull();
    expect(w.drop(tabsDrag(3, 4), 't4', 'after')).toBeNull();
  });

  it('no-op positions are null', () => {
    expect(w.drop(tabsDrag(4), 't3', 'after')).toBeNull();
    expect(w.drop(tabsDrag(3), 't4', 'before')).toBeNull();
    expect(w.drop(tabsDrag(2), 't1', 'after')).toBeNull();
    expect(w.drop(tabsDrag(12), 't11', 'after')).toBeNull();
  });

  it('multi-tab drag keeps the strip order of the dragged ids', () => {
    expect(w.drop(tabsDrag(12, 11), 't4', 'before')).toEqual(move([11, 12], 4, -1, false));
    expect(w.drop(tabsDrag(4, 3), 't12', 'after')).toEqual(move([3, 4], null, -1, false));
  });
});

describe('planDrop: tabs onto group headers', () => {
  const open = makeWindow(false);
  const closed = makeWindow(true);

  it("header 'before' => ungrouped, before its first tab", () => {
    expect(open.drop(tabsDrag(11), 'g10', 'before')).toEqual(move([11], 5, -1, false));
  });

  it("expanded header 'inside' joins at the start", () => {
    expect(open.drop(tabsDrag(11), 'g10', 'inside')).toEqual(move([11], 5, 10, false));
  });

  it("expanded header 'after' joins at the start", () => {
    expect(open.drop(tabsDrag(11), 'g10', 'after')).toEqual(move([11], 5, 10, false));
  });

  it("collapsed header 'inside' joins at the end, before the tab after the group", () => {
    expect(closed.drop(tabsDrag(3), 'g20', 'inside')).toEqual(move([3], 11, 20, false));
  });

  it("collapsed header 'after' => ungrouped after the group", () => {
    expect(closed.drop(tabsDrag(3), 'g20', 'after')).toEqual(move([3], 11, -1, false));
  });

  it("collapsed header 'before' => ungrouped, before its first tab", () => {
    expect(closed.drop(tabsDrag(3), 'g20', 'before')).toEqual(move([3], 8, -1, false));
  });

  it('header drop of a pinned tab unpins it', () => {
    expect(open.drop(tabsDrag(1), 'g10', 'inside')).toEqual(move([1], 5, 10, false));
  });

  it('collapsed group at the very end appends with beforeTabId null', () => {
    const tabs = [tab(1), tab(2, { groupId: 20 })];
    const groups = [group(20, { collapsed: true })];
    const rows = buildRows(tabs, groups);
    const i = rows.findIndex((r) => r.key === 'g20');
    expect(planDrop({ windowId: 1, tabs }, rows, tabsDrag(1), i, 'inside')).toEqual(
      move([1], null, 20, false),
    );
  });
});

describe('planDrop: group drags', () => {
  const w = makeWindow(false);
  const g1: Drag = { kind: 'group', groupId: 10 };
  const mg = (beforeTabId: number | null): PanelMessage => ({
    type: 'moveGroup',
    groupId: 10,
    windowId: 1,
    beforeTabId,
  });

  it('onto an ungrouped tab', () => {
    expect(w.drop(g1, 't11', 'before')).toEqual(mg(11));
    expect(w.drop(g1, 't11', 'after')).toEqual(mg(12));
    expect(w.drop(g1, 't12', 'after')).toEqual(mg(null));
  });

  it("onto a tab inside another group snaps to that group's edges", () => {
    expect(w.drop(g1, 't9', 'before')).toEqual(mg(8));
    expect(w.drop(g1, 't8', 'before')).toEqual(mg(8));
    expect(w.drop(g1, 't8', 'after')).toEqual(mg(11));
    expect(w.drop(g1, 't9', 'after')).toEqual(mg(11));
  });

  it('onto another group header', () => {
    const g2: Drag = { kind: 'group', groupId: 20 };
    expect(w.drop(g2, 'g10', 'before')).toEqual({
      type: 'moveGroup',
      groupId: 20,
      windowId: 1,
      beforeTabId: 5,
    });
    expect(w.drop(g2, 'g10', 'after')).toEqual({
      type: 'moveGroup',
      groupId: 20,
      windowId: 1,
      beforeTabId: 11,
    });
  });

  it('onto a pinned tab => before the first unpinned tab', () => {
    expect(w.drop(g1, 't1', 'before')).toEqual(mg(3));
    expect(w.drop(g1, 't2', 'after')).toEqual(mg(3));
  });

  it('onto itself or its own tab is null', () => {
    expect(w.drop(g1, 'g10', 'before')).toBeNull();
    expect(w.drop(g1, 'g10', 'inside')).toBeNull();
    expect(w.drop(g1, 't6', 'before')).toBeNull();
    expect(w.drop(g1, 't7', 'after')).toBeNull();
  });
});

describe('planDrop: resulting windows keep invariants', () => {
  const cases: [string, Drag, string, DropZone][] = [
    ['ungrouped into middle of group edge', tabsDrag(3), 't7', 'after'],
    ['ungrouped to group start', tabsDrag(11, 12), 't5', 'before'],
    ['grouped tab out', tabsDrag(6), 't4', 'before'],
    ['pin a tab', tabsDrag(11), 't2', 'after'],
    ['unpin a tab', tabsDrag(1, 2), 't11', 'after'],
    ['into collapsed group', tabsDrag(3), 'g20', 'inside'],
    ['group down', { kind: 'group', groupId: 10 }, 't11', 'after'],
    ['group up past pins', { kind: 'group', groupId: 20 }, 't1', 'before'],
    ['group onto other group tab', { kind: 'group', groupId: 10 }, 't9', 'before'],
    ['group to end', { kind: 'group', groupId: 10 }, 't12', 'after'],
  ];
  for (const [name, drag, key, zone] of cases) {
    it(name, () => {
      const w = makeWindow(false);
      const msg = w.drop(drag, key, zone);
      expect(msg).not.toBeNull();
      expectInvariants(simulate(w.tabs, msg as PanelMessage));
    });
  }

  it('shows the concrete order for a drop after the last tab of G1', () => {
    const w = makeWindow(false);
    const out = simulate(w.tabs, w.drop(tabsDrag(3), 't7', 'after') as PanelMessage);
    expect(out.map((t) => t.id)).toEqual([1, 2, 4, 5, 6, 7, 3, 8, 9, 11, 12]);
    expect(out.find((t) => t.id === 3)?.groupId).toBe(10);
  });

  it('pinning moves the tab to the end of the pinned zone', () => {
    const w = makeWindow(false);
    const out = simulate(w.tabs, w.drop(tabsDrag(11), 't2', 'after') as PanelMessage);
    expect(out.slice(0, 3).map((t) => [t.id, t.pinned])).toEqual([
      [1, true],
      [2, true],
      [11, true],
    ]);
  });
});

describe('nesting tabs by dropping on their center', () => {
  it('plans nesting even when the tab already sits immediately after the target', () => {
    const { drop } = makeWindow(false);
    expect(drop(tabsDrag(4), 't3', 'inside')).toEqual({
      type: 'nestTab',
      tabId: 4,
      parentTabId: 3,
    });
  });

  it('rejects self, pinned targets, whole groups and multiple selected tabs', () => {
    const { drop } = makeWindow(false);
    expect(drop(tabsDrag(3), 't3', 'inside')).toBeNull();
    expect(drop(tabsDrag(3), 't1', 'inside')).toBeNull();
    expect(drop({ kind: 'group', groupId: 10 }, 't3', 'inside')).toBeNull();
    expect(drop(tabsDrag(3, 4), 't11', 'inside')).toBeNull();
  });
});

it('refuses nesting a tab under one of its descendants', () => {
  const tabs = [tab(1), tab(2, { openerTabId: 1 }), tab(3, { openerTabId: 2 })];
  expect(planDrop({ windowId: 1, tabs }, buildRows(tabs, []), tabsDrag(1), 2, 'inside')).toBeNull();
});
