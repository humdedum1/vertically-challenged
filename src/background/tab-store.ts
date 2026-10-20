import type { GroupInfo, TabInfo, WindowPatch } from '../shared/types';

/**
 * A structural tab event, applied to the store's order locally instead of re-querying
 * the window. Indices are Chrome's at the time of the event, so ops replay in order.
 */
export type TabOp =
  | { kind: 'create'; windowId: number; tab: TabInfo; index: number }
  | { kind: 'move'; windowId: number; tabId: number; from: number; to: number }
  | { kind: 'remove'; windowId: number; tabId: number }
  | { kind: 'detach'; windowId: number; tabId: number; position: number };

/**
 * Raw chrome.tabs events accumulated between flushes. Kept separate from the store so the
 * flush can swap it out atomically while events keep arriving during async window queries.
 */
export class ChangeSet {
  /** Latest tab object seen per id (from onUpdated / onCreated). */
  readonly upserts = new Map<number, TabInfo>();
  readonly removed = new Set<number>();
  /** Windows whose order/membership must be re-read from chrome.tabs.query. */
  readonly resync = new Set<number>();
  /** Last activated tab per window; activation is applied locally to avoid a query. */
  readonly activations = new Map<number, number>();
  /** Windows whose tab groups changed; their group list is re-queried. */
  readonly groupWindows = new Set<number>();
  /** Structural events in arrival order, for windows that aren't resynced. */
  readonly ops: TabOp[] = [];
  /**
   * Windows that had a structural event that is not in `ops` (it came while the window
   * was being queried). Their ops can't be replayed, so they are queried instead.
   */
  readonly unlogged = new Set<number>();

  get isEmpty(): boolean {
    return (
      this.upserts.size === 0 &&
      this.removed.size === 0 &&
      this.resync.size === 0 &&
      this.activations.size === 0 &&
      this.groupWindows.size === 0 &&
      this.ops.length === 0
    );
  }
}

const FIELDS: readonly (keyof TabInfo)[] = [
  'windowId',
  'title',
  'url',
  'pinned',
  'active',
  'audible',
  'muted',
  'discarded',
  'loading',
  'groupId',
  'incognito',
];

export function tabsEqual(a: TabInfo, b: TabInfo): boolean {
  return FIELDS.every((f) => a[f] === b[f]);
}

const groupsEqual = (a: readonly GroupInfo[], b: readonly GroupInfo[]): boolean =>
  a.length === b.length &&
  a.every((g, i) => {
    const h = b[i];
    return (
      h !== undefined &&
      g.id === h.id &&
      g.title === h.title &&
      g.color === h.color &&
      g.collapsed === h.collapsed &&
      g.windowId === h.windowId
    );
  });

const arraysEqual = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Collects per-window output while a ChangeSet is applied. */
class PatchBuilder {
  private readonly byWindow = new Map<
    number,
    { upserts: Map<number, TabInfo>; removed: Set<number>; order?: number[]; groups?: GroupInfo[] }
  >();

  private entry(windowId: number) {
    let e = this.byWindow.get(windowId);
    if (!e) {
      e = { upserts: new Map(), removed: new Set() };
      this.byWindow.set(windowId, e);
    }
    return e;
  }

  upsert(tab: TabInfo): void {
    const e = this.entry(tab.windowId);
    e.removed.delete(tab.id);
    e.upserts.set(tab.id, tab);
  }

  remove(windowId: number, tabId: number): void {
    const e = this.entry(windowId);
    e.upserts.delete(tabId);
    e.removed.add(tabId);
  }

  order(windowId: number, order: number[]): void {
    this.entry(windowId).order = order;
  }

  groups(windowId: number, groups: GroupInfo[]): void {
    this.entry(windowId).groups = groups;
  }

  build(): WindowPatch[] {
    const out: WindowPatch[] = [];
    for (const [windowId, e] of this.byWindow) {
      const patch: WindowPatch = { windowId };
      if (e.upserts.size) patch.upserts = [...e.upserts.values()];
      if (e.removed.size) patch.removed = [...e.removed];
      if (e.order) patch.order = e.order;
      if (e.groups) patch.groups = e.groups;
      if (patch.upserts || patch.removed || patch.order || patch.groups) out.push(patch);
    }
    return out;
  }
}

/**
 * Canonical tab state owned by the service worker. All mutation goes through `apply`,
 * which returns the minimal per-window patches the panels need.
 */
export class TabStore {
  private readonly tabs = new Map<number, TabInfo>();
  private readonly orders = new Map<number, number[]>();
  private readonly groupsByWindow = new Map<number, GroupInfo[]>();

  snapshot(windowId: number): { tabs: TabInfo[]; order: number[]; groups: GroupInfo[] } {
    const order = this.orders.get(windowId) ?? [];
    const tabs: TabInfo[] = [];
    for (const id of order) {
      const t = this.tabs.get(id);
      if (t) tabs.push(t);
    }
    return { tabs, order: [...order], groups: [...(this.groupsByWindow.get(windowId) ?? [])] };
  }

  /** Live tab order of a window (a copy), for resolving move targets. */
  order(windowId: number): number[] {
    return [...(this.orders.get(windowId) ?? [])];
  }

  groups(windowId: number): readonly GroupInfo[] {
    return this.groupsByWindow.get(windowId) ?? [];
  }

  get(tabId: number): TabInfo | undefined {
    return this.tabs.get(tabId);
  }

  /**
   * Windows whose ops in `changes` can't be replayed on the store: an event is missing
   * (`unlogged`) or an index doesn't line up. The caller queries these instead.
   */
  unreplayable(changes: ChangeSet): Set<number> {
    const out = new Set<number>();
    const byWindow = new Map<number, TabOp[]>();
    for (const op of changes.ops) {
      if (changes.resync.has(op.windowId)) continue;
      const list = byWindow.get(op.windowId) ?? [];
      list.push(op);
      byWindow.set(op.windowId, list);
    }
    for (const [windowId, ops] of byWindow) {
      if (changes.unlogged.has(windowId) || !this.simulate(windowId, ops)) out.add(windowId);
    }
    return out;
  }

  /**
   * The window's order after `ops`, or null when they don't fit it. Each op is checked
   * against the order it applies to, so an event that the store already reflects (or a
   * missed one) is caught here rather than scrambling the order.
   */
  private simulate(windowId: number, ops: readonly TabOp[]): number[] | null {
    const order = [...(this.orders.get(windowId) ?? [])];
    for (const op of ops) {
      switch (op.kind) {
        case 'create':
          if (this.tabs.has(op.tab.id) || order.includes(op.tab.id)) return null;
          if (op.index > order.length) return null;
          order.splice(op.index, 0, op.tab.id);
          break;
        case 'move':
          if (order[op.from] !== op.tabId || op.to >= order.length) return null;
          order.splice(op.from, 1);
          order.splice(op.to, 0, op.tabId);
          break;
        case 'remove': {
          const i = order.indexOf(op.tabId);
          if (i !== -1) order.splice(i, 1);
          break;
        }
        case 'detach':
          if (order[op.position] !== op.tabId) return null;
          order.splice(op.position, 1);
          break;
      }
    }
    return order;
  }

  /**
   * Applies the ops of every window that isn't resynced, in event order. A tab detached
   * here stays in the map (in no window's order) until the window it went to is queried.
   */
  private replay(changes: ChangeSet, resynced: ReadonlyMap<number, unknown>, out: PatchBuilder) {
    const skip = new Set<number>(resynced.keys());
    const orders = new Map<number, number[]>();
    const windows = new Set<number>();
    for (const op of changes.ops) if (!skip.has(op.windowId)) windows.add(op.windowId);
    for (const windowId of windows) {
      const ops = changes.ops.filter((op) => op.windowId === windowId);
      const order = this.simulate(windowId, ops);
      // The flush queries these windows instead (see unreplayable).
      if (order) orders.set(windowId, order);
      else skip.add(windowId);
    }
    for (const op of changes.ops) {
      if (skip.has(op.windowId)) continue;
      switch (op.kind) {
        case 'create':
          this.tabs.set(op.tab.id, op.tab);
          out.upsert(op.tab);
          break;
        case 'remove':
          if (this.tabs.get(op.tabId)?.windowId === op.windowId) {
            this.tabs.delete(op.tabId);
            out.remove(op.windowId, op.tabId);
          }
          break;
        case 'detach':
          out.remove(op.windowId, op.tabId);
          break;
        case 'move':
          break;
      }
    }
    for (const [windowId, order] of orders) {
      const prev = this.orders.get(windowId) ?? [];
      if (order.length === 0) this.orders.delete(windowId);
      else this.orders.set(windowId, order);
      if (!arraysEqual(prev, order)) out.order(windowId, order);
    }
  }

  /**
   * @param resynced fresh, index-sorted query results for every window in `changes.resync`.
   *   A query runs after all events in the ChangeSet, so for those windows it is the newest
   *   truth and the older per-tab events are skipped.
   * @param groupsResynced fresh group lists for every window in `changes.groupWindows`.
   */
  apply(
    changes: ChangeSet,
    resynced: ReadonlyMap<number, TabInfo[]>,
    groupsResynced: ReadonlyMap<number, GroupInfo[]> = new Map(),
  ): WindowPatch[] {
    const out = new PatchBuilder();

    for (const [windowId, groups] of groupsResynced) {
      const prev = this.groupsByWindow.get(windowId) ?? [];
      if (groupsEqual(prev, groups)) continue;
      if (groups.length === 0) this.groupsByWindow.delete(windowId);
      else this.groupsByWindow.set(windowId, groups);
      out.groups(windowId, groups);
    }

    // Before the resynced windows: a tab detached here and queried in its new window must
    // end up owned by that window, and replay never deletes a tab another window holds.
    this.replay(changes, resynced, out);

    for (const id of changes.removed) {
      const prev = this.tabs.get(id);
      if (!prev) continue;
      this.tabs.delete(id);
      out.remove(prev.windowId, id);
      const order = this.orders.get(prev.windowId);
      if (order?.includes(id)) {
        const next = order.filter((x) => x !== id);
        this.orders.set(prev.windowId, next);
        out.order(prev.windowId, next);
      }
    }

    for (const [windowId, tabs] of resynced) this.replaceWindow(windowId, tabs, out);

    for (const tab of changes.upserts.values()) {
      if (changes.removed.has(tab.id) || resynced.has(tab.windowId)) continue;
      const prev = this.tabs.get(tab.id);
      // Membership changes come through resync; an upsert for a tab we don't place yet
      // would have no position, so wait for its window's resync.
      if (!prev || prev.windowId !== tab.windowId) continue;
      // Activation is tracked separately, so a stale onUpdated payload can't undo it.
      const next = { ...tab, active: prev.active };
      if (!tabsEqual(prev, next)) {
        this.tabs.set(tab.id, next);
        out.upsert(next);
      }
    }

    for (const [windowId, tabId] of changes.activations) {
      if (resynced.has(windowId)) continue;
      for (const id of this.orders.get(windowId) ?? []) {
        const t = this.tabs.get(id);
        if (!t) continue;
        const active = id === tabId;
        if (t.active !== active) {
          const next = { ...t, active };
          this.tabs.set(id, next);
          out.upsert(next);
        }
      }
    }

    return out.build();
  }

  private replaceWindow(windowId: number, tabs: TabInfo[], out: PatchBuilder): void {
    const prevOrder = this.orders.get(windowId) ?? [];
    const nextOrder = tabs.map((t) => t.id);
    const present = new Set(nextOrder);

    for (const id of prevOrder) {
      if (present.has(id)) continue;
      out.remove(windowId, id);
      // The tab may have moved to another window that was already resynced; only drop it
      // from the global map if it still belongs here.
      if (this.tabs.get(id)?.windowId === windowId) this.tabs.delete(id);
    }

    for (const tab of tabs) {
      const prev = this.tabs.get(tab.id);
      if (prev && prev.windowId !== windowId) {
        // Moved in from another window: drop it there too, in case that window isn't resynced.
        const other = this.orders.get(prev.windowId);
        if (other?.includes(tab.id)) {
          const next = other.filter((x) => x !== tab.id);
          this.orders.set(prev.windowId, next);
          out.remove(prev.windowId, tab.id);
          out.order(prev.windowId, next);
        }
      }
      if (!prev || !tabsEqual(prev, tab)) out.upsert(tab);
      this.tabs.set(tab.id, tab);
    }

    if (nextOrder.length === 0) this.orders.delete(windowId);
    else this.orders.set(windowId, nextOrder);
    if (!arraysEqual(prevOrder, nextOrder)) out.order(windowId, nextOrder);
  }
}
