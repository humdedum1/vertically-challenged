import { browser } from 'wxt/browser';
import { togglePopupOverlay } from '../lib/popup-overlay';
import { PANEL_PAGE, popupQuery } from '../shared/surface';

// Injected into the active tab with scripting.executeScript (activeTab), never declared as a
// content script, so the extension still needs no host permissions. See lib/popup-overlay.
export default defineUnlistedScript(async () => {
  const { settings } = (await browser.storage.sync.get('settings')) as {
    settings?: { display?: { closeOnClickOutside?: unknown } };
  };
  const closeOnClickOutside = settings?.display?.closeOnClickOutside !== false;
  return togglePopupOverlay(
    `${browser.runtime.getURL(PANEL_PAGE)}${popupQuery()}`,
    closeOnClickOutside,
  );
});
