# Contributing

Use the issue chooser for bug reports, feature requests, and documentation issues. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

For a code change:

1. Keep the change focused and follow nearby code conventions.
2. Add a regression test for a bug or new behavior.
3. Run `npm ci`, `npm run lint`, `npm run check`, `npm test`, and `npm run build`.
4. For UI or browser integration changes, install Chromium with `npx playwright-core install chromium` and run `npm run test:e2e`.
5. Describe the behavior change and validation in the pull request. Use Conventional Commits, for example `fix(panel): restore tab activation after reconnect`.

Dependabot checks npm dependencies and GitHub Actions weekly. Pull requests run lint, type checking, unit tests, a production build, and browser checks. Dependency updates require review; they are not automatically merged.

Repository maintainers: these files take effect on GitHub after merging into the default branch. Configure a private security contact in SECURITY.md. GitHub private vulnerability reporting is only available for public repositories; if the repository becomes public, enable it and verify the report link before directing reporters there. The private report form is defined in .github/VULNERABILITY_REPORT.yml. Make the `Pull request checks / check` check required in branch protection if desired. Dependabot security alerts and security updates have separate repository settings. The existing release workflow is unchanged.
