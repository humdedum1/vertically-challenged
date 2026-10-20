import { describe, expect, it } from 'vitest';
import type { PinFolder, PinItem, WindowLayout } from '../src/shared/layout';
import type { GroupInfo, TabInfo, WindowInfo } from '../src/shared/types';
import {
  type Drag,
  type MultiDropContext,
  planDropMulti,
  planPinDrop,
} from '../src/sidepanel/model/drop-plan';
import { buildPanelRows, type Row } from '../src/sidepanel/model/rows';
import { group, tab } from './helpers';

const item = (id: string, tabId: number | null): PinItem => ({
  kind: 'item',
  id,
  homeUrl: 'https://example.com/',
  lastUrl: 'https://example.com/',
  title: id,
  tabId,
});
const folder = (id: string, children: PinFolder['children'], collapsed = false): PinFolder => ({
  kind: 'folder',
  id,
  name: id,
  icon: 'folder',
  collapsed,
  children,
});
const layout = (id: string, over: Partial<WindowLayout> = {}): WindowLayout => ({
  id,
  name: null,
  essentials: [],
  pinned: [],
  collapsed: [],
  incognito: false,
  lastUsed: 0,
  ...over,
});

interface W {
  info: WindowInfo;
  tabs: TabInfo[];
  groups: GroupInfo[];
  layout: WindowLayout | undefined;
}
const win = (id: number, incognito = false): WindowInfo => ({ id, incognito, focused: false });

/*
 * Window 1 (home): Essentials e1(1) e2(2) e3(dormant); pinned root
 *   F{ a(3), G{ b(4) } }, c(5), d(dormant), H{ I{ J{} } }, K{} (collapsed);
 *   unpinned 10, 11, group 7 (12, 13).
 * Window 2: Essentials x(20); pinned y(21); unpinned 22.
 * Window 3 (incognito): pinned z(30); unpinned 31.
 * Window 4: no layout yet; pinned tabs 40, 42 render as tab rows; unpinned 41.
 */
const windows: W[] = [
  {
    info: win(1),
    tabs: [
      ...[1, 2, 3, 4, 5].map((id) => tab(id, { pinned: true })),
      tab(10),
      tab(11),
      tab(12, { groupId: 7 }),
      tab(13, { groupId: 7 }),
    ],
    groups: [group(7)],
    layout: layout('laaaaaaaaaa', {
      essentials: [item('e1', 1), item('e2', 2), item('e3', null)],
      pinned: [
        folder('F', [item('a', 3), folder('G', [item('b', 4)])]),
        item('c', 5),
        item('d', null),
        folder('H', [folder('I', [folder('J', [])])]),
        folder('K', [], true),
      ],
    }),
  },
  {
    info: win(2),
    tabs: [
      tab(20, { windowId: 2, pinned: true }),
      tab(21, { windowId: 2, pinned: true }),
      tab(22, { windowId: 2 }),
    ],
    groups: [],
    layout: layout('lbbbbbbbbbb', { essentials: [item('x', 20)], pinned: [item('y', 21)] }),
  },
  {
    info: win(3, true),
    tabs: [
      tab(30, { windowId: 3, pinned: true, incognito: true }),
      tab(31, { windowId: 3, incognito: true }),
    ],
    groups: [],
    layout: layout('lcccccccccc', { incognito: true, pinned: [item('z', 30)] }),
  },
  {
    info: win(4),
    tabs: [
      tab(40, { windowId: 4, pinned: true }),
      tab(42, { windowId: 4, pinned: true }),
      tab(41, { windowId: 4 }),
    ],
    groups: [],
    layout: undefined,
  },
];

const m: MultiDropContext = {
  ctxFor: (id) => {
    const w = windows.find((x) => x.info.id === id);
    return w ? { windowId: id, tabs: w.tabs } : null;
  },
  tab: (id) => windows.flatMap((w) => w.tabs).find((t) => t.id === id),
  isIncognito: (id) => windows.find((w) => w.info.id === id)?.info.incognito ?? false,
  layoutOf: (id) => windows.find((w) => w.info.id === id)?.layout,
};

const rows: Row[] = buildPanelRows(windows, 1, { tilesPerRow: 4 });
const idx = (key: string) => {
  const i = rows.findIndex((r) => r.key === key);
  if (i < 0) throw new Error(`no row ${key}`);
  return i;
};
const at = (key: string, zone: 'before' | 'after' | 'inside') => ({ index: idx(key), zone });
const grid = (windowId: number, index: number) => ({ kind: 'grid' as const, windowId, index });
const tabs = (...tabIds: number[]): Drag => ({ kind: 'tabs', tabIds });
const node = (nodeId: string, windowId = 1): Drag => ({ kind: 'node', windowId, nodeId });
const plan = (drag: Drag, target: Parameters<typeof planPinDrop>[3]) =>
  planPinDrop(m, rows, drag, target);
const root = (index: number) => ({ zone: 'pinned', folderId: null, index });
const inFolder = (folderId: string, index: number) => ({ zone: 'pinned', folderId, index });

describe('planPinDrop: tabs', () => {
  it('into the grid pins them as Essentials at the insertion index', () => {
    expect(plan(tabs(10), grid(1, 1))).toEqual({
      type: 'pinTabs',
      tabIds: [10],
      windowId: 1,
      dest: { zone: 'essentials', index: 1 },
    });
  });

  it("into another window's grid targets that window", () => {
    expect(plan(tabs(10), grid(2, 0))).toMatchObject({
      type: 'pinTabs',
      windowId: 2,
      dest: { zone: 'essentials', index: 0 },
    });
  });

  it("on another window's tiles row appends to its Essentials", () => {
    expect(plan(tabs(10), at('x2-0', 'inside'))).toMatchObject({
      type: 'pinTabs',
      windowId: 2,
      dest: { zone: 'essentials', index: 1 },
    });
  });

  it('before / after a pinned row pins them as its sibling', () => {
    expect(plan(tabs(10), at('pc', 'before'))).toEqual({
      type: 'pinTabs',
      tabIds: [10],
      windowId: 1,
      dest: root(1),
    });
    expect(plan(tabs(10), at('pc', 'after'))).toMatchObject({ dest: root(2) });
  });

  it('inside a folder header lands first in that folder', () => {
    expect(plan(tabs(10), at('fF', 'inside'))).toMatchObject({ dest: inFolder('F', 0) });
  });

  it('before a folder header lands just before the folder', () => {
    expect(plan(tabs(10), at('fH', 'before'))).toMatchObject({ dest: root(3) });
  });

  it('after an expanded folder header lands first inside it (where the line is drawn)', () => {
    expect(plan(tabs(10), at('fF', 'after'))).toMatchObject({ dest: inFolder('F', 0) });
  });

  it('after a collapsed folder header lands after the folder', () => {
    expect(plan(tabs(10), at('fK', 'after'))).toMatchObject({ dest: root(5) });
  });

  it('after the last child of an expanded folder lands at the end of that folder', () => {
    expect(plan(tabs(10), at('pb', 'after'))).toMatchObject({ dest: inFolder('G', 1) });
  });

  it('before the divider appends to the pinned root', () => {
    expect(plan(tabs(10), at('d1', 'before'))).toMatchObject({ dest: root(5) });
  });

  it('on a pinned row of another window pins them there', () => {
    expect(plan(tabs(10), at('py', 'before'))).toMatchObject({
      type: 'pinTabs',
      windowId: 2,
      dest: root(0),
    });
  });

  it('between incognito and normal windows is refused', () => {
    expect(plan(tabs(10), at('pz', 'before'))).toBeNull();
    expect(plan(tabs(31), grid(1, 0))).toBeNull();
  });

  it('into a window whose layout has not arrived is refused', () => {
    expect(plan(tabs(10), grid(4, 0))).toBeNull();
  });

  it('several selected pins: the index skips the ones being moved', () => {
    // c (root 1) and a (in F) dropped after d (root 2): once c is out, that is index 2.
    expect(plan(tabs(5, 3), at('pd', 'after'))).toMatchObject({
      type: 'pinTabs',
      tabIds: [5, 3],
      dest: root(2),
    });
  });

  it('pins that would land where they already are is a no-op', () => {
    expect(plan(tabs(5), at('pc', 'after'))).toBeNull();
    expect(plan(tabs(5), at('pd', 'before'))).toBeNull();
    expect(plan(tabs(1, 2), grid(1, 0))).toBeNull();
  });

  it('a group can never be dropped into the pinned area', () => {
    expect(plan({ kind: 'group', groupId: 7 }, at('pc', 'before'))).toBeNull();
    expect(plan({ kind: 'group', groupId: 7 }, grid(1, 0))).toBeNull();
  });
});

describe('planPinDrop: nodes', () => {
  it('reorders tiles; the index counts tiles after removing the dragged one', () => {
    expect(plan(node('e1'), grid(1, 3))).toEqual({
      type: 'pinMove',
      windowId: 1,
      nodeId: 'e1',
      toWindowId: 1,
      dest: { zone: 'essentials', index: 2 },
    });
    expect(plan(node('e3'), grid(1, 0))).toMatchObject({ dest: { zone: 'essentials', index: 0 } });
  });

  it('a tile dropped next to itself is a no-op', () => {
    expect(plan(node('e1'), grid(1, 0))).toBeNull();
    expect(plan(node('e1'), grid(1, 1))).toBeNull();
  });

  it('a pin dropped into the grid becomes an Essential', () => {
    expect(plan(node('c'), grid(1, 1))).toMatchObject({
      type: 'pinMove',
      nodeId: 'c',
      dest: { zone: 'essentials', index: 1 },
    });
  });

  it('a folder can never go into the grid', () => {
    expect(plan(node('F'), grid(1, 0))).toBeNull();
    expect(plan(node('K'), at('x2-0', 'inside'))).toBeNull();
  });

  it('a tile dropped on the pinned root becomes a pinned item', () => {
    expect(plan(node('e2'), at('pc', 'before'))).toMatchObject({
      type: 'pinMove',
      nodeId: 'e2',
      toWindowId: 1,
      dest: root(1),
    });
  });

  it('a pin moves among its siblings and into folders', () => {
    expect(plan(node('c'), at('pd', 'after'))).toMatchObject({ dest: root(2) });
    expect(plan(node('c'), at('fF', 'inside'))).toMatchObject({ dest: inFolder('F', 0) });
    expect(plan(node('a'), at('pb', 'after'))).toMatchObject({ dest: inFolder('G', 1) });
    expect(plan(node('c'), at('fK', 'inside'))).toMatchObject({ dest: inFolder('K', 0) });
  });

  it('a pin dropped where it already is is a no-op', () => {
    expect(plan(node('c'), at('pc', 'before'))).toBeNull();
    expect(plan(node('c'), at('pd', 'before'))).toBeNull();
    expect(plan(node('a'), at('fF', 'inside'))).toBeNull();
  });

  it('folders nest and reorder', () => {
    expect(plan(node('K'), at('fF', 'before'))).toMatchObject({ nodeId: 'K', dest: root(0) });
    expect(plan(node('K'), at('fI', 'inside'))).toMatchObject({ dest: inFolder('I', 0) });
    expect(plan(node('G'), at('pc', 'after'))).toMatchObject({ dest: root(2) });
  });

  it('a folder dropped into itself or its own child is refused', () => {
    expect(plan(node('F'), at('fF', 'inside'))).toBeNull();
    expect(plan(node('F'), at('fG', 'inside'))).toBeNull();
    expect(plan(node('F'), at('pb', 'after'))).toBeNull();
    expect(plan(node('H'), at('fJ', 'inside'))).toBeNull();
  });

  it('a folder that would end up deeper than the limit is refused', () => {
    // J is at depth 3: it may hold items, not folders.
    expect(plan(node('K'), at('fJ', 'inside'))).toBeNull();
    // H is three levels tall, so it can only sit at the root.
    expect(plan(node('H'), at('fF', 'inside'))).toBeNull();
    expect(plan(node('c'), at('fJ', 'inside'))).toMatchObject({ dest: inFolder('J', 0) });
  });

  it('a live pin dropped on normal tab rows is unpinned there', () => {
    expect(plan(node('c'), at('t10', 'before'))).toEqual({
      type: 'move',
      tabIds: [5],
      target: { windowId: 1, beforeTabId: 10, groupId: -1, pinned: false },
    });
    expect(plan(node('e1'), at('t12', 'before'))).toMatchObject({
      type: 'move',
      tabIds: [1],
      target: { groupId: 7, pinned: false },
    });
  });

  it('just below the divider unpins to the top of the normal tabs', () => {
    expect(plan(node('c'), at('d1', 'after'))).toMatchObject({
      type: 'move',
      tabIds: [5],
      target: { windowId: 1, beforeTabId: 10, pinned: false },
    });
  });

  it('a dormant pin or a folder on normal rows is refused', () => {
    expect(plan(node('d'), at('t10', 'before'))).toBeNull();
    expect(plan(node('e3'), at('t10', 'before'))).toBeNull();
    expect(plan(node('F'), at('t10', 'before'))).toBeNull();
  });

  it("another window's rows: the pin moves to that window", () => {
    expect(plan(node('c'), at('py', 'before'))).toEqual({
      type: 'pinMove',
      windowId: 1,
      nodeId: 'c',
      toWindowId: 2,
      dest: root(0),
    });
    expect(plan(node('e1'), grid(2, 1))).toMatchObject({
      toWindowId: 2,
      dest: { zone: 'essentials', index: 1 },
    });
    expect(plan(node('y', 2), grid(1, 3))).toMatchObject({
      windowId: 2,
      nodeId: 'y',
      toWindowId: 1,
      dest: { zone: 'essentials', index: 3 },
    });
    expect(plan(node('c'), at('t22', 'before'))).toMatchObject({
      type: 'move',
      tabIds: [5],
      target: { windowId: 2, beforeTabId: 22, pinned: false },
    });
  });

  it('a folder never moves to another window', () => {
    expect(plan(node('K'), at('py', 'before'))).toBeNull();
  });

  it('pins never cross between incognito and normal windows', () => {
    expect(plan(node('c'), at('pz', 'before'))).toBeNull();
    expect(plan(node('z', 3), grid(1, 0))).toBeNull();
    expect(plan(node('c'), at('t31', 'before'))).toBeNull();
  });

  it('a node that no longer exists is refused', () => {
    expect(plan(node('gone'), grid(1, 0))).toBeNull();
  });
});

describe('planPinDrop: pinned tabs without an item', () => {
  it('are pinned into the layout, or unpinned on normal rows', () => {
    expect(plan(tabs(40), at('pc', 'before'))).toMatchObject({
      type: 'pinTabs',
      tabIds: [40],
      windowId: 1,
    });
    expect(plan(tabs(40), at('t41', 'before'))).toEqual({
      type: 'move',
      tabIds: [40],
      target: { windowId: 4, beforeTabId: 41, groupId: -1, pinned: false },
    });
  });

  it('never move among pinned tab rows (they only move as pins)', () => {
    expect(plan(tabs(40), at('t42', 'after'))).toBeNull();
  });
});

describe('planDropMulti delegates pin drags and pin targets', () => {
  const multi = (drag: Drag, key: string, zone: 'before' | 'after' | 'inside') =>
    planDropMulti(m, rows, drag, idx(key), zone);

  it('node drags and pinned-area targets go through planPinDrop', () => {
    expect(multi(node('c'), 'pd', 'after')).toEqual(plan(node('c'), at('pd', 'after')));
    expect(multi(tabs(10), 'fF', 'inside')).toEqual(plan(tabs(10), at('fF', 'inside')));
    expect(multi(node('c'), 't10', 'before')).toMatchObject({ type: 'move', tabIds: [5] });
  });

  it('a selection of live pins dropped on normal rows is unpinned', () => {
    expect(multi(tabs(5, 3), 't11', 'before')).toEqual({
      type: 'move',
      tabIds: [3, 5],
      target: { windowId: 1, beforeTabId: 11, groupId: -1, pinned: false },
    });
  });

  it('normal tab drags onto normal rows are unchanged', () => {
    expect(multi(tabs(10), 't11', 'after')).toEqual({
      type: 'move',
      tabIds: [10],
      target: { windowId: 1, beforeTabId: 12, groupId: -1, pinned: false },
    });
  });

  it('without layouts in the context, pinned-area targets are refused', () => {
    const bare: MultiDropContext = { ...m, layoutOf: undefined };
    expect(planDropMulti(bare, rows, tabs(10), idx('pc'), 'before')).toBeNull();
  });
});
