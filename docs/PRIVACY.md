# Privacy policy

Vertically Challenged is a browser extension that shows your tabs in a vertical list. It has no
servers, no accounts, no analytics and no advertising. This page says what the extension stores,
where that data can go, and what you control.

## What stays on your computer

Everything the extension needs lives in your browser profile: your settings, themes, Staples,
pinned tabs and folders, window setups, saved and snoozed sessions, custom CSS, and the optional
backup settings. The extension reads the titles and addresses of your open tabs, and (only when
you open those panels) your bookmarks and history, to show them to you. None of this is sent to
the developer or to any third party.

## What can leave your computer, and only when you choose it

- **Browser sync.** If Chrome Sync or Firefox Sync is on, settings, custom themes, and (if you
  leave them on) tab workspaces and saved sessions are stored in your Google or Firefox account
  through the browser's own sync service. Google's or Mozilla's privacy policy covers that
  storage. Incognito and private tabs are never included. Chrome and Firefox don't share data
  with each other.
- **Favicons on Firefox.** Chrome gives the extension its cached favicons. Firefox doesn't, so on
  Firefox the panel loads each tab's icon from that site's own server, the same site the tab
  already talks to. Nothing goes anywhere else. So bookmarks, history and Staples get icons too,
  the extension remembers the icon address of up to 500 sites you've had open in normal (not
  private) tabs. That list stays on this computer and is erased when you clear all history.
- **Backups.** Automatic or manual backups contain your settings, themes, layouts, sessions and
  custom CSS. They are saved only where you point them: your Downloads folder, a WebDAV server
  (such as Nextcloud), an S3-compatible bucket, or your own Dropbox app folder. The extension
  contacts only the address you enter, after the browser asks for your permission for that
  address. Set a passphrase to encrypt the file; without one, the backup lists every saved
  address in readable form. If you lose the passphrase the backup can't be recovered.
- **Dropbox sign-in.** You create your own Dropbox app and paste its key. Sign-in uses Dropbox's
  standard OAuth window; the extension keeps only a refresh token.

## What is stored in plain form

Backup server passwords, access keys, the Dropbox refresh token and the backup passphrase are
kept in the extension's local storage on your computer so scheduled backups can run unattended.
They are never synced and never written into a backup file. Use an app password or a key limited
to one bucket or folder.

## Permissions

Each permission exists for one feature; the README lists them. The extension asks for no website
access when you install it. Optional permissions (downloads, notifications, identity, and one
server address) are requested only when you turn on the feature that needs them. Firefox doesn't
allow `identity` as optional, so it is declared at install there and used only for Dropbox
sign-in.

## Your control

You can export or delete your data at any time: remove the extension to delete its local data,
clear synced data from your Google or Firefox account settings, and delete backup files from wherever
you saved them. Uninstalling does not delete backup files you stored elsewhere.

## Children

The extension is not directed at children and collects no personal information.

## Changes and contact

If this policy changes, the new version is published in this repository with the release that
needs it. Questions and reports: https://github.com/humdedum1/vertically-challenged/issues
