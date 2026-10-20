/**
 * Owns every window's layout; the worker's single writer. Tab flushes, panel edits and
 * window events all run through one queue here, which reconciles the affected windows
 * against the TabStore, persists the result and pushes it to the panels.
 */
import type { Browser } from 'wxt/browser';
import {
  emptyLayout,
  type FolderIcon,
  findNode,
  flattenItems,
  INCOGNITO_LAYOUTS_KEY,
  isEmptyLayout,
  isLayoutUrl,
  LAYOUTS_KEY,
  type LayoutStore,
  MAX_ITEMS,
  MAX_NAME,
  MAX_SETUPS,
  newId,
  type PinDest,
  type PinItem,
  type PinNode,
  parseLayoutStore,
  type WindowLayout,
} from '../../shared/layout';
import type { SetupSummary, WorkerMessage } from '../../shared/protocol';
import type { TabInfo, WindowInfo } from '../../shared/types';
import type { SingleMove } from '../move-plan';
import type { TabStore } from '../tab-store';
import { type Match, matchLayouts, pair } from './match';
import { appendLayout, insertItems, removeItem } from './ops';
import { type ReconcileResult, reconcile } from './reconcile';

/** The slice of chrome.storage.StorageArea the manager uses. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string): Promise<void>;
}

/** A session's restored tab, ready to be bound to a fresh item. */
export interface RestoredItem {
  kind: 'item';
  tabId: number;
  url: string;
  title: string;
}
export type RestoredNode =
  | RestoredItem
  | {
      kind: 'folder';
      name: string;
      icon: FolderIcon;
      collapsed: boolean;
      children: RestoredNode[];
    };
/** What restoring a session window left in `windowId`: pinned tabs and where they belong. */
export interface RestoredLayout {
  windowId: number;
  essentials: RestoredItem[];
  pinned: RestoredNode[];
}

export interface PinManagerDeps {
  store: TabStore;
  /** Resolves once the store and the window list reflect the live browser. */
  ready: Promise<void>;
  tabsApi: {
    move(id: number, p: { index: number }): Promise<unknown>;
    create(p: Browser.tabs.CreateProperties): Promise<{ id?: number }>;
    update(id: number, p: Browser.tabs.UpdateProperties): Promise<unknown>;
    discard(id: number): Promise<unknown>;
    remove(ids: number[]): Promise<void>;
  };
  storage: { local: StorageArea; session: StorageArea };
  windows: () => readonly WindowInfo[];
  broadcast: (windowId: number | null, msg: WorkerMessage) => void;
  notice: (windowId: number, text: string) => void;
  /** Clock for the late-restore grace period; Date.now unless a test injects one. */
  now?: () => number;
}

/**
 * storage.session survives worker suspension but not a browser restart (or an extension
 * reload), so its absence tells a cold start, where every id changed, from a wake.
 */
export const ALIVE_KEY = 'vc:alive';
/**
 * Windows with our own moves outstanding. A worker that wakes mid-reorder would otherwise
 * read Chrome's half-moved order as a user drag and adopt it.
 */
export const MOVING_KEY = 'vc:moving';
const PERSIST_DELAY_MS = 250;
const LAST_USED_THROTTLE_MS = 60_000;
/** How long Chrome gets to report a batch of moves before it is re-planned. */
const SETTLE_TIMEOUT_MS = 1000;
/** Re-plans after a batch went unreported; past this the layout simply stays as it is. */
const MAX_MOVE_RETRIES = 3;
/** A transfer re-queues its target window; the cap keeps a bug from spinning a flush forever. */
const MAX_PASSES = 4;
/** How long a tab our command is pinning may take to show up pinned before reconcile stops waiting. */
const PENDING_TIMEOUT_MS = 5000;
/**
 * After a cold start Chrome may restore some windows, or some of a window's pinned tabs,
 * after restart matching ran. For this long, such arrivals are still matched against
 * the saved layouts instead of being adopted as plain pinned tabs.
 */
export const LATE_RESTORE_MS = 60_000;

interface Settled {
  windowId: number;
  /** Only an afterFlush called after this point has seen the moves' events. */
  seq: number;
  timer: ReturnType<typeof setTimeout>;
}

export class PinManager {
  /** Storage read and restart matching done; every other operation queues behind it. */
  readonly loaded: Promise<void>;
  private readonly layouts = new Map<string, WindowLayout>();
  /** windowId → layoutId; one layout per window and vice versa. */
  private readonly bindings = new Map<number, string>();
  /** Window ids are never reused, so a late flush for a closed window must not revive it. */
  private readonly closed = new Set<number>();
  /** Batches of our own Chrome moves per window that haven't been observed yet. */
  private readonly inFlight = new Map<number, number>();
  private settled: Settled[] = [];
  private seq = 0;
  /** Re-plans per window since its pinned block last matched the layout. */
  private readonly retries = new Map<number, number>();
  /**
   * Windows whose moves were given up on, with Chrome's pinned order at that point. While
   * Chrome still shows that order it is not a user reorder, so it is never adopted.
   */
  private readonly stale = new Map<number, number[]>();
  /** Windows that had moves outstanding when the previous worker went away. */
  private readonly resume = new Set<number>();
  /** Restart matching waits for a window list; see tryMatch. */
  private pendingMatch = false;
  /** End of the late-restore grace period (LATE_RESTORE_MS); 0 when there is none. */
  private lateUntil = 0;
  /** Layouts restart matching left unmatched, still eligible for a late window. */
  private readonly lateCandidates = new Set<string>();
  /** Windows bound by restart matching, whose dormant items may still find a late tab. */
  private readonly restartMatched = new Set<number>();
  /** Set when the stored layouts couldn't be read: writing would replace them. */
  private noPersist = false;
  /** `vc:alive` is written with the first layouts write after restart matching. */
  private aliveDue = false;
  private queue: Promise<unknown>;
  private writes: Promise<unknown> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = { local: false, session: false };
  private lastSetups = '[]';
  private lastMoving = '[]';
  /** Tabs our own commands are pinning into a window, or (null) closing or unpinning; see reconcile's `pending`. */
  private readonly pending = new Map<
    number,
    { windowId: number | null; timer: ReturnType<typeof setTimeout> }
  >();
  /** Dormant items whose tab is being created; a second open of the same item is dropped. */
  private readonly opening = new Set<string>();

  constructor(private readonly deps: PinManagerDeps) {
    this.loaded = this.load().catch((err: unknown) => {
      console.error('[vc] loading layouts failed', err);
    });
    this.queue = this.loaded;
    // The store was filled without a flush, so every window is reconciled once up front.
    void this.loaded.then(() => this.afterFlush(this.deps.windows().map((w) => w.id)));
  }

  /**
   * Runs `fn` after every earlier operation and before any later one. Anything that must
   * not interleave with a reconcile goes through here; e.g. creating a tab for a dormant
   * item and binding it to that item in one exclusive step keeps rule 2 from adopting
   * the new tab as a separate item first.
   */
  private exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch((err: unknown) => console.error('[vc] layout update failed', err));
    return run;
  }

  // --- Loading ---------------------------------------------------------------------------

  private readStored(): Promise<Record<string, unknown>[]> {
    const { local, session } = this.deps.storage;
    return Promise.all([
      local.get(LAYOUTS_KEY),
      session.get(INCOGNITO_LAYOUTS_KEY),
      session.get(ALIVE_KEY),
      session.get(MOVING_KEY),
    ]);
  }

  private async load(): Promise<void> {
    await this.deps.ready;
    let raw: Record<string, unknown>[];
    try {
      raw = await this.readStored();
    } catch {
      try {
        raw = await this.readStored();
      } catch (err) {
        // Saving now would replace every saved setup with what this worker builds up.
        console.warn('[vc] layouts unavailable; changes are not saved until restart', err);
        this.noPersist = true;
        return;
      }
    }
    const [l = {}, s = {}, a = {}, mv = {}] = raw;
    const saved = parseLayoutStore(l[LAYOUTS_KEY]);
    const priv = parseLayoutStore(s[INCOGNITO_LAYOUTS_KEY]);
    // Each area only ever holds its own kind; anything else is ignored.
    for (const x of saved.layouts) if (!x.incognito) this.layouts.set(x.id, x);
    for (const x of priv.layouts) if (x.incognito) this.layouts.set(x.id, x);

    if (a[ALIVE_KEY] === true) {
      const taken = new Set<string>();
      for (const b of [...saved.bindings, ...priv.bindings]) {
        // A layout bound to two windows would have reconcile hand items back and forth.
        if (
          this.layouts.has(b.layoutId) &&
          !this.bindings.has(b.windowId) &&
          !taken.has(b.layoutId)
        ) {
          this.bindings.set(b.windowId, b.layoutId);
          taken.add(b.layoutId);
        }
      }
      // Windows closed while the worker was gone. An empty list means the query failed,
      // and dropping every binding on that basis would duplicate all layouts.
      const live = new Set(this.deps.windows().map((w) => w.id));
      if (live.size > 0) {
        for (const w of [...this.bindings.keys()]) if (!live.has(w)) this.unbind(w, false);
      }
      const moving = mv[MOVING_KEY];
      if (Array.isArray(moving)) {
        for (const w of moving)
          if (typeof w === 'number' && this.bindings.has(w)) this.resume.add(w);
      }
      this.lastMoving = JSON.stringify(Array.isArray(moving) ? moving : []);
    } else {
      for (const [id, x] of this.layouts) {
        if (x.incognito) this.layouts.delete(id);
        else
          this.layouts.set(
            id,
            withTabIds(x, () => null),
          );
      }
      this.pendingMatch = true;
      this.tryMatch();
    }
    this.lastSetups = JSON.stringify(this.setups());
  }

  /**
   * Restart matching needs the windows. If the window query failed, matching waits for a
   * later pass instead of treating every layout as unmatched (and every restored pinned
   * tab as new). Windows bound to an empty layout in the meantime may still match.
   */
  private tryMatch(): boolean {
    if (!this.pendingMatch) return false;
    const windows = this.deps.windows();
    if (windows.length === 0) return false;
    this.pendingMatch = false;
    const now = this.deps.now?.() ?? Date.now();
    this.lateUntil = now + LATE_RESTORE_MS;
    const open = windows.filter((w) => {
      const id = this.bindings.get(w.id);
      const l = id === undefined ? undefined : this.layouts.get(id);
      return !l || isEmptyLayout(l);
    });
    const bound = new Set(this.bindings.values());
    const matches = matchLayouts(
      [...this.layouts.values()].filter((x) => !bound.has(x.id)),
      open.map((w) => ({
        windowId: w.id,
        incognito: w.incognito,
        pinned: this.deps.store
          .snapshot(w.id)
          .tabs.filter((t) => t.pinned)
          .map((t) => ({ id: t.id, url: t.url, title: t.title })),
      })),
    );
    for (const [windowId, m] of matches) this.bindMatch(windowId, m);
    // Bound layouts were exempt from the stored cap; unmatched ones are setups now.
    this.evictSetups(null);
    for (const l of this.layouts.values()) {
      if (this.setupLayout(l.id)) this.lateCandidates.add(l.id);
    }
    this.aliveDue = true;
    this.markDirty(false);
    this.markDirty(true);
    return true;
  }

  /** Binds a matched layout to the window, replacing an (empty) placeholder it had. */
  private bindMatch(windowId: number, m: Match): void {
    const x = this.layouts.get(m.layoutId);
    if (!x) return;
    const placeholder = this.bindings.get(windowId);
    if (placeholder !== undefined) {
      this.markDirty(this.layouts.get(placeholder)?.incognito ?? true);
      this.layouts.delete(placeholder);
    }
    this.layouts.set(
      x.id,
      withTabIds(x, (i) => m.bind.get(i.id) ?? null),
    );
    this.bindings.set(windowId, x.id);
    this.lateCandidates.delete(x.id);
    this.restartMatched.add(windowId);
    this.markDirty(false);
  }

  private inLateRestore(): boolean {
    if (this.lateUntil === 0) return false;
    if ((this.deps.now?.() ?? Date.now()) < this.lateUntil) return true;
    this.lateUntil = 0;
    this.lateCandidates.clear();
    this.restartMatched.clear();
    return false;
  }

  /**
   * A window that shows its first pinned tabs during the grace period (unbound, or bound
   * to an empty placeholder) is matched against the setups restart matching left over.
   */
  private lateMatch(windowId: number, tabs: readonly TabInfo[]): boolean {
    const id = this.bindings.get(windowId);
    const l = id === undefined ? undefined : this.layouts.get(id);
    if (l && !isEmptyLayout(l)) return false;
    const pinnedTabs = tabs.filter((t) => t.pinned);
    if (pinnedTabs.length === 0) return false;
    const candidates = [...this.lateCandidates]
      .map((c) => this.setupLayout(c))
      .filter((c): c is WindowLayout => c !== undefined);
    const m = matchLayouts(candidates, [
      {
        windowId,
        incognito: this.incognitoOf(windowId) ?? true,
        pinned: pinnedTabs.map((t) => ({ id: t.id, url: t.url, title: t.title })),
      },
    ]).get(windowId);
    if (!m) return false;
    this.bindMatch(windowId, m);
    this.publishSetups();
    return true;
  }

  /**
   * During the grace period, a restart-matched window's newly arriving pinned tabs are
   * paired with its dormant items (exact URL, then origin) before rule 2 could adopt them
   * as duplicates next to those dormant tiles.
   */
  private pairDormant(windowId: number, tabs: readonly TabInfo[]): boolean {
    if (!this.restartMatched.has(windowId)) return false;
    const id = this.bindings.get(windowId);
    const l = id === undefined ? undefined : this.layouts.get(id);
    if (!l) return false;
    const items = flattenItems(l);
    const known = new Set(items.map((i) => i.tabId));
    const fresh = tabs.filter((t) => t.pinned && !known.has(t.id) && !this.pending.has(t.id));
    if (fresh.length === 0) return false;
    const dormant = items.filter((i) => i.tabId === null || !this.deps.store.get(i.tabId));
    if (dormant.length === 0) return false;
    const bind = pair(
      dormant,
      fresh.map((t) => ({ id: t.id, url: t.url, title: t.title })),
    );
    if (bind.size === 0) return false;
    this.layouts.set(
      l.id,
      withTabIds(l, (i) => bind.get(i.id) ?? i.tabId),
    );
    return true;
  }

  // --- Reads -----------------------------------------------------------------------------

  /** The window's layout; an empty bound one is created on demand. Call after `loaded`. */
  layoutOf(windowId: number): WindowLayout {
    const id = this.bindings.get(windowId);
    const bound = id === undefined ? undefined : this.layouts.get(id);
    if (bound) return bound;
    const l = emptyLayout(this.incognitoOf(windowId) ?? true);
    this.layouts.set(l.id, l);
    this.bindings.set(windowId, l.id);
    this.markDirty(l.incognito);
    return l;
  }

  /**
   * Tabs are the surest sign (an incognito window holds only incognito tabs), then the
   * window list; null when neither knows yet. Callers fail closed and treat null as
   * incognito, so a window's URLs never reach the disk before it is known to be normal.
   */
  private incognitoOf(windowId: number): boolean | null {
    const tabs = this.deps.store.snapshot(windowId).tabs;
    if (tabs.length > 0) return tabs.some((t) => t.incognito);
    return this.deps.windows().find((w) => w.id === windowId)?.incognito ?? null;
  }

  /** Layouts no window is bound to, most recently used first. Incognito ones never qualify. */
  setups(): SetupSummary[] {
    const bound = new Set(this.bindings.values());
    return [...this.layouts.values()]
      .filter((l) => !l.incognito && !bound.has(l.id))
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .map((l) => ({
        id: l.id,
        name: setupName(l),
        essentials: l.essentials.map((i) => ({ url: i.homeUrl, title: i.title })),
        itemCount: flattenItems(l).length,
        folderCount: countFolders(l.pinned),
        lastUsed: l.lastUsed,
      }));
  }

  // --- Events ----------------------------------------------------------------------------

  /** Called after each TabStore flush with the windows its patches touched. */
  afterFlush(windowIds: Iterable<number>): Promise<void> {
    const ids = [...new Set(windowIds)];
    const seq = ++this.seq;
    return this.exclusive(() => this.publish(this.pass(ids, seq, null)));
  }

  onWindowRemoved(windowId: number): void {
    this.closed.add(windowId);
    void this.exclusive(() => {
      this.unbind(windowId, true);
      this.publishSetups();
    });
  }

  /** Feeds setup eviction order; throttled because focus flips constantly. */
  onWindowFocused(windowId: number): void {
    if (windowId < 0) return;
    void this.exclusive(() => {
      const id = this.bindings.get(windowId);
      const l = id === undefined ? undefined : this.layouts.get(id);
      const now = Date.now();
      if (!l || now - l.lastUsed < LAST_USED_THROTTLE_MS) return;
      this.layouts.set(l.id, { ...l, lastUsed: now });
      this.markDirty(l.incognito);
    });
  }

  /** Applies a panel edit, then brings Chrome's pinned block into the edited order. */
  mutate(windowId: number, fn: (l: WindowLayout) => WindowLayout): Promise<void> {
    return this.exclusive(() => {
      this.edit(windowId, fn);
    });
  }

  /** mutate's body, for operations already running inside the queue. */
  private edit(windowId: number, fn: (l: WindowLayout) => WindowLayout): void {
    if (this.closed.has(windowId)) return;
    const l = this.layoutOf(windowId);
    const next = fn(l);
    if (next === l) return;
    this.layouts.set(l.id, { ...next, id: l.id });
    // A fresh edit gets a fresh set of attempts at moving Chrome.
    this.stale.delete(windowId);
    this.retries.delete(windowId);
    // seq 0 acknowledges no settled moves: an edit is not a flush.
    const changed = this.pass([windowId], 0, windowId);
    changed.add(windowId);
    this.publish(changed);
  }

  // --- Panel commands that need the queue -------------------------------------------------

  /**
   * Re-creates a dormant item's tab at its home URL. The create and the binding happen in
   * one exclusive step, and the tab stays pending until the store has seen it, so neither
   * rule 1 (tab unknown → dormant) nor rule 2 (unknown pinned tab → new item) can split it
   * off. A second open while the first is in flight is dropped. Resolves to false when
   * the item is not dormant (anymore), so the caller can activate it instead.
   */
  openItem(windowId: number, itemId: string): Promise<boolean> {
    if (this.opening.has(itemId)) return Promise.resolve(true);
    this.opening.add(itemId);
    return this.exclusive(async () => {
      try {
        if (this.closed.has(windowId)) return true;
        const hit = findNode(this.layoutOf(windowId), itemId);
        if (hit?.node.kind !== 'item') return true;
        if (hit.node.tabId !== null) return false;
        const url = hit.node.homeUrl;
        const tab = await this.deps.tabsApi.create({ windowId, url, pinned: true, active: true });
        if (tab.id === undefined) return true;
        const tabId = tab.id;
        this.expect(tabId, windowId);
        this.edit(windowId, (l) =>
          findNode(l, itemId) ? withTabIds(l, (i) => (i.id === itemId ? tabId : i.tabId)) : l,
        );
        return true;
      } finally {
        this.opening.delete(itemId);
      }
    });
  }

  /**
   * Session restore: `run` creates the pinned tabs and `report`s which of them belong in
   * the layout. It runs inside the queue, so no reconcile can adopt the new pinned tabs as
   * plain items before they are bound; each stays pending until the store has seen it.
   * Whatever was reported is bound even when `run` throws (the error is rethrown), so a
   * failed restore doesn't lose the layout of the tabs it did create. The items are
   * appended after the window's existing layout (a new window has none); past MAX_ITEMS
   * the remaining tabs simply stay plain pinned tabs.
   */
  restoreLayout(run: (report: (r: RestoredLayout) => void) => Promise<void>): Promise<void> {
    return this.exclusive(async () => {
      let reported: RestoredLayout | null = null;
      try {
        await run((r) => {
          reported = r;
        });
      } finally {
        if (reported) this.bindRestored(reported);
      }
    });
  }

  private bindRestored(r: RestoredLayout): void {
    if (this.closed.has(r.windowId)) return;
    let budget = MAX_ITEMS - flattenItems(this.layoutOf(r.windowId)).length;
    const bind = (n: RestoredItem): PinItem | null => {
      // Sessions restore schemes a layout can't store (ftp:); that tab stays a plain one.
      if (budget <= 0 || !isLayoutUrl(n.url)) return null;
      budget--;
      this.expect(n.tabId, r.windowId);
      return {
        kind: 'item',
        id: newId('i'),
        homeUrl: n.url,
        lastUrl: n.url,
        title: n.title,
        tabId: n.tabId,
      };
    };
    const walk = (nodes: RestoredNode[]): PinNode[] => {
      const out: PinNode[] = [];
      for (const n of nodes) {
        if (n.kind === 'item') {
          const i = bind(n);
          if (i) out.push(i);
        } else {
          const children = walk(n.children);
          if (children.length) out.push({ ...n, id: newId('f'), children });
        }
      }
      return out;
    };
    const essentials = r.essentials.map(bind).filter((i): i is PinItem => i !== null);
    const pinned = walk(r.pinned);
    if (!essentials.length && !pinned.length) return;
    this.edit(r.windowId, (l) => ({
      ...l,
      essentials: [...l.essentials, ...essentials],
      pinned: [...l.pinned, ...pinned],
    }));
  }

  /**
   * Places items at `dest` of `windowId`'s layout in one step. `moved` items (by the
   * window whose layout holds them) are taken out of their layouts; `tabs` reuse the item
   * already bound to them in any window, else get a new item (a tab whose URL a layout
   * can't store gets none and is just pinned, a stray row until it navigates). Returns the tabs Chrome
   * still has to move into the window and/or pin (they are pending until it has), or null
   * when nothing was placed (the window is gone, the layout is full or `dest` is missing).
   */
  pinInto(
    windowId: number,
    dest: PinDest,
    tabs: readonly TabInfo[],
    moved: readonly { windowId: number; itemId: string }[],
  ): Promise<number[] | null> {
    return this.exclusive(() => {
      if (this.closed.has(windowId)) return null;
      const target = this.layoutOf(windowId);
      const work = new Map<string, WindowLayout>();
      const get = (id: string) => work.get(id) ?? (this.layouts.get(id) as WindowLayout);
      const owner = new Map<string, number>([...this.bindings].map(([w, id]) => [id, w]));
      const picked: PinItem[] = [];
      /** Tabs pinned without an item: their URL can't be stored, so they stay strays. */
      const strays: number[] = [];
      const take = (layoutId: string, itemId: string): boolean => {
        const l = get(layoutId);
        const hit = findNode(l, itemId);
        if (hit?.node.kind !== 'item' || picked.some((p) => p.id === itemId)) return false;
        picked.push(hit.node);
        work.set(layoutId, removeItem(l, itemId));
        return true;
      };
      for (const m of moved) {
        const id = this.bindings.get(m.windowId);
        if (id !== undefined) take(id, m.itemId);
      }
      for (const t of tabs) {
        if (picked.some((p) => p.tabId === t.id)) continue;
        // A tab that already has an item, in any window, moves as that item.
        const owned = [...this.bindings.values()].find((id) =>
          flattenItems(get(id)).some((x) => x.tabId === t.id),
        );
        const existing = owned && flattenItems(get(owned)).find((x) => x.tabId === t.id);
        if (owned && existing && take(owned, existing.id)) continue;
        if (!isLayoutUrl(t.url)) {
          strays.push(t.id);
          continue;
        }
        picked.push({
          kind: 'item',
          id: newId('i'),
          homeUrl: t.url,
          lastUrl: t.url,
          title: t.title,
          tabId: t.id,
        });
      }
      const base = get(target.id);
      const next = picked.length ? insertItems(base, picked, dest) : base;
      if (picked.length ? next === base : strays.length === 0) return null;
      work.set(target.id, next);

      const touched: number[] = [];
      for (const [id, l] of work) {
        this.layouts.set(id, l);
        const w = owner.get(id);
        if (w !== undefined && w !== windowId) touched.push(w);
      }
      const chrome: number[] = [];
      for (const id of [...picked.map((i) => i.tabId), ...strays]) {
        if (id === null) continue;
        const t = this.deps.store.get(id);
        if (t?.pinned && t.windowId === windowId) continue;
        this.expect(id, windowId);
        chrome.push(id);
      }
      // As in edit(): a fresh edit gets a fresh set of attempts at moving Chrome.
      this.stale.delete(windowId);
      this.retries.delete(windowId);
      const changed = this.pass([windowId, ...touched], 0, windowId);
      for (const w of [windowId, ...touched]) changed.add(w);
      this.publish(changed);
      this.publishSetups();
      return chrome;
    });
  }

  /**
   * Tabs a command is about to close or unpin while it removes their items. Until the
   * store shows them gone or unpinned, no window adopts them as new items.
   */
  expectGone(tabIds: readonly number[]): void {
    for (const id of tabIds) this.expect(id, null);
  }

  /** Marks a tab as pending for `windowId`; see reconcile's `pending`. */
  private expect(tabId: number, windowId: number | null): void {
    const old = this.pending.get(tabId);
    if (old) clearTimeout(old.timer);
    const entry = {
      windowId,
      timer: setTimeout(
        () =>
          void this.exclusive(() => {
            if (this.pending.get(tabId) !== entry) return;
            this.pending.delete(tabId);
            if (windowId !== null) this.publish(this.pass([windowId], 0, null));
          }),
        PENDING_TIMEOUT_MS,
      ),
    };
    this.pending.set(tabId, entry);
  }

  /** Our command failed; the tab is no longer expected anywhere. */
  dropPending(tabIds: readonly number[]): Promise<void> {
    return this.exclusive(() => {
      const ws = new Set<number>();
      for (const id of tabIds) {
        const p = this.pending.get(id);
        if (!p) continue;
        clearTimeout(p.timer);
        this.pending.delete(id);
        if (p.windowId !== null) ws.add(p.windowId);
      }
      if (ws.size) this.publish(this.pass([...ws], 0, null));
    });
  }

  /**
   * Clears the window's pending tabs that Chrome now shows pinned there (and any closed
   * or unpinned tabs that are gone or unpinned now). True when the
   * window had any: their arrival at the end of the pinned block is our doing, not a
   * user reorder, so that pass must not adopt Chrome's order.
   */
  private settlePending(windowId: number): boolean {
    let any = false;
    for (const [id, p] of this.pending) {
      // Another window's arrivals are settled when that window is reconciled, which is
      // the pass that must not adopt them.
      if (p.windowId !== null && p.windowId !== windowId) continue;
      const t = this.deps.store.get(id);
      const done = p.windowId === null ? !t?.pinned : t?.pinned === true && t.windowId === windowId;
      if (p.windowId === windowId) any = true;
      if (done) {
        clearTimeout(p.timer);
        this.pending.delete(id);
      }
    }
    return any;
  }

  // --- Setups (commands) ------------------------------------------------------------------

  /** A layout no window is bound to; incognito layouts are never setups. */
  private setupLayout(setupId: string): WindowLayout | undefined {
    const l = this.layouts.get(setupId);
    if (!l || l.incognito || [...this.bindings.values()].includes(setupId)) return undefined;
    return l;
  }

  /** Whether `setupId` names a saved setup right now. */
  hasSetup(setupId: string): boolean {
    return this.setupLayout(setupId) !== undefined;
  }

  /**
   * Binds a saved setup to a window just opened for it, every item dormant. A layout the
   * new window already got (an empty placeholder) is replaced; a non-empty one wins.
   */
  bindSetup(setupId: string, windowId: number): Promise<void> {
    return this.exclusive(() => {
      const s = this.setupLayout(setupId);
      if (!s || this.closed.has(windowId)) return;
      const current = this.bindings.get(windowId);
      if (current !== undefined) {
        const l = this.layouts.get(current);
        if (l && !isEmptyLayout(l)) return;
        this.layouts.delete(current);
      }
      this.layouts.set(s.id, { ...withTabIds(s, () => null), lastUsed: Date.now() });
      this.bindings.set(windowId, s.id);
      this.markDirty(false);
      const changed = this.pass([windowId], 0, windowId);
      changed.add(windowId);
      this.publish(changed);
      this.publishSetups();
    });
  }

  /**
   * "Apply to this window": the setup is appended (see appendLayout), then deleted.
   * Refused, keeping the setup, when the window can't take all of its items ('full'), or
   * when the window is incognito: its layout lives only in storage.session, so the
   * setup would be gone with the incognito session.
   */
  applySetup(setupId: string, windowId: number): Promise<'full' | 'incognito' | null> {
    return this.exclusive(() => {
      const s = this.setupLayout(setupId);
      if (!s || this.closed.has(windowId)) return null;
      const target = this.layoutOf(windowId);
      if (target.incognito) return 'incognito';
      const room = MAX_ITEMS - flattenItems(target).length;
      if (flattenItems(s).length > room) return 'full';
      this.edit(windowId, (l) => appendLayout(l, s));
      this.layouts.delete(s.id);
      this.markDirty(false);
      this.publishSetups();
      return null;
    });
  }

  renameSetup(setupId: string, name: string): Promise<void> {
    return this.exclusive(() => {
      const s = this.setupLayout(setupId);
      const trimmed = name.trim().slice(0, MAX_NAME);
      if (!s || !trimmed) return;
      this.layouts.set(s.id, { ...s, name: trimmed });
      this.markDirty(false);
      this.publishSetups();
    });
  }

  deleteSetup(setupId: string): Promise<void> {
    return this.exclusive(() => {
      if (!this.setupLayout(setupId)) return;
      this.layouts.delete(setupId);
      this.markDirty(false);
      this.publishSetups();
    });
  }

  // --- Reconciling -----------------------------------------------------------------------

  /**
   * One reconcile pass. Returns the windows whose layout changed. `own` is a window whose
   * layout was just edited: the edit is the intent, so its Chrome order is not adopted.
   */
  private pass(ids: readonly number[], seq: number, own: number | null): Set<number> {
    if (this.pendingMatch) {
      if (!this.tryMatch()) return new Set();
      // Nothing was reconciled while matching waited.
      ids = [...ids, ...this.deps.windows().map((w) => w.id)];
      this.publishSetups();
    }
    const changed = this.transferPinned();
    const todo = [...new Set([...ids, ...changed])];
    const passes = new Map<number, number>();
    for (let w = todo.shift(); w !== undefined; w = todo.shift()) {
      const n = (passes.get(w) ?? 0) + 1;
      if (n > MAX_PASSES) continue;
      passes.set(w, n);
      const r = this.reconcileOne(w, w === own, seq);
      if (r) {
        if (r.changed) changed.add(w);
        // Fallback for transfers the pre-pass missed.
        for (const t of r.transfers) {
          if (this.appendPinned(t.windowId, t.item)) {
            changed.add(t.windowId);
            todo.push(t.windowId);
          }
        }
      }
    }
    return changed;
  }

  /**
   * The guard is decided before this flush acknowledges settled batches, so the flush
   * that first sees our moves still doesn't adopt them; new moves wait until no batch is
   * outstanding, because planning against a half-applied order would repeat them.
   */
  private reconcileOne(windowId: number, own: boolean, seq: number): ReconcileResult | null {
    const moving = (this.inFlight.get(windowId) ?? 0) > 0;
    this.ackSettled(windowId, seq);
    if (this.closed.has(windowId)) return null;
    const { store } = this.deps;
    // The window's tabs and the lookup must describe the same store state, so both are
    // read in this one synchronous step.
    const tabs = store.snapshot(windowId).tabs;
    // Bindings made here are changes even when reconcile below finds nothing to do.
    let late = false;
    if (this.inLateRestore()) {
      late = this.lateMatch(windowId, tabs);
      late = this.pairDormant(windowId, tabs) || late;
    }
    // A window without pinned tabs needs no layout until a panel asks for one.
    if (!this.bindings.has(windowId) && !tabs.some((t) => t.pinned)) return null;
    let layout = this.layoutOf(windowId);
    const incognito = this.incognitoOf(windowId) ?? layout.incognito;
    const flipped = incognito !== layout.incognito;
    if (flipped) {
      // Moves the layout to the other storage area on the next write.
      layout = { ...layout, incognito };
      this.layouts.set(layout.id, layout);
      this.markDirty(false);
      this.markDirty(true);
    }
    const stale = this.isStale(windowId, tabs);
    const resumed = this.resume.delete(windowId);
    const settling = this.settlePending(windowId);
    const pending = new Map([...this.pending].map(([id, p]) => [id, p.windowId]));
    const r = reconcile(layout, windowId, tabs, store, {
      inFlight: own || stale || resumed || moving || settling,
      pending,
    });
    if (r.changed) this.layouts.set(layout.id, r.layout);
    if (r.moves.length === 0) this.retries.delete(windowId);
    else if (!stale && !this.inFlight.has(windowId)) this.issueMoves(windowId, r.moves);
    if (resumed) void this.writeMoving();
    return flipped || late ? { ...r, changed: true } : r;
  }

  /**
   * True while Chrome still shows the order we gave up on: the same pinned tabs in the
   * same order. Any other set of pinned tabs ends it, so a give-up recorded against a
   * momentarily empty (or otherwise different) snapshot can't hold forever.
   */
  private isStale(windowId: number, tabs: readonly TabInfo[]): boolean {
    const then = this.stale.get(windowId);
    if (!then) return false;
    const now = tabs.filter((t) => t.pinned).map((t) => t.id);
    if (now.length === then.length && now.every((id, k) => id === then[k])) return true;
    this.stale.delete(windowId);
    return false;
  }

  /**
   * A pinned tab dragged to another window takes its item along (same id, so folders
   * and Essentials placement in the panel stay recognisable). Done before any reconcile
   * so the target's rule 2 doesn't mint a second item for the tab.
   */
  private transferPinned(): Set<number> {
    const touched = new Set<number>();
    for (const [windowId, layoutId] of [...this.bindings]) {
      let layout = this.layouts.get(layoutId);
      if (!layout) continue;
      for (const item of flattenItems(layout)) {
        // A tab our command is moving here is not a drag back to where it came from.
        if (item.tabId === null || this.pending.has(item.tabId)) continue;
        const t = this.deps.store.get(item.tabId);
        if (!t?.pinned || t.windowId === windowId || this.closed.has(t.windowId)) continue;
        // A full target can't take it; it stays here, dormant, rather than being lost.
        layout = this.appendPinned(t.windowId, item)
          ? removeItem(layout, item.id)
          : withTabIds(layout, (i) => (i.id === item.id ? null : i.tabId));
        touched.add(windowId);
        touched.add(t.windowId);
      }
      this.layouts.set(layoutId, layout);
    }
    return touched;
  }

  /** Appends to the window's pinned root; false when the window is gone or the layout is full. */
  private appendPinned(windowId: number, item: PinItem): boolean {
    if (this.closed.has(windowId)) return false;
    const l = this.layoutOf(windowId);
    const next = insertItems(l, [item], { zone: 'pinned', folderId: null, index: l.pinned.length });
    if (next === l) return false;
    this.layouts.set(l.id, next);
    return true;
  }

  /**
   * Our own moves arrive back as tab events in later flushes, partly applied. While any
   * are outstanding the window is reconciled with `inFlight`, so those intermediate
   * orders are not mistaken for the user dragging in Chrome's strip.
   */
  private issueMoves(windowId: number, moves: readonly SingleMove[]): void {
    this.inFlight.set(windowId, (this.inFlight.get(windowId) ?? 0) + 1);
    void (async () => {
      // Recorded first, so a worker that dies mid-batch knows on wake not to adopt.
      await this.writeMoving();
      for (const m of moves) {
        try {
          await this.deps.tabsApi.move(m.tabId, { index: m.index });
        } catch (err) {
          // The tab may have closed or be mid-drag; the retry below re-plans.
          console.debug('[vc] pin move failed', err);
        }
      }
      const entry: Settled = {
        windowId,
        seq: this.seq,
        timer: setTimeout(() => void this.exclusive(() => this.retry(entry)), SETTLE_TIMEOUT_MS),
      };
      this.settled.push(entry);
    })();
  }

  /**
   * No flush saw the batch (failed moves produce no events). Re-plan with the guard still
   * on; after MAX_MOVE_RETRIES the batch is dropped and the layout keeps its order.
   */
  private retry(entry: Settled): void {
    if (!this.settled.includes(entry)) return;
    const w = entry.windowId;
    const n = (this.retries.get(w) ?? 0) + 1;
    if (n > MAX_MOVE_RETRIES) {
      this.retries.delete(w);
      const pinned = this.deps.store.snapshot(w).tabs.filter((t) => t.pinned);
      this.stale.set(
        w,
        pinned.map((t) => t.id),
      );
      this.release(entry);
      return;
    }
    this.retries.set(w, n);
    this.release(entry);
    this.publish(this.pass([w], 0, w));
  }

  /** Releases move batches that settled before this flush was called. */
  private ackSettled(windowId: number, seq: number): void {
    for (const e of this.settled.filter((x) => x.windowId === windowId && x.seq < seq)) {
      this.release(e);
    }
  }

  private release(entry: Settled): boolean {
    const i = this.settled.indexOf(entry);
    if (i < 0) return false;
    this.settled.splice(i, 1);
    clearTimeout(entry.timer);
    const n = (this.inFlight.get(entry.windowId) ?? 1) - 1;
    if (n > 0) this.inFlight.set(entry.windowId, n);
    else {
      this.inFlight.delete(entry.windowId);
      void this.writeMoving();
    }
    return true;
  }

  /** Mirrors the windows with moves outstanding into storage.session (see MOVING_KEY). */
  private writeMoving(): Promise<unknown> {
    const list = [...new Set([...this.inFlight.keys(), ...this.resume])].sort((a, b) => a - b);
    const json = JSON.stringify(list);
    if (this.noPersist || json === this.lastMoving) return this.writes;
    this.lastMoving = json;
    this.writes = this.writes
      .then(() => this.deps.storage.session.set({ [MOVING_KEY]: list }))
      .catch((err: unknown) => console.warn('[vc] saving move marker failed', err));
    return this.writes;
  }

  // --- Setups ----------------------------------------------------------------------------

  /** Incognito and empty layouts are dropped; anything else stays as a setup, all dormant. */
  private unbind(windowId: number, notify: boolean): void {
    const id = this.bindings.get(windowId);
    if (id === undefined) return;
    this.bindings.delete(windowId);
    const l = this.layouts.get(id);
    if (!l) return;
    this.markDirty(l.incognito);
    if (l.incognito || isEmptyLayout(l)) {
      this.layouts.delete(id);
      return;
    }
    this.layouts.set(
      id,
      withTabIds(l, () => null),
    );
    this.evictSetups(notify ? windowId : null);
  }

  /** Drops the least recently used setups past the cap; `closing` is the window that caused it. */
  private evictSetups(closing: number | null): void {
    const bound = new Set(this.bindings.values());
    const setups = [...this.layouts.values()]
      .filter((l) => !l.incognito && !bound.has(l.id))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (setups.length > MAX_SETUPS) {
      const old = setups.shift() as WindowLayout;
      this.layouts.delete(old.id);
      this.markDirty(false);
      if (closing === null) continue;
      // The closing window has no panel left; tell the one the user is looking at.
      const open = this.deps.windows().filter((w) => w.id !== closing && !this.closed.has(w.id));
      const to = open.find((w) => w.focused) ?? open[0];
      if (to) this.deps.notice(to.id, `Removed the oldest saved setup “${setupName(old)}”`);
    }
  }

  // --- Output ----------------------------------------------------------------------------

  private publish(changed: ReadonlySet<number>): void {
    for (const w of changed) {
      const id = this.bindings.get(w);
      const l = id === undefined ? undefined : this.layouts.get(id);
      if (!l) continue;
      this.markDirty(l.incognito);
      this.deps.broadcast(w, { type: 'layout', windowId: w, layout: l });
    }
  }

  private publishSetups(): void {
    const setups = this.setups();
    const json = JSON.stringify(setups);
    if (json === this.lastSetups) return;
    this.lastSetups = json;
    this.deps.broadcast(null, { type: 'setups', setups });
  }

  /**
   * Writes at most once per 250 ms window. The timer is not pushed back by later
   * changes, so a steady stream of tab events still gets saved.
   */
  private markDirty(incognito: boolean): void {
    if (this.noPersist) return;
    if (incognito) this.dirty.session = true;
    else this.dirty.local = true;
    if (this.persistTimer === null) {
      this.persistTimer = setTimeout(() => this.persist(), PERSIST_DELAY_MS);
    }
  }

  /** Queued like src/background/sessions.ts `mutate`, so two writes never land out of order. */
  private persist(): void {
    this.persistTimer = null;
    const { local, session } = this.dirty;
    this.dirty = { local: false, session: false };
    const alive = this.aliveDue;
    this.aliveDue = false;
    const data = { local: this.storeFor(false), session: this.storeFor(true) };
    this.writes = this.writes
      .then(async () => {
        if (local) await this.deps.storage.local.set({ [LAYOUTS_KEY]: data.local });
        // After the local write, so a wake never trusts bindings that weren't saved.
        if (session || alive) {
          await this.deps.storage.session.set({
            [INCOGNITO_LAYOUTS_KEY]: data.session,
            ...(alive ? { [ALIVE_KEY]: true } : {}),
          });
        }
      })
      .catch((err: unknown) => console.warn('[vc] saving layouts failed', err));
  }

  /**
   * Incognito layouts and their bindings never reach storage.local. A layout still marked
   * normal whose window holds incognito tabs is held back too, until a pass relabels it.
   */
  private storeFor(incognito: boolean): LayoutStore {
    const held = new Set<string>();
    for (const [w, id] of this.bindings) {
      if (this.deps.store.snapshot(w).tabs.some((t) => t.incognito)) held.add(id);
    }
    const layouts = [...this.layouts.values()].filter(
      (l) => l.incognito === incognito && (incognito || !held.has(l.id)),
    );
    const ids = new Set(layouts.map((l) => l.id));
    const bindings = [...this.bindings]
      .filter(([, layoutId]) => ids.has(layoutId))
      .map(([windowId, layoutId]) => ({ windowId, layoutId }));
    return { v: 1, layouts, bindings };
  }
}

function withTabIds(l: WindowLayout, f: (i: PinItem) => number | null): WindowLayout {
  const out = structuredClone(l);
  for (const i of flattenItems(out)) i.tabId = f(i);
  return out;
}

function countFolders(nodes: readonly PinNode[]): number {
  let n = 0;
  for (const x of nodes) if (x.kind === 'folder') n += 1 + countFolders(x.children);
  return n;
}

function setupName(l: WindowLayout): string {
  return l.name ?? (flattenItems(l)[0]?.title || 'Untitled setup');
}
