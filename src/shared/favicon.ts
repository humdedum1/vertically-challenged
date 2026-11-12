import { SvelteMap } from 'svelte/reactivity';
import { browser } from 'wxt/browser';
import { SITE_ICONS_KEY, siteIcon } from './site-icons';

/** Schemes with no favicon to resolve; the panel shows a generic glyph. */
const NO_FAVICON =
  /^(chrome|chrome-extension|moz-extension|edge|about|devtools|view-source|file|data|javascript):/i;

/** Firefox only: page URL -> the icon the browser reported for an open tab with that URL. */
const known = new Map<string, string>();

/** Firefox only: the worker's site icons (shared/site-icons.ts), reactive so rows update once read. */
const sites = new SvelteMap<string, string>();

/** Firefox only: reads the site icons and follows changes. Call once per panel page. */
export function loadSiteIcons(): void {
  const apply = (v: unknown) => {
    sites.clear();
    if (v && typeof v === 'object')
      for (const [site, icon] of Object.entries(v))
        if (typeof icon === 'string') sites.set(site, icon);
  };
  browser.storage.local.get(SITE_ICONS_KEY).then(
    (r) => apply(r[SITE_ICONS_KEY]),
    () => {},
  );
  browser.storage.local.onChanged.addListener((c) => {
    if (SITE_ICONS_KEY in c) apply(c[SITE_ICONS_KEY]?.newValue);
  });
}

/**
 * Chrome: the MV3 `favicon` permission endpoint, instead of tab.favIconUrl, which points at
 * the page's origin and would leak a request per tab.
 * Firefox has no such endpoint, so it uses the icon the browser reports for the tab (pass it
 * as `reported`; other panels get the icon of an open tab with the same URL, else the icon its
 * site last had in a normal tab, else the glyph).
 * That is a request to the site's own origin per icon, allowed by the Firefox CSP only.
 */
export function faviconUrl(pageUrl: string, size = 16, reported?: string): string | null {
  if (!pageUrl || NO_FAVICON.test(pageUrl)) return null;
  if (import.meta.env.FIREFOX) {
    if (reported) known.set(pageUrl, reported);
    return reported ?? known.get(pageUrl) ?? siteIcon(sites, pageUrl) ?? null;
  }
  // _favicon isn't a file in public/, so it's outside WXT's typed PublicPath union.
  const u = new URL(`chrome-extension://${browser.runtime.id}/_favicon/`);
  u.searchParams.set('pageUrl', pageUrl);
  // Request 2x so favicons stay sharp on HiDPI screens.
  u.searchParams.set('size', String(size * 2));
  return u.toString();
}
