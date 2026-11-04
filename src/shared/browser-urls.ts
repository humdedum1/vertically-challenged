/** Browser-internal pages the UI links to or recognises; they differ between Chrome and Firefox. */
const firefox = !!import.meta.env.FIREFOX;
export const FIREFOX = firefox;

export const SHORTCUTS_URL = firefox ? 'about:addons' : 'chrome://extensions/shortcuts';
export const APPEARANCE_URL = firefox ? 'about:preferences' : 'chrome://settings/appearance';
/** Where the user rebinds the panel toggle, for help text. */
export const SHORTCUTS_HINT = firefox
  ? 'about:addons (gear menu → Manage Extension Shortcuts)'
  : 'chrome://extensions/shortcuts';

/** The browser's blank new-tab page (also `pendingUrl` while it loads). */
export function isNewTabUrl(url: string | undefined): boolean {
  return !!url && /^(chrome:\/\/newtab|about:(newtab|home))(\/|$|[?#])/i.test(url);
}

/** Names for user-facing copy. */
export const BROWSER = firefox ? 'Firefox' : 'Chrome';
export const ACCOUNT = firefox ? 'Firefox account' : 'Google account';
