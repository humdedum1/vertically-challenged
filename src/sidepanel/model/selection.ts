import type { TabInfo } from '../../shared/types';
import type { Row } from './rows';

/** Tab ids of the tab rows between two row indexes (inclusive, either order). */
export function tabIdsBetween(rows: readonly Row[], a: number, b: number): number[] {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(rows.length - 1, Math.max(a, b));
  const ids: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const r = rows[i];
    if (r?.kind === 'tab') ids.push(r.tab.id);
  }
  return ids;
}

/** Drops ids of closed tabs; returns the same Set instance when nothing changed. */
export function pruneSelection(
  selection: ReadonlySet<number>,
  tabs: readonly TabInfo[],
): ReadonlySet<number> {
  if (selection.size === 0) return selection;
  const alive = new Set(tabs.map((t) => t.id));
  const next = new Set<number>();
  for (const id of selection) if (alive.has(id)) next.add(id);
  return next.size === selection.size ? selection : next;
}
