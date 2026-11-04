import type { Plugin } from 'vite';
import { defineConfig } from 'wxt';

/**
 * Mozilla's validator warns about every `.innerHTML =`. Svelte's runtime does that in two places,
 * both on strings fixed at compile time (the markup of a template, and a one-off feature probe),
 * so nothing dynamic is involved. For the Firefox build they are rewritten to use DOMParser,
 * which parses the same way. It throws when Svelte's source no longer matches, so a Svelte upgrade
 * can't turn this into a silent no-op.
 */
function noInnerHtml(): Plugin {
  const edits: Record<string, [from: string, to: string][]> = {
    'svelte/src/internal/client/dom/reconciler.js': [
      [
        "\telem.innerHTML = create_trusted_html(html.replaceAll('<!>', '<!---->')); // XHTML compliance\n\treturn elem.content;",
        "\tvar doc = new DOMParser().parseFromString(\n\t\t'<!doctype html><body><template>' + html.replaceAll('<!>', '<!---->') + '</template>',\n\t\t'text/html'\n\t);\n\treturn document.importNode(/** @type {HTMLTemplateElement} */ (doc.querySelector('template')).content, true);",
      ],
    ],
    'svelte/src/internal/client/dom/elements/customizable-select.js': [
      [
        "\t\tvar select = create_element('select');\n\t\tselect.innerHTML = create_trusted_html('<option><span>t</span></option>');\n\t\tsupported = /** @type {Element} */ (select.firstChild)?.firstChild?.nodeType === 1;",
        "\t\tvar doc = new DOMParser().parseFromString(\n\t\t\t'<!doctype html><body><select><option><span>t</span></option></select>',\n\t\t\t'text/html'\n\t\t);\n\t\tvar select = doc.querySelector('select');\n\t\tsupported = /** @type {Element} */ (select?.firstChild)?.firstChild?.nodeType === 1;",
      ],
    ],
  };
  return {
    name: 'no-inner-html',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]?.replaceAll('\\', '/') ?? '';
      const key = Object.keys(edits).find((k) => file.endsWith(k));
      if (!key) return null;
      let out = code;
      for (const [from, to] of edits[key] ?? []) {
        if (!out.includes(from)) throw new Error(`no-inner-html: ${key} changed; update the edit`);
        out = out.replace(from, () => to);
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: ({ browser }) => ({ plugins: browser === 'firefox' ? [noInnerHtml()] : [] }),
  manifest: ({ browser }) => ({
    name: 'Vertically Challenged',
    description:
      browser === 'firefox'
        ? 'Fast, customizable vertical tabs in the sidebar or a window. Local-first, no telemetry.'
        : 'Fast, customizable vertical tabs in the side panel, a popup or a window. Local-first, no telemetry.',
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // Keep this id stable once published: AMO and storage.sync key on it.
              id: 'vertically-challenged@humdedum1.github.io',
              // 139 added the tabGroups API; 140 data_collection_permissions.
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
            // Android only supports data_collection_permissions from 142.
            gecko_android: { strict_min_version: '142.0' },
          },
          sidebar_action: {
            default_panel: 'sidepanel.html',
            default_title: 'Vertically Challenged',
          },
          // Match Chrome: usable in private windows when the user allows the extension there.
          incognito: 'spanning',
        }
      : { minimum_chrome_version: '116' }),
    // Each permission is justified; no host permissions are requested.
    permissions: [
      // Read tab titles/URLs (needed for the list and search) and switch/close tabs.
      'tabs',
      // Chrome only: the side panel and the chrome-extension://<id>/_favicon/ endpoint.
      // Firefox uses sidebar_action and tab.favIconUrl instead, and needs identity (Dropbox
      // sign-in) as a required permission.
      ...(browser === 'firefox' ? ['identity'] : ['sidePanel', 'favicon']),
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
      // In-page popup (Display setting): injecting the popup into the current tab, only
      // after the toolbar button, a shortcut or the toolbar menu was used on that tab.
      // Together they replace host permissions; no page is touched otherwise.
      'activeTab',
      'scripting',
    ],
    // Only when "Open on launch" is switched on: Chrome won't open the panel without a
    // user gesture, so launch shows a notification whose click opens it. `downloads` is only
    // requested when scheduled backups are switched on: they are saved to the Downloads folder.
    // `identity` is only for the Dropbox sign-in window (OAuth).
    // Block CSS network leaks through images, imports and fonts, including escaped tokens.
    // Inline styles are required by Svelte and the user's custom CSS.
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; img-src 'self' data:${
        // Firefox has no _favicon endpoint: favicons are the sites' own https icons.
        browser === 'firefox' ? ' https:' : ''
      }; style-src 'self' 'unsafe-inline'; font-src 'self'`,
    },
    optional_permissions: [
      'notifications',
      'downloads',
      // Firefox rejects identity as optional; it is a required permission there (no prompt).
      ...(browser === 'firefox' ? [] : ['identity']),
    ],
    // Remote backups (WebDAV, S3-compatible) talk to a server the user types in. Nothing is
    // granted at install: the panel requests exactly that server's origin when it is saved.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // The in-page popup frames the panel page. The dynamic URL changes every browser
    // session and is only known to the extension, so other sites can't frame the panel.
    web_accessible_resources: [
      {
        resources: ['sidepanel.html'],
        matches: ['<all_urls>'],
        // Firefox already serves extensions from a per-install random host.
        ...(browser === 'firefox' ? {} : { use_dynamic_url: true }),
      },
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
      'mru-back': {
        description: 'Switch to the previously used tab (press again to go further back)',
      },
      'mru-forward': { description: 'Switch forward through recently used tabs' },
    },
  }),
});
