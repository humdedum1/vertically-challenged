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
    ],
    action: { default_title: 'Vertically Challenged' },
    commands: {
      'toggle-side-panel': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Open or close the vertical tab panel',
      },
    },
  },
});
