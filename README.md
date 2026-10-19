# Vertically Challenged

Fast, customizable vertical tabs in Chrome's Side Panel. Local-first.

## Status

**Milestone 1: scaffold and live vertical tab list.** The service worker tracks every tab in the browser and the side panel mirrors the current window.

Roadmap:

2. **Theme system and layout.** Themes, density, and row layout.
3. **Core tab management.** Pinned tabs, drag and drop, native tab groups, search.
4. **Customization settings.** Persisted settings via `chrome.storage`.
5. **Extras.** Tab suspension, sessions, bookmarks, history, multi-window, keyboard shortcuts, context menus.
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

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Read tab titles and URLs for the list and search, and switch or close tabs |
| `sidePanel` | Render the UI in Chrome's side panel and open it from the shortcut or toolbar icon |
| `favicon` | Load page favicons through `_favicon` without host permissions |

No host permissions are requested. `storage`, `tabGroups`, `sessions`, `bookmarks`, and `history` will be added only in the milestones that use them.

## Platform limits

- **Panel width.** The extension cannot set the side panel width. Drag the panel's edge to resize it.
- **Native tab strip.** The extension cannot hide Chrome's horizontal tab strip.
- **Restricted pages.** Chrome does not let extensions run on some pages. This does not affect the side panel, which is a browser UI, but `chrome://` and Chrome Web Store pages show a generic favicon.
- **Panel position.** Left or right placement is a Chrome setting: **Settings → Appearance → Side panel position**.

## Privacy

Vertically Challenged has no accounts, no telemetry, and no network requests. All data stays in the browser. Once settings land in milestone 4, they will be stored with `chrome.storage` on the local machine. Favicons come from Chrome's local cache.

## License

TBD
