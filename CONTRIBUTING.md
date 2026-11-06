# Contributing

Vertically Challenged is a personal, open-source project. Contributions are welcome from anyone, including people who use AI tools in their workflow.

This project is developed with AI assistance. Humans review and own every change; contributors remain responsible for what they submit. You are responsible for understanding your changes and verifying them; generated code and a passing test suite are not substitutes for review.

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Support](SUPPORT.md) guide.

## Before you start

Use the [issue chooser](https://github.com/humdedum1/vertically-challenged/issues/new/choose) for bugs, feature requests, and documentation issues. Search existing issues first. Discuss large features before building them. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Report the extension version, browser/OS, installation method, reproduction steps, expected and actual behavior, and any sanitized evidence. For sync issues, include which data is missing, the chosen interval, device count, whether Sync now helps, and the status/error shown in Settings. Never attach browsing history, private URLs, credentials, or signing keys.

## Local development

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:23da45be114b0a348d050ee0151805955b82267fe276b1a06359c465e001c17d -->

1. Fork the repository on GitHub and clone your fork. Ensure your fork includes the `dev` branch, then run `git fetch origin dev` before creating a feature branch with `git switch -c fix/short-description origin/dev`. If your fork lacks `dev`, add the original repository as an upstream remote with `git remote add upstream https://github.com/humdedum1/vertically-challenged.git`, then run `git fetch upstream dev` and `git switch -c fix/short-description upstream/dev`.

<!-- /coderabbit-ai-generated:v1 -->
2. Use Node.js 22 or later and run `npm ci`.
3. Run `npm run dev`, or build with `npm run build` and load `.output/chrome-mv3` through Chrome's Load unpacked. For Firefox, `npm run build:firefox` writes `.output/firefox-mv3` (load its `manifest.json` from `about:debugging`), and `npm run start:firefox` runs it with web-ext.
4. Keep changes focused and follow nearby TypeScript/Svelte code and the existing UI components. Avoid adding dependencies for small changes.
5. Add a meaningful regression test for changed behavior. Preserve incognito separation, input validation, and existing data during migrations.

## Checks before a PR

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:81f6dabed85ded4978a254eadabf3a67d31df70507a2d0ccfd6d69b660d57bdf -->

Install Chromium before running the local CI gate. The gate runs the validation script, the Chromium end-to-end tests, and the Firefox 140 smoke test:

```sh
npx playwright-core install chromium
FIREFOX_BIN=/path/to/firefox npm run ci
```

<!-- /coderabbit-ai-generated:v1 -->

`FIREFOX_BIN` must point to Firefox 140 or newer. To run the steps one at a time:

```sh
npm run lint
npm run check
npm test
npm run build
npm run build:firefox
npx playwright-core install chromium
npm run test:e2e
FIREFOX_BIN=/path/to/firefox npm run test:e2e:firefox
```

Use `npx playwright-core install --with-deps chromium` when the operating system needs browser libraries. To run the pull-request workflow locally, you can use [`act`](https://github.com/nektos/act) (it needs Docker): `act pull_request -W .github/workflows/checks.yml`. This is optional; GitHub Actions remains the reference.

Test UI changes in the real panel and popup at narrow widths, with keyboard navigation and accessible labels. For performance changes, profile first and include before/after measurements; see [bench/README.md](bench/README.md).

Firefox support has had far less testing than Chrome, so Firefox fixes and extra Firefox tests are especially welcome. Say which browser a change was tested in.

Report exactly which checks you ran and their results. If a check could not run, state why. Never include a real browser profile in a test or commit private session data.

## Pull requests and review

- Open pull requests against `dev` from your feature branch. Maintainers merge `dev` into `main`, which cuts the release.
- Explain the concrete problem and final behavior, link relevant issues, and include screenshots for visible UI changes.
- Include verification results and any known limits. Mention AI assistance when it materially affected the implementation or review.
- Use Conventional Commits, such as `fix(sync): include ordinary tabs in workspace snapshots` or `feat(panel): add a reload control`.
- State release impact: NONE for internal/docs-only work, PATCH for compatible fixes, MINOR for compatible features, MAJOR for breaking changes. Judge the actual behavior, not just the prefix.
- Do not manually bump package versions, create tags, publish releases, change repository settings, or include private signing keys in an ordinary PR.

GitHub Actions checks PRs with lint, type checking, tests, builds, and real-browser flows. Maintainers may ask for smaller changes or additional evidence. Dependency updates require review and are not automatically merged.

## Releases

The release workflow runs on `main` and creates Semantic Versioning releases from Conventional Commits. Each release gets:

- `vertically-challenged-<version>-crx.zip`: the signed Chrome CRX. It needs the `CRX_PRIVATE_KEY` Actions secret (the PEM signing key; never generate a replacement for an update).
- `vertically-challenged-<version>-firefox.zip` and `-sources.zip`: the Firefox build and the source archive Mozilla asks for. When the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` secrets exist, the release is also signed on addons.mozilla.org (unlisted) and the signed `.xpi` is attached. Set the repository variable `AMO_CHANNEL` to `listed` to submit releases for the public AMO listing instead; see [docs/store/AMO.md](docs/store/AMO.md).
- Optionally, an upload to the Chrome Web Store: set the repository variables `CWS_EXTENSION_ID` and `CWS_PUBLISHER_ID` and the secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`. Set the variable `CWS_AUTO_PUBLISH` to `true` to also submit the upload for review. See [docs/store/LISTING.md](docs/store/LISTING.md).

Dry runs do not sign or upload anything. For local packaging, run `npm run pack:crx`. It uses `.output/chrome-mv3.pem` by default; set `CRX_KEY_PATH` for another location and `CHROME_BIN` if Chrome is not available as `google-chrome`. Chrome/Chromium, `zip`, and `unzip` must be installed. Keep the signing key outside the repository and the package, and keep a backup of it somewhere other than `.output`.

## Branch protection

`main` disallows force pushes and deletion. Changes reach it through a pull request from `dev`, and the `check` job must pass first. Branch rules can't require a PR for everyone, because the release workflow pushes the version commit to `main` itself.

When you merge a PR on GitHub, use a commit email you're happy to publish. GitHub otherwise uses your account's primary email for the merge commit.

## License

By contributing, you agree that your contribution is available under this project's [GPLv3 license](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md).
