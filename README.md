# Vertically Challenged

Fast, customizable vertical tabs in Chrome's Side Panel. Local-first.

## Status

**Milestone 5: extras, plus the Zen-style pinned system.** Everything from M1–M4, plus tab suspending (manual and on an idle timer), saved sessions, Bookmarks and History panels, recently closed tabs, configurable shortcuts, and Chrome context menus. On top of that: an Essentials grid, pinned tabs and folders, a Clear divider, saved window setups, and a panel that always shows every window.

Roadmap:

6. **Profiling.** Benchmarks against a 1,500-tab synthetic test.

## Requirements

- Node.js 20 or later (developed with Node 26)
- Chrome 116 or later. The shortcut opens the panel with `sidePanel.open`. Closing the panel with the shortcut requires Chrome 141 or later.

## Setup and scripts

```powershell
npm install
```

`pnpm` also works:

```powershell
pnpm install
```

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `npm run dev` | Launch a dev browser with hot reload (WXT) |
| `build` | `npm run build` | Build the extension to `.output\chrome-mv3` |
| `zip` | `npm run zip` | Build and package a distributable zip |
| `check` | `npm run check` | Type-check Svelte and TypeScript (`svelte-check`) |
| `lint` | `npm run lint` | Lint and format check (Biome) |
| `lint:fix` | `npm run lint:fix` | Apply Biome fixes |
| `test` | `npm test` | Run the Vitest suite once |
| `test:watch` | `npm run test:watch` | Run Vitest in watch mode |
| `test:e2e` | `npm run test:e2e` | Real-Chrome checks against the built extension (see below) |

`pnpm` equivalents: `pnpm dev`, `pnpm build`, `pnpm zip`, `pnpm check`, `pnpm lint`, `pnpm lint:fix`, `pnpm test`.

`npm install` runs `wxt prepare` automatically (postinstall) to generate WXT's type definitions.

### Real-Chrome checks

`tests/e2e/` holds scripts that load the built extension into a headless Chromium with a
throwaway profile and check it against Chrome's real tab state:

- `speedups.mjs`: after bursts of moves, new and closed tabs, moves between windows,
  group and pin changes and a suspended background script, the worker's updates and the
  panel's rows both match Chrome's tab order; a title change redraws only its row; search
  sees changes made before searching.
- `boot-handoff.mjs`: the panel still connects when its early connection is dropped, when
  the early script never ran, and when the background script is stopped at 30 different
  moments while the panel loads.

Google Chrome itself ignores `--load-extension`, so the scripts use Playwright's Chromium
(or any Chromium or Chrome for Testing binary in `CHROME_BIN`). One-time setup, then run:

```powershell
npx playwright-core install chromium
npm run build
npm run test:e2e
```

To test a different build or browser:

```powershell
$env:CHROME_BIN = "C:\path\to\chrome.exe"
node tests/e2e/speedups.mjs .output\chrome-mv3-dev
```

Each script prints `PASS`/`FAIL` lines and exits non-zero on any failure. They take under half a
minute each.

## Load unpacked

1. Build the extension:

   ```powershell
   npm run build
   ```

2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `.output\chrome-mv3` folder.
3. After rebuilding, click the reload icon on the extension's card in `chrome://extensions`.

Open the panel from the toolbar icon or with **Alt+Shift+V**. To change the shortcut, go to `chrome://extensions/shortcuts`.

For development, `npm run dev` launches a browser with the extension loaded and hot reload enabled.

## Architecture

- **The service worker owns the canonical tab state.** `TabStore` (`src/background/tab-store.ts`) holds every tab and the order of each window. The side panel is a thin mirror of it.
- **Events are batched.** Events from `chrome.tabs` are accumulated into a `ChangeSet` and flushed by a 16 ms batcher (`src/background/batcher.ts`). Service workers have no `requestAnimationFrame`, so a timer is used. Flushes never overlap.
- **Structural changes resync a window.** Create, move, attach, detach, replace, and pin or group changes mark the window for a resync through `chrome.tabs.query`. Title, URL, and state changes (`onUpdated`) and activations are applied incrementally.
- **The panel gets a snapshot, then diffs.** The panel connects over a long-lived `chrome.runtime` port named `vc-panel`, receives one snapshot, then small `WindowPatch` messages containing upserts, removed IDs, and the tab order only when it changes (`src/shared/protocol.ts`, `src/shared/types.ts`). The tab `index` is excluded from `TabInfo` on purpose: moving one tab shifts the index of many, and sending order as one array avoids a flood of upserts.
- **Suspension is safe because nothing is persisted.** Tab state is not stored. When the worker wakes, it re-reads all windows from the browser. The panel reconnects with backoff (50 ms, doubling, capped at 1 s) and receives a fresh snapshot.
- **Panel state uses `$state.raw`.** `TabState` (`src/sidepanel/tab-state.svelte.ts`) replaces changed `TabInfo` objects by reference, so keyed rendering updates only the rows that changed.
- **The list is virtualized.** `computeRange` in `src/lib/virtual-range.ts` renders only the visible rows at a fixed row height, plus overscan.
- **Favicons come from Chrome's cache.** `faviconUrl` (`src/shared/favicon.ts`) builds `chrome-extension://<id>/_favicon/?pageUrl=...` URLs. This needs no host permissions and makes no request to the site. Internal pages (`chrome://`, `about:`, `file:`, and similar) get a generic glyph.
- **Messages from the panel are validated.** `parsePanelMessage` rejects malformed messages before they reach `chrome.tabs`.

Directory map:

| Path | Contents |
| --- | --- |
| `src/entrypoints/` | WXT entrypoints: `background.ts` starts the service worker; `sidepanel/` holds the panel page |
| `src/background/` | Service worker: tab store, change batching, `chrome.tabs` event wiring; `pins/` holds layout reconciliation, restart matching and the layout commands |
| `src/sidepanel/` | Side panel state (`tab-state.svelte.ts`) and Svelte components (`components/`) |
| `src/shared/` | Code shared by both sides: message protocol, types, favicon URLs |
| `src/lib/` | Pure helpers, such as virtual list math |
| `src/themes/` | Theme definitions (milestone 2) |
| `src/settings/` | User settings (milestone 4) |
| `tests/` | Vitest unit tests for pure logic |
| `scripts/` | Build helpers, such as `generate-icons.mjs` |

## Keyboard

In the tab list (the Tabs panel):

| Key | Action |
| --- | --- |
| Up / Down, Home / End | Move focus |
| Left / Right | Collapse or expand a group; go to the parent group or first child |
| Enter | Switch to the tab, or toggle the group |
| Space, Shift+Up/Down, Ctrl+A | Select tabs |
| Delete | Close the selected or focused tabs |
| F2 | Rename the focused group |
| Alt+Up / Alt+Down | Move the tab, selection or group (crossing a group edge first joins or leaves it) |
| Shift+F10 or the Menu key | Context menu |
| `/` or Ctrl+F | Search; Enter opens the top result, Escape clears |

In the Essentials grid (one tab stop; the arrow keys rove between tiles):

| Key | Action |
| --- | --- |
| Left / Right, Home / End | Previous or next tile; first or last tile |
| Up / Down | The tile above or below (rows are measured, so a stretched last row works). Down from the last row goes to the list; Up from the first list row comes back |
| Enter or Space | Open the tile (activate it, or re-create a dormant one) |
| Alt+Left / Alt+Right | Move the tile one place |
| Delete | Suspend the tile's tab; the tile stays |
| Shift+F10 or the Menu key | Context menu |

In the list, pinned tabs and folders also respond to Alt+Up / Alt+Down, which moves the pin or folder one place; a pin at the edge of its folder leaves it, and a folder row's Left / Right collapse or expand it. Screen readers hear where the item went ("out of Work").

Command keys (everything except arrows, Home/End, Enter, Space and Escape) can be rebound in Settings → Shortcuts.

## Themes

A theme is a JSON file in the [Noctalia](https://github.com/noctalia-dev/noctalia-shell) palette format: a `dark` and a `light` object, each with the same 16 roles (`mPrimary`, `mOnPrimary`, `mSecondary`, `mOnSecondary`, `mTertiary`, `mOnTertiary`, `mError`, `mOnError`, `mSurface`, `mOnSurface`, `mSurfaceVariant`, `mOnSurfaceVariant`, `mOutline`, `mShadow`, `mHover`, `mOnHover`), each an exact `#rrggbb` value. A single flat palette is also accepted and used for both modes.

- The default theme, Abyss, lives entirely in `src/themes/abyss.json`; replace that file to change it.
- `src/themes/token-mapper.ts` turns a theme into CSS custom properties. State layers, elevations and shadows are derived in `src/sidepanel/styles/base.css` with `color-mix()`, so themes only carry the 16 roles.
- Non-colour tokens (radius, density, font) come from settings, not the theme.
- A unit test asserts that every text/background pair in Abyss meets WCAG AA (4.5:1) in both modes.

Settings are versioned (`src/settings/schema.ts`). `migrateSettings` upgrades older data, validates every field, and reads settings written by a newer version best-effort instead of resetting them.

## Essentials

The grid at the top of the panel is each window's Zen-style Essentials: small tinted tiles for the sites you always want one click away.

- Every Essential is a real Chrome pinned tab. The tile shows the favicon with the title as a tooltip, and a tint taken from the favicon's dominant colour (the theme's primary colour as a fallback). The active tile tints more strongly, glows and gets a bar along its bottom edge. A dormant tile (the tab is suspended or closed) goes neutral with a dimmed greyscale favicon. An audio badge shows when the tab plays or is muted.
- Tiles are at least 64 px wide and 48 px tall, with 12 px corners. Rows wrap and every row fills the width: with 4 + 1 tiles the lone one stretches across the row, with 4 + 2 each takes half. More columns appear as the panel widens. There is no limit on the count.
- Each Essential remembers a home URL. If the tab has navigated away, a hover button and a menu item go back to it ("Set this page as home" changes it).
- Closing from the panel (the Delete key, or the tile's menu) suspends the tab and keeps the tile. If the tab is really closed (Ctrl+W, a crash), the tile stays dormant and clicking it re-creates the tab at the right place.
- "Remove from Essentials" turns the tile into a normal pinned tab; a second action closes it.
- Drag a tab or pinned row into the grid to make it an Essential, reorder tiles by dragging, or drag a tile out to the pinned list or the normal list to demote it. Essentials belong to a window: a new window starts with none.

## Pinned tabs and folders

Below the grid are the window's pinned tabs. They behave like Essentials (home URL, close suspends, dormant entries persist) but show as rows.

- **Folders** live only in the pinned area. A folder has a name and an icon; click it to expand or collapse. A collapsed folder still shows the tab you are on. Folders nest up to three levels. Drag tabs in and out and drag folders to reorder or nest them. The menu renames, changes the icon, suspends everything in it or deletes it (keeping the tabs as plain pinned tabs, or closing them).
- Folders exist only in the extension; Chrome's tab strip shows their tabs as ordinary pinned tabs.
- Chrome's pinned order always equals the panel's order: Essentials in grid order, then the pinned tree depth-first. The worker keeps them in step, and a reorder you make in Chrome's tab strip is adopted by the panel. Pinning a tab in Chrome adds a plain pinned entry; unpinning removes it.
- Limits: 500 entries per window; folders three deep.

## Clear

A line below the pinned area marks where normal tabs start. Its **Clear** button closes every normal tab in the window, including tabs in Chrome tab groups, except the active one. Pinned tabs and Essentials are never touched. A toast points to Recently closed instead of offering an undo.

## Window setups

When a window that has Essentials, pinned tabs or folders closes, its layout is kept as a window setup. The same happens when Chrome starts without restoring a window. Setups are listed in the Sessions panel under **Window setups**, with the tiles and counts for each. Each can be opened in a new window (all entries dormant), applied to the current window (its Essentials and folders are added after what is already there), renamed or deleted. At most 50 are kept; when a new one would go past that, the one unused longest is removed and a toast says which. Saved sessions also record Essentials and folders, so restoring one rebuilds the layout.

After a Chrome restart, tab and window ids change, so the worker re-attaches saved layouts to restored windows by comparing the windows' pinned URLs with the layouts' entries; a window needs at least half its pinned tabs to match. A restored pinned tab that matches nothing becomes a new plain pinned entry. Chrome often restores windows, or a window's pinned tabs, a little after startup, so for the first minute after a restart a window that shows its first pinned tabs is still matched against the setups that are left, and a late pinned tab in an already matched window is paired with one of its dormant entries (same URL, then same site) instead of becoming a duplicate. After that minute, a newly opened window's pinned tabs are adopted as plain entries.

## All windows, always

The panel always lists every window; the old "Show all windows" toggle is gone (settings from earlier versions are migrated). Your own window comes first: Essentials grid, pinned tabs and folders, the Clear divider, then normal tabs. Every other window is a collapsible group below it with a header (its name, or its active tab's title, and the tab count), a smaller row of its Essentials, its pinned tabs and folders, then its normal tabs. Click any tab to focus that window and tab; rename a window from its header's menu.

- Collapse state is per panel: collapsing window B in A's panel does not change B's own panel. The worker remembers each panel's choice.
- Drag tabs between windows, including onto another window's Essentials row or folders, or use "Move to window".
- Incognito and normal windows are kept apart: an incognito panel lists only incognito windows and a normal panel only normal ones, tabs can't move between them, incognito layouts live only in `chrome.storage.session`, and an incognito panel keeps its Essentials' site colours in memory only, so no incognito URL or site is written to disk.

## Suspending, sessions and windows

- **Suspending** uses Chrome's native tab discarding: memory is freed and the tab reloads when you click it. Suspend from the tab's context menu, Chrome's page or toolbar menu, or a global shortcut. Auto-suspend (off by default) discards background tabs idle for a set time, skipping pinned and audible tabs and whitelisted sites. Only http(s) tabs are auto-suspended.
- **Sessions** save the current window or all windows (tabs, pinned state, groups) to `chrome.storage.local` and restore them into a new or the current window, optionally as suspended tabs so a large session doesn't load at once.
- **Shortcuts**: in-panel commands are configurable in Settings → Shortcuts. Browser-wide shortcuts (toggle panel, focus search, suspend tab, suspend other tabs) are set at `chrome://extensions/shortcuts`; only the panel toggle has a default (Alt+Shift+V).

## Customization

Settings (the Settings panel) apply live and sync through your Chrome profile:

- **Appearance:** colour mode, theme, density, row layout (single line or title + URL), corner radius, font family and size, accent colour.
- **Tab rows:** actions on hover or always visible; show or hide the close, mute and new-tab buttons and the tab count.
- **Layout:** order and visibility of panels and of the sections in the Tabs panel.
- **Themes:** duplicate any theme and edit all 16 roles for dark and light in the colour editor, with live preview and a WCAG contrast check. Import a Noctalia palette JSON file (including community palettes); export any theme back to Noctalia format.
- **Backup:** export settings and custom themes to one JSON file and import it on another machine.

Each custom theme is stored as its own `chrome.storage.sync` key because of Chrome's 8 KB per-item limit; up to 40 custom themes fit in the sync quota. Imported files are validated before use: colours must be exact `#rrggbb`, settings go through the same migration as stored ones, and invalid entries are skipped with a warning.

## Search

Search goes through the `SearchIndex` interface (`src/lib/search/search-index.ts`). The current implementation, `FuzzyIndex`, is a TypeScript linear scan over titles and URLs: every query word must match, whole-word and substring matches rank above scattered ones, and titles outweigh URLs. Queries take under 1 ms at 1,500 tabs, so there is no Rust/WASM build; one could replace `FuzzyIndex` without touching the UI.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Read tab titles and URLs for the list and search, and switch or close tabs |
| `sidePanel` | Render the UI in Chrome's side panel and open it from the shortcut or toolbar icon |
| `favicon` | Load page favicons through `_favicon` without host permissions |
| `tabGroups` | Show, create, rename, recolour, collapse and move native tab groups |
| `sessions` | Recently closed tabs and windows, and restoring them |
| `bookmarks` | The Bookmarks panel: read, open, search, add, delete |
| `history` | The History panel: read, search, delete entries |
| `alarms` | The auto-suspend timer. The worker is shut down when idle, so a timer can't run for 30 minutes; alarms survive and wake it |
| `contextMenus` | "Suspend this tab", "Save window as session" and similar items in Chrome's page and toolbar-icon menus |
| `storage` | Settings in `chrome.storage.sync` (follows your Chrome profile); saved sessions, pinned layouts and window setups in `chrome.storage.local`; incognito layouts and worker bookkeeping in `chrome.storage.session` |

No host permissions are requested.

## Platform limits

- **Panel width.** The extension cannot set the side panel width. Drag the panel's edge to resize it.
- **Native tab strip.** The extension cannot hide Chrome's horizontal tab strip.
- **Restricted pages.** Chrome does not let extensions run on some pages. This does not affect the side panel, which is a browser UI, but `chrome://` and Chrome Web Store pages show a generic favicon.
- **Panel position.** Left or right placement is a Chrome setting: **Settings → Appearance → Side panel position**.

## Privacy

Vertically Challenged has no accounts, no telemetry, and no network requests. All data stays in the browser. Once settings land in milestone 4, they will be stored with `chrome.storage` on the local machine. Favicons come from Chrome's local cache.

## License

TBD
