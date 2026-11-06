# Vertically Challenged task runner. `just --list` shows recipes.
set shell := ["bash", "-euo", "pipefail", "-c"]

# WXT dev build
dev:
    npm run dev

# The local gate: install, lint, typecheck, unit tests, both builds and web-ext lint.
ci:
    bash .github/release/validate.sh

# Browser checks: Chromium e2e, then the Firefox smoke test. Run before a PR.
# FIREFOX_BIN overrides the Firefox 140 that gets downloaded (the oldest the manifest allows).
qa:
    npm run build
    npm run build:firefox
    CHROME_BIN="" npm run test:e2e
    if [ -z "${FIREFOX_BIN:-}" ]; then \
      out=$(npx --yes @puppeteer/browsers@3.2.6 install firefox@stable_140.0 --path "${XDG_CACHE_HOME:-$HOME/.cache}/vertically-challenged/firefox" | tail -1); \
      export FIREFOX_BIN="${out#* }"; \
    fi; \
    npm run test:e2e:firefox || { echo "Firefox smoke test failed, retrying once"; npm run test:e2e:firefox; }

fmt:
    npm run lint:fix

# Pure-logic benchmarks
bench:
    npm run bench:pure
