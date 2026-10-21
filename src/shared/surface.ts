/**
 * Where a panel page is shown. The same sidepanel.html serves all three:
 *   sidebar  Chrome's side panel (no query string)
 *   popup    an iframe floating over a web page (?surface=popup)
 *   window   a small popup window, used where a page can't host the overlay
 *            (?surface=window&windowId=N: the browser window it lists, since
 *            windows.getCurrent() would return the popup window itself)
 */
export type Surface = 'sidebar' | 'popup' | 'window';

export interface SurfaceInfo {
  surface: Surface;
  /** The browser window to list; null = the window the page itself is in. */
  windowId: number | null;
}

/** Message the popup iframe posts to its host page to close the overlay. */
export const POPUP_CLOSE = 'vc-popup-close';

export const PANEL_PAGE = '/sidepanel.html';

export const popupQuery = (): string => '?surface=popup';
export const windowQuery = (windowId: number): string => `?surface=window&windowId=${windowId}`;

export function parseSurface(search: string): SurfaceInfo {
  const q = new URLSearchParams(search);
  const surface = q.get('surface');
  if (surface === 'popup') return { surface, windowId: null };
  if (surface === 'window') {
    const raw = q.get('windowId');
    const id = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
    // Without a valid target window it would list its own popup window: show the side panel UI.
    return id === null ? { surface: 'sidebar', windowId: null } : { surface, windowId: id };
  }
  return { surface: 'sidebar', windowId: null };
}
