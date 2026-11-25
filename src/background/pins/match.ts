/**
 * Restart matching: after a Chrome restart every tab and window id changes, so saved
 * layouts are re-attached by pinned-tab URLs and saved URLs from named windows.
 * Pure; the worker applies the result.
 */
import { flattenItems, MAX_ITEMS, type PinItem, type WindowLayout } from '../../shared/layout';

export interface PinnedTabLite {
  id: number;
  url: string;
  title: string;
}

export interface Match {
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
export function pair(
  items: readonly PinItem[],
  tabs: readonly PinnedTabLite[],
): Map<string, number> {
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

interface MatchWindow {
  windowId: number;
  incognito: boolean;
  pinned: readonly PinnedTabLite[];
  urls?: readonly string[];
}

/**
 * Assigns layouts to windows one-to-one. A pair qualifies when at least half the
 * window's pinned tabs find an item, so one shared site does not claim a whole layout.
 * Saved URLs break pinned-match ties and recover named windows without pins when a
 * strict majority overlaps. Ambiguous named windows stay unmatched.
 * Pinned tabs that another of the `open` windows also has cannot tell windows apart, so
 * saved URLs are compared without them, and then decide before the pinned tabs do.
 */
export function matchLayouts(
  layouts: readonly WindowLayout[],
  windows: readonly MatchWindow[],
  open: readonly MatchWindow[] = windows,
): Map<number, Match> {
  const flat = new Map(layouts.map((l) => [l.id, flattenItems(l)]));
  const candidates: {
    windowId: number;
    layout: WindowLayout;
    bind: Map<string, number>;
    overlap: number;
  }[] = [];
  const urlCandidates: typeof candidates = [];
  const copiedCandidates: typeof candidates = [];
  const pinnedUrls = open.map((w) => ({
    ...w,
    set: new Set(w.pinned.map((t) => normalise(t.url))),
  }));
  for (const w of windows) {
    const others = pinnedUrls.filter(
      (o) => o.windowId !== w.windowId && o.incognito === w.incognito,
    );
    const copied = new Set(
      w.pinned.map((t) => normalise(t.url)).filter((url) => others.some((o) => o.set.has(url))),
    );
    const own = (urls: readonly string[] = []) =>
      new Set(urls.map(normalise).filter((url) => !copied.has(url)));
    const need = Math.ceil(w.pinned.length / 2);
    for (const layout of layouts) {
      if (layout.incognito !== w.incognito) continue;
      const bind = pair(flat.get(layout.id) ?? [], w.pinned);
      const saved = own(layout.tabUrls);
      const live = own(w.urls?.slice(0, MAX_ITEMS));
      const overlap = [...live].filter((url) => saved.has(url)).length;
      const c = { windowId: w.windowId, layout, bind, overlap };
      const majority = layout.name && overlap > Math.max(saved.size, live.size) / 2;
      if (majority && copied.size > 0 && overlap >= 2) copiedCandidates.push(c);
      if (bind.size > 0 && bind.size >= need) candidates.push(c);
      else if (majority) urlCandidates.push(c);
    }
  }
  candidates.sort(
    (a, b) =>
      b.bind.size - a.bind.size ||
      b.overlap - a.overlap ||
      b.layout.lastUsed - a.layout.lastUsed ||
      a.windowId - b.windowId,
  );

  const out = new Map<number, Match>();
  const taken = new Set<string>();
  const matchUrls = (from: typeof candidates) => {
    const available = from.filter((c) => !out.has(c.windowId) && !taken.has(c.layout.id));
    available.sort((a, b) => b.overlap - a.overlap);
    for (const c of available) {
      if (out.has(c.windowId) || taken.has(c.layout.id)) continue;
      // Identical evidence cannot identify a window safely; never choose a name by id or recency.
      if (
        available.some(
          (other) =>
            other !== c &&
            !out.has(other.windowId) &&
            !taken.has(other.layout.id) &&
            other.overlap >= c.overlap &&
            (other.windowId === c.windowId || other.layout.id === c.layout.id),
        )
      )
        continue;
      out.set(c.windowId, { layoutId: c.layout.id, bind: c.bind });
      taken.add(c.layout.id);
    }
  };
  matchUrls(copiedCandidates);
  for (const c of candidates) {
    if (out.has(c.windowId) || taken.has(c.layout.id)) continue;
    if (
      c.layout.name &&
      c.layout.tabUrls?.length &&
      candidates.some(
        (other) =>
          other !== c &&
          !out.has(other.windowId) &&
          !taken.has(other.layout.id) &&
          other.bind.size === c.bind.size &&
          other.overlap === c.overlap &&
          (other.windowId === c.windowId || other.layout.id === c.layout.id),
      )
    )
      continue;
    out.set(c.windowId, { layoutId: c.layout.id, bind: c.bind });
    taken.add(c.layout.id);
  }
  matchUrls(urlCandidates);
  return out;
}
