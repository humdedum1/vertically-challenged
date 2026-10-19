import { GROUP_COLORS, type GroupColor, type GroupInfo, type TabInfo } from './types';

export interface SavedTab {
  url: string;
  title: string;
  pinned: boolean;
  /** Index into the window's `groups`, or null. */
  group: number | null;
}

export interface SavedGroup {
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface SavedWindow {
  tabs: SavedTab[];
  groups: SavedGroup[];
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  windows: SavedWindow[];
}

export const SESSIONS_KEY = 'sessions';
export const MAX_SESSIONS = 200;
const MAX_TABS_PER_WINDOW = 5000;
const MAX_URL = 8192;

/**
 * Snapshot of one window. Group ids are per-browser-run, so groups are stored by
 * position and re-created on restore. Our own extension pages (the panel opened as a tab)
 * are left out: restoring them is pointless.
 */
export function captureWindow(
  tabs: readonly TabInfo[],
  groups: readonly GroupInfo[],
  ownOrigin: string,
): SavedWindow {
  const groupIndex = new Map<number, number>();
  const saved: SavedGroup[] = [];
  const out: SavedTab[] = [];
  for (const t of tabs) {
    if (!t.url || t.url.startsWith(ownOrigin)) continue;
    let group: number | null = null;
    if (t.groupId !== -1 && !t.pinned) {
      let i = groupIndex.get(t.groupId);
      if (i === undefined) {
        const g = groups.find((x) => x.id === t.groupId);
        if (g) {
          i = saved.length;
          saved.push({ title: g.title, color: g.color, collapsed: g.collapsed });
          groupIndex.set(t.groupId, i);
        }
      }
      group = i ?? null;
    }
    out.push({ url: t.url, title: t.title, pinned: t.pinned, group });
  }
  return { tabs: out, groups: saved };
}

export const sessionTabCount = (s: Session): number =>
  s.windows.reduce((n, w) => n + w.tabs.length, 0);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' ? v.slice(0, max) : fallback;

/**
 * Validates stored sessions. storage.local is only written by our worker, but sessions
 * may also arrive in an imported backup, and every URL here is later passed to
 * chrome.tabs.create. Invalid entries are dropped, not repaired.
 */
export function parseSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  const out: Session[] = [];
  for (const s of raw) {
    if (out.length >= MAX_SESSIONS) break;
    if (!isObj(s) || typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id)) continue;
    const windows: SavedWindow[] = [];
    for (const w of Array.isArray(s.windows) ? s.windows : []) {
      if (!isObj(w)) continue;
      const groups: SavedGroup[] = (Array.isArray(w.groups) ? w.groups : [])
        .filter(isObj)
        .map((g) => ({
          title: str(g.title, 200),
          color: GROUP_COLORS.includes(g.color as GroupColor) ? (g.color as GroupColor) : 'grey',
          collapsed: g.collapsed === true,
        }));
      const tabs: SavedTab[] = [];
      for (const t of (Array.isArray(w.tabs) ? w.tabs : []).slice(0, MAX_TABS_PER_WINDOW)) {
        if (!isObj(t) || typeof t.url !== 'string' || !t.url || t.url.length > MAX_URL) continue;
        const g = t.group;
        tabs.push({
          url: t.url,
          title: str(t.title, 500),
          pinned: t.pinned === true,
          group:
            Number.isInteger(g) && (g as number) >= 0 && (g as number) < groups.length
              ? (g as number)
              : null,
        });
      }
      if (tabs.length) windows.push({ tabs, groups });
    }
    if (!windows.length) continue;
    out.push({
      id: s.id,
      name: str(s.name, 100, 'Session').trim() || 'Session',
      createdAt: typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : 0,
      windows,
    });
  }
  return out;
}

/**
 * URLs extensions can't open with chrome.tabs.create (or that would do something other
 * than show the page). Restore skips them and reports how many.
 */
export function isRestorableUrl(url: string): boolean {
  if (/^(javascript|data|file|chrome-error|devtools):/i.test(url)) return false;
  if (/^chrome:\/\/(kill|hang|crash|quit|restart|inducebrowsercrashforrealz)/i.test(url))
    return false;
  return /^(https?|chrome|chrome-extension|about|ftp):/i.test(url);
}
