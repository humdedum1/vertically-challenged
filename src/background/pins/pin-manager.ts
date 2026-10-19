/**
 * Owns every window's layout; the worker's single writer. Tab flushes, panel edits and
 * window events all run through one queue here, which reconciles the affected windows
 * against the TabStore, persists the result and pushes it to the panels.
 */
import type { Browser } from 'wxt/browser';
import {
  emptyLayout,
  flattenItems,
  INCOGNITO_LAYOUTS_KEY,
  isEmptyLayout,
  LAYOUTS_KEY,
  type LayoutStore,
  MAX_SETUPS,
  type PinItem,
  type PinNode,
  parseLayoutStore,
  type WindowLayout,
} from '../../shared/layout';
import type { SetupSummary, WorkerMessage } from '../../shared/protocol';
import type { WindowInfo } from '../../shared/types';
import type { SingleMove } from '../move-plan';
import type { TabStore } from '../tab-store';
import { matchLayouts } from './match';
import { insertItems, removeItem } from './ops';
import { type ReconcileResult, reconcile } from './reconcile';

/** The slice of chrome.storage.StorageArea the manager uses. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string): Promise<void>;
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
}

/**
 * storage.session survives worker suspension but not a browser restart (or an extension
 * reload), so its absence tells a cold start, where every id changed, from a wake.
 */
export const ALIVE_KEY = 'vc:alive';
const PERSIST_DELAY_MS = 250;
const LAST_USED_THROTTLE_MS = 60_000;
/** Releases the in-flight guard when Chrome never reports a move (e.g. the tab closed mid-move). */
const SETTLE_TIMEOUT_MS = 1000;
/** A transfer re-queues its target window; the cap keeps a bug from spinning a flush forever. */
const MAX_PASSES = 4;

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
  private queue: Promise<unknown>;
  private writes: Promise<unknown> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = { local: false, session: false };
  private lastSetups = '[]';

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

  private async load(): Promise<void> {
    await this.deps.ready;
    const { local, session } = this.deps.storage;
    const [l, s, a] = await Promise.all([
      local.get(LAYOUTS_KEY),
      session.get(INCOGNITO_LAYOUTS_KEY),
      session.get(ALIVE_KEY),
    ]);
    const saved = parseLayoutStore(l[LAYOUTS_KEY]);
    const priv = parseLayoutStore(s[INCOGNITO_LAYOUTS_KEY]);
    // Each area only ever holds its own kind; anything else is ignored.
    for (const x of saved.layouts) if (!x.incognito) this.layouts.set(x.id, x);
    for (const x of priv.layouts) if (x.incognito) this.layouts.set(x.id, x);
    const windows = this.deps.windows();

    if (a[ALIVE_KEY] === true) {
      for (const b of [...saved.bindings, ...priv.bindings]) {
        if (this.layouts.has(b.layoutId) && !this.bindings.has(b.windowId)) {
          this.bindings.set(b.windowId, b.layoutId);
        }
      }
      // Windows closed while the worker was gone. An empty list means the query failed,
      // and dropping every binding on that basis would duplicate all layouts.
      const live = new Set(windows.map((w) => w.id));
      if (live.size > 0) {
        for (const w of [...this.bindings.keys()]) if (!live.has(w)) this.unbind(w, false);
      }
    } else {
      for (const [id, x] of this.layouts) {
        if (x.incognito) this.layouts.delete(id);
        else
          this.layouts.set(
            id,
            withTabIds(x, () => null),
          );
      }
      const matches = matchLayouts(
        [...this.layouts.values()],
        windows.map((w) => ({
          windowId: w.id,
          incognito: w.incognito,
          pinned: this.deps.store
            .snapshot(w.id)
            .tabs.filter((t) => t.pinned)
            .map((t) => ({ id: t.id, url: t.url, title: t.title })),
        })),
      );
      for (const [windowId, m] of matches) {
        const x = this.layouts.get(m.layoutId);
        if (!x) continue;
        this.layouts.set(
          x.id,
          withTabIds(x, (i) => m.bind.get(i.id) ?? null),
        );
        this.bindings.set(windowId, x.id);
      }
      // Bound layouts were exempt from the stored cap; unmatched ones are setups now.
      this.evictSetups(null);
      this.markDirty(false);
      this.markDirty(true);
      await session.set({ [ALIVE_KEY]: true });
    }
    this.lastSetups = JSON.stringify(this.setups());
  }

  // --- Reads -----------------------------------------------------------------------------

  /** The window's layout; an empty bound one is created on demand. Call after `loaded`. */
  layoutOf(windowId: number): WindowLayout {
    const id = this.bindings.get(windowId);
    const bound = id === undefined ? undefined : this.layouts.get(id);
    if (bound) return bound;
    const incognito =
      this.deps.windows().find((w) => w.id === windowId)?.incognito ??
      this.deps.store.snapshot(windowId).tabs.some((t) => t.incognito);
    const l = emptyLayout(incognito);
    this.layouts.set(l.id, l);
    this.bindings.set(windowId, l.id);
    this.markDirty(incognito);
    return l;
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
      if (this.closed.has(windowId)) return;
      const l = this.layoutOf(windowId);
      const next = fn(l);
      if (next === l) return;
      this.layouts.set(l.id, { ...next, id: l.id });
      // seq 0 acknowledges no settled moves: an edit is not a flush.
      const changed = this.pass([windowId], 0, windowId);
      changed.add(windowId);
      this.publish(changed);
    });
  }

  // --- Reconciling -----------------------------------------------------------------------

  /**
   * One reconcile pass. Returns the windows whose layout changed. `own` is a window whose
   * layout was just edited: the edit is the intent, so its Chrome order is not adopted.
   */
  private pass(ids: readonly number[], seq: number, own: number | null): Set<number> {
    const changed = this.transferPinned();
    const todo = [...new Set([...ids, ...changed])];
    const passes = new Map<number, number>();
    for (let w = todo.shift(); w !== undefined; w = todo.shift()) {
      const n = (passes.get(w) ?? 0) + 1;
      if (n > MAX_PASSES) continue;
      passes.set(w, n);
      const r = this.reconcileOne(w, w === own);
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
      this.ackSettled(w, seq);
    }
    return changed;
  }

  private reconcileOne(windowId: number, own: boolean): ReconcileResult | null {
    if (this.closed.has(windowId)) return null;
    const { store } = this.deps;
    // A window without pinned tabs needs no layout until a panel asks for one.
    if (!this.bindings.has(windowId) && !store.snapshot(windowId).tabs.some((t) => t.pinned)) {
      return null;
    }
    const layout = this.layoutOf(windowId);
    // The window's tabs and the lookup must describe the same store state, so both are
    // read here in one synchronous step.
    const r = reconcile(layout, windowId, store.snapshot(windowId).tabs, store, {
      inFlight: own || (this.inFlight.get(windowId) ?? 0) > 0,
    });
    if (r.changed) this.layouts.set(layout.id, r.layout);
    if (r.moves.length > 0) this.issueMoves(windowId, r.moves);
    return r;
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
        if (item.tabId === null) continue;
        const t = this.deps.store.get(item.tabId);
        if (!t?.pinned || t.windowId === windowId || this.closed.has(t.windowId)) continue;
        layout = removeItem(layout, item.id);
        this.appendPinned(t.windowId, item);
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
      for (const m of moves) {
        try {
          await this.deps.tabsApi.move(m.tabId, { index: m.index });
        } catch (err) {
          // The tab may have closed or moved meanwhile; the next flush converges.
          console.debug('[vc] pin move failed', err);
        }
      }
      const entry: Settled = {
        windowId,
        seq: this.seq,
        timer: setTimeout(() => {
          // Chrome never reported the moves; release the guard and look again.
          if (this.release(entry)) void this.afterFlush([windowId]);
        }, SETTLE_TIMEOUT_MS),
      };
      this.settled.push(entry);
    })();
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
    else this.inFlight.delete(entry.windowId);
    return true;
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
    const data = { local: this.storeFor(false), session: this.storeFor(true) };
    this.writes = this.writes
      .then(async () => {
        if (local) await this.deps.storage.local.set({ [LAYOUTS_KEY]: data.local });
        if (session) {
          await this.deps.storage.session.set({ [INCOGNITO_LAYOUTS_KEY]: data.session });
        }
      })
      .catch((err: unknown) => console.warn('[vc] saving layouts failed', err));
  }

  /** Incognito layouts and their bindings never reach storage.local. */
  private storeFor(incognito: boolean): LayoutStore {
    const layouts = [...this.layouts.values()].filter((l) => l.incognito === incognito);
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
