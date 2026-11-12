import type { TabInfo } from './types';

/**
 * Firefox only, in storage.local: site origin -> the icon a normal tab of that site last
 * reported. Firefox has no favicon API, so bookmarks, history and Staples that aren't open in a
 * tab use their site's icon. Private tabs are never recorded.
 */
export const SITE_ICONS_KEY = 'siteIcons';
export const SITE_ICONS_MAX = 500;

export type SiteIcons = Record<string, string>;

function siteOf(url: string): string | null {
  if (!/^https?:/i.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function siteIcon(icons: ReadonlyMap<string, string>, pageUrl: string): string | undefined {
  const site = siteOf(pageUrl);
  return site ? icons.get(site) : undefined;
}

/** Adds the tabs' icons, newest last; drops the oldest sites past `max`. Null if unchanged. */
export function rememberIcons(
  stored: SiteIcons,
  tabs: readonly TabInfo[],
  max = SITE_ICONS_MAX,
): SiteIcons | null {
  const next = { ...stored };
  let changed = false;
  for (const t of tabs) {
    const site = t.incognito || !t.favIconUrl ? null : siteOf(t.url);
    if (!site || !t.favIconUrl || next[site] === t.favIconUrl) continue;
    delete next[site];
    next[site] = t.favIconUrl;
    changed = true;
  }
  if (!changed) return null;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}
