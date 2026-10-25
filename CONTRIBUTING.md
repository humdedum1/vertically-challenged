# Contributing

Vertically Challenged is a vibecoded, AI-assisted personal project. Contributions from humans and AI-assisted workflows are welcome. You are responsible for understanding your changes and verifying them; generated code and a passing test suite are not substitutes for review.

## Before you start

Use the [issue chooser](https://github.com/humdedum1/vertically-challenged/issues/new/choose) for bugs, feature requests, and documentation issues. Search existing issues first. Discuss large features before building them. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Report the extension version, browser/OS, installation method, reproduction steps, expected and actual behavior, and any sanitized evidence. For sync issues, include which data is missing, the chosen interval, device count, whether Sync now helps, and the status/error shown in Settings. Never attach browsing history, private URLs, credentials, or signing keys.

## Local development

1. Fork the repository if you have access, or create a branch in your clone.
2. Use Node.js 22 or later and run `npm ci`.
3. Run `npm run dev`, or build with `npm run build` and load `.output/chrome-mv3` through Chrome's Load unpacked.
4. Keep changes focused and follow nearby TypeScript/Svelte code and the existing UI components. Avoid adding dependencies for small changes.
5. Add a meaningful regression test for changed behavior. Preserve incognito separation, input validation, and existing data during migrations.

## Checks before a PR

```sh
npm run lint
npm run check
npm test
npm run build
npx playwright-core install chromium
npm run test:e2e
```

Use `npx playwright-core install --with-deps chromium` when the operating system needs browser libraries. Test UI changes in the real panel and popup at narrow widths, with keyboard navigation and accessible labels. For performance changes, profile first and include before/after measurements; see [bench/README.md](bench/README.md).

Report exactly which checks you ran and their results. If a check could not run, state why. Never include a real browser profile in a test or commit private session data.

## Pull requests and review

- Target `main` from a feature branch.
- Explain the concrete problem and final behavior, link relevant issues, and include screenshots for visible UI changes.
- Include verification results and any known limits. Mention AI assistance when it materially affected the implementation or review.
- Use Conventional Commits, such as `fix(sync): include ordinary tabs in workspace snapshots` or `feat(panel): add a reload control`.
- State release impact: NONE for internal/docs-only work, PATCH for compatible fixes, MINOR for compatible features, MAJOR for breaking changes. Judge the actual behavior, not just the prefix.
- Do not manually bump package versions, create tags, publish releases, change repository settings, or include private signing keys in an ordinary PR.

GitHub Actions checks PRs with lint, type checking, tests, builds, and real-browser flows. Maintainers may ask for smaller changes or additional evidence. Dependency updates require review and are not automatically merged.

## Releases

The existing release workflow runs on `main` and creates Semantic Versioning releases from Conventional Commits. Release publishing and signing are maintainer responsibilities. `npm run zip` creates an unpacked-extension ZIP; signed CRX archives are a separate release artifact. Keep the signing key private and reuse it for compatible extension updates.

Every new release automatically receives `vertically-challenged-<version>-crx.zip`, containing the signed CRX. Maintainers must configure the `CRX_PRIVATE_KEY` Actions secret with the existing PEM signing key; never generate a replacement for an update. Dry runs do not sign or upload packages.

For local packaging, run `npm run pack:crx`. It uses `.output/chrome-mv3.pem` by default; set `CRX_KEY_PATH` for another location and `CHROME_BIN` if Chrome is not available as `google-chrome`. Chrome/Chromium, `zip`, and `unzip` must be installed. The signing key stays outside the package.

## Branch protection

The intended `main` protection is: require PRs and one approval, dismiss stale approvals, require the `check` CI job with the branch up to date, resolve conversations, and disallow force pushes and deletion. Administrator bypass remains available for maintainer recovery.

On 2026-10-24 GitHub rejected protection/ruleset access for this private repository with HTTP 403: “Upgrade to GitHub Pro or make this repository public to enable this feature.” No branch protection is claimed to be active. An owner must enable a suitable plan or explicitly choose to make the repository public, then apply and verify these settings. PR instructions and CI alone do not enforce branch protection.

## License

By contributing, you agree that your contribution is available under this project's [MIT license](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md).
