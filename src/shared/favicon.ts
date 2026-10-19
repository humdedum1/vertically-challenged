import { browser } from 'wxt/browser';

/** Schemes Chrome's _favicon endpoint can't resolve; the panel shows a generic glyph. */
const NO_FAVICON =
  /^(chrome|chrome-extension|edge|about|devtools|view-source|file|data|javascript):/i;

/**
 * Uses the MV3 `favicon` permission endpoint instead of tab.favIconUrl: favIconUrl points
 * at the page's origin, which would need host permissions and leak a request per tab.
 */
export function faviconUrl(pageUrl: string, size = 16): string | null {
  if (!pageUrl || NO_FAVICON.test(pageUrl)) return null;
  // _favicon isn't a file in public/, so it's outside WXT's typed PublicPath union.
  const u = new URL(`chrome-extension://${browser.runtime.id}/_favicon/`);
  u.searchParams.set('pageUrl', pageUrl);
  // Request 2x so favicons stay sharp on HiDPI screens.
  u.searchParams.set('size', String(size * 2));
  return u.toString();
}
