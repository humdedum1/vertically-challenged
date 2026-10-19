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
  | { type: 'restoreSession'; id: string; target: 'newWindow' | 'currentWindow'; windowId: number };

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
  | { type: 'notice'; level: 'info' | 'error'; text: string };

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
      return null;
  }
}
