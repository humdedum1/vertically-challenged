export interface Visit {
  id: string;
  lastVisitTime: number;
}

export type HistoryRow<T extends Visit> =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'item'; item: T };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local calendar day, so "Today" follows the user's clock, not UTC. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "Today", "Yesterday", else "Monday, Oct 12" (with the year when it isn't the current one). */
export function dayLabel(ts: number, now: number): string {
  const key = dayKey(ts);
  if (key === dayKey(now)) return 'Today';
  const n = new Date(now);
  // Built from calendar fields rather than subtracting 24h, which is wrong across DST changes.
  if (key === dayKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime()))
    return 'Yesterday';
  const d = new Date(ts);
  const year = d.getFullYear() === n.getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

/**
 * Interleaves day header rows into a newest-first list. Only consecutive items share a
 * header, so pages appended later (older) continue the list without re-sorting.
 */
export function withDayHeaders<T extends Visit>(items: readonly T[], now: number): HistoryRow<T>[] {
  const rows: HistoryRow<T>[] = [];
  let current: string | null = null;
  for (const item of items) {
    const key = dayKey(item.lastVisitTime);
    if (key !== current) {
      current = key;
      rows.push({ kind: 'day', key, label: dayLabel(item.lastVisitTime, now) });
    }
    rows.push({ kind: 'item', item });
  }
  return rows;
}
