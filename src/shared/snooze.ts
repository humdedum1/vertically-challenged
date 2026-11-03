import { isRestorableUrl } from './sessions';

export const SNOOZE_KEY = 'vc:snoozed';
export const MAX_SNOOZED = 200;
const MAX_URL = 8192;
const DAY = 86_400_000;

/** A tab put away until `wakeAt` (ms since the epoch), kept as just what reopening needs. */
export interface Snoozed {
  id: string;
  url: string;
  title: string;
  wakeAt: number;
  snoozedAt: number;
}

/** Validates what storage returns: ids, restorable URLs and sane times only. */
export function parseSnoozed(raw: unknown): Snoozed[] {
  if (!Array.isArray(raw)) return [];
  const out: Snoozed[] = [];
  for (const r of raw) {
    if (out.length >= MAX_SNOOZED) break;
    if (typeof r !== 'object' || r === null) continue;
    const s = r as Record<string, unknown>;
    if (typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id)) continue;
    if (typeof s.url !== 'string' || s.url.length > MAX_URL || !isRestorableUrl(s.url)) continue;
    if (!Number.isFinite(s.wakeAt) || !Number.isFinite(s.snoozedAt)) continue;
    out.push({
      id: s.id,
      url: s.url,
      title: typeof s.title === 'string' ? s.title.slice(0, 300) : '',
      wakeAt: s.wakeAt as number,
      snoozedAt: s.snoozedAt as number,
    });
  }
  return out;
}

/** Times worth offering, in local time: later today, tomorrow morning, Monday, next month. */
export function snoozePresets(now: Date): { label: string; at: number }[] {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x.getTime();
  };
  const tomorrow = new Date(now.getTime() + DAY);
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  const monday = new Date(now.getTime() + daysToMonday * DAY);
  const month = new Date(now);
  month.setMonth(month.getMonth() + 1);
  return [
    { label: 'In 3 hours', at: now.getTime() + 3 * 3_600_000 },
    { label: 'Tomorrow, 9:00', at: at(tomorrow, 9) },
    { label: 'Next Monday, 9:00', at: at(monday, 9) },
    { label: 'In a month', at: at(month, 9) },
  ];
}

/**
 * Which tabs to put away. A tab is closed only if its entry was kept (valid, and room is left),
 * so a tab that could not be stored is never lost. `stored` is how many entries exist already.
 */
export function planSnooze(
  tabs: readonly { id: number; url: string; title: string; incognito: boolean }[],
  stored: number,
  wakeAt: number,
  now: number,
  newId: () => string,
): { entries: Snoozed[]; tabIds: number[] } {
  const entries: Snoozed[] = [];
  const tabIds: number[] = [];
  for (const t of tabs) {
    if (t.incognito || !t.url || stored + entries.length >= MAX_SNOOZED) continue;
    const [entry] = parseSnoozed([
      { id: newId(), url: t.url, title: t.title, wakeAt, snoozedAt: now },
    ]);
    if (!entry) continue;
    entries.push(entry);
    tabIds.push(t.id);
  }
  return { entries, tabIds };
}

export const dueSnoozed = (list: readonly Snoozed[], now: number): Snoozed[] =>
  list.filter((s) => s.wakeAt <= now);

/** The wake time a panel message may carry: in the future, at most about a year out. */
export const isWakeTime = (v: unknown, now: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > now && v < now + 366 * DAY;
