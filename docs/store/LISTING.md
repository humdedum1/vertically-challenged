<div align="center">

<img src="../../public/icon/128.png" alt="Vertically Challenged icon" width="96" height="96">

# Chrome Web Store listing

**Everything the store form asks for, and the steps to a published listing.**

The images in this folder are built by `node scripts/store-assets.mjs` from the README screenshots.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-submit-0071e3?logo=googlechrome&logoColor=white&labelColor=1d1d1f)](https://chrome.google.com/webstore/devconsole)
[![Firefox](https://img.shields.io/badge/Firefox-AMO.md-0071e3?logo=firefoxbrowser&logoColor=white&labelColor=1d1d1f)](AMO.md)

[Publish](#publish) · [Automation](#automatic-uploads-from-releases) · [Short description](#short-description) · [Detailed description](#detailed-description) · [Privacy tab](#privacy-tab) · [Reviewer notes](#reviewer-notes)

<table>
  <tr>
    <td align="center" width="50%"><b>Upload the Chrome zip</b><br><sub><code>…-chrome.zip</code>, not the CRX or sources zip</sub></td>
    <td align="center" width="50%"><b>Manual review</b><br><sub><code>history</code>, <code>tabs</code> and optional all-sites draw extra scrutiny</sub></td>
  </tr>
</table>

</div>

## Publish

<table>
  <tr>
    <td valign="top" width="33%"><b>1. Account</b><br>Register at the <a href="https://chrome.google.com/webstore/devconsole">developer dashboard</a>. One-time US$5 fee, 2-step verification required.</td>
    <td valign="top" width="33%"><b>2. Build the upload</b><br><code>npm ci &amp;&amp; npm run zip</code> writes <code>.output/vertically-challenged-&lt;version&gt;-chrome.zip</code>, or take it from <a href="https://github.com/humdedum1/vertically-challenged/releases">Releases</a>. Upload it as a new item.</td>
    <td valign="top" width="33%"><b>3. Store listing tab</b><br>Paste the texts below. Category: Productivity.</td>
  </tr>
  <tr>
    <td valign="top"><b>4. Privacy tab</b><br>Single purpose, permissions and data use are <a href="#privacy-tab">below</a>.</td>
    <td valign="top"><b>5. Distribution</b><br>Public, all regions.</td>
    <td valign="top"><b>6. Submit</b><br>Expect a manual review. The justifications below are written for it.</td>
  </tr>
</table>

After approval, copy the extension ID and set up [automatic uploads](#automatic-uploads-from-releases).

> [!IMPORTANT]
> Upload the `-chrome.zip`, never the signed CRX from GitHub Releases. The `-crx.zip` holds only a `.crx` file, so the store reports "No manifest found in package".

**Images**

| Use | File | Size |
| --- | --- | --- |
| Screenshots | `store-1-tabs.png`, `store-2-search.png`, `store-3-history.png`, `store-4-settings.png` | 1280x800 |
| Small promo tile | `store-promo-small.png` | 440x280 |
| Icon | `public/icon/128.png` | 128x128 |

**Privacy policy URL:** <https://github.com/humdedum1/vertically-challenged/blob/main/docs/PRIVACY.md>

The Web Store assigns its own extension ID and signs the package itself, so it differs from the CRX on GitHub Releases. Browser sync data is stored per extension ID, so someone who switches between the two installs starts with fresh synced data.

## Automatic uploads from releases

The release workflow can upload each new version to the store. It stays off until you set these in the GitHub repository settings (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `CWS_EXTENSION_ID` | The item's ID from the developer dashboard |
| Variable | `CWS_PUBLISHER_ID` | Your publisher ID (dashboard → Account) |
| Variable | `CWS_AUTO_PUBLISH` | `true` to also submit each upload for review; leave unset to upload as a draft |
| Secret | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | An OAuth client of type Desktop app, in a Google Cloud project with the Chrome Web Store API enabled |
| Secret | `CWS_REFRESH_TOKEN` | A refresh token for that client with the `https://www.googleapis.com/auth/chromewebstore` scope |

Set the secrets with `gh secret set <NAME>`, so the values never appear in a terminal log. The first submission has to be done by hand in the dashboard (the listing fields live there).

## Short description

132 characters or fewer.

```text
Vertical tabs in Chrome's side panel: search, pin, group, snooze and back up. Local-first, no tracking.
```

## Detailed description

```text
🗂️ Every tab in every window, in one searchable vertical list. Free, open source and local-first.

• Side panel, sidebar or window: side panel and in-page popup on Chrome, sidebar on Firefox, own window on both.
• One list: every tab in every window, with window names. Incognito stays separate.
• Staples: a grid of the pages you use all day.
• Pinned folders and child tabs: nest, drag and arrange.
• Tab Groups: create, rename, recolor, collapse and move native groups.
• Search: fuzzy matching, plus > for keyboard commands.
• Snoozing: put a tab away until tomorrow, or park it without a reminder.
• Suspensions: discard idle tabs to save memory.
• Sessions: save sessions and window setups, restore them later.
• Themes: density, layout and custom CSS.
• Backups: optional encryption, on your schedule, to Downloads, Nextcloud/WebDAV, S3-compatible storage or Dropbox.
• Local-first privacy: no account, no analytics, no ads, no server run by the project.
• License: free and open source (GPLv3).

Young, AI-assisted project with a small test sample. Firefox support has had much less testing than Chrome. Keep backups of anything you cannot afford to lose, and report problems on GitHub.

Source code and issue tracker: https://github.com/humdedum1/vertically-challenged
```

## Privacy tab

### Single purpose

```text
Show and manage browser tabs in a vertical list in the side panel.
```

### Permission justifications

| Permission | Why |
| --- | --- |
| tabs | Read tab titles and addresses for the list and search; switch, move and close tabs. |
| sidePanel | Show the interface in Chrome's side panel. |
| favicon | Show site icons without requesting website access. |
| storage | Keep settings, layouts, sessions and backup settings. |
| tabGroups | Create, rename, recolor, collapse and move tab groups. |
| sessions | Show and reopen recently closed tabs and windows. |
| bookmarks | The Bookmarks panel: read, search and open your bookmarks. Nothing is copied or sent anywhere. |
| history | The History panel: read, search and open your browsing history, grouped by day, and delete entries you choose. Nothing is copied or sent anywhere. |
| alarms | Auto-suspend, scheduled sync, scheduled backups and snoozed tabs. |
| contextMenus | Tab actions in Chrome's menus. |
| activeTab, scripting | Show the in-page popup on the tab you invoke it on, only after you ask. |
| downloads (optional) | Save backups to your Downloads folder when you turn on automatic backups. |
| notifications (optional) | Offer a click-to-open notice at browser start when you choose "Open on launch". |
| identity (optional) | Dropbox's sign-in window, only if you back up to Dropbox. |
| Server address (optional host permission) | Upload backups to the WebDAV, S3-compatible or Dropbox address you enter, and only that one address. |

No remote code is loaded. All scripts ship inside the package.

### Data use answers

- **Collected data:** none is sent to the developer. The extension reads open tabs, bookmarks and history on your device to display them (declare "Web history" and "Website content" as handled locally if the form asks).
- **Sold or transferred to third parties:** no. The only transfers are the ones you set up: browser sync (Google), and backups to a server you choose.
- **Used for purposes unrelated to the single purpose, or for creditworthiness:** no.

## Reviewer notes

```text
The extension needs no website access at install. The all-sites host permission is optional: the
Settings → Data card asks for exactly one origin (the backup server the user typed in) when a
remote backup target is saved. Test account or sign-in: none is needed. To try backups, choose the
Downloads target.
```
