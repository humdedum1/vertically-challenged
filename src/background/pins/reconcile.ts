/**
 * Reconciliation: brings a window's layout and Chrome's real pinned tabs back into
 * agreement after tab events. Chrome is the truth for which tabs exist and are pinned;
 * the layout is the truth for order, except when the user reorders in Chrome's own
 * strip. Pure; the worker applies the result after every TabStore flush.
 */
import {
  flattenItems,
  MAX_ITEMS,
  newId,
  type PinDest,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from '../../shared/layout';
import type { TabInfo } from '../../shared/types';
import { planMoves, type SingleMove } from '../move-plan';
import { insertItems, moveNode, removeItem } from './ops';

/** TabStore satisfies this. */
export interface TabLookup {
  get(id: number): TabInfo | undefined;
}

export interface ReconcileResult {
  layout: WindowLayout;
  /** Items whose tab moved to another window: append to that window's layout. */
  transfers: { windowId: number; item: PinItem }[];
  /** Chrome moves that bring the pinned block into layout order. */
  moves: SingleMove[];
  changed: boolean;
}

export function reconcile(
  layout: WindowLayout,
  windowId: number,
  windowTabs: readonly TabInfo[],
  tabs: TabLookup,
  opts: {
    inFlight: boolean;
    /**
     * Tabs our own commands are still turning into pinned tabs, by the window they will be
     * pinned in (null: being closed or unpinned). Until the tab shows up pinned there, its
     * item keeps the binding, and no window adopts the tab as a new item.
     */
    pending?: ReadonlyMap<number, number | null>;
  },
): ReconcileResult {
  const pending = opts.pending ?? new Map<number, number | null>();
  const transfers: ReconcileResult['transfers'] = [];
  let out = layout;
  /** Copy-on-write: the input is returned as-is when nothing needed changing. */
  const own = (): WindowLayout => {
    // Ops results are already fresh copies; only the input itself must never be written.
    if (out === layout) {
      out = structuredClone(out);
    }
    return out;
  };

  // Rule 1: follow each bound tab. Field updates go on a single clone; removals reuse ops.
  const bound = new Set<number>();
  const removals: string[] = [];
  for (const orig of flattenItems(layout)) {
    if (orig.tabId === null) continue;
    const t = tabs.get(orig.tabId);
    if (pending.get(orig.tabId) === windowId && !(t?.pinned && t.windowId === windowId)) {
      bound.add(orig.tabId);
      continue;
    }
    // A second item claiming the same tab would make two tiles drive one tab.
    if (!t || bound.has(orig.tabId)) {
      setFields(own(), orig.id, { tabId: null });
      continue;
    }
    if (!t.pinned) {
      removals.push(orig.id);
      continue;
    }
    if (t.windowId !== windowId) {
      removals.push(orig.id);
      transfers.push({ windowId: t.windowId, item: structuredClone(orig) });
      continue;
    }
    bound.add(orig.tabId);
    if (orig.lastUrl !== t.url || orig.title !== t.title) {
      setFields(own(), orig.id, { lastUrl: t.url, title: t.title });
    }
  }
  for (const id of removals) out = removeItem(out, id);

  // Rule 2: pinned tabs no item knows about become plain items; rule 3 then places them.
  const budget = MAX_ITEMS - flattenItems(out).length;
  const fresh: PinItem[] = windowTabs
    .filter((t) => t.pinned && !bound.has(t.id) && !pending.has(t.id))
    .slice(0, Math.max(0, budget))
    .map((t) => ({
      kind: 'item',
      id: newId('i'),
      homeUrl: t.url,
      lastUrl: t.url,
      title: t.title,
      tabId: t.id,
    }));
  if (fresh.length > 0) {
    out = insertItems(out, fresh, { zone: 'pinned', folderId: null, index: out.pinned.length });
  }

  const pinnedIds = new Set(windowTabs.filter((t) => t.pinned).map((t) => t.id));
  const liveItems = (l: WindowLayout) =>
    flattenItems(l).filter((i) => i.tabId !== null && pinnedIds.has(i.tabId));

  // Rule 3: the user reordered in Chrome's strip; adopt that order.
  if (!opts.inFlight) out = adoptChromeOrder(out, windowTabs, liveItems(out));

  // Rule 4: whatever still differs is put right in Chrome.
  const firstUnpinned = windowTabs.find((t) => !t.pinned);
  const moves = planMoves(
    windowTabs.map((t) => t.id),
    liveItems(out).map((i) => i.tabId as number),
    firstUnpinned?.id ?? null,
  );

  const changed = out !== layout || transfers.length > 0;
  return { layout: changed ? out : layout, transfers, moves, changed };
}

function setFields(l: WindowLayout, id: string, patch: Partial<PinItem>): void {
  const it = flattenItems(l).find((i) => i.id === id);
  if (it) Object.assign(it, patch);
}

/**
 * Chrome-side reorder rule. The longest run of items already in Chrome's relative order
 * stays put, so one dragged tab moves one item rather than reshuffling everything. Each
 * other ("displaced") item, in Chrome order, goes directly after the item Chrome now
 * shows before it, taking that item's zone and folder; with no predecessor it goes
 * before the first item that stays put. Dormant items are never touched. When the
 * longest run is ambiguous (an adjacent swap), the item earlier in Chrome is kept.
 */
function adoptChromeOrder(
  l: WindowLayout,
  windowTabs: readonly TabInfo[],
  live: readonly PinItem[],
): WindowLayout {
  const byTab = new Map(live.map((i) => [i.tabId as number, i.id]));
  const chrome: string[] = [];
  for (const t of windowTabs) {
    const id = byTab.get(t.id);
    if (id !== undefined) chrome.push(id);
  }
  const layoutOrder = live.map((i) => i.id);
  if (chrome.every((id, k) => id === layoutOrder[k])) return l;

  const pos = new Map(chrome.map((id, k) => [id, k]));
  const kept = new Set(longestIncreasing(layoutOrder, (id) => pos.get(id) as number));

  let out = l;
  for (let k = 0; k < chrome.length; k++) {
    const id = chrome[k] as string;
    if (kept.has(id)) continue;
    // Chrome's first item has no predecessor; the items after it may be displaced too
    // (and will chain after it), so the first item that stays put is the stable anchor.
    const anchor = k > 0 ? chrome[k - 1] : chrome.find((c) => kept.has(c));
    if (anchor === undefined) continue;
    const dest = destNextTo(out, id, anchor, k > 0 ? 1 : 0);
    if (dest) out = moveNode(out, id, dest);
  }
  return out;
}

/** Destination beside `anchor` (offset 1 = after, 0 = before), indexed as if `id` were already removed. */
function destNextTo(l: WindowLayout, id: string, anchor: string, offset: 0 | 1): PinDest | null {
  const ess = l.essentials.filter((i) => i.id !== id);
  const ei = ess.findIndex((i) => i.id === anchor);
  if (ei >= 0) return { zone: 'essentials', index: ei + offset };
  const walk = (nodes: PinNode[], folderId: string | null): PinDest | null => {
    const rest = nodes.filter((n) => n.id !== id);
    const i = rest.findIndex((n) => n.id === anchor);
    if (i >= 0) return { zone: 'pinned', folderId, index: i + offset };
    for (const n of nodes) {
      if (n.kind === 'folder') {
        const hit = walk(n.children, n.id);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(l.pinned, null);
}

/** Elements of `xs` forming a longest subsequence with strictly increasing `key` (patience sort). */
function longestIncreasing<T>(xs: readonly T[], key: (x: T) => number): T[] {
  const tails: number[] = []; // index into xs of the smallest tail per length
  const prev: number[] = new Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    const v = key(xs[i] as T);
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key(xs[tails[mid] as number] as T) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }
  const res: T[] = [];
  for (
    let i = tails.length ? (tails[tails.length - 1] as number) : -1;
    i >= 0;
    i = prev[i] as number
  ) {
    res.push(xs[i] as T);
  }
  return res.reverse();
}
