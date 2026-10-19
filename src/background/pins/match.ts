/**
 * Restart matching: after a Chrome restart every tab and window id changes, so saved
 * layouts are re-attached to windows by comparing the restored pinned tabs' URLs with
 * the layouts' items. Pure; the worker applies the result.
 */
import { flattenItems, type PinItem, type WindowLayout } from '../../shared/layout';

export interface PinnedTabLite {
  id: number;
  url: string;
  title: string;
}

interface Match {
  layoutId: string;
  bind: Map<string, number>;
}

/** Fragments change without the page changing, so they never count. Unparseable URLs stay raw. */
function normalise(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

function originOf(url: string): string | null {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

/** Pairs a window's pinned tabs with a layout's items: exact URLs first, then same origin. */
function pair(items: readonly PinItem[], tabs: readonly PinnedTabLite[]): Map<string, number> {
  const keyed = items.map((item) => ({
    item,
    urls: [normalise(item.lastUrl), normalise(item.homeUrl)],
    origins: [originOf(item.lastUrl), originOf(item.homeUrl)],
  }));
  const bind = new Map<string, number>();
  const take = (tab: PinnedTabLite, hit: (k: (typeof keyed)[number]) => boolean): boolean => {
    const k = keyed.find((x) => !bind.has(x.item.id) && hit(x));
    if (!k) return false;
    bind.set(k.item.id, tab.id);
    return true;
  };

  const left: PinnedTabLite[] = [];
  for (const tab of tabs) {
    const u = normalise(tab.url);
    if (!take(tab, (k) => k.urls.includes(u))) left.push(tab);
  }
  for (const tab of left) {
    const o = originOf(tab.url);
    if (o !== null) take(tab, (k) => k.origins.includes(o));
  }
  return bind;
}

/**
 * Assigns layouts to windows one-to-one. A pair qualifies when at least half the
 * window's pinned tabs find an item, so one shared site does not claim a whole layout.
 * Candidates are taken best score first, then most recently used layout, then lowest
 * window id, which keeps the outcome deterministic.
 */
export function matchLayouts(
  layouts: readonly WindowLayout[],
  windows: readonly { windowId: number; incognito: boolean; pinned: readonly PinnedTabLite[] }[],
): Map<number, Match> {
  const flat = new Map(layouts.map((l) => [l.id, flattenItems(l)]));
  const candidates: { windowId: number; layout: WindowLayout; bind: Map<string, number> }[] = [];
  for (const w of windows) {
    if (w.pinned.length === 0) continue;
    const need = Math.ceil(w.pinned.length / 2);
    for (const layout of layouts) {
      if (layout.incognito !== w.incognito) continue;
      const bind = pair(flat.get(layout.id) ?? [], w.pinned);
      if (bind.size >= need) candidates.push({ windowId: w.windowId, layout, bind });
    }
  }
  candidates.sort(
    (a, b) =>
      b.bind.size - a.bind.size || b.layout.lastUsed - a.layout.lastUsed || a.windowId - b.windowId,
  );

  const out = new Map<number, Match>();
  const taken = new Set<string>();
  for (const c of candidates) {
    if (out.has(c.windowId) || taken.has(c.layout.id)) continue;
    out.set(c.windowId, { layoutId: c.layout.id, bind: c.bind });
    taken.add(c.layout.id);
  }
  return out;
}
