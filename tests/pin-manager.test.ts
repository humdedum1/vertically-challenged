import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALIVE_KEY,
  MOVING_KEY,
  PinManager,
  type PinManagerDeps,
} from '../src/background/pins/pin-manager';
import { ChangeSet, TabStore } from '../src/background/tab-store';
import {
  flattenItems,
  INCOGNITO_LAYOUTS_KEY,
  LAYOUTS_KEY,
  type LayoutStore,
  MAX_ITEMS,
  MAX_SETUPS,
  type PinItem,
  type WindowLayout,
} from '../src/shared/layout';
import type { WorkerMessage } from '../src/shared/protocol';
import type { TabInfo, WindowInfo } from '../src/shared/types';
import { tab } from './helpers';

/** In-memory chrome.storage area that records every write. */
function area(init: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(structuredClone(init)));
  const sets: Record<string, unknown>[] = [];
  let gate: Promise<void> = Promise.resolve();
  return {
    data,
    sets,
    /** Holds every get until the returned function is called. */
    hold(): () => void {
      let release = () => {};
      gate = new Promise((r) => {
        release = r;
      });
      return release;
    },
    async get(key: string): Promise<Record<string, unknown>> {
      await gate;
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items: Record<string, unknown>): Promise<void> {
      sets.push(structuredClone(items));
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
  };
}

const ID = (n: number) => `l${String(n).padStart(10, '0')}`;
const item = (id: string, url: string, tabId: number | null = null): PinItem => ({
  kind: 'item',
  id,
  homeUrl: url,
  lastUrl: url,
  title: id,
  tabId,
});
const layout = (n: number, items: PinItem[], o: Partial<WindowLayout> = {}): WindowLayout => ({
  id: ID(n),
  name: null,
  essentials: [],
  pinned: items,
  collapsed: [],
  incognito: false,
  lastUsed: n,
  ...o,
});
const stored = (layouts: WindowLayout[], bindings: LayoutStore['bindings'] = []): LayoutStore => ({
  v: 1,
  layouts,
  bindings,
});

const pinned = (id: number, windowId: number, url: string, o: Partial<TabInfo> = {}) =>
  tab(id, { windowId, url, title: `T${id}`, pinned: true, ...o });

function setup(opts: {
  windows: Record<number, TabInfo[]>;
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
  incognito?: number[];
  focused?: number;
  /** Overrides the window list derived from `windows` (e.g. [] for a failed query). */
  windowList?: WindowInfo[];
  /** Replaces the fake move, e.g. with one that always fails. */
  move?: (id: number, index: number) => Promise<void>;
}) {
  const store = new TabStore();
  store.apply(new ChangeSet(), new Map(Object.entries(opts.windows).map(([k, v]) => [+k, v])));
  const local = area(opts.local);
  const session = area(opts.session);
  const sent: { windowId: number | null; msg: WorkerMessage }[] = [];
  const notices: { windowId: number; text: string }[] = [];
  const moves: { id: number; index: number }[] = [];
  let windows: WindowInfo[] =
    opts.windowList ??
    Object.keys(opts.windows).map((k) => ({
      id: +k,
      incognito: opts.incognito?.includes(+k) ?? false,
      focused: +k === opts.focused,
    }));
  const deps: PinManagerDeps = {
    store,
    ready: Promise.resolve(),
    tabsApi: {
      // Applies the move to the store, as the flush following Chrome's onMoved would.
      move: async (id, p) => {
        moves.push({ id, index: p.index });
        if (opts.move) return opts.move(id, p.index);
        const t = store.get(id);
        if (!t) return;
        const tabs = store.snapshot(t.windowId).tabs.filter((x) => x.id !== id);
        tabs.splice(p.index, 0, t);
        resync(t.windowId, tabs);
      },
      create: async () => ({ id: 999 }),
      update: async () => {},
      discard: async () => {},
      remove: async () => {},
    },
    storage: { local, session },
    windows: () => windows,
    broadcast: (windowId, msg) => sent.push({ windowId, msg }),
    notice: (windowId, text) => notices.push({ windowId, text }),
  };
  /** Replaces a window's tabs in the store, as a flush would. */
  const resync = (windowId: number, tabs: TabInfo[]) => {
    const cs = new ChangeSet();
    cs.resync.add(windowId);
    return store.apply(cs, new Map([[windowId, tabs]]));
  };
  return {
    deps,
    store,
    local,
    session,
    sent,
    notices,
    moves,
    resync,
    setWindows: (w: WindowInfo[]) => {
      windows = w;
    },
  };
}

/** Lets queued work (load, flushes) and the 250 ms persist debounce run. */
const settle = () => vi.advanceTimersByTimeAsync(2000);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PinManager loading', () => {
  it('matches stored layouts to windows by URL after a browser restart', async () => {
    const saved = layout(1, [item('ia', 'https://a.com/'), item('ib', 'https://b.com/')]);
    const t = setup({
      windows: { 7: [pinned(10, 7, 'https://a.com/'), pinned(11, 7, 'https://b.com/'), tab(12)] },
      // Bindings from the previous session point at window ids that no longer mean anything.
      local: { [LAYOUTS_KEY]: stored([saved], [{ windowId: 1, layoutId: ID(1) }]) },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    const l = pins.layoutOf(7);
    expect(l.id).toBe(ID(1));
    expect(flattenItems(l).map((i) => [i.id, i.tabId])).toEqual([
      ['ia', 10],
      ['ib', 11],
    ]);
    expect(t.session.data.get(ALIVE_KEY)).toBe(true);
    const persisted = t.local.data.get(LAYOUTS_KEY) as LayoutStore;
    expect(persisted.bindings).toEqual([{ windowId: 7, layoutId: ID(1) }]);
  });

  it('keeps stored bindings and skips matching when the worker merely woke up', async () => {
    const boundElsewhere = layout(1, [item('ix', 'https://x.com/', 10)]);
    const wouldMatch = layout(2, [item('ia', 'https://a.com/'), item('ib', 'https://b.com/')]);
    const t = setup({
      windows: {
        1: [pinned(10, 1, 'https://x.com/')],
        2: [pinned(20, 2, 'https://a.com/'), pinned(21, 2, 'https://b.com/')],
      },
      local: {
        [LAYOUTS_KEY]: stored([boundElsewhere, wouldMatch], [{ windowId: 1, layoutId: ID(1) }]),
      },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    expect(pins.layoutOf(1).id).toBe(ID(1));
    expect(flattenItems(pins.layoutOf(1)).map((i) => i.tabId)).toEqual([10]);
    // No matching: window 2 gets a fresh layout and the stored one stays a setup.
    expect(pins.layoutOf(2).id).not.toBe(ID(2));
    expect(flattenItems(pins.layoutOf(2)).map((i) => i.tabId)).toEqual([20, 21]);
    expect(pins.setups().map((s) => s.id)).toEqual([ID(2)]);
  });

  it('does not adopt restored tabs as new items when a flush arrives before loading finishes', async () => {
    const saved = layout(1, [item('ia', 'https://a.com/'), item('ib', 'https://b.com/')]);
    const t = setup({
      windows: { 7: [pinned(10, 7, 'https://a.com/'), pinned(11, 7, 'https://b.com/')] },
      local: { [LAYOUTS_KEY]: stored([saved]) },
    });
    const release = t.local.hold();
    const pins = new PinManager(t.deps);
    const flushed = pins.afterFlush([7]);
    await vi.advanceTimersByTimeAsync(10);
    release();
    await flushed;
    await settle();

    const items = flattenItems(pins.layoutOf(7));
    expect(items.map((i) => [i.id, i.tabId])).toEqual([
      ['ia', 10],
      ['ib', 11],
    ]);
  });
});

describe('PinManager window close', () => {
  it('deletes an empty layout', async () => {
    const t = setup({ windows: { 1: [tab(1)] }, session: { [ALIVE_KEY]: true } });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    const id = pins.layoutOf(1).id;
    pins.onWindowRemoved(1);
    await settle();

    expect(pins.setups()).toEqual([]);
    const persisted = t.local.data.get(LAYOUTS_KEY) as LayoutStore;
    expect(persisted.layouts.map((l) => l.id)).not.toContain(id);
    expect(persisted.bindings).toEqual([]);
  });

  it('keeps a layout with items as a setup, all items dormant', async () => {
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/'), tab(11, { windowId: 1 })] },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    const id = pins.layoutOf(1).id;
    t.sent.length = 0;
    pins.onWindowRemoved(1);
    await settle();

    const setups = pins.setups();
    expect(setups).toHaveLength(1);
    expect(setups[0]).toMatchObject({ id, itemCount: 1, folderCount: 0 });
    const persisted = t.local.data.get(LAYOUTS_KEY) as LayoutStore;
    expect(flattenItems(persisted.layouts[0] as WindowLayout).map((i) => i.tabId)).toEqual([null]);
    expect(t.sent.some(({ msg }) => msg.type === 'setups')).toBe(true);
  });

  it('evicts the least recently used setup past the cap and says so', async () => {
    const setups = Array.from({ length: MAX_SETUPS }, (_, k) =>
      layout(k + 1, [item(`i${k}`, `https://s${k}.com/`)], { name: `Setup ${k + 1}` }),
    );
    const mine = layout(100, [item('mine', 'https://a.com/', 10)], { lastUsed: 1e12 });
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/')], 2: [tab(20, { windowId: 2 })] },
      focused: 2,
      local: { [LAYOUTS_KEY]: stored([...setups, mine], [{ windowId: 1, layoutId: ID(100) }]) },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    expect(pins.setups()).toHaveLength(MAX_SETUPS);

    pins.onWindowRemoved(1);
    await settle();

    const ids = pins.setups().map((s) => s.id);
    expect(ids).toHaveLength(MAX_SETUPS);
    expect(ids).toContain(ID(100));
    expect(ids).not.toContain(ID(1));
    expect(t.notices).toEqual([{ windowId: 2, text: 'Removed the oldest saved setup “Setup 1”' }]);
  });
});

describe('PinManager persistence', () => {
  it('writes incognito layouts to session storage only', async () => {
    const t = setup({
      windows: {
        1: [pinned(10, 1, 'https://a.com/')],
        3: [pinned(30, 3, 'https://secret.com/', { incognito: true })],
      },
      incognito: [3],
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    const secret = pins.layoutOf(3);
    expect(secret.incognito).toBe(true);
    const sess = t.session.data.get(INCOGNITO_LAYOUTS_KEY) as LayoutStore;
    expect(sess.layouts.map((l) => l.id)).toEqual([secret.id]);
    expect(sess.bindings).toEqual([{ windowId: 3, layoutId: secret.id }]);
    expect(t.local.sets.length).toBeGreaterThan(0);
    for (const write of t.local.sets) {
      const text = JSON.stringify(write);
      expect(text).not.toContain(secret.id);
      expect(text).not.toContain('secret.com');
    }

    // Closing an incognito window deletes its layout instead of keeping a setup.
    pins.onWindowRemoved(3);
    await settle();
    expect(pins.setups()).toEqual([]);
    expect((t.session.data.get(INCOGNITO_LAYOUTS_KEY) as LayoutStore).layouts).toEqual([]);
  });

  it('debounces writes: three mutations, one write', async () => {
    const t = setup({ windows: { 1: [tab(1)] }, session: { [ALIVE_KEY]: true } });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    pins.layoutOf(1);
    await settle();
    const before = t.local.sets.length;

    const rename = (name: string) => (l: WindowLayout) => ({ ...l, name });
    await Promise.all([
      pins.mutate(1, rename('a')),
      pins.mutate(1, rename('b')),
      pins.mutate(1, rename('c')),
    ]);
    await settle();

    expect(t.local.sets.length - before).toBe(1);
    expect((t.local.data.get(LAYOUTS_KEY) as LayoutStore).layouts[0]?.name).toBe('c');
  });
});

describe('PinManager reconciling', () => {
  it('moves the item along when a pinned tab is dragged to another window', async () => {
    const t = setup({
      windows: {
        1: [pinned(10, 1, 'https://a.com/'), pinned(11, 1, 'https://b.com/')],
        2: [pinned(20, 2, 'https://c.com/')],
      },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    const moved = flattenItems(pins.layoutOf(1)).find((i) => i.tabId === 10) as PinItem;

    t.resync(1, [pinned(11, 1, 'https://b.com/')]);
    t.resync(2, [pinned(20, 2, 'https://c.com/'), pinned(10, 2, 'https://a.com/')]);
    await pins.afterFlush([2]);
    await settle();

    expect(flattenItems(pins.layoutOf(1)).map((i) => i.tabId)).toEqual([11]);
    const target = flattenItems(pins.layoutOf(2));
    expect(target.map((i) => i.tabId)).toEqual([20, 10]);
    expect(target[1]?.id).toBe(moved.id);
    expect(t.sent.some(({ msg }) => msg.type === 'layout' && msg.windowId === 2)).toBe(true);
  });

  it('applies a panel edit to Chrome instead of adopting the old Chrome order', async () => {
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/'), pinned(11, 1, 'https://b.com/')] },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    await pins.mutate(1, (l) => ({ ...l, pinned: [...l.pinned].reverse() }));
    expect(flattenItems(pins.layoutOf(1)).map((i) => i.tabId)).toEqual([11, 10]);
    await pins.afterFlush([1]);
    await settle();
    expect(t.moves).toEqual([{ id: 10, index: 1 }]);
    expect(t.store.order(1)).toEqual([11, 10]);
    expect(flattenItems(pins.layoutOf(1)).map((i) => i.tabId)).toEqual([11, 10]);
  });
});

describe('PinManager fix round 1', () => {
  const order = (pins: PinManager, w: number) => flattenItems(pins.layoutOf(w)).map((i) => i.tabId);

  it('F1: failing moves are retried guarded, then dropped without adopting Chrome order', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const abc = () => [
      pinned(10, 1, 'https://a.com/'),
      pinned(11, 1, 'https://b.com/'),
      pinned(12, 1, 'https://c.com/'),
    ];
    const t = setup({
      windows: { 1: abc() },
      session: { [ALIVE_KEY]: true },
      move: async () => {
        throw new Error('Tabs cannot be edited right now');
      },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    await pins.mutate(1, (l) => ({ ...l, pinned: [...l.pinned].reverse() }));
    await vi.advanceTimersByTimeAsync(10_000);
    // Two moves per batch: the first batch plus three retries, then the manager gives up.
    expect(t.moves).toHaveLength(8);
    expect(order(pins, 1)).toEqual([12, 11, 10]);

    // A later unrelated flush must not adopt Chrome's unchanged (old) order either.
    await pins.afterFlush([1]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(order(pins, 1)).toEqual([12, 11, 10]);
    expect(t.moves).toHaveLength(8);

    // A real reorder in Chrome's strip is still adopted.
    const [a, b, c] = abc() as [TabInfo, TabInfo, TabInfo];
    t.resync(1, [b, a, c]);
    await pins.afterFlush([1]);
    await settle();
    expect(order(pins, 1)).toEqual([11, 10, 12]);
  });

  it('F2: a wake with moves outstanding pushes the stored layout to Chrome', async () => {
    const saved = layout(1, [item('ia', 'https://a.com/', 10), item('ib', 'https://b.com/', 11)]);
    const t = setup({
      // Half-moved: Chrome shows b before a, the layout says a before b.
      windows: { 1: [pinned(11, 1, 'https://b.com/'), pinned(10, 1, 'https://a.com/')] },
      local: { [LAYOUTS_KEY]: stored([saved], [{ windowId: 1, layoutId: ID(1) }]) },
      session: { [ALIVE_KEY]: true, [MOVING_KEY]: [1] },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    expect(order(pins, 1)).toEqual([10, 11]);
    expect(t.moves.length).toBeGreaterThan(0);
    expect(t.store.order(1)).toEqual([10, 11]);
    // The marker is cleared once the moves are done.
    await pins.afterFlush([1]);
    await settle();
    expect(t.session.data.get(MOVING_KEY)).toEqual([]);
  });

  it('F3: a failed load never overwrites the saved layouts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/')] },
      session: { [ALIVE_KEY]: true },
    });
    t.local.get = async () => {
      throw new Error('storage unavailable');
    };
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    await pins.mutate(1, (l) => ({ ...l, name: 'x' }));
    pins.onWindowRemoved(1);
    await settle();

    expect(t.local.sets).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('F4: a window of unknown incognito status never reaches storage.local', async () => {
    const t = setup({ windows: { 1: [tab(1)] }, session: { [ALIVE_KEY]: true } });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    // Window 5 is not in windows() yet and has no tabs in the store.
    const l = pins.layoutOf(5);
    t.resync(5, [pinned(50, 5, 'https://secret.com/', { incognito: true })]);
    await pins.afterFlush([5]);
    await settle();

    expect(order(pins, 5)).toEqual([50]);
    for (const write of t.local.sets) {
      const text = JSON.stringify(write);
      expect(text).not.toContain(l.id);
      expect(text).not.toContain('secret.com');
    }
    expect(JSON.stringify(t.session.data.get(INCOGNITO_LAYOUTS_KEY))).toContain('secret.com');
  });

  it('F5: restart matching waits until the window list is known', async () => {
    const saved = layout(1, [item('ia', 'https://a.com/'), item('ib', 'https://b.com/')]);
    const t = setup({
      windows: { 7: [pinned(10, 7, 'https://a.com/'), pinned(11, 7, 'https://b.com/')] },
      windowList: [],
      local: { [LAYOUTS_KEY]: stored([saved]) },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await pins.afterFlush([7]);
    await settle();
    expect(t.session.data.get(ALIVE_KEY)).toBeUndefined();

    t.setWindows([{ id: 7, incognito: false, focused: true }]);
    await pins.afterFlush([7]);
    await settle();
    const l = pins.layoutOf(7);
    expect(l.id).toBe(ID(1));
    expect(flattenItems(l).map((i) => [i.id, i.tabId])).toEqual([
      ['ia', 10],
      ['ib', 11],
    ]);
    expect(t.session.data.get(ALIVE_KEY)).toBe(true);
  });

  it('F6: a transfer into a full layout keeps the item (dormant) in its source', async () => {
    const full = layout(
      2,
      Array.from({ length: MAX_ITEMS }, (_, k) => item(`f${k}`, `https://f${k}.com/`)),
    );
    const src = layout(1, [item('ia', 'https://a.com/', 10)]);
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/')], 2: [tab(20, { windowId: 2 })] },
      local: {
        [LAYOUTS_KEY]: stored(
          [src, full],
          [
            { windowId: 1, layoutId: ID(1) },
            { windowId: 2, layoutId: ID(2) },
          ],
        ),
      },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    t.resync(1, []);
    t.resync(2, [pinned(10, 2, 'https://a.com/'), tab(20, { windowId: 2 })]);
    await pins.afterFlush([1, 2]);
    await settle();

    expect(flattenItems(pins.layoutOf(1)).map((i) => [i.id, i.tabId])).toEqual([['ia', null]]);
    expect(flattenItems(pins.layoutOf(2))).toHaveLength(MAX_ITEMS);
  });
});

describe('PinManager restoreLayout', () => {
  const rItem = (tabId: number, url: string) => ({
    kind: 'item' as const,
    tabId,
    url,
    title: `T${tabId}`,
  });

  it('binds restored tabs to fresh items, appended after the existing layout', async () => {
    const existing = layout(1, [item('ia', 'https://a.com/', 10)]);
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/')] },
      local: { [LAYOUTS_KEY]: stored([existing], [{ windowId: 1, layoutId: ID(1) }]) },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    await pins.restoreLayout(async (report) => {
      // Chrome has the tabs by the time the flush below reaches the manager.
      t.resync(1, [
        pinned(10, 1, 'https://a.com/'),
        pinned(20, 1, 'https://e.com/'),
        pinned(21, 1, 'https://f.com/'),
        pinned(22, 1, 'https://g.com/'),
      ]);
      report({
        windowId: 1,
        essentials: [rItem(20, 'https://e.com/')],
        pinned: [
          {
            kind: 'folder',
            name: 'Work',
            icon: 'code',
            collapsed: true,
            children: [rItem(21, 'https://f.com/'), rItem(99, 'https://gone.com/')],
          },
          rItem(22, 'https://g.com/'),
        ],
      });
    });
    await pins.afterFlush([1]);
    await settle();

    const l = pins.layoutOf(1);
    expect(l.essentials.map((i) => [i.tabId, i.homeUrl])).toEqual([[20, 'https://e.com/']]);
    expect(l.pinned.map((n) => n.kind)).toEqual(['item', 'folder', 'item']);
    const f = l.pinned[1];
    expect(f?.kind === 'folder' && [f.name, f.icon, f.collapsed]).toEqual(['Work', 'code', true]);
    // Each restored tab has exactly one item: none was adopted as a plain extra.
    expect(
      flattenItems(l)
        .map((i) => i.tabId)
        .sort(),
    ).toEqual([10, 20, 21, 22, 99].sort());
  });

  it('stops creating items at MAX_ITEMS; the rest stay plain tabs', async () => {
    const full = layout(
      1,
      Array.from({ length: MAX_ITEMS - 1 }, (_, i) => item(`i${i}`, `https://x${i}.com/`)),
    );
    const t = setup({
      windows: { 1: [pinned(20, 1, 'https://e.com/'), pinned(21, 1, 'https://f.com/')] },
      local: { [LAYOUTS_KEY]: stored([full], [{ windowId: 1, layoutId: ID(1) }]) },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    await pins.restoreLayout(async (report) => {
      report({
        windowId: 1,
        essentials: [rItem(20, 'https://e.com/')],
        pinned: [rItem(21, 'https://f.com/')],
      });
    });
    await settle();
    const items = flattenItems(pins.layoutOf(1));
    expect(items.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(items.some((i) => i.tabId === 20)).toBe(true);
    expect(items.some((i) => i.tabId === 21)).toBe(false);
  });

  it('binds the tabs created so far when the run throws, then rethrows', async () => {
    const t = setup({
      windows: { 1: [] },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    await expect(
      pins.restoreLayout(async (report) => {
        t.resync(1, [pinned(20, 1, 'https://e.com/'), pinned(21, 1, 'https://f.com/')]);
        report({
          windowId: 1,
          essentials: [rItem(20, 'https://e.com/')],
          pinned: [rItem(21, 'https://f.com/')],
        });
        throw new Error('tabs.create failed');
      }),
    ).rejects.toThrow('tabs.create failed');
    await pins.afterFlush([1]);
    await settle();
    const l = pins.layoutOf(1);
    expect(l.essentials.map((i) => i.tabId)).toEqual([20]);
    expect(l.pinned.map((n) => n.kind === 'item' && n.tabId)).toEqual([21]);
  });

  it('does nothing when the run reports no layout or the window closed', async () => {
    const t = setup({ windows: { 1: [] }, session: { [ALIVE_KEY]: true } });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await pins.restoreLayout(async () => {});
    pins.onWindowRemoved(1);
    await pins.restoreLayout(async (report) => {
      report({ windowId: 1, essentials: [rItem(5, 'https://a.com/')], pinned: [] });
    });
    expect(flattenItems(pins.layoutOf(2))).toEqual([]);
  });
});

describe('PinManager worker wake (round trip through storage)', () => {
  it('keeps items whose tabs navigated to extension or unstorable URLs', async () => {
    const saved = layout(1, [item('ib', 'https://b.com/', 11)], {
      essentials: [item('ia', 'https://a.com/', 10)],
    });
    const dormant = item('ic', 'https://c.com/');
    saved.pinned.push(dormant);
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/'), pinned(11, 1, 'https://b.com/')] },
      local: { [LAYOUTS_KEY]: stored([saved], [{ windowId: 1, layoutId: ID(1) }]) },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    const suspended = 'chrome-extension://abcdef/suspended.html#uri=https://a.com/';
    t.resync(1, [
      pinned(10, 1, suspended, { title: 'Suspended' }),
      pinned(11, 1, 'view-source:https://b.com/', { title: 'Source' }),
    ]);
    await pins.afterFlush([1]);
    await settle();

    // A new worker over the same storage, as after a ~30 s idle suspension.
    const woken = new PinManager(t.deps);
    await woken.loaded;
    await settle();

    const l = woken.layoutOf(1);
    expect(l.id).toBe(ID(1));
    expect(l.essentials.map((i) => [i.id, i.tabId, i.homeUrl, i.lastUrl])).toEqual([
      ['ia', 10, 'https://a.com/', suspended],
    ]);
    expect(flattenItems(l).map((i) => [i.id, i.tabId, i.lastUrl, i.title])).toEqual([
      ['ia', 10, suspended, 'Suspended'],
      ['ib', 11, 'https://b.com/', 'Source'],
      ['ic', null, 'https://c.com/', 'ic'],
    ]);
  });

  it('pins a tab on an unstorable URL without giving it an item', async () => {
    const t = setup({
      windows: { 1: [pinned(10, 1, 'https://a.com/'), tab(12, { windowId: 1, url: 'blob:x' })] },
      session: { [ALIVE_KEY]: true },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    const src = t.store.get(12) as TabInfo;

    const todo = await pins.pinInto(1, { zone: 'essentials', index: 0 }, [src], []);
    expect(todo).toEqual([12]);
    expect(flattenItems(pins.layoutOf(1)).map((i) => i.tabId)).toEqual([10]);
  });

  it('restores a session tab on an unstorable URL as a plain tab, without an item', async () => {
    const t = setup({ windows: { 1: [tab(1, { windowId: 1 })] }, session: { [ALIVE_KEY]: true } });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();

    await pins.restoreLayout(async (report) => {
      t.resync(1, [pinned(20, 1, 'ftp://f.com/'), pinned(21, 1, 'https://g.com/')]);
      report({
        windowId: 1,
        essentials: [{ kind: 'item', tabId: 20, url: 'ftp://f.com/', title: 'F' }],
        pinned: [{ kind: 'item', tabId: 21, url: 'https://g.com/', title: 'G' }],
      });
    });
    await pins.afterFlush([1]);
    await settle();

    expect(flattenItems(pins.layoutOf(1)).map((i) => [i.tabId, i.homeUrl])).toEqual([
      [21, 'https://g.com/'],
    ]);
  });
});

describe('PinManager late-restored windows', () => {
  const work = () =>
    layout(1, [item('ia', 'https://a.com/'), item('ib', 'https://b.com/')], { lastUsed: 5 });
  const play = () =>
    layout(2, [item('id', 'https://d.com/')], {
      essentials: [item('ic', 'https://c.com/')],
      lastUsed: 4,
    });

  /** Cold start with window 7 restored first; `clock` drives the grace period. */
  async function coldStart() {
    const t = setup({
      windows: { 7: [pinned(10, 7, 'https://a.com/'), pinned(11, 7, 'https://b.com/')] },
      local: { [LAYOUTS_KEY]: stored([work(), play()]) },
    });
    let clock = 1_000_000;
    t.deps.now = () => clock;
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    expect(pins.layoutOf(7).id).toBe(ID(1));
    expect(pins.setups().map((s) => s.id)).toEqual([ID(2)]);
    /** Chrome restores window 8 now. */
    const restore8 = async () => {
      t.setWindows([
        { id: 7, incognito: false, focused: false },
        { id: 8, incognito: false, focused: true },
      ]);
      t.resync(8, [pinned(20, 8, 'https://c.com/'), pinned(21, 8, 'https://d.com/'), tab(22)]);
      await pins.afterFlush([8]);
      await settle();
    };
    return { t, pins, restore8, advance: (ms: number) => (clock += ms) };
  }

  it('re-attaches the setup to a window restored within the grace period', async () => {
    const { pins, restore8, advance } = await coldStart();
    advance(30_000);
    await restore8();

    const l = pins.layoutOf(8);
    expect(l.id).toBe(ID(2));
    expect(l.essentials.map((i) => [i.id, i.tabId])).toEqual([['ic', 20]]);
    expect(flattenItems(l).map((i) => [i.id, i.tabId])).toEqual([
      ['ic', 20],
      ['id', 21],
    ]);
    expect(pins.setups()).toEqual([]);
  });

  it('adopts a window restored after the grace period as plain pinned tabs', async () => {
    const { pins, restore8, advance } = await coldStart();
    advance(61_000);
    await restore8();

    const l = pins.layoutOf(8);
    expect(l.id).not.toBe(ID(2));
    expect(l.essentials).toEqual([]);
    expect(flattenItems(l).map((i) => i.tabId)).toEqual([20, 21]);
    expect(pins.setups().map((s) => s.id)).toEqual([ID(2)]);
  });

  it('binds a matched window’s dormant item to its tab arriving late', async () => {
    const t = setup({
      windows: { 7: [pinned(10, 7, 'https://a.com/')] },
      local: { [LAYOUTS_KEY]: stored([work()]) },
    });
    let clock = 1_000_000;
    t.deps.now = () => clock;
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    expect(flattenItems(pins.layoutOf(7)).map((i) => [i.id, i.tabId])).toEqual([
      ['ia', 10],
      ['ib', null],
    ]);

    clock += 10_000;
    // Same site, different page: paired by origin.
    t.resync(7, [pinned(10, 7, 'https://a.com/'), pinned(11, 7, 'https://b.com/later')]);
    await pins.afterFlush([7]);
    await settle();

    expect(flattenItems(pins.layoutOf(7)).map((i) => [i.id, i.tabId])).toEqual([
      ['ia', 10],
      ['ib', 11],
    ]);
  });

  it('publishes and saves a late pairing even when nothing else changed', async () => {
    const t = setup({
      windows: { 7: [pinned(10, 7, 'https://a.com/')] },
      local: { [LAYOUTS_KEY]: stored([work()]) },
    });
    const pins = new PinManager(t.deps);
    await pins.loaded;
    await settle();
    t.sent.length = 0;

    t.resync(7, [
      pinned(10, 7, 'https://a.com/'),
      pinned(11, 7, 'https://b.com/', { title: 'ib' }),
    ]);
    await pins.afterFlush([7]);
    await settle();

    const sent = t.sent.filter(({ msg }) => msg.type === 'layout');
    const last = sent.at(-1)?.msg;
    expect(last?.type === 'layout' && flattenItems(last.layout).map((i) => i.tabId)).toEqual([
      10, 11,
    ]);
    const saved = (t.local.data.get(LAYOUTS_KEY) as LayoutStore).layouts[0] as WindowLayout;
    expect(flattenItems(saved).map((i) => i.tabId)).toEqual([10, 11]);
  });
});
