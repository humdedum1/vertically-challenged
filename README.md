<div align="center">

<img src="public/icon/128.png" alt="Vertically Challenged icon" width="128" height="128">

# Vertically Challenged

**A vertical tab list for Chrome and Firefox.**

It sits in the side panel (the sidebar on Firefox), floats over the page as a popup (Chrome only), or runs in its own window. Staples, pinned folders, tab groups, saved sessions and themes come with it.

[![CI](https://github.com/humdedum1/vertically-challenged/actions/workflows/checks.yml/badge.svg)](https://github.com/humdedum1/vertically-challenged/actions/workflows/checks.yml)
[![Release](https://img.shields.io/github/v/release/humdedum1/vertically-challenged?label=release&color=0071e3&labelColor=1d1d1f)](https://github.com/humdedum1/vertically-challenged/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-0071e3?labelColor=1d1d1f)](LICENSE)
![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-0071e3?logo=googlechrome&logoColor=white&labelColor=1d1d1f)
![Firefox 140+](https://img.shields.io/badge/Firefox-140%2B-0071e3?logo=firefoxbrowser&logoColor=white&labelColor=1d1d1f)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/humdedum1)
[![PayPal](https://img.shields.io/badge/PayPal-donate-00457C?logo=paypal&logoColor=white)](https://paypal.me/oddboxx)

[Install](#install) · [Features](#features) · [Shortcuts](#keyboard-shortcuts) · [Privacy](#privacy) · [Releases](https://github.com/humdedum1/vertically-challenged/releases) · [Report a bug](https://github.com/humdedum1/vertically-challenged/issues/new/choose) · [Contribute](CONTRIBUTING.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/store/readme-tabs-dark.png">
  <img src="docs/store/readme-tabs-light.png" alt="The tab list with child tabs and search" width="260">
</picture> <picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/store/readme-history-dark.png">
  <img src="docs/store/readme-history-light.png" alt="The History panel, grouped by day" width="260">
</picture> <picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/store/readme-settings-dark.png">
  <img src="docs/store/readme-settings-light.png" alt="Settings with every group collapsed" width="260">
</picture>

<sub>Tab list with child tabs and fuzzy search (type <code>&gt;</code> for commands) · History grouped by day · Settings with its own search. Noctalia theme, shown in your GitHub light or dark mode.</sub>

<table>
  <tr>
    <td align="center" width="50%"><b>Local-first</b><br><sub>No telemetry, no server run by the project</sub></td>
    <td align="center" width="50%"><b>Your choice of surface</b><br><sub>Pick it in Settings</sub></td>
  </tr>
  <tr>
    <td align="center"><b>No host permissions</b><br><sub>Nothing asked for at install</sub></td>
    <td align="center"><b>Free, MIT</b><br><sub>And it stays free</sub></td>
  </tr>
</table>
<!-- TODO: add Chrome Web Store version/users badges once the store listing exists. -->

</div>

> [!WARNING]
> This was mostly written with AI coding tools and has only been tested lightly. It has unit and end-to-end tests, but they've run on a handful of machines and profiles, so expect rough edges. Keep backups of anything you can't lose, and please report what breaks.
>
> Firefox support is newer and has had much less testing than Chrome. It has been checked mainly by an automated headless smoke test, not by people using it day to day, so there will be bugs I haven't found. Pull requests that fix Firefox problems are very welcome.

## Install

<table>
  <tr>
    <td valign="top" width="33%"><b>1. Get it</b><br>From Releases, or build it yourself.</td>
    <td valign="top" width="33%"><b>2. Open it</b><br>Click the toolbar icon or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.</td>
    <td valign="top" width="33%"><b>3. Make it yours</b><br>Theme, layout, shortcuts and sync are all in Settings.</td>
  </tr>
</table>

You need Chrome 116 or newer (141 to close the side panel with the shortcut), or Firefox 140 or newer.

- **Chrome Web Store:** not listed yet. <!-- TODO: add the Chrome Web Store listing URL once it exists. -->
- **Firefox:** download the signed `.xpi` from [Releases](https://github.com/humdedum1/vertically-challenged/releases) and open it in Firefox. There's no addons.mozilla.org listing yet.
- **Chrome, from Releases:** download `vertically-challenged-<version>-crx.zip` and extract the signed `.crx`. Chrome often blocks extensions from outside the Web Store. If it blocks this one, use an unpacked build instead. The zip isn't an unpacked folder, so Load unpacked won't accept it.
- **From source:** see [Build from source](#build-from-source).

## Features

<table>
  <tr>
    <td valign="top" width="50%">
      <b>Organize</b>
        <ul>
          <li><b>One list for every window.</b> Each normal window gets a name and its active tab. Incognito and private windows stay separate.</li>
          <li><b>Staples.</b> A compact grid of the pages you use all day, each with a fixed home URL. A closed tile reopens when you click it.</li>
          <li><b>Pinned tabs and folders.</b> Folders can nest, take custom icons, and be dragged between sections or windows.</li>
          <li><b>Child tabs.</b> A tab opened from a page can sit under it. Drag to nest or unnest.</li>
          <li><b>Tab groups.</b> Create, rename, recolor, collapse and move the browser's own groups.</li>
        </ul>
    </td>
    <td valign="top" width="50%">
      <b>Find and select</b>
        <ul>
          <li><b>Search.</b> Fuzzy search over titles and URLs, and over bookmarks, history, saved sessions and snoozed tabs. Settings has its own search box.</li>
          <li><b>Multi-select.</b> Pick a range or single tabs and act on them together.</li>
          <li><b>Bookmarks, history, recently closed.</b> Each has its own panel for searching and opening. Closed tabs and windows can be reopened.</li>
        </ul>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Declutter</b>
        <ul>
          <li><b>Clear.</b> Closes ordinary tabs. Staples and pins stay.</li>
          <li><b>Suspend tabs.</b> Discard tabs by hand or after a stretch of inactivity. Pinned and audible tabs and sites you pick can be excluded. The browser reloads a tab when you switch back to it.</li>
          <li><b>Snooze and park.</b> Put a tab away until later today, tomorrow, Monday or next month, or park it without a reminder. Snoozed tabs come back on time, even after a restart.</li>
          <li><b>Tidy up.</b> "Tidy up tabs…" in the command palette lists tabs you haven't touched for 7, 30 or 90 days, grouped by site, so you can park or close a whole site at once.</li>
        </ul>
    </td>
    <td valign="top">
      <b>Make it yours</b>
        <ul>
          <li><b>Themes and appearance.</b> Built-in and custom themes, accent colors, light, dark or system mode, import and export. You can also change density, fonts, row layout, panel order, which sections show and which actions each tab offers.</li>
          <li><b>Shortcuts and menus.</b> Rebind the in-panel shortcuts, the browser-level commands and the context-menu actions.</li>
          <li><b>Panel recovery.</b> Reload the panel from the button next to the color mode, or from its context menu.</li>
        </ul>
    </td>
  </tr>
  <tr>
    <td valign="top" colspan="2">
      <b>Save and move</b>
        <ul>
          <li><b>Window setups.</b> Save window names, Staples, pins and folders to reuse later.</li>
          <li><b>Saved sessions.</b> Save one window or all of them and restore the tabs, groups and pinned layout. Export as a Markdown outline or a bookmarks file.</li>
          <li><b>Other devices.</b> Browse workspaces and sessions from your other computers, open them, or keep a copy.</li>
          <li><b>Full backups.</b> Scheduled, optionally encrypted backups to Downloads, WebDAV (Nextcloud works), S3-compatible storage or Dropbox. You can restore from the server, undo a restore, and see a warning on the toolbar button if backups stop.</li>
        </ul>
    </td>
  </tr>
</table>

### Chrome and Firefox

Everything above should work on both, with these exceptions. Firefox is the less tested of the two (see the note at the top), and fixes for it are especially welcome.

| | Chrome | Firefox |
| --- | --- | --- |
| Where the panel opens | Side panel, in-page popup, or window | Sidebar or window |
| Synced tabs from other devices (Other devices) | Yes, Chrome's own list | No. Firefox has no API for it. Workspaces and sessions from this extension still sync. |
| Favicons | From the browser's cache | Loaded from each site's own server |
| Remote images in custom CSS | Blocked | Blocked, and a stylesheet that tries is left unapplied |

An in-page popup setting that arrives on Firefox through a backup opens the window instead. Firefox doesn't give a page that's embedded in a website the tabs and windows APIs the panel needs.

## Keyboard shortcuts

<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> opens and closes the panel. Search, selection, tab navigation and context menus all work from the keyboard. Rebind the in-panel shortcuts in Settings. To rebind the browser-level commands below, use `chrome://extensions/shortcuts` in Chrome, or Settings → Shortcuts in Firefox, which opens Firefox's own shortcut manager.

| Command | Default |
| --- | --- |
| Open or close the panel | Alt+Shift+V |
| Open the panel with search focused | Unassigned |
| Suspend the current tab | Unassigned |
| Suspend the other tabs in the window | Unassigned |
| Switch to the previously used tab (press again to go further back) | Unassigned |
| Switch forward through recently used tabs | Unassigned |

On Chrome, the popup only injects into a page after you click the toolbar button or press a shortcut on that tab, so the extension never needs access to every site. Where Chrome blocks injection, the popup opens in its own window.

## Sync and its limits

Sync goes through your browser's own sync, which means Chrome Sync or Firefox Sync. Chrome and Firefox don't share data with each other.

Sign in to the same account on each computer, turn on sync for extensions, and install the extension on all of them. Settings and themes sync as soon as they change. Open workspaces publish on a schedule you set, from manual to every 60 minutes. On Chrome, the browser's own remote-tab list also needs its Open tabs sync setting turned on.

<details>
<summary>How it works, and the limits</summary>

- Open workspaces publish ordinary tabs, groups, Staples, pins, folders and window names. Saved setups and sessions can be shared too. Settings → Sync sets how often: manual, or every 1, 5, 15, 30 or 60 minutes. Sync now publishes immediately. Scheduled runs use browser alarms, so they can fire late while the computer sleeps. The interval doesn't change how fast settings and themes sync, or how fast Google or Mozilla delivers the data.
- Published data shows up under Sessions → Other devices. Nothing opens or closes on the other computer by itself. "Keep here" saves a workspace's pinned layout as a setup, plus a full snapshot in Saved sessions if it has ordinary tabs.
- Incognito and private tabs and extension pages are never captured, and snapshots don't carry browser tab IDs.
- Chrome's sync storage holds about 100 KB in total for settings, themes and compressed snapshots, so a big collection may not fit. Settings shows storage errors and skipped snapshots. I haven't measured Firefox's limit, but the extension budgets the same way. For real backups, use Full backups.

File backups cover settings, custom themes, Staples, pins, nested folders and window setups. They don't cover incognito layouts. Importing adds layouts under Sessions → Window setups without touching open windows or existing setups, and older settings-only backups still import. Updates and reloads keep saved layouts when their tabs can be matched. Uninstalling deletes the extension's local data for good, and reinstalling won't bring it back.

</details>

## Permissions

No host permissions are requested at install.

<details>
<summary>Every permission and why</summary>

| Permission | Why |
| --- | --- |
| `tabs` | Titles and URLs for the list and search, and switching and closing tabs. |
| `sidePanel` (Chrome) | Show the UI in Chrome's side panel. Firefox uses its sidebar instead, which needs no permission. |
| `favicon` (Chrome) | Load favicons without host permissions. |
| `storage` | Settings (synced), plus local layouts and sessions. |
| `tabGroups` | Manage the browser's native tab groups. |
| `sessions` | Recently closed tabs and windows. |
| `bookmarks` | The Bookmarks panel. |
| `history` | The History panel: read, search and delete. |
| `alarms` | Auto-suspend and scheduled sync. The background page sleeps when idle, so `setTimeout` can't be relied on. |
| `contextMenus` | Items like "Suspend tab" and "Save window as session" in the browser's menus. |
| `activeTab`, `scripting` | Chrome's in-page popup is injected into the current tab, after you invoke it there. |
| `notifications` (optional) | Only for Open on launch. Chrome won't open the side panel without a user gesture, so a notification does it on click. |
| `downloads` (optional) | Only for automatic backups to Downloads. |
| Server address (optional) | Only for WebDAV, S3-compatible or Dropbox backups, and only the one address you enter. |
| `identity` (optional on Chrome) | Only for Dropbox sign-in, with your own Dropbox app key. No shared credentials ship with the extension. Firefox doesn't allow `identity` as optional, so it's declared at install there. |

</details>

## Build from source

You need Node.js 22 or newer and npm.

```sh
git clone https://github.com/humdedum1/vertically-challenged.git
cd vertically-challenged
npm ci
npm run build            # Chrome, into .output/chrome-mv3
npm run build:firefox    # Firefox, into .output/firefox-mv3
```

**Chrome:** open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick `.output/chrome-mv3`. To update, rebuild into the same folder and click Reload.

**Firefox:** open `about:debugging`, choose This Firefox, click Load Temporary Add-on and pick `.output/firefox-mv3/manifest.json`. A temporary add-on goes away when Firefox closes. Release builds are signed, which is the only way to keep an add-on installed in regular Firefox.

## Development and testing

TypeScript, Svelte 5, WXT, Vitest, Playwright, Selenium and Biome.

<details>
<summary>Commands and end-to-end setup</summary>

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev browser with hot reload |
| `npm run build` | Production build in `.output/chrome-mv3` |
| `npm run build:firefox` | Production build in `.output/firefox-mv3` |
| `npm run start:firefox` | Build for Firefox and run it with web-ext (`WEB_EXT_FIREFOX` is the Firefox binary) |
| `npm run zip` / `zip:firefox` | Zip a build (not a signed CRX or XPI) |
| `npm run pack:crx` | Signed CRX in a release ZIP (needs the signing key, see [CONTRIBUTING.md](CONTRIBUTING.md)) |
| `npm run lint` | Formatting and lint |
| `npm run check` | Svelte and TypeScript checks |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Real Chromium runs against the built extension |
| `npm run test:e2e:firefox` | Headless Firefox smoke test (`FIREFOX_BIN` is a Firefox 140+ binary) |
| `npm run bench:pure` | Pure-function benchmarks |

```sh
npx playwright-core install chromium
npm run build
npm run test:e2e
```

The Chromium tests use throwaway profiles and need Chromium or Chrome for Testing, because branded Chrome ignores the flag that loads test extensions. Set `CHROME_BIN` to use your own binary. The Firefox test loads the unpacked build as a temporary add-on. Firefox won't run injected script files from a temporary add-on, so the test can't cover anything that depends on that. `node tests/e2e/shots.mjs` regenerates the screenshots above in Noctalia light and dark. Profiling and benchmarks are in [bench/README.md](bench/README.md).

</details>

## Privacy

The full policy is in [docs/PRIVACY.md](docs/PRIVACY.md). There's no analytics and no server run by the project.

With sync on, the tab URLs, titles, workspace data and settings you share travel through Chrome Sync or Firefox Sync, so "local-first" doesn't mean nothing ever leaves your computer. On Firefox, favicons are fetched from each site's own server. Bookmarks and history stay in the browser, and showing them in the panel doesn't copy them into workspace snapshots. Please keep private browsing data out of issues.

## Contributing

Work on a feature branch and open a focused PR. Say what was wrong, what you changed, and which checks you ran. AI-assisted PRs are welcome if you've reviewed and tested them and kept private data out. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [issue chooser](https://github.com/humdedum1/vertically-challenged/issues/new/choose).

Versions follow Semantic Versioning, commits follow Conventional Commits, and releases are cut from `main` automatically. Don't bump versions or tag in ordinary PRs.

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md), and keep exploit details out of public issues and PRs.

## Support the project

It's free under the [MIT License](LICENSE), and it will stay free for the foreseeable future. If it saves you time, you can chip in on [Ko-fi](https://ko-fi.com/humdedum1) or [PayPal](https://paypal.me/oddboxx). Donations are optional and unlock nothing. Bug reports, testing on your setup, doc fixes and code review help just as much.

## License

[MIT](LICENSE). Third-party palettes keep their own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
