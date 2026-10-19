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
  incognito: boolean;
}

/** Changes for one window since the last flush. Empty fields are omitted on the wire. */
export interface WindowPatch {
  windowId: number;
  upserts?: TabInfo[];
  removed?: number[];
  /** Full tab-id order, sent only when it changed. */
  order?: number[];
}
