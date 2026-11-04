# Chrome Web Store listing

Everything the store form asks for, and the steps to get from here to a published listing. The
images in this folder are built by `node scripts/store-assets.mjs` from the README screenshots.

## Publishing checklist

1. **Developer account.** Register at <https://chrome.google.com/webstore/devconsole> (one-time
   US$5 fee, 2-step verification required).
2. **Build the upload.** `npm ci && npm run zip` writes `.output/vertically-challenged-<version>-chrome.zip`.
   Upload that ZIP (not the signed CRX from GitHub Releases) as a new item.
3. **Store listing tab.** Paste the texts below. Screenshots: `store-1-tabs.png`,
   `store-2-search.png`, `store-3-history.png`, `store-4-settings.png` (1280x800). Small promo
   tile: `store-promo-small.png` (440x280). Icon: `public/icon/128.png`. Category: Productivity.
4. **Privacy tab.** Single purpose, permission justifications and data-use answers below. Privacy
   policy URL: <https://github.com/humdedum1/vertically-challenged/blob/main/docs/PRIVACY.md>.
5. **Distribution.** Public, all regions.
6. **Submit for review.** Expect a manual review: the `history`, `tabs` and optional all-sites
   host permissions draw extra scrutiny. The justifications below are written for that.
7. **After approval,** copy the extension ID and set up automatic uploads (next section).

The Firefox equivalent is [AMO.md](AMO.md).

The Web Store assigns its own extension ID and signs the package itself, so it differs from the
CRX on GitHub Releases. Browser sync data is stored per extension ID, so someone who switches
between the two installs starts with fresh synced data.

## Automatic uploads from releases

The release workflow can upload each new version to the store. It stays off until you set these
in the GitHub repository settings (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CWS_EXTENSION_ID` | The item's ID from the developer dashboard |
| Variable | `CWS_PUBLISHER_ID` | Your publisher ID (dashboard → Account) |
| Variable | `CWS_AUTO_PUBLISH` | `true` to also submit each upload for review; leave unset to upload as a draft |
| Secret | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | An OAuth client of type Desktop app, in a Google Cloud project with the Chrome Web Store API enabled |
| Secret | `CWS_REFRESH_TOKEN` | A refresh token for that client with the `https://www.googleapis.com/auth/chromewebstore` scope |

Set the secrets with `gh secret set <NAME>`, so the values never appear in a terminal log. The
first submission has to be done by hand in the dashboard (the listing fields live there).

## Short description (132 characters or fewer)

Vertical tabs in Chrome's side panel: search, pin, group, snooze and back up. Local-first, no tracking.

## Detailed description

Vertically Challenged puts all your tabs in a fast, searchable vertical list in Chrome's side
panel (or an in-page popup, or its own window).

- Every tab in every window, with window names. Incognito stays separate.
- Search tabs with fuzzy matching, or type > to run commands from the keyboard.
- Staples, pinned folders, child tabs and native tab groups.
- Save sessions and window setups, restore them later, or snooze a tab until tomorrow.
- Suspend idle tabs to save memory.
- Themes, density and layout you control, including custom CSS.
- Full backups with optional encryption, saved to Downloads, Nextcloud/WebDAV, S3-compatible
  storage or Dropbox, on a schedule you choose. Restore from the server in one click.
- Free and MIT licensed. No account, no analytics, no ads.

This is a young, AI-assisted project with a small test sample. Keep backups of anything you
cannot afford to lose, and please report problems on GitHub.

Source code and issue tracker: https://github.com/humdedum1/vertically-challenged

## Single purpose

Show and manage browser tabs in a vertical list in the side panel.

## Permission justifications

| Permission | Why |
| --- | --- |
| tabs | Read tab titles and addresses for the list and search; switch, move and close tabs. |
| sidePanel | Show the interface in Chrome's side panel. |
| favicon | Show site icons without requesting website access. |
| storage | Keep settings, layouts, sessions and backup settings. |
| tabGroups | Create, rename, recolor, collapse and move tab groups. |
| sessions | Show and reopen recently closed tabs and windows. |
| bookmarks, history | The Bookmarks and History panels (read, search, open; history entries can be deleted). Nothing is copied or sent anywhere. |
| alarms | Auto-suspend, scheduled sync, scheduled backups and snoozed tabs. |
| contextMenus | Tab actions in Chrome's menus. |
| activeTab, scripting | Show the in-page popup on the tab you invoke it on, only after you ask. |
| downloads (optional) | Save backups to your Downloads folder when you turn on automatic backups. |
| notifications (optional) | Offer a click-to-open notice at browser start when you choose "Open on launch". |
| identity (optional) | Dropbox's sign-in window, only if you back up to Dropbox. |
| Server address (optional host permission) | Upload backups to the WebDAV, S3-compatible or Dropbox address you enter, and only that one address. |

No remote code is loaded. All scripts ship inside the package.

## Data use answers

- **Collected data:** none is sent to the developer. The extension reads open tabs, bookmarks and
  history on your device to display them (declare "Web history" and "Website content" as handled
  locally if the form asks).
- **Sold or transferred to third parties:** no. The only transfers are the ones you set up:
  browser sync (Google), and backups to a server you choose.
- **Used for purposes unrelated to the single purpose, or for creditworthiness:** no.

## Reviewer notes

The extension needs no website access at install. The all-sites host permission is optional: the
Settings → Data card asks for exactly one origin (the backup server the user typed in) when a
remote backup target is saved. Test account or sign-in: none is needed. To try backups, choose the
Downloads target.
