export interface ToolTab {
  id?: number;
  index: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  lastAccessed?: number;
}

export type SortKey = 'site' | 'title' | 'recent';

/** The URL without its #fragment, so in-page anchors of one page count as duplicates. */
const pageOf = (t: ToolTab): string => (t.pendingUrl || t.url || '').replace(/#.*$/, '');

/**
 * Tabs to close so each page is open once. The kept copy is the active tab, else a pinned
 * one, else the leftmost; pinned tabs are never closed. Blank pages aren't duplicates.
 */
export function duplicateTabIds(tabs: readonly ToolTab[]): number[] {
  const keep = new Map<string, ToolTab>();
  const rank = (t: ToolTab) => (t.active ? 0 : t.pinned ? 1 : 2);
  for (const t of [...tabs].sort((a, b) => rank(a) - rank(b) || a.index - b.index)) {
    const page = pageOf(t);
    if (page && !page.startsWith('chrome://newtab') && page !== 'about:blank' && !keep.has(page))
      keep.set(page, t);
  }
  const kept = new Set(keep.values());
  return tabs
    .filter((t) => t.id !== undefined && !t.pinned && !kept.has(t) && keep.has(pageOf(t)))
    .map((t) => t.id as number);
}

function siteKey(t: ToolTab): string {
  try {
    const u = new URL(pageOf(t));
    return u.hostname.replace(/^www\./, '') + u.pathname;
  } catch {
    return `~${pageOf(t)}`;
  }
}

/**
 * `tabs.move` calls that sort each run of neighbouring tabs that share a group (or are all
 * ungrouped), so sorting never moves a tab into or out of a group. Pinned tabs stay put.
 * `onlyGroup` limits it to one group. Apply the moves in order.
 */
export function sortMoves(
  tabs: readonly ToolTab[],
  by: SortKey,
  onlyGroup?: number,
): { id: number; index: number }[] {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const runs: ToolTab[][] = [];
  for (const t of ordered) {
    if (t.pinned || t.id === undefined) continue;
    if (onlyGroup !== undefined && t.groupId !== onlyGroup) continue;
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev && prev.groupId === t.groupId && prev.index === t.index - 1) run.push(t);
    else runs.push([t]);
  }
  const cmp = (a: ToolTab, b: ToolTab): number => {
    if (by === 'recent') return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    const ka = by === 'site' ? siteKey(a) : (a.title ?? '').toLocaleLowerCase();
    const kb = by === 'site' ? siteKey(b) : (b.title ?? '').toLocaleLowerCase();
    return ka.localeCompare(kb);
  };
  const moves: { id: number; index: number }[] = [];
  for (const run of runs) {
    const start = run[0]?.index ?? 0;
    const sorted = [...run].sort((a, b) => cmp(a, b) || a.index - b.index);
    sorted.forEach((t, i) => {
      if (t !== run[i]) moves.push({ id: t.id as number, index: start + i });
    });
  }
  return moves;
}
