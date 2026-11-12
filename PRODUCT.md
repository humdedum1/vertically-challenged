# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Power users with many tabs and windows who know Sidebery, Zen Browser or Arc and want that kind of vertical tab management in Chrome (and now Firefox). They keep the panel open all day beside their work, switch and search tabs constantly, and expect it to stay fast with hundreds of tabs.

## Product Purpose

Vertically Challenged shows every tab in every window as one searchable, local-first vertical list, in Chrome's side panel, an in-page popup or a window (Firefox: sidebar or window). It exists because Chromium had nothing like Sidebery or Zen. Success means a heavy tab user can find, organise, park and restore tabs faster than with the browser's own strip, without giving up privacy or control.

## Positioning

All four of these together, none traded away for another:

- **Local-first privacy:** no backend, no telemetry, no install-time host permissions, incognito kept separate from normal windows and sync.
- **Zen/Sidebery depth in Chromium:** Staples, nested pinned folders, child tabs, native tab groups, window setups, snooze, sessions, other devices.
- **A look the user controls:** three styles (Classic, Dense, Glass), built-in and custom themes, accent colour, density, fonts, row layout and custom CSS.
- **Speed and keyboard:** fuzzy search over tabs, bookmarks, history and sessions; a `>` command palette; rebindable shortcuts; fast at hundreds of tabs.

## Operating Context

- Lives in a narrow, always-open side panel (about 300–400px wide), next to the page the user is working on; also as an in-page popup overlay and a standalone window.
- Used in short, frequent glances and keyboard bursts: search, switch, close, nest, suspend.
- Panels: Tabs, Sessions, Bookmarks, History, Settings; plus Recently closed, the command palette and context menus.
- Data moves only through the browser's own sync and user-chosen backup targets (Downloads, WebDAV, S3-compatible, Dropbox).

## Capabilities and Constraints

- Chrome 116+ and Firefox 140+, Manifest V3; WXT, Svelte 5, TypeScript.
- Every browser call must work on both, or have a documented Firefox fallback (side panel vs sidebar).
- No server backend, no telemetry. No install-time host permissions; remote backups ask for an optional origin grant at runtime.
- Incognito separation is a hard requirement: incognito tabs and data never reach normal windows or sync.
- Data loss is the worst failure: any stored or synced data shape change needs a version bump, a migration and a test.
- Terminology to keep: Staples, pinned folders, child tabs, window setups, saved sessions, snooze, park, suspend, Clear, Tidy up, Recently closed, Other devices.

## Brand Commitments

- Name: **Vertically Challenged**.
- Voice: plain and candid. Short sentences, controls named by their action, limits stated openly (the README warns it is a young, AI-assisted project and asks users to keep backups).
- License: GPL-3.0-or-later (`LICENSE`, `package.json`).

## Evidence on Hand

- Store and README screenshots: `docs/store/store-*.png`, `docs/store/style-*-{classic,dense,glass}.png`, `docs/store/readme-*.png`, `docs/store/readme-promo.png`.
- Store copy: `docs/store-listing.md`, `docs/store/LISTING.md`, `docs/store/AMO.md`. Privacy policy: `docs/PRIVACY.md`.
- No user counts, ratings, reviews, testimonials or benchmarks are on hand; do not invent any.

## Product Principles

1. **Never lose the user's data.** Safety and undo beat speed of shipping.
2. **Private by construction.** A feature that needs a server, tracking or broad permissions is the wrong feature.
3. **Fast in the hand.** Every common action works from the keyboard and stays quick at hundreds of tabs.
4. **Depth without clutter.** Power features are there when wanted, out of the way when not.
5. **The user's panel, the user's look.** Styles and themes are first-class; every built-in variant meets the same quality bar.

## Accessibility & Inclusion

WCAG 2.2 AA across every style, theme and mode: AA text contrast (built-in themes are tested), full keyboard operation with visible focus, accessible names for screen readers (axe: no serious or critical violations), reduced-motion and forced-colours modes respected, and usable by touch.
