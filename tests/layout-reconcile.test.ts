import { describe, expect, it } from 'vitest';
import { reconcile, type TabLookup } from '../src/background/pins/reconcile';
import {
  findNode,
  flattenItems,
  type PinFolder,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from '../src/shared/layout';
import type { TabInfo } from '../src/shared/types';
import { tab } from './helpers';

const item = (id: string, tabId: number | null = null): PinItem => ({
  kind: 'item',
  id,
  homeUrl: `https://example.com/${tabId ?? id}`,
  lastUrl: `https://example.com/${tabId ?? id}`,
  title: `Tab ${tabId ?? id}`,
  tabId,
});
const folder = (id: string, children: PinNode[] = []): PinFolder => ({
  kind: 'folder',
  id,
  name: id,
  icon: 'folder',
  collapsed: false,
  children,
});
const layout = (essentials: PinItem[], pinned: PinNode[]): WindowLayout => ({
  id: 'labcdefghij0',
  name: null,
  essentials,
  pinned,
  collapsed: [],
  incognito: false,
  lastUsed: 1,
});
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
const lookup = (tabs: TabInfo[]): TabLookup => {
  const m = new Map(tabs.map((t) => [t.id, t]));
  return { get: (id) => m.get(id) };
};
const pinnedTab = (id: number, o: Partial<TabInfo> = {}) => tab(id, { pinned: true, ...o });
const ids = (nodes: PinNode[]) => nodes.map((n) => n.id);
const liveTabs = (l: WindowLayout) =>
  flattenItems(l)
    .filter((i) => i.tabId !== null)
    .map((i) => i.tabId);
const run = (l: WindowLayout, windowTabs: TabInfo[], inFlight = false, extra: TabInfo[] = []) =>
  reconcile(deepFreeze(l), 1, windowTabs, lookup([...windowTabs, ...extra]), { inFlight });

describe('reconcile', () => {
  it('returns the input unchanged when Chrome already agrees', () => {
    const l = layout([item('a', 1)], [item('b', 2)]);
    const r = run(l, [pinnedTab(1), pinnedTab(2), tab(3)]);
    expect(r.layout).toBe(l);
    expect(r).toMatchObject({ changed: false, moves: [], transfers: [] });
  });

  it('makes an item dormant when its tab is gone, with no moves', () => {
    const l = layout([item('a', 1)], [item('b', 2)]);
    const r = run(l, [pinnedTab(2), tab(3)]);
    expect(r.changed).toBe(true);
    expect(r.layout.essentials[0]).toMatchObject({ id: 'a', tabId: null });
    expect(r.moves).toEqual([]);
  });

  it('removes an item whose tab was unpinned', () => {
    const l = layout([], [item('a', 1), item('b', 2)]);
    const r = run(l, [pinnedTab(2), tab(1), tab(3)]);
    expect(ids(r.layout.pinned)).toEqual(['b']);
    expect(r.changed).toBe(true);
  });

  it('transfers an item whose tab is now pinned in another window', () => {
    const a = item('a', 1);
    const l = layout([a], [item('b', 2)]);
    const r = run(l, [pinnedTab(2)], false, [pinnedTab(1, { windowId: 2 })]);
    expect(r.layout.essentials).toEqual([]);
    expect(r.transfers).toEqual([{ windowId: 2, item: a }]);
    expect(r.changed).toBe(true);
  });

  it('keeps a tab that moved to another window unpinned out of both layouts', () => {
    const l = layout([], [item('a', 1)]);
    const r = run(l, [], false, [tab(1, { windowId: 2 })]);
    expect(r.layout.pinned).toEqual([]);
    expect(r.transfers).toEqual([]);
  });

  it('refreshes lastUrl and title from the live tab, keeping homeUrl', () => {
    const l = layout([], [item('a', 1)]);
    const r = run(l, [pinnedTab(1, { url: 'https://elsewhere.test/', title: 'New' })]);
    expect(r.layout.pinned[0]).toMatchObject({
      homeUrl: 'https://example.com/1',
      lastUrl: 'https://elsewhere.test/',
      title: 'New',
    });
    expect(r.changed).toBe(true);
  });

  it('appends a plain item for a newly pinned tab', () => {
    const l = layout([], [item('a', 1)]);
    const r = run(l, [
      pinnedTab(1),
      pinnedTab(5, { url: 'https://new.test/', title: 'N' }),
      tab(6),
    ]);
    expect(r.layout.pinned).toHaveLength(2);
    expect(r.layout.pinned[1]).toMatchObject({
      kind: 'item',
      homeUrl: 'https://new.test/',
      lastUrl: 'https://new.test/',
      title: 'N',
      tabId: 5,
    });
    expect(r.layout.pinned[1]?.id).toMatch(/^i[a-z0-9]{10}$/);
    expect(r.moves).toEqual([]);
  });

  it('places a tab pinned mid-strip where Chrome put it', () => {
    const l = layout([], [item('a', 1), item('b', 2)]);
    const r = run(l, [pinnedTab(1), pinnedTab(5), pinnedTab(2)]);
    expect(liveTabs(r.layout)).toEqual([1, 5, 2]);
    expect(r.moves).toEqual([]);
  });

  it('moves an essential after the pinned item Chrome now puts before it', () => {
    const l = layout([item('a', 1)], [item('b', 2), item('c', 3)]);
    const r = run(l, [pinnedTab(2), pinnedTab(1), pinnedTab(3)]);
    expect(r.layout.essentials).toEqual([]);
    expect(ids(r.layout.pinned)).toEqual(['b', 'a', 'c']);
    expect(r.moves).toEqual([]);
    expect(r.changed).toBe(true);
  });

  it('joins a folder when Chrome puts the tab after a folder child', () => {
    const l = layout([], [folder('f', [item('a', 1)]), item('b', 2), item('c', 3), item('d', 4)]);
    // Chrome: a, d, b, c — d was dragged up behind a, the folder's last child.
    const r = run(l, [pinnedTab(1), pinnedTab(4), pinnedTab(2), pinnedTab(3)]);
    const f = findNode(r.layout, 'f')?.node as PinFolder;
    expect(ids(f.children)).toEqual(['a', 'd']);
    expect(ids(r.layout.pinned)).toEqual(['f', 'b', 'c']);
    expect(r.moves).toEqual([]);
  });

  it('puts a tab moved to the front before the first live item', () => {
    const l = layout([item('a', 1)], [item('b', 2), item('c', 3)]);
    const r = run(l, [pinnedTab(3), pinnedTab(1), pinnedTab(2)]);
    expect(ids(r.layout.essentials)).toEqual(['c', 'a']);
    expect(ids(r.layout.pinned)).toEqual(['b']);
  });

  it('leaves the layout alone while its own moves are in flight, and plans moves back', () => {
    const l = layout([item('a', 1)], [item('b', 2), item('c', 3)]);
    const r = run(l, [pinnedTab(2), pinnedTab(1), pinnedTab(3), tab(4)], true);
    expect(r.layout).toBe(l);
    expect(r.changed).toBe(false);
    expect(r.moves.length).toBeGreaterThan(0);
    // Applying the moves to Chrome's order restores the layout order.
    const order = [2, 1, 3, 4];
    for (const m of r.moves) {
      order.splice(order.indexOf(m.tabId), 1);
      order.splice(m.index, 0, m.tabId);
    }
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('keeps identical-URL items bound to distinct tabs distinct', () => {
    const same = { url: 'https://same.test/', title: 'Same' };
    const l = layout([], [item('a', 1), item('b', 2)]);
    const r = run(l, [pinnedTab(1, same), pinnedTab(2, same)]);
    expect(r.layout.pinned).toMatchObject([
      { id: 'a', tabId: 1 },
      { id: 'b', tabId: 2 },
    ]);
  });

  it('binds a tab to at most one item', () => {
    const l = layout([], [item('a', 1), item('b', 1)]);
    const r = run(l, [pinnedTab(1)]);
    expect(r.layout.pinned).toMatchObject([
      { id: 'a', tabId: 1 },
      { id: 'b', tabId: null },
    ]);
  });

  it('never moves dormant items or plans moves for them', () => {
    const l = layout([item('d1')], [item('a', 1), item('d2'), item('b', 2)]);
    const r = run(l, [pinnedTab(1), pinnedTab(2), tab(3)]);
    expect(r.layout).toBe(l);
    expect(r.moves).toEqual([]);
  });

  it('keeps dormant items in place while reordering live ones around them', () => {
    const l = layout([], [item('a', 1), item('d'), item('b', 2)]);
    const r = run(l, [pinnedTab(2), pinnedTab(1)]);
    expect(liveTabs(r.layout)).toEqual([2, 1]);
    expect(ids(r.layout.pinned)).toContain('d');
  });

  it('always ends with the layout in Chrome order for random reorders', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const l = layout(
        [item('e1', 1), item('e2', 2)],
        [folder('f', [item('a', 3), folder('g', [item('b', 4)]), item('d0')]), item('c', 5)],
      );
      const order = [1, 2, 3, 4, 5];
      for (let i = order.length - 1; i > 0; i--) {
        const j = rnd(i + 1);
        [order[i], order[j]] = [order[j] as number, order[i] as number];
      }
      const r = run(
        l,
        order.map((id) => pinnedTab(id)),
      );
      expect(liveTabs(r.layout)).toEqual(order);
      expect(r.moves).toEqual([]);
      expect(flattenItems(r.layout)).toHaveLength(6);
    }
  });
});
