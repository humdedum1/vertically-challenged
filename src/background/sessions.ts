import { browser } from 'wxt/browser';
import { mergeSessions } from '../backup/snapshot';
import type { WindowLayout } from '../shared/layout';
import {
  captureWindow,
  isRestorableUrl,
  MAX_SESSIONS,
  parseSessions,
  type SavedPinNode,
  type SavedWindow,
  SESSIONS_KEY,
  type Session,
  splitIncognito,
  withArchived,
} from '../shared/sessions';
import type { GroupInfo, TabInfo } from '../shared/types';
import type { RestoredLayout, RestoredNode } from './pins/pin-manager';

/** The slice of PinManager sessions use; optional so sessions work without layouts. */
export interface SessionLayouts {
  layoutOf(windowId: number): WindowLayout;
  restoreLayout(run: (report: (r: RestoredLayout) => void) => Promise<void>): Promise<void>;
}

/** Writes are queued so concurrent saves/renames can't lose each other's changes. */
let queue: Promise<unknown> = Promise.resolve();
function mutate(fn: (list: Session[]) => Session[]): Promise<void> {
  const run = queue.then(async () => {
    const list = parseSessions((await browser.storage.local.get(SESSIONS_KEY))[SESSIONS_KEY]);
    await browser.storage.local.set({ [SESSIONS_KEY]: fn(list) });
  });
  queue = run.catch(() => {});
  return run;
}

async function readAll(): Promise<Session[]> {
  await queue;
  return parseSessions((await browser.storage.local.get(SESSIONS_KEY))[SESSIONS_KEY]);
}

const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export async function saveSession(
  name: string,
  windows: { tabs: readonly TabInfo[]; groups: readonly GroupInfo[]; layout?: WindowLayout }[],
): Promise<{ count: number; skipped: number }> {
  const own = browser.runtime.getURL('/');
  const { keep, skipped } = splitIncognito(windows);
  const saved = keep
    .map((w) => captureWindow(w.tabs, w.groups, own, w.layout))
    .filter((w) => w.tabs.length > 0);
  const count = saved.reduce((n, w) => n + w.tabs.length, 0);
  if (count === 0) return { count, skipped };
  const session: Session = { id: newId(), name, createdAt: Date.now(), windows: saved };
  // Newest first; the oldest fall off past the cap rather than failing the save.
  await mutate((list) => [session, ...list].slice(0, MAX_SESSIONS));
  return { count, skipped };
}

/**
 * Saves tabs into the Archived tabs session. Resolves only once the write is stored, so the
 * caller can close the tabs knowing they can be restored. Incognito tabs are never saved.
 */
export async function archiveTabs(
  windows: { tabs: readonly TabInfo[]; groups: readonly GroupInfo[] }[],
): Promise<number> {
  const own = browser.runtime.getURL('/');
  const saved = splitIncognito(windows)
    .keep.map((w) => captureWindow(w.tabs, w.groups, own))
    .filter((w) => w.tabs.length > 0);
  const count = saved.reduce((n, w) => n + w.tabs.length, 0);
  if (count) await mutate((list) => withArchived(list, saved, Date.now()));
  return count;
}

export const renameSession = (id: string, name: string): Promise<void> =>
  mutate((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));

export const deleteSession = (id: string): Promise<void> =>
  mutate((list) => list.filter((s) => s.id !== id));

/** Saved sessions, newest first (for publishing to other devices). */
export const listSessions = (): Promise<Session[]> => readAll();

/** Keeps a copy of a session (another device's) here, under a new id, as the newest. */
/** Backup restore: adds sessions whose id isn't stored yet; never replaces or removes any. */
export async function addSessions(incoming: Session[]): Promise<number> {
  let added = 0;
  await mutate((list) => {
    const merged = mergeSessions(list, incoming);
    const had = new Set(list.map((s) => s.id));
    added = merged.filter((s) => !had.has(s.id)).length;
    return merged;
  });
  return added;
}

export const addSession = (session: Session): Promise<void> =>
  mutate((list) =>
    [{ ...session, id: newId(), createdAt: Date.now() }, ...list].slice(0, MAX_SESSIONS),
  );

/** Resolves once the tab has committed a real URL, so discarding it keeps that URL. */
function whenCommitted(tabId: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      browser.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: { url?: string; status?: string }) => {
      if (id === tabId && (info.url || info.status === 'complete')) done();
    };
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs.get(tabId).then((t) => {
      if (t.url && t.url !== 'about:blank') done();
    }, done);
  });
}

interface Created {
  id: number;
  /** Index into the saved window's `tabs`. */
  at: number;
  group: number | null;
  active: boolean;
}

/** The layout of a restored window, with saved tab indices swapped for the new tab ids. */
function restoredLayout(
  w: SavedWindow,
  windowId: number,
  created: Created[],
): RestoredLayout | null {
  if (!w.layout) return null;
  const byAt = new Map(created.map((c) => [c.at, c.id]));
  const item = (at: number): Extract<RestoredNode, { kind: 'item' }> | null => {
    const id = byAt.get(at);
    const t = w.tabs[at];
    return id === undefined || !t ? null : { kind: 'item', tabId: id, url: t.url, title: t.title };
  };
  const walk = (nodes: SavedPinNode[]): RestoredNode[] => {
    const out: RestoredNode[] = [];
    for (const n of nodes) {
      if (n.kind === 'item') {
        const i = item(n.tab);
        if (i) out.push(i);
      } else {
        const children = walk(n.children);
        if (children.length) out.push({ ...n, children });
      }
    }
    return out;
  };
  return {
    windowId,
    essentials: w.layout.essentials.map(item).filter((i) => i !== null),
    pinned: walk(w.layout.pinned),
  };
}

async function restoreWindow(
  w: SavedWindow,
  targetWindowId: number | null,
  discard: boolean,
  layouts?: SessionLayouts,
): Promise<{ opened: number; skipped: number }> {
  const tabs = w.tabs.map((t, at) => ({ ...t, at })).filter((t) => isRestorableUrl(t.url));
  const skipped = w.tabs.length - tabs.length;
  if (!tabs.length) return { opened: 0, skipped };

  const created: Created[] = [];
  let windowId = targetWindowId;
  const first = windowId === null ? (tabs[0] as (typeof tabs)[number]) : null;
  /** Creates the window around the first tab; false when Chrome didn't give one. */
  const openFirst = async (f: (typeof tabs)[number]): Promise<boolean> => {
    const win = await browser.windows.create({ url: f.url, focused: true });
    const firstTab = win?.tabs?.[0];
    if (!win?.id || firstTab?.id === undefined) return false;
    windowId = win.id;
    if (f.pinned) await browser.tabs.update(firstTab.id, { pinned: true });
    created.push({ id: firstTab.id, at: f.at, group: f.group, active: true });
    return true;
  };
  const openRest = async (list: typeof tabs): Promise<void> => {
    for (const t of list) {
      const tab = await browser.tabs.create({
        windowId: windowId as number,
        url: t.url,
        pinned: t.pinned,
        active: false,
      });
      if (tab.id !== undefined)
        created.push({ id: tab.id, at: t.at, group: t.group, active: false });
    }
  };
  // Chrome keeps pinned tabs in front, so they are created first and the rest after.
  const pinnedRest = tabs.filter((t) => t.pinned && t !== first);
  const plainRest = tabs.filter((t) => !t.pinned && t !== first);
  const openPinned = async (): Promise<void> => {
    if (first && !(await openFirst(first))) return;
    await openRest(pinnedRest);
  };
  if (w.layout && layouts) {
    // Only the pinned tabs are created inside the layout queue, where binding keeps them
    // from being adopted as plain items; the (possibly many) others are created after, so
    // the queue isn't held for every window while a large restore runs.
    await layouts.restoreLayout(async (report) => {
      try {
        await openPinned();
      } finally {
        if (windowId !== null) report(restoredLayout(w, windowId, created) as RestoredLayout);
      }
    });
  } else {
    await openPinned();
  }
  if (windowId !== null) await openRest(plainRest);
  if (windowId === null) return { opened: 0, skipped: w.tabs.length };

  for (const [i, g] of w.groups.entries()) {
    const ids = created.filter((c) => c.group === i).map((c) => c.id);
    if (!ids.length) continue;
    const groupId = await browser.tabs.group({
      tabIds: ids as [number, ...number[]],
      createProperties: { windowId },
    });
    await browser.tabGroups.update(groupId, {
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
    });
  }

  if (discard) {
    // Discard as each tab commits its URL; running them in parallel keeps a 200-tab
    // restore from waiting on the slowest page in sequence.
    await Promise.all(
      created
        .filter((c) => !c.active)
        .map((c) => whenCommitted(c.id).then(() => browser.tabs.discard(c.id).catch(() => {}))),
    );
  }
  return { opened: created.length, skipped };
}

/** Restores a saved session; returns a user-facing summary. */
export async function restoreSession(
  id: string,
  target: 'newWindow' | 'currentWindow',
  currentWindowId: number,
  discard: boolean,
  layouts?: SessionLayouts,
): Promise<string> {
  const session = (await readAll()).find((s) => s.id === id);
  if (!session) return 'That session no longer exists';
  return restoreSessionValue(session, target, currentWindowId, discard, layouts);
}

/** restoreSession for a session that isn't stored here (another device's). */
export async function restoreSessionValue(
  session: Session,
  target: 'newWindow' | 'currentWindow',
  currentWindowId: number,
  discard: boolean,
  layouts?: SessionLayouts,
): Promise<string> {
  let opened = 0;
  let skipped = 0;
  for (const [i, w] of session.windows.entries()) {
    // "Current window" applies to the first saved window; any others open in new windows.
    const into = target === 'currentWindow' && i === 0 ? currentWindowId : null;
    const r = await restoreWindow(w, into, discard, layouts);
    opened += r.opened;
    skipped += r.skipped;
  }
  const tabs = (n: number) => `${n} tab${n === 1 ? '' : 's'}`;
  return skipped
    ? `Restored ${tabs(opened)} from “${session.name}”; skipped ${tabs(skipped)} Chrome doesn't let extensions open`
    : `Restored ${tabs(opened)} from “${session.name}”`;
}
