# Vertically Challenged

Vertical tabs for Chrome, in the side panel or a popup over your current page. Organize windows with Essentials, pinned folders, tab groups, saved sessions, and themes.

**This is a vibecoded project.** AI coding tools have been used extensively to build it. It is a personal, experimental project: bugs happen, tests do not cover everything, and releases may need follow-up fixes. Reports, code review, and focused PRs are welcome. Keep backups of anything you cannot afford to lose.

[Releases](https://github.com/humdedum1/vertically-challenged/releases) · [Report a bug](https://github.com/humdedum1/vertically-challenged/issues/new/choose) · [Contribute](CONTRIBUTING.md)

## Quick start

Requires Chrome 116 or newer. Closing the side panel by shortcut needs Chrome 141 or newer.

To build and load it locally, install Node.js 22 or newer and npm, then:

```sh
git clone https://github.com/humdedum1/vertically-challenged.git
cd vertically-challenged
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose `.output/chrome-mv3`.
3. Click the extension's toolbar icon or press **Alt+Shift+V**.
4. Open Settings to choose your theme, display mode, layout, shortcuts, and sync timing.

For packaged builds, see the release's installation notes. A release ZIP may contain a signed CRX; extract it first. Chrome can restrict installation of extensions outside its Web Store. A CRX ZIP is different from an unpacked source ZIP and cannot be selected directly with Load unpacked.

The repository is currently private; GitHub links require access until it is made public.

## Features

| Feature | What it does |
| --- | --- |
| All-window tab list | Shows your normal windows together, with window names and active tabs. Incognito windows are kept separate. |
| Essentials | A compact grid for frequently used pages, with persistent home URLs and dormant tiles you can reopen. |
| Pinned tabs and folders | Arrange pins into nested folders, change folder icons, and drag items between sections or windows. |
| Child tabs | New tabs opened from another page can appear beneath their opener. Drag to nest or unnest tabs. |
| Native tab groups | Create, rename, recolor, collapse, and move Chrome groups. |
| Search | Find tabs by title and URL with fuzzy matching and keyboard navigation. |
| Multiple selection | Select ranges or individual tabs and act on them together. |
| Clear | Close ordinary tabs while keeping your Essentials and pinned layout. |
| Window setups | Save window names, Essentials, pins, and folder structures for reuse. |
| Saved sessions | Save windows or all windows and restore their tabs, groups, and live pinned layouts. |
| Other devices | Browse published workspaces and sessions, open or add them locally, and keep copies. |
| Suspend tabs | Discard tabs manually or after an idle interval, with pinned, audible, and site exclusions. Chrome reloads them when activated. |
| Bookmarks and history | Search and open saved bookmarks and visited pages from dedicated panels. |
| Recently closed | Reopen recently closed tabs and windows. |
| Themes | Built-in palettes, custom themes, accent colors, light/dark/system mode, import and export. |
| Appearance | Density, fonts, row layout, panel order, visible sections, and tab actions. |
| Shortcuts and context menus | Configurable in-panel shortcuts, Chrome commands, and browser context-menu actions. |
| Panel recovery | Reload the panel with the button beside colour mode, or from its context menu. |

### Keyboard and display

**Alt+Shift+V** toggles the panel. Change Chrome-level bindings at `chrome://extensions/shortcuts`; edit in-panel bindings in Settings. Search, selection, tab navigation, and context menus support the keyboard.

Choose the Chrome side panel or an in-page popup. On pages where Chrome disallows injection, the popup uses a separate window. In-page injection needs a user gesture and does not request access to every website.

## Sync and its limits

Sign in to the same Google account in Chrome on each computer and enable Chrome Sync for extensions. Install Vertically Challenged on each device. Chrome's own remote-tab list additionally needs its **Open tabs** sync setting.

- **Settings and custom themes** are stored directly in Chrome Sync and update when changed.
- **Open workspaces** publish ordinary tabs, groups, Essentials, pinned tabs, folders, and window names. Saved setups and sessions can also be shared.
- Choose **Manual only**, **1**, **5**, **15**, **30**, or **60 minutes** in Settings → Sync. This controls workspace/session publication; it does not control Google's delivery timing or settings/theme sync.
- **Sync now** publishes immediately. Automatic publication uses Chrome alarms so the extension's idle background worker can wake to sync. Alarms can run late when the computer sleeps.
- Published data appears under **Sessions → Other devices**. It does not automatically open or close tabs on another computer. Open or add a workspace when you want it; pinned tiles remain available to open on demand.
- **Keep here** saves a workspace's pinned layout as a setup. When it includes ordinary tabs, a full snapshot is also saved in Saved sessions.
- Incognito tabs are excluded. Extension pages are excluded from ordinary-tab capture. Device snapshots do not share browser tab IDs.
- Chrome Sync has about **100 KB total storage**, shared by settings, themes, and compressed device snapshots. Large collections may not fit. Settings shows storage errors and omitted snapshots; this is not an unlimited or complete backup service.

Updates and reloads preserve saved layouts when their live tabs can be identified. **Uninstalling removes the extension's local data.** Reinstalling is not a recovery method. Settings/theme export backs up settings and themes, not every tab, session, or folder.

## Updates and pull requests

Check [Releases](https://github.com/humdedum1/vertically-challenged/releases) for changes and downloads. For an unpacked install, rebuild into the same directory and use **Reload** on `chrome://extensions`; avoid removing and reinstalling to update.

Use a feature branch and submit a focused PR with the problem, resulting behavior, and checks actually run. AI-assisted contributions are welcome; contributors remain responsible for reviewing the code, protecting private data, and testing it. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

Versions follow Semantic Versioning and commit messages follow Conventional Commits. The existing GitHub Actions release workflow derives releases from changes on `main`; contributors should not bump versions, create release tags, or upload signing keys in ordinary PRs.

## Development

Built with TypeScript, Svelte 5, WXT, Vitest, and Biome. No new runtime service is required.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development browser and hot reload |
| `npm run build` | Production extension in `.output/chrome-mv3` |
| `npm run zip` | Package the unpacked extension as a ZIP, not a signed CRX |
| `npm run lint` | Formatting and lint checks |
| `npm run check` | Svelte and TypeScript checks |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Real Chromium flows against the built extension |
| `npm run bench:pure` | Pure-function performance benchmarks |

Browser test setup:

```sh
npx playwright-core install chromium
npm run build
npm run test:e2e
```

Tests use temporary browser profiles. Chromium or Chrome for Testing is required; branded Chrome ignores the test extension-loading flag. Set `CHROME_BIN` to use a compatible local binary. See [bench/README.md](bench/README.md) for profiling and benchmarks.

## Privacy and permissions

Local-first, with no analytics or project-operated sync server. Enabling sync sends the shared tab URLs, titles, workspace data, and settings through Chrome Sync. Local-first does not mean that synced data never leaves your computer.

Permissions support tab/window management, side panels, favicons, storage, groups, sessions, bookmarks, history, alarms, context menus, and user-triggered popup injection. Bookmarks and history remain Chrome-managed data; reading them in the panel does not put the whole browser history or bookmark library into workspace snapshots.

Do not paste private browsing data into issues. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Support the project

Donation links are not configured yet:

- Patreon: **placeholder — coming later**
- Ko-fi: **placeholder — coming later**
- Other donations: **placeholder — coming later**

Bug reports, testing, documentation fixes, and code review also help.

## License

[MIT](LICENSE). Third-party palettes retain their own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
