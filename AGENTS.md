# Agent guide: Vertically Challenged

- **Source of truth:** `CONTRIBUTING.md` for checks, commits and releases. On conflict, follow it and fix this file.

## Project

- **Type:** Chrome and Firefox MV3 extension showing vertical tabs in the side panel or an in-page popup overlay.
- **Stack:** WXT 0.21, Svelte 5, TypeScript, Vite.
- **Minimum versions:** Chrome 116, Firefox 140.

## Layout

- **`src/background/`:** MV3 service worker.
- **`src/sidepanel/`:** panel UI (Svelte 5).
- **`src/settings/`:** settings schema and migrations (`migrate.ts`).
- **`src/lib/`, `src/shared/`:** pure logic.
- **`tests/`:** Vitest unit tests (a few sit beside code under `src/`).
- **`tests/e2e/`:** Playwright, Chrome.
- **`tests/e2e-firefox/`:** Firefox smoke.
- **`bench/`:** pure-logic benchmarks.
- **`wxt.config.ts`:** manifest and build config.
- **`.claude/settings.json`:** shared project settings (tracked). Personal overrides go in `.claude/settings.local.json` (ignored).

## Commands

- **`npm run dev`:** WXT dev build.
- **`npm run build` / `npm run build:firefox`:** Chrome and Firefox builds into `.output/`.
- **`npm run check`:** svelte-check typecheck (warnings fail).
- **`npm run lint` / `npm run lint:fix`:** Biome.
- **`npm test`:** Vitest unit tests.
- **`npm run test:e2e`:** Playwright in Chrome.
- **`npm run test:e2e:firefox`:** Firefox 140 smoke (set `FIREFOX_BIN`).
- **`npm run bench:pure`:** pure-logic benchmarks.
- **`just ci`:** the local gate (validate.sh).
- **`just qa`:** Chromium e2e and Firefox smoke. Downloads Firefox 140 unless `FIREFOX_BIN` is set.
- **Hosted CI:** none for PRs. Checks are local.
- **`just dev` / `just fmt` / `just bench`:** `npm run dev`, `lint:fix` and `bench:pure`.

## Behavioral Boundaries

**Local-first and telemetry**
- **Local-first execution:** no server backend.
- **Zero telemetry.**

**Manifest V3 and stack**
- **Manifest V3 compatibility:** background code runs as an MV3 service worker.
- **Svelte 5 / WXT:** structural base for UI and builds.

**Chrome Side Panel vs Firefox Sidebar**
- **Cross-browser calls:** check every new `chrome.*` / `browser.*` call against Chrome 116 and Firefox 140.
- **Firefox fallback:** provide one, or document why the call is Chrome-only (for example, `sidePanel` in Chrome versus `sidebar_action` in Firefox).

**Platform constraints**
- **No install-time host permissions.** Remote backups request an optional origin grant at runtime.
- **Popup overlay** injects via `activeTab` + `scripting` from a user gesture.
- **Injection refusal:** chrome://, Web Store, New Tab, PDFs and incognito fall back to a popup window (`src/background/display.ts`).
- **Gestures:** `sidePanel.open` works only synchronously inside a user-gesture listener.
- **Browser startup:** side panel goes through a notification click. Popup window opens directly.
- **Incognito separation:** hard requirement. Incognito tabs and data never reach normal windows or sync.

**Manifest and permissions**
- **Permissions:** ask the maintainer before adding or widening a permission or host pattern. State the reason.

**Dependencies**
- **Runtime dependencies:** ask first.
- **Dev dependencies:** allowed when the change needs them.

**Persisted data (hard rule)**

Data loss is the worst failure. Any change to stored or synced data shape:
- **Bumps the version:** `SETTINGS_VERSION`, `SYNC_VERSION` or `FULL_VERSION` (backup format), as applicable.
- **Adds a migration** preserving existing user data (settings: `src/settings/migrate.ts`).
- **Adds a test** loading the old shape and checking the migrated result.

## Verification Routines

Features: plan first and agree the scope before editing.

Before reporting work as done, run the checks matching the change, in this order:

1. **`npm run lint`:** always.
2. **`npm run check`:** always.
3. **`npm test`:** always.
4. **`npm run test:e2e`:** when `src/sidepanel/`, `src/background/` or the manifest changes.
5. **`npm run test:e2e:firefox`:** when Firefox-specific code or the manifest changes.

- **Full gate:** `just ci` covers steps 1-3. `just qa` covers steps 4-5. Run both before a PR.
- **Reporting:** report failures plainly, with the output. Claim a check passed only after running it.

**Tests**
- **New logic** gets a Vitest test.
- **Bug fixes** start with a failing test reproducing the bug.
- **UI-only tweaks:** exempt from unit tests. Check in the real browser.
- **UI changes:** build, then drive the panel with `tests/e2e/harness.mjs` (`launch(extensionDir(), { width, height })`, page `chrome-extension://<id>/sidepanel.html`) and screenshot at narrow width.
- **Sticky elements:** Settings scrolls under the sticky Preview card, so offset by `--preview-h`.

**Performance**
- **Tab rendering, virtual lists, search, drag-and-drop:** run `npm run bench:pure` before and after. Report both numbers. See `bench/README.md`.

## Commits and PRs

- **Commit format:** Conventional Commits with scopes, e.g. `fix(sidepanel): ...`, `ci(release): ...`.
- **PR target:** `dev`, the staging branch.
- **Release path:** maintainers merge `dev` into `main`, which cuts releases. `main` is protected.
- **`dev` branch:** never delete it or its remote. A ruleset blocks deletion. Leave that block in place.
- **Commit and push** only when the user asks.

## Release boundary

- **Agents never** tag, hand-bump versions, edit changelogs, or run release or store-upload workflows.
- **CI (semantic-release)** does that from commit types.

**Human-only: replacing the current release without a new version**
1. Merge with `[skip ci]` in the message.
2. Move the tag: `git tag -f vX.Y.Z main && git push -f origin vX.Y.Z`.
3. On `main`: `CHROME_BIN=google-chrome-stable npm run pack:crx`, then `gh release upload vX.Y.Z .output/vertically-challenged-X.Y.Z-crx.zip --clobber`.
4. Confirm the release asset digest matches the local `sha256sum`.

- **Signing key:** `.output/chrome-mv3.pem`. Stays out of git. Never regenerated.

## Delegation

- **Main agent** plans, decides and verifies.
- **Subagents** handle exploration, search, routine edits, docs and test scaffolding.
- **Model default:** cheapest (Haiku).
- **Sonnet only** for security boundaries, migrations, or debugging Haiku has failed at.
- **Model choice:** state it when delegating.

## Issues and labels

- **Tracker:** GitHub Issues on humdedum1/vertically-challenged (via `gh`).
- **Scope:** file issues only into this repo, never into an upstream.
- **Label vocabulary:** needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix.
- **Type labels:** bug, enhancement, documentation, dependencies, skip-changelog (used by issue templates and `.github/release.yml`).
