import {
  FOLDER_ICONS,
  type FolderIcon,
  MAX_ITEMS,
  MAX_NAME,
  type PinDest,
  type WindowLayout,
} from './layout';
import {
  GROUP_COLORS,
  type GroupColor,
  type GroupInfo,
  type TabInfo,
  type WindowInfo,
  type WindowPatch,
} from './types';

export const PANEL_PORT_NAME = 'vc-panel';

/**
 * Where a move lands. `beforeTabId` is resolved against the live order in the worker at
 * execution time (null = end of window), so a panel that is a few events behind can't
 * send a stale numeric index.
 */
export interface MoveTarget {
  windowId: number;
  beforeTabId: number | null;
  /** Group to end up in: a group id, -1 to leave any group, or null to keep membership. */
  groupId: number | null;
  /** Pin or unpin as part of the move; null leaves it unchanged. */
  pinned: boolean | null;
}

/** Panel → service worker. */
export type PanelMessage =
  /** `all` subscribes to every window (multi-window view); `windowId` is still the home window. */
  | { type: 'subscribe'; windowId: number; all: boolean }
  | { type: 'activate'; tabId: number }
  | { type: 'close'; tabIds: number[] }
  | { type: 'closeOthers'; tabId: number }
  | { type: 'closeBelow'; tabId: number }
  | { type: 'duplicate'; tabId: number }
  | { type: 'setPinned'; tabIds: number[]; pinned: boolean }
  | { type: 'setMuted'; tabIds: number[]; muted: boolean }
  | { type: 'newTab'; windowId: number; afterTabId: number | null }
  | { type: 'move'; tabIds: number[]; target: MoveTarget }
  | { type: 'moveGroup'; groupId: number; windowId: number; beforeTabId: number | null }
  | { type: 'group'; tabIds: number[]; groupId: number | null; title?: string; color?: GroupColor }
  | { type: 'ungroup'; tabIds: number[] }
  | {
      type: 'updateGroup';
      groupId: number;
      title?: string;
      color?: GroupColor;
      collapsed?: boolean;
    }
  | { type: 'closeGroup'; groupId: number }
  | { type: 'discard'; tabIds: number[] }
  | { type: 'discardOthers'; tabId: number }
  | { type: 'moveToNewWindow'; tabIds: number[] }
  | { type: 'saveSession'; scope: 'window' | 'all'; windowId: number; name: string }
  | { type: 'renameSession'; id: string; name: string }
  | { type: 'deleteSession'; id: string }
  | { type: 'restoreSession'; id: string; target: 'newWindow' | 'currentWindow'; windowId: number }
  /** Pins tabs from any window into `dest` of `windowId`'s layout, moving them across first. */
  | { type: 'pinTabs'; tabIds: number[]; windowId: number; dest: PinDest }
  | { type: 'pinMove'; windowId: number; nodeId: string; toWindowId: number; dest: PinDest }
  /** Activates the item's tab, or re-creates a dormant item's tab at its home URL in place. */
  | { type: 'pinOpen'; windowId: number; itemId: string }
  /** Discards the tabs but keeps the tiles; an active one hands focus to the next live tab. */
  | { type: 'pinClose'; windowId: number; itemIds: string[] }
  /** `unpin` leaves a normal tab at the start of the unpinned area; `close` closes it too. */
  | { type: 'pinRemove'; windowId: number; itemId: string; mode: 'unpin' | 'close' }
  | { type: 'pinHome'; windowId: number; itemId: string }
  | { type: 'pinSetHome'; windowId: number; itemId: string }
  | {
      type: 'folderCreate';
      windowId: number;
      name: string;
      dest: { zone: 'pinned'; folderId: string | null; index: number };
      itemIds: string[];
    }
  | {
      type: 'folderUpdate';
      windowId: number;
      folderId: string;
      name?: string;
      icon?: FolderIcon;
      collapsed?: boolean;
    }
  | { type: 'folderDelete'; windowId: number; folderId: string; keepTabs: boolean }
  | { type: 'folderSuspend'; windowId: number; folderId: string }
  /** Closes the window's unpinned tabs, grouped ones included, except the active tab. */
  | { type: 'clearTabs'; windowId: number }
  | { type: 'renameWindow'; windowId: number; name: string | null }
  /** `windowId` is the panel's own window; the collapse is remembered in its layout. */
  | { type: 'setWindowCollapsed'; windowId: number; otherWindowId: number; collapsed: boolean }
  | { type: 'setupOpen'; setupId: string }
  | { type: 'setupApply'; setupId: string; windowId: number }
  | { type: 'setupRename'; setupId: string; name: string }
  | { type: 'setupDelete'; setupId: string };

/** The layout commands; the worker runs these through the PinManager. */
export type PinMessage = Extract<
  PanelMessage,
  {
    type:
      | 'pinTabs'
      | 'pinMove'
      | 'pinOpen'
      | 'pinClose'
      | 'pinRemove'
      | 'pinHome'
      | 'pinSetHome'
      | 'folderCreate'
      | 'folderUpdate'
      | 'folderDelete'
      | 'folderSuspend'
      | 'clearTabs'
      | 'renameWindow'
      | 'setWindowCollapsed'
      | 'setupOpen'
      | 'setupApply'
      | 'setupRename'
      | 'setupDelete';
  }
>;

const PIN_TYPES = new Set<string>([
  'pinTabs',
  'pinMove',
  'pinOpen',
  'pinClose',
  'pinRemove',
  'pinHome',
  'pinSetHome',
  'folderCreate',
  'folderUpdate',
  'folderDelete',
  'folderSuspend',
  'clearTabs',
  'renameWindow',
  'setWindowCollapsed',
  'setupOpen',
  'setupApply',
  'setupRename',
  'setupDelete',
] satisfies PinMessage['type'][]);

export const isPinMessage = (m: PanelMessage): m is PinMessage => PIN_TYPES.has(m.type);

/** Service worker → panel. */
export type WorkerMessage =
  | {
      type: 'snapshot';
      windowId: number;
      tabs: TabInfo[];
      order: number[];
      groups: GroupInfo[];
    }
  | { type: 'patch'; patch: WindowPatch }
  /** Full window list; sent on subscribe and whenever windows open, close or change focus. */
  | { type: 'windows'; windows: WindowInfo[] }
  /** The "focus search" global shortcut opened or targeted this panel. */
  | { type: 'focusSearch' }
  /** Outcome of a command the user should hear about (e.g. tabs skipped on restore). */
  | { type: 'notice'; level: 'info' | 'error'; text: string }
  /** A window's full layout; sent on subscribe and whenever it changes. */
  | { type: 'layout'; windowId: number; layout: WindowLayout }
  /** Saved setups (layouts of closed windows), most recently used first. */
  | { type: 'setups'; setups: SetupSummary[] };

/** Enough of a saved setup to list it without shipping its whole tree. */
export interface SetupSummary {
  id: string;
  name: string;
  essentials: { url: string; title: string }[];
  itemCount: number;
  folderCount: number;
  lastUsed: number;
}

const MAX_IDS = 5000;
const MAX_TITLE = 200;
const MAX_SESSION_NAME = 100;
const isSessionId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v);
const isName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MAX_SESSION_NAME;

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isIdOrNull = (v: unknown): v is number | null => v === null || isId(v);
const isIds = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.length <= MAX_IDS && v.every(isId);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isColor = (v: unknown): v is GroupColor => GROUP_COLORS.includes(v as GroupColor);
const isTitle = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TITLE;

/** Item, folder and layout ids, as minted by newId. */
const isNodeId = (v: unknown): v is string =>
  typeof v === 'string' && /^[lif][a-z0-9]{10}$/.test(v);
const isNodeIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every(isNodeId);
const isTabIds = (v: unknown): v is number[] => isIds(v) && v.length <= MAX_ITEMS;
const isLayoutName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MAX_NAME;
const isIndex = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_ITEMS;

/** Whether the folder exists (and isn't too deep) is the layout's business, checked by the ops. */
function parseDest(v: unknown): PinDest | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  if (!isIndex(d.index)) return null;
  if (d.zone === 'essentials') return { zone: 'essentials', index: d.index };
  if (d.zone === 'pinned' && (d.folderId === null || isNodeId(d.folderId))) {
    return { zone: 'pinned', folderId: d.folderId, index: d.index };
  }
  return null;
}

function parsePinMessage(m: Record<string, unknown>): PinMessage | null {
  switch (m.type) {
    case 'pinTabs': {
      const dest = parseDest(m.dest);
      return isTabIds(m.tabIds) && isId(m.windowId) && dest
        ? { type: 'pinTabs', tabIds: m.tabIds, windowId: m.windowId, dest }
        : null;
    }
    case 'pinMove': {
      const dest = parseDest(m.dest);
      return isId(m.windowId) && isNodeId(m.nodeId) && isId(m.toWindowId) && dest
        ? {
            type: 'pinMove',
            windowId: m.windowId,
            nodeId: m.nodeId,
            toWindowId: m.toWindowId,
            dest,
          }
        : null;
    }
    case 'pinOpen':
    case 'pinHome':
    case 'pinSetHome':
      return isId(m.windowId) && isNodeId(m.itemId)
        ? { type: m.type, windowId: m.windowId, itemId: m.itemId }
        : null;
    case 'pinClose':
      return isId(m.windowId) && isNodeIds(m.itemIds)
        ? { type: 'pinClose', windowId: m.windowId, itemIds: m.itemIds }
        : null;
    case 'pinRemove':
      return isId(m.windowId) && isNodeId(m.itemId) && (m.mode === 'unpin' || m.mode === 'close')
        ? { type: 'pinRemove', windowId: m.windowId, itemId: m.itemId, mode: m.mode }
        : null;
    case 'folderCreate': {
      const dest = parseDest(m.dest);
      return isId(m.windowId) &&
        isLayoutName(m.name) &&
        dest?.zone === 'pinned' &&
        isNodeIds(m.itemIds)
        ? {
            type: 'folderCreate',
            windowId: m.windowId,
            name: m.name.trim(),
            dest,
            itemIds: m.itemIds,
          }
        : null;
    }
    case 'folderUpdate': {
      if (!isId(m.windowId) || !isNodeId(m.folderId)) return null;
      const out: PinMessage = { type: 'folderUpdate', windowId: m.windowId, folderId: m.folderId };
      if (isLayoutName(m.name)) out.name = m.name.trim();
      if (FOLDER_ICONS.includes(m.icon as FolderIcon)) out.icon = m.icon as FolderIcon;
      if (isBool(m.collapsed)) out.collapsed = m.collapsed;
      return out;
    }
    case 'folderDelete':
      return isId(m.windowId) && isNodeId(m.folderId) && isBool(m.keepTabs)
        ? { type: 'folderDelete', windowId: m.windowId, folderId: m.folderId, keepTabs: m.keepTabs }
        : null;
    case 'folderSuspend':
      return isId(m.windowId) && isNodeId(m.folderId)
        ? { type: 'folderSuspend', windowId: m.windowId, folderId: m.folderId }
        : null;
    case 'clearTabs':
      return isId(m.windowId) ? { type: 'clearTabs', windowId: m.windowId } : null;
    case 'renameWindow':
      return isId(m.windowId) && (m.name === null || isLayoutName(m.name))
        ? {
            type: 'renameWindow',
            windowId: m.windowId,
            name: m.name === null ? null : m.name.trim(),
          }
        : null;
    case 'setWindowCollapsed':
      return isId(m.windowId) && isId(m.otherWindowId) && isBool(m.collapsed)
        ? {
            type: 'setWindowCollapsed',
            windowId: m.windowId,
            otherWindowId: m.otherWindowId,
            collapsed: m.collapsed,
          }
        : null;
    case 'setupOpen':
    case 'setupDelete':
      return isNodeId(m.setupId) ? { type: m.type, setupId: m.setupId } : null;
    case 'setupApply':
      return isNodeId(m.setupId) && isId(m.windowId)
        ? { type: 'setupApply', setupId: m.setupId, windowId: m.windowId }
        : null;
    case 'setupRename':
      return isNodeId(m.setupId) && isLayoutName(m.name)
        ? { type: 'setupRename', setupId: m.setupId, name: m.name.trim() }
        : null;
    default:
      return null;
  }
}

function parseTarget(v: unknown): MoveTarget | null {
  if (typeof v !== 'object' || v === null) return null;
  const t = v as Record<string, unknown>;
  const groupOk = t.groupId === null || t.groupId === -1 || isId(t.groupId);
  const pinOk = t.pinned === null || isBool(t.pinned);
  if (!isId(t.windowId) || !isIdOrNull(t.beforeTabId) || !groupOk || !pinOk) return null;
  return {
    windowId: t.windowId,
    beforeTabId: t.beforeTabId,
    groupId: t.groupId as number | null,
    pinned: t.pinned as boolean | null,
  };
}

/**
 * Ports only carry messages from our own extension pages, but validating keeps a
 * buggy panel from passing garbage straight into chrome.tabs calls. Unknown fields are
 * dropped, optional fields are only kept when valid.
 */
export function parsePanelMessage(raw: unknown): PanelMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'subscribe':
      return isId(m.windowId)
        ? { type: 'subscribe', windowId: m.windowId, all: m.all === true }
        : null;
    case 'activate':
    case 'closeOthers':
    case 'closeBelow':
    case 'duplicate':
      return isId(m.tabId) ? { type: m.type, tabId: m.tabId } : null;
    case 'close':
    case 'ungroup':
      return isIds(m.tabIds) ? { type: m.type, tabIds: m.tabIds } : null;
    case 'setPinned':
      return isIds(m.tabIds) && isBool(m.pinned)
        ? { type: 'setPinned', tabIds: m.tabIds, pinned: m.pinned }
        : null;
    case 'setMuted':
      return isIds(m.tabIds) && isBool(m.muted)
        ? { type: 'setMuted', tabIds: m.tabIds, muted: m.muted }
        : null;
    case 'newTab':
      return isId(m.windowId) && isIdOrNull(m.afterTabId)
        ? { type: 'newTab', windowId: m.windowId, afterTabId: m.afterTabId }
        : null;
    case 'move': {
      const target = parseTarget(m.target);
      return isIds(m.tabIds) && target ? { type: 'move', tabIds: m.tabIds, target } : null;
    }
    case 'moveGroup':
      return isId(m.groupId) && isId(m.windowId) && isIdOrNull(m.beforeTabId)
        ? {
            type: 'moveGroup',
            groupId: m.groupId,
            windowId: m.windowId,
            beforeTabId: m.beforeTabId,
          }
        : null;
    case 'group': {
      if (!isIds(m.tabIds) || !isIdOrNull(m.groupId)) return null;
      const out: PanelMessage = { type: 'group', tabIds: m.tabIds, groupId: m.groupId };
      if (isTitle(m.title)) out.title = m.title;
      if (isColor(m.color)) out.color = m.color;
      return out;
    }
    case 'updateGroup': {
      if (!isId(m.groupId)) return null;
      const out: PanelMessage = { type: 'updateGroup', groupId: m.groupId };
      if (isTitle(m.title)) out.title = m.title;
      if (isColor(m.color)) out.color = m.color;
      if (isBool(m.collapsed)) out.collapsed = m.collapsed;
      return out;
    }
    case 'closeGroup':
      return isId(m.groupId) ? { type: 'closeGroup', groupId: m.groupId } : null;
    case 'discard':
    case 'moveToNewWindow':
      return isIds(m.tabIds) ? { type: m.type, tabIds: m.tabIds } : null;
    case 'discardOthers':
      return isId(m.tabId) ? { type: 'discardOthers', tabId: m.tabId } : null;
    case 'saveSession':
      return (m.scope === 'window' || m.scope === 'all') && isId(m.windowId) && isName(m.name)
        ? { type: 'saveSession', scope: m.scope, windowId: m.windowId, name: m.name.trim() }
        : null;
    case 'renameSession':
      return isSessionId(m.id) && isName(m.name)
        ? { type: 'renameSession', id: m.id, name: m.name.trim() }
        : null;
    case 'deleteSession':
      return isSessionId(m.id) ? { type: 'deleteSession', id: m.id } : null;
    case 'restoreSession':
      return isSessionId(m.id) &&
        (m.target === 'newWindow' || m.target === 'currentWindow') &&
        isId(m.windowId)
        ? { type: 'restoreSession', id: m.id, target: m.target, windowId: m.windowId }
        : null;
    default:
      return typeof m.type === 'string' && PIN_TYPES.has(m.type) ? parsePinMessage(m) : null;
  }
}
