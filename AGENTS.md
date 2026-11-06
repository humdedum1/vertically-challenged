# Agent guide: Vertically Challenged

Vertically Challenged is a Chrome and Firefox MV3 extension (WXT 0.21, Svelte 5, TypeScript, Vite) that shows vertical tabs in the side panel or an in-page popup overlay. It is local-first, with no telemetry and no server backend. Minimum versions: Chrome 116, Firefox 140.

`CONTRIBUTING.md` is the source of truth for checks, commits and releases. If this file disagrees with it, follow `CONTRIBUTING.md` and fix this file.

## Layout

- `src/background/`: MV3 service worker
- `src/sidepanel/`: panel UI (Svelte 5)
- `src/settings/`: settings schema and migrations (`migrate.ts`)
- `src/lib/`, `src/shared/`: pure logic
- `tests/`: Vitest unit tests (a few sit beside code under `src/`); `tests/e2e/` (Playwright, Chrome); `tests/e2e-firefox/` (Firefox smoke)
- `bench/`: pure-logic benchmarks
- `wxt.config.ts`: manifest and build config
- `.claude/settings.json`: shared project settings (tracked). Personal overrides go in `.claude/settings.local.json` (ignored), not in `settings.json`.

## Commands

- `npm run dev`: WXT dev build
- `npm run build` / `npm run build:firefox`: Chrome and Firefox builds into `.output/`
- `npm run check`: svelte-check typecheck (warnings fail)
- `npm run lint` / `npm run lint:fix`: Biome
- `npm test`: Vitest unit tests
- `npm run test:e2e`: Playwright in Chrome
- `npm run test:e2e:firefox`: Firefox 140 smoke (set `FIREFOX_BIN`)
- `npm run bench:pure`: pure-logic benchmarks
- `npm run ci`: local CI gate (validate.sh, e2e and Firefox smoke)

## Working loop

- For features, plan first and agree the scope before editing.
- Before saying work is done, run the checks that match the change:
  - Always: unit tests, lint, `check`.
  - When `src/sidepanel/`, `src/background/` or the manifest changes: e2e.
  - When Firefox-specific code or the manifest changes: the Firefox smoke.
  - `npm run ci` runs all of them.
- Report failures plainly, with the output. Do not claim a check passed unless you ran it.

## Tests

- New logic gets a Vitest test.
- Bug fixes start with a failing test that reproduces the bug.
- UI-only tweaks are exempt from unit tests; check them in the real browser instead (see below).
- UI changes: build, then drive the panel with `tests/e2e/harness.mjs` (`launch(extensionDir(), { width, height })`, page `chrome-extension://<id>/sidepanel.html`) and screenshot it at narrow width. Settings scrolls under the sticky Preview card, so sticky elements offset by `--preview-h`.

## Persisted data (hard rule)

Data loss is the worst failure. Any change to stored or synced data shape:

- bumps `SETTINGS_VERSION`, `SYNC_VERSION` or `FULL_VERSION` (backup format), as applicable;
- adds a migration that preserves existing user data (settings: `src/settings/migrate.ts`);
- adds a test that loads the old shape and checks the migrated result.

## Platform constraints

- **No install-time host permissions.** Remote backups request an optional origin grant at runtime. The popup overlay is injected via `activeTab` + `scripting` from a user gesture. Pages that refuse injection (chrome://, Web Store, New Tab, PDFs, incognito) fall back to a popup window (`src/background/display.ts`).
- **Gestures.** `sidePanel.open` only works synchronously inside a user-gesture listener. At browser startup the side panel goes through a notification click; the popup window opens directly.
- **Incognito separation** is a hard requirement. Incognito tabs and data never reach normal windows or sync.

## Manifest and permissions

- Never add or widen a permission or host pattern without asking the maintainer first. State the reason.

## Cross-browser

- Check every new `chrome.*` / `browser.*` call against Chrome 116 and Firefox 140.
- Provide a Firefox fallback, or document why the call is Chrome-only (for example, `sidePanel` in Chrome versus `sidebar_action` in Firefox).

## Dependencies

- Ask before adding a runtime dependency.
- Dev dependencies are fine when the change needs them.

## Performance

- Changes to tab rendering, virtual lists, search, or drag-and-drop: run `npm run bench:pure` before and after, and report both numbers. See `bench/README.md`.

## Commits and PRs

- Use Conventional Commits with scopes, e.g. `fix(sidepanel): ...`, `ci(release): ...`.
- PRs target `dev`, the staging branch. Maintainers merge `dev` into `main`, which cuts releases. `main` is protected.
- Never delete `dev` or its remote; a ruleset blocks deletion, so don't work around it.
- Do not commit or push unless the user asks.

## Release boundary

- Agents never tag, hand-bump versions, edit changelogs, or run release or store-upload workflows. CI (semantic-release) does that from commit types.
- **Human-only:** replacing the current release without a new version.
  1. Merge with `[skip ci]` in the message.
  2. Move the tag: `git tag -f vX.Y.Z main && git push -f origin vX.Y.Z`.
  3. On `main`: `CHROME_BIN=google-chrome-stable npm run pack:crx`, then `gh release upload vX.Y.Z .output/vertically-challenged-X.Y.Z-crx.zip --clobber`.
  4. Confirm the release asset digest matches the local `sha256sum`.
  - The signing key is `.output/chrome-mv3.pem`. It stays out of git and is never regenerated.

## Delegation

- The main agent plans, decides and verifies.
- Exploration, search, routine edits, docs and test scaffolding go to subagents.
- Default to the cheapest model (Haiku). Use Sonnet only for security boundaries, migrations, or debugging that Haiku has failed at.
- State the model choice when delegating.

## Issues and labels

Issues live in GitHub Issues on humdedum1/vertically-challenged (via `gh`). Label vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. Issue templates and release notes (`.github/release.yml`) also use the type labels bug, enhancement, documentation, dependencies and skip-changelog. File issues only into this repo, never into an upstream.
