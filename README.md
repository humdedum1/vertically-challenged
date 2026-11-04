<div align="center">

<img src="public/icon/128.png" alt="Vertically Challenged icon" width="128" height="128">

# Vertically Challenged

**Fast, customizable vertical tabs for Chrome, in the side panel or an in-page popup.**

Staples, pinned folders, tab groups, saved sessions and themes. Local-first, no telemetry.

[![CI](https://github.com/humdedum1/vertically-challenged/actions/workflows/checks.yml/badge.svg)](https://github.com/humdedum1/vertically-challenged/actions/workflows/checks.yml)
[![Release](https://img.shields.io/github/v/release/humdedum1/vertically-challenged?label=release&color=0071e3&labelColor=1d1d1f)](https://github.com/humdedum1/vertically-challenged/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-0071e3?labelColor=1d1d1f)](LICENSE)
![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-0071e3?logo=googlechrome&logoColor=white&labelColor=1d1d1f)
![Free](https://img.shields.io/badge/price-free-34c759?labelColor=1d1d1f)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/humdedum1)
[![PayPal](https://img.shields.io/badge/PayPal-donate-00457C?logo=paypal&logoColor=white)](https://paypal.me/oddboxx)

[Install](#install) · [Features](#features) · [Shortcuts](#keyboard-shortcuts) · [Releases](https://github.com/humdedum1/vertically-challenged/releases) · [Report a bug](https://github.com/humdedum1/vertically-challenged/issues/new/choose) · [Contribute](CONTRIBUTING.md)

<table>
  <tr>
    <td align="center" width="50%"><b>Local-first</b><br><sub>No telemetry, no project-run server</sub></td>
    <td align="center" width="50%"><b>Side panel or popup</b><br><sub>Your pick, in Settings</sub></td>
  </tr>
  <tr>
    <td align="center"><b>No host permissions</b><br><sub>Nothing requested at install</sub></td>
    <td align="center"><b>Free, MIT</b><br><sub>And it stays free</sub></td>
  </tr>
</table>

<img src="docs/store/readme-tabs-light.png" alt="The tab list, Noctalia light" width="260"> <img src="docs/store/readme-history-light.png" alt="The History panel, Noctalia light" width="260"> <img src="docs/store/readme-settings-light.png" alt="Settings with every group collapsed, Noctalia light" width="260">
<img src="docs/store/readme-tabs-dark.png" alt="The tab list, Noctalia dark" width="260"> <img src="docs/store/readme-history-dark.png" alt="The History panel, Noctalia dark" width="260"> <img src="docs/store/readme-settings-dark.png" alt="Settings with every group collapsed, Noctalia dark" width="260">

<sub>Tab list with child tabs and fuzzy search (type <code>&gt;</code> for commands) · History grouped by day · Settings with its own search. Noctalia theme, light and dark.</sub>
<!-- TODO: add Chrome Web Store version/users badges once the store listing exists. -->

</div>

> [!WARNING]
> Vibecoded and lightly tested. Most of this extension was written with AI coding tools. It has unit and end-to-end tests, but they were run on a few machines, profiles and workflows, so expect bugs in untested corners and the odd follow-up fix. Keep backups of anything you can't afford to lose, and please report what you find.

> [!NOTE]
> Free and open source under the [MIT License](LICENSE), and it will stay free for the foreseeable future. Donations ([Ko-fi](https://ko-fi.com/humdedum1), [PayPal](https://paypal.me/oddboxx)) are optional and unlock nothing.

## Install

Needs Chrome 116 or newer (141 or newer to close the side panel by shortcut).

- Chrome Web Store: [TODO: Chrome Web Store listing URL]
- GitHub Releases: download `vertically-challenged-<version>-crx.zip` from [Releases](https://github.com/humdedum1/vertically-challenged/releases) and extract the signed `.crx`. Chrome may block extensions from outside the Web Store, in which case use the store or an unpacked build. The CRX ZIP is not an unpacked source ZIP, so Load unpacked won't accept it.
- Unpacked: see [Build from source](#build-from-source).

<table>
  <tr>
    <td valign="top" width="33%"><b>1. Get it</b><br>Web Store, Releases or an unpacked build.</td>
    <td valign="top" width="33%"><b>2. Open it</b><br>Toolbar icon or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.</td>
    <td valign="top" width="33%"><b>3. Tune it</b><br>Theme, layout, shortcuts and sync are in Settings.</td>
  </tr>
</table>

## Features

<table>
  <tr>
    <td valign="top" width="50%">
      <b>Organize</b>
        <ul>
          <li><b>All-window tab list.</b> Your normal windows in one list, with window names and active tabs. Incognito windows stay separate.</li>
          <li><b>Staples.</b> A compact grid of frequent pages with fixed home URLs. Dormant tiles reopen on click.</li>
          <li><b>Pinned tabs and folders.</b> Nested folders for pins, custom folder icons, drag between sections or windows.</li>
          <li><b>Child tabs.</b> Tabs opened from a page can sit under their opener. Drag to nest or unnest.</li>
          <li><b>Native tab groups.</b> Create, rename, recolor, collapse and move Chrome groups.</li>
        </ul>
    </td>
    <td valign="top" width="50%">
      <b>Find and select</b>
        <ul>
          <li><b>Search.</b> Fuzzy search over titles and URLs, plus bookmarks, history, saved sessions and snoozed tabs. Settings has its own search box.</li>
          <li><b>Multiple selection.</b> Select ranges or single tabs and act on them together.</li>
          <li><b>Bookmarks, history, recently closed.</b> Panels to search and open bookmarks and visited pages, and to reopen closed tabs and windows.</li>
        </ul>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Declutter</b>
        <ul>
          <li><b>Clear.</b> Close ordinary tabs and keep your Staples and pinned layout.</li>
          <li><b>Suspend tabs.</b> Discard tabs by hand or after an idle period, with exclusions for pinned, audible and chosen sites. Chrome reloads them when you switch back.</li>
          <li><b>Snooze and park.</b> Put a tab away until later today, tomorrow, Monday or next month, or park it with no reminder. Snoozed tabs come back on time, even after a browser restart.</li>
          <li><b>Tidy up.</b> "Tidy up tabs…" in the command palette lists tabs unused for 7, 30 or 90 days, grouped by site, so you can park or close a whole site at once.</li>
        </ul>
    </td>
    <td valign="top">
      <b>Make it yours</b>
        <ul>
          <li><b>Themes and appearance.</b> Built-in and custom themes, accent colors, light/dark/system mode, import and export. Density, fonts, row layout, panel order, visible sections and tab actions.</li>
          <li><b>Shortcuts and menus.</b> Configurable in-panel shortcuts, Chrome commands and context-menu actions.</li>
          <li><b>Panel recovery.</b> Reload the panel from the button next to color mode or from its context menu.</li>
        </ul>
    </td>
  </tr>
  <tr>
    <td valign="top" colspan="2">
      <b>Save and move</b>
        <ul>
          <li><b>Window setups.</b> Save window names, Staples, pins and folders for reuse.</li>
          <li><b>Saved sessions.</b> Save one or all windows, then restore tabs, groups and pinned layouts. Export as a Markdown outline or a bookmarks file.</li>
          <li><b>Other devices.</b> Browse workspaces and sessions published from your other computers, open them, or keep copies.</li>
          <li><b>Full backups.</b> Scheduled, encrypted backups to Downloads, WebDAV (Nextcloud), S3-compatible storage or Dropbox. Restore from the server, undo a restore, and get a toolbar warning if backups stop.</li>
        </ul>
    </td>
  </tr>
</table>

## Keyboard shortcuts

Alt+Shift+V toggles the panel. Change Chrome-level bindings at `chrome://extensions/shortcuts` and in-panel bindings in Settings. Search, selection, tab navigation and context menus all work from the keyboard.

| Chrome command | Default |
| --- | --- |
| Open or close the panel | Alt+Shift+V |
| Open the panel with search focused | none |
| Suspend the current tab | none |
| Suspend the other tabs in the window | none |
| Switch to the previously used tab (press again to go further back) | none |
| Switch forward through recently used tabs | none |

The panel can be Chrome's side panel or an in-page popup (pick in Settings). Where Chrome blocks injection, the popup opens in its own window. Injection only happens after you click or press a shortcut on that tab, so the extension never asks for access to every site.

## Sync and its limits

Sign in to the same Google account on each computer, turn on extension sync, and install Vertically Challenged everywhere. Chrome's own remote-tab list also needs its Open tabs sync setting.

- Settings and custom themes sync as soon as they change.
- Open workspaces publish ordinary tabs, groups, Staples, pins, folders and window names. Saved setups and sessions can be shared too. Settings → Sync sets how often: manual, or every 1, 5, 15, 30 or 60 minutes. That interval doesn't affect settings/theme sync or how fast Google delivers data. Sync now publishes immediately; scheduled publishing uses Chrome alarms, which can fire late while the computer sleeps.
- Published data shows up under Sessions → Other devices. Nothing opens or closes on the other computer by itself. Keep here saves a workspace's pinned layout as a setup, plus a full snapshot in Saved sessions when it has ordinary tabs.
- Incognito tabs and extension pages are never captured, and snapshots don't share browser tab IDs.
- Chrome Sync has roughly 100 KB in total for settings, themes and compressed snapshots, so large collections may not fit. Settings shows storage errors and skipped snapshots. For real backups, use Full backups.

File backups cover settings, custom themes, Staples, pins, nested folders and Window setups (not incognito layouts). Importing adds layouts to Sessions → Window setups without touching open windows or existing setups; older settings-only backups still import. Updates and reloads keep saved layouts when their tabs can be matched. Uninstalling deletes the extension's local data for good; reinstalling won't restore it.

## Permissions

No host permissions are requested at install. The popup injects only after you use its toolbar button, shortcut or menu on that tab.

| Permission | Why |
| --- | --- |
| `tabs` | Read titles and URLs for the list and search; switch and close tabs. |
| `sidePanel` | Show the UI in Chrome's side panel. |
| `favicon` | Load favicons without host permissions. |
| `storage` | Settings (synced) and local layouts and sessions. |
| `tabGroups` | Manage native tab groups. |
| `sessions` | Recently closed tabs and windows. |
| `bookmarks` | The Bookmarks panel. |
| `history` | The History panel (read, search, delete). |
| `alarms` | Auto-suspend and scheduled sync. The background worker sleeps when idle, so `setTimeout` won't do. |
| `contextMenus` | Items such as "Suspend tab" and "Save window as session" in Chrome's menus. |
| `activeTab`, `scripting` | Inject the in-page popup into the current tab after you invoke it there. |
| `notifications` (optional) | Only with Open on launch: Chrome can't open the panel without a user gesture, so a notification does it on click. |
| `downloads` (optional) | Only with automatic backups to your Downloads folder. |
| Server address (optional) | Only for WebDAV, S3-compatible or Dropbox backups: access to the one address you enter. |
| `identity` (optional) | Only for Dropbox sign-in, using your own Dropbox app key. The extension ships no shared credentials. |

## Build from source

Needs Node.js 22+ and npm.

```sh
git clone https://github.com/humdedum1/vertically-challenged.git
cd vertically-challenged
npm ci
npm run build
```

Open `chrome://extensions`, enable Developer mode, click Load unpacked and pick `.output/chrome-mv3`. To update, rebuild into the same folder and click Reload.

## Development and testing

TypeScript, Svelte 5, WXT, Vitest, Playwright and Biome.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev browser with hot reload |
| `npm run build` | Production build in `.output/chrome-mv3` |
| `npm run zip` | Zip the unpacked build (not a signed CRX) |
| `npm run pack:crx` | Signed CRX in a release ZIP (needs the signing key, see [CONTRIBUTING.md](CONTRIBUTING.md)) |
| `npm run lint` | Formatting and lint |
| `npm run check` | Svelte and TypeScript checks |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Real Chromium runs against the built extension |
| `npm run bench:pure` | Pure-function benchmarks |

```sh
npx playwright-core install chromium
npm run build
npm run test:e2e
```

End-to-end tests use throwaway profiles and need Chromium or Chrome for Testing, because branded Chrome ignores the flag that loads test extensions. Set `CHROME_BIN` to use your own binary. `node tests/e2e/shots.mjs` regenerates the screenshots above in Noctalia light and dark. Profiling and benchmarks: [bench/README.md](bench/README.md).

## Privacy

Full policy: [docs/PRIVACY.md](docs/PRIVACY.md). No analytics and no project-run server. If you turn on sync, shared tab URLs, titles, workspace data and settings travel through Chrome Sync, so local-first doesn't mean nothing ever leaves your computer. Bookmarks and history stay in Chrome; showing them in the panel doesn't copy them into workspace snapshots. Please don't paste private browsing data into issues.

## Contributing

Work on a feature branch and open a focused PR that says what was wrong, what changed, and which checks you ran. AI-assisted contributions are welcome, but you're responsible for reviewing, testing and keeping private data out. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [issue chooser](https://github.com/humdedum1/vertically-challenged/issues/new/choose).

Versions follow Semantic Versioning and commits follow Conventional Commits. Releases are cut automatically from `main`, so don't bump versions or tag in ordinary PRs.

## Security

Report vulnerabilities as described in [SECURITY.md](SECURITY.md). Keep exploit details out of public issues and PRs.

## Support the project

If it saves you time, you can chip in on [Ko-fi](https://ko-fi.com/humdedum1) or [PayPal](https://paypal.me/oddboxx). Bug reports, testing on your setup, doc fixes and code review help just as much.

## License

[MIT](LICENSE). Third-party palettes keep their own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
