/**
 * Panel commands on layouts: Essentials and pinned items, folders, Clear, window names
 * and saved setups. Layout edits go through the PinManager, the single writer; Chrome
 * calls go through `deps.chrome`, and their effects come back through the regular tab
 * events like every other command's.
 */
import {
  findNode,
  flattenItems,
  isLayoutUrl,
  MAX_ITEMS,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from '../../shared/layout';
import type { PinMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import type { CommandDeps } from '../commands';
import { canDiscardManually } from '../suspend/eligibility';
import { createFolder, deleteFolder, moveNode, removeItem, updateFolder } from './ops';
import type { PinManager } from './pin-manager';

const INCOGNITO_REFUSED = "Can't move tabs between incognito and normal windows";
const FULL = `A window holds at most ${MAX_ITEMS} pinned tabs`;

/** Returns the toast text, or null when there is nothing to tell the user. */
export async function runPinCommand(
  msg: PinMessage,
  pins: PinManager,
  deps: CommandDeps,
): Promise<string | null> {
  await pins.loaded;
  switch (msg.type) {
    case 'pinTabs':
      return pinTabs(msg.tabIds, msg.windowId, msg.dest, pins, deps);
    case 'pinMove':
      return pinMove(msg, pins, deps);
    case 'pinOpen':
      await openItem(msg.windowId, msg.itemId, pins, deps);
      return null;
    case 'pinClose':
      await closeItems(msg.windowId, msg.itemIds, pins, deps);
      return null;
    case 'pinRemove': {
      const it = itemOf(pins, msg.windowId, msg.itemId);
      if (!it) return null;
      const tabId = it.tabId;
      // Without the mark, the still-pinned tab would be adopted again as a new item the
      // moment its item is gone.
      if (tabId !== null) pins.expectGone([tabId]);
      await pins.mutate(msg.windowId, (l) => removeItem(l, msg.itemId));
      if (tabId === null) return null;
      try {
        // Chrome puts an unpinned tab at the start of the unpinned area.
        if (msg.mode === 'unpin') await deps.chrome.tabs.update(tabId, { pinned: false });
        else await deps.chrome.tabs.remove([tabId]);
      } catch (err) {
        await pins.dropPending([tabId]);
        throw err;
      }
      return null;
    }
    case 'pinHome': {
      const it = itemOf(pins, msg.windowId, msg.itemId);
      if (it?.tabId === null) await openItem(msg.windowId, msg.itemId, pins, deps);
      else if (it) await deps.chrome.tabs.update(it.tabId, { url: it.homeUrl });
      return null;
    }
    case 'pinSetHome': {
      const it = itemOf(pins, msg.windowId, msg.itemId);
      if (!it) return null;
      const url = (it.tabId !== null ? deps.tab(it.tabId)?.url : undefined) ?? it.lastUrl;
      // The stored layout drops items with other URLs (extension pages, data:, ...) on load.
      if (!isLayoutUrl(url)) return "This page can't be a pinned tab's home";
      await pins.mutate(msg.windowId, (l) => patchItem(l, msg.itemId, { homeUrl: url }));
      return null;
    }
    case 'folderCreate':
      await pins.mutate(
        msg.windowId,
        (l) => createFolder(l, msg.name, msg.dest, msg.itemIds).layout,
      );
      return null;
    case 'folderUpdate': {
      const { type: _t, windowId, folderId, ...patch } = msg;
      await pins.mutate(windowId, (l) => updateFolder(l, folderId, patch));
      return null;
    }
    case 'folderDelete': {
      const tabIds = msg.keepTabs ? [] : folderTabs(pins.layoutOf(msg.windowId), msg.folderId);
      pins.expectGone(tabIds);
      await pins.mutate(msg.windowId, (l) => deleteFolder(l, msg.folderId, msg.keepTabs).layout);
      if (tabIds.length) {
        try {
          await deps.chrome.tabs.remove(tabIds);
        } catch (err) {
          await pins.dropPending(tabIds);
          throw err;
        }
      }
      return null;
    }
    case 'folderSuspend': {
      const tabs = folderTabs(pins.layoutOf(msg.windowId), msg.folderId)
        .map((id) => deps.tab(id))
        .filter((t): t is TabInfo => t !== undefined && canDiscardManually(t));
      await Promise.all(tabs.map((t) => deps.chrome.tabs.discard(t.id).catch(() => {})));
      return null;
    }
    case 'clearTabs':
      return clearTabs(msg.windowId, deps);
    case 'renameWindow':
      await pins.mutate(msg.windowId, (l) => (l.name === msg.name ? l : { ...l, name: msg.name }));
      return null;
    case 'setWindowCollapsed': {
      // A window the store doesn't know would get an empty layout bound for nothing.
      if (!deps.windows('window', msg.otherWindowId)[0]?.tabs.length) return null;
      await pins.mutate(msg.windowId, (l) => {
        const other = pins.layoutOf(msg.otherWindowId).id;
        if (other === l.id || l.collapsed.includes(other) === msg.collapsed) return l;
        const collapsed = msg.collapsed
          ? [...l.collapsed, other]
          : l.collapsed.filter((id) => id !== other);
        return { ...l, collapsed };
      });
      return null;
    }
    case 'setupOpen': {
      if (!pins.hasSetup(msg.setupId)) return null;
      const win = await deps.chrome.windows.create({ focused: true });
      // The new tab page Chrome opens with the window stays as its normal tab.
      if (win?.id !== undefined) await pins.bindSetup(msg.setupId, win.id);
      return null;
    }
    case 'setupApply':
      return (await pins.applySetup(msg.setupId, msg.windowId)) ? null : FULL;
    case 'setupRename':
      await pins.renameSetup(msg.setupId, msg.name);
      return null;
    case 'setupDelete':
      await pins.deleteSetup(msg.setupId);
      return null;
  }
}

/** Reads outside the manager's queue: a command acts on what the panel showed. */
function itemOf(pins: PinManager, windowId: number, itemId: string): PinItem | null {
  const hit = findNode(pins.layoutOf(windowId), itemId);
  return hit?.node.kind === 'item' ? hit.node : null;
}

function patchItem(l: WindowLayout, itemId: string, patch: Partial<PinItem>): WindowLayout {
  const hit = findNode(l, itemId);
  if (hit?.node.kind !== 'item') return l;
  const out = structuredClone(l);
  const it = findNode(out, itemId)?.node as PinItem;
  Object.assign(it, patch);
  return out;
}

/** Live tabs of every item in the folder's subtree. */
function folderTabs(l: WindowLayout, folderId: string): number[] {
  const hit = findNode(l, folderId);
  if (hit?.node.kind !== 'folder') return [];
  const nodes: PinNode[] = [hit.node];
  return flattenItems({ ...l, essentials: [], pinned: nodes })
    .map((i) => i.tabId)
    .filter((id): id is number => id !== null);
}

async function focusWindow(windowId: number, deps: CommandDeps): Promise<void> {
  await deps.chrome.windows.update(windowId, { focused: true }).catch(() => {});
}

/** Activates the item's tab; a dormant item gets its tab re-created (see PinManager.openItem). */
async function openItem(
  windowId: number,
  itemId: string,
  pins: PinManager,
  deps: CommandDeps,
): Promise<void> {
  const it = itemOf(pins, windowId, itemId);
  if (!it) return;
  if (it.tabId === null && (await pins.openItem(windowId, itemId))) {
    await focusWindow(windowId, deps);
    return;
  }
  // Live, or it came alive while queued.
  const tabId = itemOf(pins, windowId, itemId)?.tabId;
  if (tabId === null || tabId === undefined) return;
  await deps.chrome.tabs.update(tabId, { active: true });
  await focusWindow(windowId, deps);
}

/**
 * Discards the items' tabs; tiles stay. Chrome can't discard the active tab, so focus
 * first moves to the next live tab in strip order (else the previous one).
 */
async function closeItems(
  windowId: number,
  itemIds: string[],
  pins: PinManager,
  deps: CommandDeps,
): Promise<void> {
  const closing = new Set(
    itemIds
      .map((id) => itemOf(pins, windowId, id)?.tabId)
      .filter((id): id is number => id !== null && id !== undefined),
  );
  const strip = deps.windows('window', windowId)[0]?.tabs ?? [];
  for (const id of closing) {
    const t = deps.tab(id);
    if (!t || t.discarded) continue;
    if (t.active) {
      const i = strip.findIndex((x) => x.id === id);
      const ok = (x: TabInfo) => !closing.has(x.id) && !x.discarded;
      const next = strip.slice(i + 1).find(ok) ?? strip.slice(0, Math.max(0, i)).findLast(ok);
      if (!next) continue;
      await deps.chrome.tabs.update(next.id, { active: true });
    }
    await deps.chrome.tabs.discard(id).catch(() => {});
  }
}

async function clearTabs(windowId: number, deps: CommandDeps): Promise<string> {
  // Live query: the store may be a flush behind on which tab is active.
  const tabs = await deps.chrome.tabs.query({ windowId });
  const ids = tabs
    .filter((t) => !t.pinned && !t.active)
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length === 0) return 'Nothing to clear';
  await deps.chrome.tabs.remove(ids);
  return ids.length === 1
    ? 'Closed 1 tab · restore it from Recently closed'
    : `Closed ${ids.length} tabs · restore them from Recently closed`;
}

async function pinTabs(
  tabIds: number[],
  windowId: number,
  dest: Parameters<PinManager['pinInto']>[1],
  pins: PinManager,
  deps: CommandDeps,
): Promise<string | null> {
  const incognito = pins.layoutOf(windowId).incognito;
  const tabs = tabIds.map((id) => deps.tab(id)).filter((t): t is TabInfo => t !== undefined);
  const ok = tabs.filter((t) => t.incognito === incognito);
  const refused = ok.length < tabs.length ? INCOGNITO_REFUSED : null;
  if (ok.length === 0) return refused;
  const todo = await pins.pinInto(windowId, dest, ok, []);
  if (todo === null) return isFull(pins, windowId, ok.length) ? FULL : refused;
  await bringIn(todo, windowId, pins, deps);
  return refused;
}

async function pinMove(
  msg: Extract<PinMessage, { type: 'pinMove' }>,
  pins: PinManager,
  deps: CommandDeps,
): Promise<string | null> {
  const { windowId, nodeId, toWindowId, dest } = msg;
  if (windowId === toWindowId) {
    await pins.mutate(windowId, (l) => moveNode(l, nodeId, dest));
    return null;
  }
  const hit = findNode(pins.layoutOf(windowId), nodeId);
  if (!hit) return null;
  if (hit.node.kind === 'folder') return "Folders can't be moved to another window";
  // Also keeps a dormant incognito item's URLs out of a layout that is saved to disk.
  if (pins.layoutOf(windowId).incognito !== pins.layoutOf(toWindowId).incognito) {
    return INCOGNITO_REFUSED;
  }
  const todo = await pins.pinInto(toWindowId, dest, [], [{ windowId, itemId: nodeId }]);
  if (todo === null) return isFull(pins, toWindowId, 1) ? FULL : null;
  await bringIn(todo, toWindowId, pins, deps);
  return null;
}

function isFull(pins: PinManager, windowId: number, adding: number): boolean {
  return flattenItems(pins.layoutOf(windowId)).length + adding > MAX_ITEMS;
}

/**
 * Moves tabs into the window, then pins them; the items already sit where they belong
 * and reconcile moves the tabs there. Sequential like setPinned in ../commands.ts:
 * Chrome appends each newly pinned tab to the pinned block. Moving a tab to another
 * window also takes it out of its tab group.
 */
async function bringIn(
  tabIds: number[],
  windowId: number,
  pins: PinManager,
  deps: CommandDeps,
): Promise<void> {
  const failed: number[] = [];
  for (const id of tabIds) {
    try {
      if (deps.tab(id)?.windowId !== windowId) {
        await deps.chrome.tabs.move(id, { windowId, index: -1 });
      }
      await deps.chrome.tabs.update(id, { pinned: true });
    } catch (err) {
      console.debug('[vc] pinning tab failed', id, err);
      failed.push(id);
    }
  }
  // Reconcile then treats them as it finds them, instead of waiting out the timeout.
  if (failed.length) await pins.dropPending(failed);
}
