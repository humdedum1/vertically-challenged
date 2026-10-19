# Vertically Challenged

Fast, customizable vertical tabs in Chrome's Side Panel. Local-first.

## Status

**Milestone 5: extras.** Everything from M1–M4, plus tab suspending (manual and on an idle timer), saved sessions, Bookmarks and History panels, recently closed tabs, a multi-window view, configurable shortcuts, and Chrome context menus.

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

`pnpm` equivalents: `pnpm dev`, `pnpm build`, `pnpm zip`, `pnpm check`, `pnpm lint`, `pnpm lint:fix`, `pnpm test`.

`npm install` runs `wxt prepare` automatically (postinstall) to generate WXT's type definitions.

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
| `src/background/` | Service worker: tab store, change batching, `chrome.tabs` event wiring |
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

Command keys (everything except arrows, Home/End, Enter, Space and Escape) can be rebound in Settings → Shortcuts.

## Themes

A theme is a JSON file in the [Noctalia](https://github.com/noctalia-dev/noctalia-shell) palette format: a `dark` and a `light` object, each with the same 16 roles (`mPrimary`, `mOnPrimary`, `mSecondary`, `mOnSecondary`, `mTertiary`, `mOnTertiary`, `mError`, `mOnError`, `mSurface`, `mOnSurface`, `mSurfaceVariant`, `mOnSurfaceVariant`, `mOutline`, `mShadow`, `mHover`, `mOnHover`), each an exact `#rrggbb` value. A single flat palette is also accepted and used for both modes.

- The default theme, Abyss, lives entirely in `src/themes/abyss.json`; replace that file to change it.
- `src/themes/token-mapper.ts` turns a theme into CSS custom properties. State layers, elevations and shadows are derived in `src/sidepanel/styles/base.css` with `color-mix()`, so themes only carry the 16 roles.
- Non-colour tokens (radius, density, font) come from settings, not the theme.
- A unit test asserts that every text/background pair in Abyss meets WCAG AA (4.5:1) in both modes.

Settings are versioned (`src/settings/schema.ts`). `migrateSettings` upgrades older data, validates every field, and reads settings written by a newer version best-effort instead of resetting them.

## Suspending, sessions and windows

- **Suspending** uses Chrome's native tab discarding: memory is freed and the tab reloads when you click it. Suspend from the tab's context menu, Chrome's page or toolbar menu, or a global shortcut. Auto-suspend (off by default) discards background tabs idle for a set time, skipping pinned and audible tabs and whitelisted sites. Only http(s) tabs are auto-suspended.
- **Sessions** save the current window or all windows (tabs, pinned state, groups) to `chrome.storage.local` and restore them into a new or the current window, optionally as suspended tabs so a large session doesn't load at once.
- **Multi-window view** (toggle in the Open tabs card) lists every window; drag tabs between windows or use "Move to window". Tabs can't move between incognito and normal windows.
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
| `storage` | Save settings in `chrome.storage.sync` (follows your Chrome profile); later, local data in `chrome.storage.local` |

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
