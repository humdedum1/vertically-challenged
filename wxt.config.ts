import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'Vertically Challenged',
    description: 'Fast, customizable vertical tabs in the side panel. Local-first, no telemetry.',
    minimum_chrome_version: '116',
    // Each permission is justified; no host permissions are requested.
    permissions: [
      // Read tab titles/URLs (needed for the list and search) and switch/close tabs.
      'tabs',
      // Render the UI in Chrome's side panel.
      'sidePanel',
      // Load page favicons via chrome-extension://<id>/_favicon/ without host permissions.
      'favicon',
      // Persist settings (sync, so they follow the user's Chrome profile) and later
      // local data such as layout and sessions.
      'storage',
      // Show, create, rename, recolour, collapse and move native tab groups.
      'tabGroups',
      // Recently closed tabs/windows and restoring them.
      'sessions',
      // The Bookmarks panel (read, open, search).
      'bookmarks',
      // The History panel (read, search, delete entries).
      'history',
      // Auto-suspend timer: the worker is shut down when idle, so setTimeout can't run a
      // 30-minute timer; alarms survive and wake it.
      'alarms',
      // "Suspend tab", "Save window as session" etc. in Chrome's page and toolbar menus.
      'contextMenus',
    ],
    action: { default_title: 'Vertically Challenged' },
    // Users rebind these at chrome://extensions/shortcuts; only the panel toggle gets a
    // default key so we don't collide with shortcuts users already rely on.
    commands: {
      'toggle-side-panel': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Open or close the vertical tab panel',
      },
      'focus-search': { description: 'Open the panel and search tabs' },
      'suspend-tab': { description: 'Suspend the current tab' },
      'suspend-other-tabs': { description: 'Suspend all other tabs in the window' },
    },
  },
});
