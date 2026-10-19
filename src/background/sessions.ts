import { browser } from 'wxt/browser';
import {
  captureWindow,
  isRestorableUrl,
  MAX_SESSIONS,
  parseSessions,
  type SavedWindow,
  SESSIONS_KEY,
  type Session,
} from '../shared/sessions';
import type { GroupInfo, TabInfo } from '../shared/types';

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
  windows: { tabs: readonly TabInfo[]; groups: readonly GroupInfo[] }[],
): Promise<number> {
  const own = browser.runtime.getURL('/');
  const saved = windows
    .map((w) => captureWindow(w.tabs, w.groups, own))
    .filter((w) => w.tabs.length > 0);
  const count = saved.reduce((n, w) => n + w.tabs.length, 0);
  if (count === 0) return 0;
  const session: Session = { id: newId(), name, createdAt: Date.now(), windows: saved };
  // Newest first; the oldest fall off past the cap rather than failing the save.
  await mutate((list) => [session, ...list].slice(0, MAX_SESSIONS));
  return count;
}

export const renameSession = (id: string, name: string): Promise<void> =>
  mutate((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));

export const deleteSession = (id: string): Promise<void> =>
  mutate((list) => list.filter((s) => s.id !== id));

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

async function restoreWindow(
  w: SavedWindow,
  targetWindowId: number | null,
  discard: boolean,
): Promise<{ opened: number; skipped: number }> {
  const tabs = w.tabs.filter((t) => isRestorableUrl(t.url));
  const skipped = w.tabs.length - tabs.length;
  if (!tabs.length) return { opened: 0, skipped };

  const created: { id: number; group: number | null; active: boolean }[] = [];
  let windowId = targetWindowId;
  let rest = tabs;
  if (windowId === null) {
    const first = tabs[0] as (typeof tabs)[number];
    const win = await browser.windows.create({ url: first.url, focused: true });
    const firstTab = win?.tabs?.[0];
    if (!win?.id || firstTab?.id === undefined) return { opened: 0, skipped: w.tabs.length };
    windowId = win.id;
    if (first.pinned) await browser.tabs.update(firstTab.id, { pinned: true });
    created.push({ id: firstTab.id, group: first.group, active: true });
    rest = tabs.slice(1);
  }
  for (const t of rest) {
    const tab = await browser.tabs.create({
      windowId,
      url: t.url,
      pinned: t.pinned,
      active: false,
    });
    if (tab.id !== undefined) created.push({ id: tab.id, group: t.group, active: false });
  }

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
): Promise<string> {
  const session = (await readAll()).find((s) => s.id === id);
  if (!session) return 'That session no longer exists';
  let opened = 0;
  let skipped = 0;
  for (const [i, w] of session.windows.entries()) {
    // "Current window" applies to the first saved window; any others open in new windows.
    const into = target === 'currentWindow' && i === 0 ? currentWindowId : null;
    const r = await restoreWindow(w, into, discard);
    opened += r.opened;
    skipped += r.skipped;
  }
  const tabs = (n: number) => `${n} tab${n === 1 ? '' : 's'}`;
  return skipped
    ? `Restored ${tabs(opened)} from “${session.name}”; skipped ${tabs(skipped)} Chrome doesn't let extensions open`
    : `Restored ${tabs(opened)} from “${session.name}”`;
}
