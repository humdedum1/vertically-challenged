/** Panel API calls the framed Firefox popup can't make itself; the background runs them. */
export const RELAY_METHODS = [
  'windows.getCurrent',
  'windows.create',
  'tabs.create',
  'tabs.query',
  'tabs.update',
  'bookmarks.getTree',
  'bookmarks.search',
  'bookmarks.create',
  'bookmarks.remove',
  'history.search',
  'history.deleteUrl',
  'sessions.getRecentlyClosed',
  'sessions.restore',
] as const;

export type RelayMethod = (typeof RELAY_METHODS)[number];

export interface RelayRequest {
  type: 'relay';
  method: RelayMethod;
  args: unknown[];
}

export type RelayResponse = { ok: true; value: unknown } | { ok: false; error: string };
