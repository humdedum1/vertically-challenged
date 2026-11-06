import { browser } from 'wxt/browser';
import { togglePopupOverlay } from '../lib/popup-overlay';
import { PANEL_PAGE, POPUP_TOKEN_KEY, popupQuery } from '../shared/surface';

// Injected into the active tab with scripting.executeScript (activeTab), never declared as a
// content script, so the extension still needs no host permissions. See lib/popup-overlay.
export default defineUnlistedScript(async () => {
  const { settings } = (await browser.storage.sync.get('settings')) as {
    settings?: { display?: { closeOnClickOutside?: unknown } };
  };
  const closeOnClickOutside = settings?.display?.closeOnClickOutside !== false;
  // shortcut: one token for the latest popup, so an older popup refuses a reload; per-tab tokens if that matters.
  const token = crypto.randomUUID();
  await browser.storage.local.set({ [POPUP_TOKEN_KEY]: token });
  return togglePopupOverlay(
    `${browser.runtime.getURL(PANEL_PAGE)}${popupQuery(token)}`,
    closeOnClickOutside,
  );
});
