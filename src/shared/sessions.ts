import {
  FOLDER_ICONS,
  type FolderIcon,
  MAX_FOLDER_DEPTH,
  MAX_ITEMS,
  MAX_NAME,
  type PinNode,
  type WindowLayout,
} from './layout';
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

/** A pinned-tree node of a saved layout; `tab` indexes the SavedWindow's `tabs`. */
export type SavedPinNode =
  | { kind: 'item'; tab: number }
  | {
      kind: 'folder';
      name: string;
      icon: FolderIcon;
      collapsed: boolean;
      children: SavedPinNode[];
    };

/**
 * Which of a window's saved tabs were Essentials and which sat in pinned folders. Only
 * live items are saved (a session is a tab snapshot), so there are no dormant entries.
 */
export interface SavedLayout {
  essentials: number[];
  pinned: SavedPinNode[];
}

export interface SavedWindow {
  tabs: SavedTab[];
  groups: SavedGroup[];
  layout?: SavedLayout;
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
  layout?: WindowLayout,
): SavedWindow {
  const groupIndex = new Map<number, number>();
  const saved: SavedGroup[] = [];
  const out: SavedTab[] = [];
  /** Tab id → index in `out`, for the layout. */
  const indexOf = new Map<number, number>();
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
    indexOf.set(t.id, out.length);
    out.push({ url: t.url, title: t.title, pinned: t.pinned, group });
  }
  const savedLayout = layout && captureLayout(layout, out, indexOf);
  return savedLayout
    ? { tabs: out, groups: saved, layout: savedLayout }
    : { tabs: out, groups: saved };
}

/** The layout restricted to items whose pinned tab was captured; null when nothing is left. */
function captureLayout(
  layout: WindowLayout,
  tabs: readonly SavedTab[],
  indexOf: ReadonlyMap<number, number>,
): SavedLayout | null {
  const indexFor = (tabId: number | null): number | null => {
    const i = tabId === null ? undefined : indexOf.get(tabId);
    return i !== undefined && tabs[i]?.pinned ? i : null;
  };
  const walk = (nodes: PinNode[]): SavedPinNode[] => {
    const out: SavedPinNode[] = [];
    for (const n of nodes) {
      if (n.kind === 'item') {
        const tab = indexFor(n.tabId);
        if (tab !== null) out.push({ kind: 'item', tab });
        continue;
      }
      const children = walk(n.children);
      if (children.length) {
        out.push({ kind: 'folder', name: n.name, icon: n.icon, collapsed: n.collapsed, children });
      }
    }
    return out;
  };
  const essentials = layout.essentials
    .map((i) => indexFor(i.tabId))
    .filter((i): i is number => i !== null);
  const pinned = walk(layout.pinned);
  return essentials.length || pinned.length ? { essentials, pinned } : null;
}

export const ARCHIVE_ID = 'archive';
export const ARCHIVE_NAME = 'Archived tabs';
const MAX_ARCHIVED = 2000;

/**
 * Adds auto-archived tabs to the one "Archived tabs" session, as a single window so a
 * restore opens one window, not one per archive run. A URL archived again replaces its
 * older entry, and past the cap the oldest entries go first.
 */
export function withArchived(
  list: readonly Session[],
  add: readonly SavedWindow[],
  now: number,
): Session[] {
  const old = list.find((x) => x.id === ARCHIVE_ID);
  const groups: SavedGroup[] = [];
  const tabs: SavedTab[] = [];
  for (const w of [...(old?.windows ?? []), ...add]) {
    const offset = groups.length;
    groups.push(...w.groups);
    for (const t of w.tabs)
      tabs.push({ ...t, pinned: false, group: t.group === null ? null : t.group + offset });
  }
  const urls = new Set<string>();
  const kept: SavedTab[] = [];
  for (let i = tabs.length - 1; i >= 0 && kept.length < MAX_ARCHIVED; i--) {
    const t = tabs[i] as SavedTab;
    if (urls.has(t.url)) continue;
    urls.add(t.url);
    kept.push(t);
  }
  kept.reverse();
  const archive: Session = {
    id: ARCHIVE_ID,
    name: old?.name ?? ARCHIVE_NAME,
    createdAt: now,
    windows: kept.length ? [{ tabs: kept, groups }] : [],
  };
  const rest = list.filter((x) => x.id !== ARCHIVE_ID);
  return kept.length ? [archive, ...rest] : rest;
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
      /** Stored tab index → index after invalid tabs are dropped. */
      const remap = new Map<number, number>();
      for (const [at, t] of (Array.isArray(w.tabs) ? w.tabs : [])
        .slice(0, MAX_TABS_PER_WINDOW)
        .entries()) {
        if (!isObj(t) || typeof t.url !== 'string' || !t.url || t.url.length > MAX_URL) continue;
        const g = t.group;
        remap.set(at, tabs.length);
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
      if (!tabs.length) continue;
      const layout = parseLayout(w.layout, tabs, remap);
      windows.push(layout ? { tabs, groups, layout } : { tabs, groups });
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
 * Validates a saved layout against the window's (already parsed) tabs. Invalid parts are
 * dropped, never the whole session: out-of-range or repeated indices, tabs that were not
 * pinned, folders nested too deep (their contents move up) and items past the cap.
 */
function parseLayout(
  raw: unknown,
  tabs: readonly SavedTab[],
  remap: ReadonlyMap<number, number>,
): SavedLayout | null {
  if (!isObj(raw)) return null;
  const used = new Set<number>();
  let budget = MAX_ITEMS;
  const take = (v: unknown): number | null => {
    if (typeof v !== 'number' || budget <= 0) return null;
    const i = remap.get(v);
    if (i === undefined || used.has(i) || !tabs[i]?.pinned) return null;
    used.add(i);
    budget--;
    return i;
  };
  const essentials: number[] = [];
  for (const v of Array.isArray(raw.essentials) ? raw.essentials : []) {
    const i = take(v);
    if (i !== null) essentials.push(i);
  }
  /**
   * Folders nested deeper than MAX_FOLDER_DEPTH are flattened into their parent. That is
   * done with an explicit stack: crafted input can nest far deeper than the call stack.
   */
  const flatten = (list: unknown): SavedPinNode[] => {
    const out: SavedPinNode[] = [];
    const stack: { list: unknown[]; at: number }[] = [
      { list: Array.isArray(list) ? list : [], at: 0 },
    ];
    while (stack.length) {
      const top = stack[stack.length - 1] as { list: unknown[]; at: number };
      if (top.at >= top.list.length) {
        stack.pop();
        continue;
      }
      const n = top.list[top.at++];
      if (!isObj(n)) continue;
      if (n.kind === 'item') {
        const i = take(n.tab);
        if (i !== null) out.push({ kind: 'item', tab: i });
      } else if (n.kind === 'folder' && Array.isArray(n.children)) {
        stack.push({ list: n.children, at: 0 });
      }
    }
    return out;
  };
  /** `depth` is the depth of the folder holding `list`; 0 for the root. */
  const walk = (list: unknown, depth: number): SavedPinNode[] => {
    const out: SavedPinNode[] = [];
    for (const n of Array.isArray(list) ? list : []) {
      if (!isObj(n)) continue;
      if (n.kind === 'item') {
        const i = take(n.tab);
        if (i !== null) out.push({ kind: 'item', tab: i });
      } else if (n.kind === 'folder') {
        if (depth + 1 > MAX_FOLDER_DEPTH) {
          out.push(...flatten(n.children));
          continue;
        }
        const children = walk(n.children, depth + 1);
        if (children.length) {
          out.push({
            kind: 'folder',
            name: str(n.name, MAX_NAME).trim() || 'Folder',
            icon: (FOLDER_ICONS as readonly unknown[]).includes(n.icon)
              ? (n.icon as FolderIcon)
              : 'folder',
            collapsed: n.collapsed === true,
            children,
          });
        }
      }
    }
    return out;
  };
  const pinned = walk(raw.pinned, 0);
  return essentials.length || pinned.length ? { essentials, pinned } : null;
}

/**
 * URLs extensions can't open with chrome.tabs.create (or that would do something other
 * than show the page). Restore skips them and reports how many.
 */
export function isRestorableUrl(url: string): boolean {
  if (/^(javascript|data|file|chrome-error|devtools):/i.test(url)) return false;
  if (/^chrome:\/\/(kill|hang|crash|quit|restart|inducebrowsercrashforrealz)/i.test(url))
    return false;
  return /^(https?|chrome|chrome-extension|moz-extension|about|ftp):/i.test(url);
}

/**
 * Incognito windows never reach storage.local (Chrome itself doesn't persist them), so
 * save skips any window holding an incognito tab and reports how many it skipped.
 */
export function splitIncognito<T extends { tabs: readonly { incognito: boolean }[] }>(
  windows: readonly T[],
): { keep: T[]; skipped: number } {
  const keep = windows.filter((w) => !w.tabs.some((t) => t.incognito));
  return { keep, skipped: windows.length - keep.length };
}

/** The toast after a save; `count` is the saved tabs, `skipped` the incognito windows left out. */
export function saveSummary(name: string, count: number, skipped: number): string {
  if (count === 0) {
    return skipped > 0 ? "Incognito windows aren't saved" : 'Nothing to save in this window';
  }
  const base = `Saved “${name}” (${count} tab${count === 1 ? '' : 's'})`;
  return skipped > 0
    ? `${base} · ${skipped} incognito window${skipped === 1 ? '' : 's'} skipped`
    : base;
}
