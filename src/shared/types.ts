/**
 * The panel's view of a tab. Deliberately excludes `index`: a single move shifts
 * every index in the window, so position travels as a separate `order` array
 * and moves don't turn into N tab upserts.
 */
export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  muted: boolean;
  discarded: boolean;
  loading: boolean;
  /** -1 when ungrouped, mirroring chrome.tabGroups.TAB_GROUP_ID_NONE. */
  groupId: number;
  /** Browser-reported opener; absent once the opener no longer exists. */
  openerTabId?: number;
  incognito: boolean;
  /** When the tab was last active, rounded to the minute (tab age indicator). */
  lastAccessed?: number;
}

/** Chrome's fixed tab-group colour names. */
export const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface GroupInfo {
  id: number;
  windowId: number;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

/** Changes for one window since the last flush. Empty fields are omitted on the wire. */
export interface WindowPatch {
  windowId: number;
  upserts?: TabInfo[];
  removed?: number[];
  /** Full tab-id order, sent only when it changed. */
  order?: number[];
  /** Full group list for the window, sent only when it changed (windows have few groups). */
  groups?: GroupInfo[];
}

/** A normal browser window (popups and devtools windows are never listed). */
export interface WindowInfo {
  id: number;
  incognito: boolean;
  focused: boolean;
}
