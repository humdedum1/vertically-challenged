# Firefox Add-ons (addons.mozilla.org) listing

What the AMO form asks for, and how to get from a signed self-distributed build to a public
listing. The metadata Mozilla's tooling reads is in [`amo-metadata.json`](amo-metadata.json); the
screenshots are the 1280x800 images in this folder (`store-1-tabs.png` and the others). They
come from the Chrome build, but the interface is the same.

## Where things stand

The release workflow signs each release on the **unlisted** channel (a signed `.xpi` for
GitHub Releases). That already created the add-on `vertically-challenged@humdedum1.github.io`
on AMO. Listing it publicly is a separate, one-time step. Version numbers are unique per add-on,
so a version signed as unlisted can't be submitted again as listed: the first listed version
has to be a new release.

## Publishing checklist

1. **Sign in** at <https://addons.mozilla.org/developers/> with the Mozilla account that owns the
   API keys.
2. **Make sure the listing text is right.** Edit `amo-metadata.json`. The summary should stay
   under 250 characters (Mozilla's limit; check the form if it changes).
3. **Decide the channel.** Set the repository variable `AMO_CHANNEL` to `listed`
   (Settings → Secrets and variables → Actions → Variables). Leave it unset to keep signing
   unlisted.
4. **Cut a new release.** With `AMO_CHANNEL=listed` the workflow submits the version for review
   with the metadata file and the source archive instead of signing it unlisted. It doesn't wait
   for the review, so no signed `.xpi` is attached to that GitHub release; people install it from
   AMO once it's approved.
5. **Finish the product page in the Developer Hub** (the parts the API doesn't cover):
   - Screenshots: upload `store-1-tabs.png`, `store-2-search.png`, `store-3-history.png`,
     `store-4-settings.png`.
   - Privacy policy: paste the text of [`../PRIVACY.md`](../PRIVACY.md), or link
     <https://github.com/humdedum1/vertically-challenged/blob/main/docs/PRIVACY.md>.
   - Support email: optional; the support URL already points at the issue tracker.
6. **Wait for review.** The reviewers read the submitted source, so the notes below matter.
7. **After approval,** later releases with `AMO_CHANNEL=listed` update the listing automatically.

The release workflow needs the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` secrets (Developer Hub →
Tools → Manage API Keys). Set them with `gh secret set`, so the values never appear in a log.

## Notes for the reviewer

These are also in `amo-metadata.json` (`version.approval_notes`).

- **Source:** the source ZIP is attached to the submission and published at
  <https://github.com/humdedum1/vertically-challenged>.
- **Build:** Node.js 22 and npm. `npm ci`, then `npm run build:firefox`. The result is
  `.output/firefox-mv3`, which is the submitted package. The JavaScript is bundled and minified
  by Vite through WXT.
- **Two edits to a library:** `wxt.config.ts` has a build transform that replaces two
  `innerHTML` assignments in Svelte's runtime (template markup and a feature probe, both fixed at
  compile time) with `DOMParser`. It throws if Svelte's source changes, so it can't silently do
  nothing. The validator reports no warnings.
- **No remote code:** every script ships in the package. The extension page's CSP is
  `script-src 'self'`.
- **Network:** nothing is contacted by default. With the user's explicit permission it talks to a
  backup server they type in (WebDAV, S3-compatible or Dropbox). It also loads each tab's favicon
  from that site's own server, since Firefox has no favicon API for extensions. The page's CSP
  allows `img-src https:` for that, and custom CSS that tries to load remote images is not
  applied.
- **Permissions:** `tabs`, `tabGroups`, `sessions`, `bookmarks`, `history` (the panels),
  `storage`, `alarms`, `contextMenus`, `activeTab` and `scripting` (the optional in-page popup,
  which Firefox doesn't support, so it's inert), `identity` (Dropbox sign-in only; Firefox doesn't
  allow it as optional). Optional: `notifications`, `downloads` and one host origin for a backup
  server.
- **Data:** `data_collection_permissions` is `none`. Nothing is sent to the developer.

## Listing text

The same text as in `amo-metadata.json`, for pasting into the form by hand.

**Name:** Vertically Challenged

**Summary:** Vertical tabs in the sidebar: search, pin, group, snooze and back up your tabs.
Local-first, no tracking, free and open source.

**Categories:** Tabs

**Tags:** vertical tabs, sidebar, tab manager, tab groups, sessions

**License:** GPL-3.0-only (AMO has no “or later” option)

**Homepage:** <https://github.com/humdedum1/vertically-challenged>

**Support site:** <https://github.com/humdedum1/vertically-challenged/issues>

**Description:** see `description` in `amo-metadata.json`.

## What differs from the Chrome listing

- The panel is Firefox's sidebar, or a window. There is no in-page popup on Firefox.
- Synced open tabs from other devices aren't available (Firefox has no API for them).
- Firefox has had much less testing than Chrome; the description says so and asks for fixes.
