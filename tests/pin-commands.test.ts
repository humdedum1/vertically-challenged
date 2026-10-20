import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandDeps } from '../src/background/commands';
import { runPinCommand } from '../src/background/pins/commands';
import { ALIVE_KEY, PinManager, type PinManagerDeps } from '../src/background/pins/pin-manager';
import { ChangeSet, TabStore } from '../src/background/tab-store';
import {
  findNode,
  flattenItems,
  LAYOUTS_KEY,
  MAX_ITEMS,
  type PinItem,
  type WindowLayout,
} from '../src/shared/layout';
import type { PinMessage } from '../src/shared/protocol';
import type { TabInfo, WindowInfo } from '../src/shared/types';
import { tab } from './helpers';

const ID = (n: number) => `l${String(n).padStart(10, '0')}`;
const IT = (c: string) => `i${c.repeat(10)}`;
const FO = (c: string) => `f${c.repeat(10)}`;
const item = (id: string, url: string, tabId: number | null = null): PinItem => ({
  kind: 'item',
  id,
  homeUrl: url,
  lastUrl: url,
  title: id,
  tabId,
});
const layout = (n: number, o: Partial<WindowLayout> = {}): WindowLayout => ({
  id: ID(n),
  name: null,
  essentials: [],
  pinned: [],
  collapsed: [],
  incognito: false,
  lastUsed: n,
  ...o,
});
const pinned = (id: number, windowId: number, url: string, o: Partial<TabInfo> = {}) =>
  tab(id, { windowId, url, title: `T${id}`, pinned: true, ...o });

/**
 * A fake browser: Chrome calls change `tabs` immediately, but the TabStore only sees
 * them on `flush()`, as with the real event batcher.
 */
function sim(opts: {
  windows: Record<number, TabInfo[]>;
  layouts?: WindowLayout[];
  bindings?: { windowId: number; layoutId: string }[];
  incognito?: number[];
}) {
  const tabs = new Map<number, TabInfo[]>(
    Object.entries(opts.windows).map(([k, v]) => [+k, v.map((t) => ({ ...t, windowId: +k }))]),
  );
  const calls: string[] = [];
  let nextId = 900;
  let windows: WindowInfo[] = [...tabs.keys()].map((id) => ({
    id,
    incognito: opts.incognito?.includes(id) ?? false,
    focused: false,
  }));
  const store = new TabStore();
  store.apply(new ChangeSet(), new Map(tabs));

  const find = (id: number) => {
    for (const [w, list] of tabs) {
      const i = list.findIndex((t) => t.id === id);
      if (i >= 0) return { w, list, i, t: list[i] as TabInfo };
    }
    throw new Error(`No tab with id ${id}`);
  };
  const pinnedEnd = (list: TabInfo[]) => list.filter((t) => t.pinned).length;
  const place = (w: number, t: TabInfo, index: number) => {
    const list = tabs.get(w) ?? [];
    tabs.set(w, list);
    const lo = t.pinned ? 0 : pinnedEnd(list);
    const hi = t.pinned ? pinnedEnd(list) : list.length;
    const at = index < 0 ? hi : Math.min(Math.max(index, lo), hi);
    list.splice(at, 0, { ...t, windowId: w });
  };

  const api: CommandDeps['chrome'] = {
    tabs: {
      async query(q) {
        return (tabs.get(q.windowId) ?? []).map((t) => ({ ...t }));
      },
      async update(id, p) {
        calls.push(`update ${id} ${JSON.stringify(p)}`);
        const { w, list, i, t } = find(id);
        if (p.active) for (const x of list) x.active = x.id === id;
        if (p.url !== undefined) t.url = p.url;
        if (p.pinned !== undefined && p.pinned !== t.pinned) {
          list.splice(i, 1);
          // Chrome puts a newly pinned tab at the end of the pinned block and an unpinned
          // one at the start of the unpinned area.
          place(w, { ...t, pinned: p.pinned, groupId: -1 }, -1);
          if (!p.pinned) {
            const l = tabs.get(w) as TabInfo[];
            const j = l.findIndex((x) => x.id === id);
            const [moved] = l.splice(j, 1);
            l.splice(pinnedEnd(l), 0, moved as TabInfo);
          }
        }
        return {};
      },
      async move(id, p) {
        calls.push(`move ${id} ${p.windowId}`);
        const { list, i, t } = find(id);
        list.splice(i, 1);
        place(p.windowId, { ...t, groupId: -1 }, p.index);
        return {};
      },
      async discard(id) {
        calls.push(`discard ${id}`);
        find(id).t.discarded = true;
        return {};
      },
      async remove(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        calls.push(`remove ${list.join(',')}`);
        for (const id of list) {
          const f = find(id);
          f.list.splice(f.i, 1);
        }
      },
    },
    windows: {
      async create(p) {
        calls.push(`windows.create ${JSON.stringify(p)}`);
        const id = Math.max(...tabs.keys()) + 1;
        tabs.set(id, [tab(nextId++, { windowId: id, url: 'chrome://newtab/', active: true })]);
        windows = [...windows, { id, incognito: false, focused: true }];
        return { id };
      },
      async update(id, p) {
        calls.push(`windows.update ${id} ${JSON.stringify(p)}`);
        return {};
      },
    },
  };

  const local = new Map<string, unknown>();
  if (opts.layouts) {
    local.set(LAYOUTS_KEY, { v: 1, layouts: opts.layouts, bindings: opts.bindings ?? [] });
  }
  const area = (data: Map<string, unknown>) => ({
    async get(key: string) {
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
  });
  let creates = 0;
  const pinDeps: PinManagerDeps = {
    store,
    ready: Promise.resolve(),
    tabsApi: {
      move: async (id, p) => {
        const { w } = find(id);
        await api.tabs.move(id, { windowId: w, index: p.index });
      },
      create: async (p) => {
        creates++;
        calls.push(`create ${p.url}`);
        const id = nextId++;
        const w = p.windowId as number;
        if (p.active) for (const x of tabs.get(w) ?? []) x.active = false;
        place(
          w,
          tab(id, { url: p.url, title: `New ${id}`, pinned: !!p.pinned, active: !!p.active }),
          -1,
        );
        return { id };
      },
      update: (id, p) => api.tabs.update(id, p as never),
      discard: (id) => api.tabs.discard(id),
      remove: (ids) => api.tabs.remove(ids),
    },
    storage: { local: area(local), session: area(new Map([[ALIVE_KEY, true]])) },
    windows: () => windows,
    broadcast: () => {},
    notice: () => {},
  };
  const pins = new PinManager(pinDeps);
  const deps: CommandDeps = {
    windows: (_scope, windowId) => [store.snapshot(windowId)],
    tab: (id) => store.get(id),
    restoreDiscarded: async () => false,
    chrome: api,
  };

  /** Delivers everything Chrome did since the last flush to the store and the manager. */
  const flush = async () => {
    const cs = new ChangeSet();
    for (const w of tabs.keys()) cs.resync.add(w);
    store.apply(cs, new Map([...tabs].map(([w, l]) => [w, l.map((t) => ({ ...t }))])));
    await pins.afterFlush([...tabs.keys()]);
    await vi.advanceTimersByTimeAsync(100);
  };
  const run = async (msg: PinMessage) => {
    const text = await runPinCommand(msg, pins, deps);
    await vi.advanceTimersByTimeAsync(10);
    return text;
  };
  const order = (w: number) => (tabs.get(w) ?? []).map((t) => t.id);
  return {
    pins,
    deps,
    store,
    tabs,
    calls,
    flush,
    run,
    order,
    local,
    creates: () => creates,
  };
}

/** The item with this id, if the layout has one. */
const itemIn = (l: WindowLayout, id: string) => findNode(l, id)?.node as PinItem | undefined;

/** Item ids and tab ids of a window's layout, flattened. */
const items = (l: WindowLayout) => flattenItems(l).map((i) => [i.id, i.tabId]);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('clearTabs', () => {
  it('closes unpinned tabs including grouped ones, keeping the active tab, pinned tabs and Essentials', async () => {
    const s = sim({
      windows: {
        1: [
          pinned(1, 1, 'https://ess.com/'),
          pinned(2, 1, 'https://pin.com/'),
          tab(3, { active: true }),
          tab(4, { groupId: 7 }),
          tab(5),
        ],
      },
      layouts: [
        layout(1, {
          essentials: [item(IT('a'), 'https://ess.com/', 1)],
          pinned: [item(IT('b'), 'https://pin.com/', 2)],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();

    expect(await s.run({ type: 'clearTabs', windowId: 1 })).toBe(
      'Closed 2 tabs · restore them from Recently closed',
    );
    expect(s.order(1)).toEqual([1, 2, 3]);
    await s.flush();
    expect(items(s.pins.layoutOf(1))).toEqual([
      [IT('a'), 1],
      [IT('b'), 2],
    ]);
  });

  it('uses the singular for one tab and says when there is nothing to clear', async () => {
    const s = sim({ windows: { 1: [tab(3, { active: true }), tab(4)] } });
    await s.flush();
    expect(await s.run({ type: 'clearTabs', windowId: 1 })).toBe(
      'Closed 1 tab · restore it from Recently closed',
    );
    expect(await s.run({ type: 'clearTabs', windowId: 1 })).toBe('Nothing to clear');
  });
});

describe('pinOpen', () => {
  const dormant = () =>
    sim({
      windows: {
        1: [
          pinned(1, 1, 'https://a.com/'),
          pinned(2, 1, 'https://c.com/'),
          tab(3, { active: true }),
        ],
      },
      layouts: [
        layout(1, {
          essentials: [
            item(IT('a'), 'https://a.com/', 1),
            item(IT('b'), 'https://b.com/'),
            item(IT('c'), 'https://c.com/', 2),
          ],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });

  it('creates exactly one tab when sent twice in a row for a dormant item (Review Focus 4)', async () => {
    const s = dormant();
    await s.flush();
    const msg = { type: 'pinOpen', windowId: 1, itemId: IT('b') } as const;
    await Promise.all([runPinCommand(msg, s.pins, s.deps), runPinCommand(msg, s.pins, s.deps)]);
    await vi.advanceTimersByTimeAsync(10);
    expect(s.creates()).toBe(1);

    await s.flush();
    await s.flush();
    const l = s.pins.layoutOf(1);
    expect(flattenItems(l).map((i) => i.id)).toEqual([IT('a'), IT('b'), IT('c')]);
    const b = itemIn(l, IT('b')) as PinItem;
    expect(b.tabId).toBe(900);
    // Moved into place in Chrome: between a and c.
    expect(s.order(1)).toEqual([1, 900, 2, 3]);
  });

  it('keeps the new tab bound while the store has not seen it yet', async () => {
    const s = dormant();
    await s.flush();
    await s.run({ type: 'pinOpen', windowId: 1, itemId: IT('b') });
    // A flush of events from before the create: the store has no tab 900 yet.
    await s.pins.afterFlush([1]);
    expect(itemIn(s.pins.layoutOf(1), IT('b'))?.tabId).toBe(900);
    await s.flush();
    await s.flush();
    expect(flattenItems(s.pins.layoutOf(1))).toHaveLength(3);
    expect(s.order(1)).toEqual([1, 900, 2, 3]);
  });

  it('activates a live item and focuses its window', async () => {
    const s = dormant();
    await s.flush();
    await s.run({ type: 'pinOpen', windowId: 1, itemId: IT('c') });
    expect(s.calls).toEqual(['update 2 {"active":true}', 'windows.update 1 {"focused":true}']);
    expect(s.creates()).toBe(0);
  });
});

describe('pinClose', () => {
  it('on the active essential, activates the next live tab first, then discards', async () => {
    const s = sim({
      windows: {
        1: [
          pinned(1, 1, 'https://a.com/', { active: true }),
          pinned(2, 1, 'https://b.com/'),
          tab(3),
        ],
      },
      layouts: [
        layout(1, {
          essentials: [item(IT('a'), 'https://a.com/', 1), item(IT('b'), 'https://b.com/', 2)],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    await s.run({ type: 'pinClose', windowId: 1, itemIds: [IT('a')] });
    expect(s.calls).toEqual(['update 2 {"active":true}', 'discard 1']);
    await s.flush();
    // The tile stays, still bound to its (discarded) tab.
    expect(items(s.pins.layoutOf(1))).toEqual([
      [IT('a'), 1],
      [IT('b'), 2],
    ]);
  });

  it('discards a live non-active item and ignores dormant ones', async () => {
    const s = sim({
      windows: { 1: [pinned(1, 1, 'https://a.com/'), tab(3, { active: true })] },
      layouts: [
        layout(1, {
          pinned: [item(IT('a'), 'https://a.com/', 1), item(IT('b'), 'https://b.com/')],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    await s.run({ type: 'pinClose', windowId: 1, itemIds: [IT('a'), IT('b')] });
    expect(s.calls).toEqual(['discard 1']);
  });
});

describe('pinRemove', () => {
  const two = () =>
    sim({
      windows: {
        1: [
          pinned(1, 1, 'https://a.com/'),
          pinned(2, 1, 'https://b.com/'),
          tab(3, { active: true }),
        ],
      },
      layouts: [
        layout(1, {
          essentials: [item(IT('a'), 'https://a.com/', 1)],
          pinned: [item(IT('b'), 'https://b.com/', 2), item(IT('c'), 'https://c.com/')],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });

  it('unpin turns the tab into a normal tab at the start of the unpinned area', async () => {
    const s = two();
    await s.flush();
    await s.run({ type: 'pinRemove', windowId: 1, itemId: IT('a'), mode: 'unpin' });
    expect(s.calls).toContain('update 1 {"pinned":false}');
    await s.flush();
    expect(items(s.pins.layoutOf(1))).toEqual([
      [IT('b'), 2],
      [IT('c'), null],
    ]);
    expect(s.order(1)).toEqual([2, 1, 3]);
  });

  it('unpin on a dormant item just removes it', async () => {
    const s = two();
    await s.flush();
    await s.run({ type: 'pinRemove', windowId: 1, itemId: IT('c'), mode: 'unpin' });
    expect(s.calls).toEqual([]);
    expect(items(s.pins.layoutOf(1)).map(([id]) => id)).toEqual([IT('a'), IT('b')]);
  });

  it('close removes the item and closes its tab, leaving no dormant tile', async () => {
    const s = two();
    await s.flush();
    await s.run({ type: 'pinRemove', windowId: 1, itemId: IT('b'), mode: 'close' });
    expect(s.calls).toContain('remove 2');
    await s.flush();
    expect(items(s.pins.layoutOf(1))).toEqual([
      [IT('a'), 1],
      [IT('c'), null],
    ]);
  });
});

describe('pinHome / pinSetHome', () => {
  it('navigates back home, and sets home to the current URL', async () => {
    const s = sim({
      windows: { 1: [pinned(1, 1, 'https://a.com/elsewhere'), tab(3, { active: true })] },
      layouts: [
        layout(1, {
          pinned: [{ ...item(IT('a'), 'https://a.com/', 1), lastUrl: 'https://a.com/elsewhere' }],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    await s.run({ type: 'pinHome', windowId: 1, itemId: IT('a') });
    expect(s.calls).toEqual(['update 1 {"url":"https://a.com/"}']);

    s.tabs.get(1)?.splice(0, 1, pinned(1, 1, 'https://a.com/new'));
    await s.flush();
    await s.run({ type: 'pinSetHome', windowId: 1, itemId: IT('a') });
    expect(itemIn(s.pins.layoutOf(1), IT('a'))?.homeUrl).toBe('https://a.com/new');
  });
});

describe('folders', () => {
  const withFolder = () =>
    sim({
      windows: {
        1: [
          pinned(1, 1, 'https://a.com/'),
          pinned(2, 1, 'https://b.com/'),
          pinned(4, 1, 'https://d.com/'),
          tab(3, { active: true }),
        ],
      },
      layouts: [
        layout(1, {
          pinned: [
            {
              kind: 'folder',
              id: FO('x'),
              name: 'X',
              icon: 'folder',
              collapsed: false,
              children: [
                item(IT('a'), 'https://a.com/', 1),
                item(IT('b'), 'https://b.com/', 2),
                item(IT('c'), 'https://c.com/'),
              ],
            },
            item(IT('d'), 'https://d.com/', 4),
          ],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });

  it('folderDelete(keepTabs: false) closes the live tabs and removes every item', async () => {
    const s = withFolder();
    await s.flush();
    await s.run({ type: 'folderDelete', windowId: 1, folderId: FO('x'), keepTabs: false });
    expect(s.calls).toEqual(['remove 1,2']);
    await s.flush();
    expect(s.pins.layoutOf(1).pinned.map((n) => n.id)).toEqual([IT('d')]);
    expect(s.order(1)).toEqual([4, 3]);
  });

  it('folderDelete(keepTabs: true) keeps the tabs as plain pinned items', async () => {
    const s = withFolder();
    await s.flush();
    await s.run({ type: 'folderDelete', windowId: 1, folderId: FO('x'), keepTabs: true });
    expect(s.calls).toEqual([]);
    expect(s.pins.layoutOf(1).pinned.map((n) => n.id)).toEqual([
      IT('a'),
      IT('b'),
      IT('c'),
      IT('d'),
    ]);
  });

  it('folderSuspend discards the live, non-active tabs of the folder', async () => {
    const s = withFolder();
    s.tabs.get(1)?.forEach((t) => {
      t.active = t.id === 2;
    });
    await s.flush();
    await s.run({ type: 'folderSuspend', windowId: 1, folderId: FO('x') });
    expect(s.calls).toEqual(['discard 1']);
  });

  it('folderCreate and folderUpdate edit the tree', async () => {
    const s = withFolder();
    await s.flush();
    await s.run({
      type: 'folderCreate',
      windowId: 1,
      name: 'New',
      dest: { zone: 'pinned', folderId: null, index: 1 },
      itemIds: [IT('d')],
    });
    const l = s.pins.layoutOf(1);
    const created = l.pinned[1];
    expect(created).toMatchObject({ kind: 'folder', name: 'New', children: [{ id: IT('d') }] });
    await s.run({
      type: 'folderUpdate',
      windowId: 1,
      folderId: created?.id as string,
      icon: 'star',
      collapsed: true,
    });
    expect(s.pins.layoutOf(1).pinned[1]).toMatchObject({
      icon: 'star',
      collapsed: true,
      name: 'New',
    });
  });
});

describe('pinTabs and pinMove', () => {
  it('pins a normal tab from another window into Essentials', async () => {
    const s = sim({
      windows: {
        1: [pinned(1, 1, 'https://a.com/'), tab(3, { active: true })],
        2: [tab(5, { url: 'https://e.com/', groupId: 9 }), tab(6, { active: true })],
      },
      layouts: [layout(1, { pinned: [item(IT('a'), 'https://a.com/', 1)] })],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    await s.run({
      type: 'pinTabs',
      tabIds: [5],
      windowId: 1,
      dest: { zone: 'essentials', index: 0 },
    });
    expect(s.calls.slice(0, 2)).toEqual(['move 5 1', 'update 5 {"pinned":true}']);
    await s.flush();
    await s.flush();
    const l = s.pins.layoutOf(1);
    expect(l.essentials.map((i) => [i.homeUrl, i.tabId])).toEqual([['https://e.com/', 5]]);
    expect(flattenItems(l)).toHaveLength(2);
    expect(flattenItems(s.pins.layoutOf(2))).toHaveLength(0);
    expect(s.order(1)).toEqual([5, 1, 3]);
  });

  it('moves a tab that already has an item instead of duplicating it', async () => {
    const s = sim({
      windows: {
        1: [
          pinned(1, 1, 'https://a.com/'),
          pinned(2, 1, 'https://b.com/'),
          tab(3, { active: true }),
        ],
      },
      layouts: [
        layout(1, {
          pinned: [item(IT('a'), 'https://a.com/', 1), item(IT('b'), 'https://b.com/', 2)],
        }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    await s.run({
      type: 'pinTabs',
      tabIds: [2],
      windowId: 1,
      dest: { zone: 'essentials', index: 0 },
    });
    await s.flush();
    const l = s.pins.layoutOf(1);
    expect(l.essentials.map((i) => i.id)).toEqual([IT('b')]);
    expect(flattenItems(l).map((i) => i.id)).toEqual([IT('b'), IT('a')]);
    expect(s.order(1)).toEqual([2, 1, 3]);
  });

  it('refuses to move tabs between incognito and normal windows', async () => {
    const s = sim({
      windows: {
        1: [tab(3, { active: true })],
        2: [tab(5, { incognito: true }), tab(6, { incognito: true, active: true })],
      },
      incognito: [2],
    });
    await s.flush();
    expect(
      await s.run({
        type: 'pinTabs',
        tabIds: [5],
        windowId: 1,
        dest: { zone: 'essentials', index: 0 },
      }),
    ).toBe("Can't move tabs between incognito and normal windows");
    expect(s.calls).toEqual([]);
  });

  it('pinMove moves a dormant item between windows without touching Chrome', async () => {
    const s = sim({
      windows: { 1: [tab(3, { active: true })], 2: [tab(6, { active: true })] },
      layouts: [layout(1, { pinned: [item(IT('a'), 'https://a.com/')] })],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    await s.run({
      type: 'pinMove',
      windowId: 1,
      nodeId: IT('a'),
      toWindowId: 2,
      dest: { zone: 'essentials', index: 0 },
    });
    expect(s.calls).toEqual([]);
    expect(flattenItems(s.pins.layoutOf(1))).toHaveLength(0);
    expect(s.pins.layoutOf(2).essentials.map((i) => i.id)).toEqual([IT('a')]);
  });

  it('pinMove moves a live item and its tab to another window', async () => {
    const s = sim({
      windows: {
        1: [pinned(1, 1, 'https://a.com/'), tab(3, { active: true })],
        2: [pinned(7, 2, 'https://z.com/'), tab(6, { active: true })],
      },
      layouts: [
        layout(1, { pinned: [item(IT('a'), 'https://a.com/', 1)] }),
        layout(2, { pinned: [item(IT('z'), 'https://z.com/', 7)] }),
      ],
      bindings: [
        { windowId: 1, layoutId: ID(1) },
        { windowId: 2, layoutId: ID(2) },
      ],
    });
    await s.flush();
    await s.run({
      type: 'pinMove',
      windowId: 1,
      nodeId: IT('a'),
      toWindowId: 2,
      dest: { zone: 'essentials', index: 0 },
    });
    await s.flush();
    await s.flush();
    expect(flattenItems(s.pins.layoutOf(1))).toHaveLength(0);
    expect(items(s.pins.layoutOf(2))).toEqual([
      [IT('a'), 1],
      [IT('z'), 7],
    ]);
    expect(s.order(2)).toEqual([1, 7, 6]);
  });
});

describe('windows', () => {
  it('renames and collapses other windows by layout id', async () => {
    const s = sim({ windows: { 1: [tab(3, { active: true })], 2: [tab(6, { active: true })] } });
    await s.flush();
    await s.run({ type: 'renameWindow', windowId: 1, name: 'Work' });
    expect(s.pins.layoutOf(1).name).toBe('Work');
    await s.run({ type: 'setWindowCollapsed', windowId: 1, otherWindowId: 2, collapsed: true });
    expect(s.pins.layoutOf(1).collapsed).toEqual([s.pins.layoutOf(2).id]);
    await s.run({ type: 'setWindowCollapsed', windowId: 1, otherWindowId: 2, collapsed: true });
    expect(s.pins.layoutOf(1).collapsed).toHaveLength(1);
    await s.run({ type: 'setWindowCollapsed', windowId: 1, otherWindowId: 2, collapsed: false });
    expect(s.pins.layoutOf(1).collapsed).toEqual([]);
    await s.run({ type: 'renameWindow', windowId: 1, name: null });
    expect(s.pins.layoutOf(1).name).toBeNull();
  });
});

describe('setups', () => {
  const withSetup = () =>
    sim({
      windows: { 1: [pinned(1, 1, 'https://a.com/'), tab(3, { active: true })] },
      layouts: [
        layout(1, { pinned: [item(IT('a'), 'https://a.com/', 1)] }),
        layout(2, { name: 'Saved', essentials: [item(IT('s'), 'https://s.com/')], lastUsed: 5 }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });

  it('setupApply appends the setup to the window and empties the setup list', async () => {
    const s = withSetup();
    await s.flush();
    expect(s.pins.setups().map((x) => x.id)).toEqual([ID(2)]);
    await s.run({ type: 'setupApply', setupId: ID(2), windowId: 1 });
    expect(s.pins.setups()).toEqual([]);
    const l = s.pins.layoutOf(1);
    expect(l.id).toBe(ID(1));
    expect(l.essentials.map((i) => [i.homeUrl, i.tabId])).toEqual([['https://s.com/', null]]);
    expect(l.pinned.map((n) => n.id)).toEqual([IT('a')]);
  });

  it('setupOpen binds the setup to a new window with every item dormant', async () => {
    const s = withSetup();
    await s.flush();
    vi.setSystemTime(1_000_000);
    await s.run({ type: 'setupOpen', setupId: ID(2) });
    expect(s.calls).toEqual(['windows.create {"focused":true}']);
    await s.flush();
    expect(s.pins.setups()).toEqual([]);
    const l = s.pins.layoutOf(2);
    expect(l.id).toBe(ID(2));
    expect(l.lastUsed).toBe(1_000_000);
    expect(items(l)).toEqual([[IT('s'), null]]);
    // The new tab page stays a normal tab.
    expect(s.store.snapshot(2).tabs.map((t) => t.pinned)).toEqual([false]);
  });

  it('setupRename and setupDelete; unknown ids are no-ops', async () => {
    const s = withSetup();
    await s.flush();
    await s.run({ type: 'setupRename', setupId: ID(2), name: 'Morning' });
    expect(s.pins.setups().map((x) => x.name)).toEqual(['Morning']);
    await s.run({ type: 'setupDelete', setupId: ID(9) });
    await s.run({ type: 'setupApply', setupId: ID(9), windowId: 1 });
    await s.run({ type: 'setupOpen', setupId: ID(9) });
    expect(s.calls).toEqual([]);
    expect(s.pins.setups()).toHaveLength(1);
    // A bound layout is not a setup.
    await s.run({ type: 'setupDelete', setupId: ID(1) });
    expect(s.pins.layoutOf(1).id).toBe(ID(1));
    await s.run({ type: 'setupDelete', setupId: ID(2) });
    expect(s.pins.setups()).toEqual([]);
  });
});

describe('refusals that would lose items', () => {
  it('setupApply keeps the setup when the window has no room for all of it', async () => {
    const full = Array.from({ length: MAX_ITEMS }, (_, k) =>
      item(`i${String(k).padStart(10, '0')}`, `https://x.com/${k}`),
    );
    const s = sim({
      windows: { 1: [tab(3, { active: true })] },
      layouts: [
        layout(1, { pinned: full }),
        layout(2, { essentials: [item(IT('s'), 'https://s.com/')] }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    expect(await s.run({ type: 'setupApply', setupId: ID(2), windowId: 1 })).toBe(
      'A window holds at most 500 pinned tabs',
    );
    expect(s.pins.setups().map((x) => x.id)).toEqual([ID(2)]);
    expect(flattenItems(s.pins.layoutOf(1))).toHaveLength(MAX_ITEMS);
  });

  it('setupApply refuses an incognito window and keeps the setup', async () => {
    const s = sim({
      windows: {
        1: [pinned(1, 1, 'https://a.com/'), tab(3, { active: true })],
        5: [tab(50, { active: true, incognito: true })],
      },
      incognito: [5],
      layouts: [
        layout(1, { pinned: [item(IT('a'), 'https://a.com/', 1)] }),
        layout(2, { essentials: [item(IT('s'), 'https://s.com/')] }),
      ],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    expect(await s.run({ type: 'setupApply', setupId: ID(2), windowId: 5 })).toBe(
      "Saved setups can't be applied to incognito windows",
    );
    expect(s.pins.setups().map((x) => x.id)).toEqual([ID(2)]);
    expect(flattenItems(s.pins.layoutOf(5))).toEqual([]);
  });

  it('pinSetHome refuses a URL the stored layout would drop', async () => {
    const s = sim({
      windows: { 1: [pinned(1, 1, 'view-source:https://a.com/'), tab(3, { active: true })] },
      layouts: [layout(1, { pinned: [item(IT('a'), 'https://a.com/', 1)] })],
      bindings: [{ windowId: 1, layoutId: ID(1) }],
    });
    await s.flush();
    expect(await s.run({ type: 'pinSetHome', windowId: 1, itemId: IT('a') })).toBe(
      "This page can't be a pinned tab's home",
    );
    expect(itemIn(s.pins.layoutOf(1), IT('a'))?.homeUrl).toBe('https://a.com/');
  });
});
