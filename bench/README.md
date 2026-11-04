# Benchmarks

Load-test and profiling scripts. They run Playwright's Chromium
headless (Google Chrome ignores `--load-extension`) or any Chromium in `CHROME_BIN`, with
the extension loaded unpacked into a throwaway profile. Nothing leaves the machine: the
fixture's sites are served from a local page server. Everything they write goes to
`bench/.out/` (gitignored).

One-time setup:

```powershell
npm install
npx playwright-core install chromium
npm run build
```

## Pure functions (no browser)

```powershell
npm run bench:pure
```

Row building, search, the worker store and message sizes at 1,500 synthetic tabs, as a
table of median / p95 / max ms per call. About 3 seconds.

## The 1,500-tab fixture

Most Chrome benchmarks attach to a running fixture: a headless Chromium with about
1,500 tabs in two windows, 30 tab groups, and 8 Essentials plus 12 pinned tabs in two
folders per build. Start it in its own terminal and leave it running (setup takes 2 to 3 minutes):

```powershell
node bench/fixture.mjs                                   # the production build
node bench/fixture.mjs .output\chrome-mv3 C:\old-build  # two builds, "a" and "b"
```

Stop it with Ctrl+C. Only one fixture runs at a time (it uses port 9333). The builds are
copied to `bench/.out/` with timing probes added; the originals aren't touched.

| Script | What it measures |
| --- | --- |
| `node bench/measure.mjs [--build a\|b] <phase...>` | The panel loaded in a tab (so it can be instrumented before it loads). Phases: `open` (cold and warm open timeline, with worker marks), `sizes` (message sizes), `events` (one title, 200 titles, 200 moves), `scroll`, `search`, `mem`, `drag`, `trace`, `throttle4` (scroll, search and drag at 4x CPU), `memburst`. Results go to `bench/.out/results-<build>.json`; `--out name` picks another file. |
| `node bench/side-panel.mjs [runs]` | Chrome's real side panel, cold (worker stopped) and warm. With two builds, runs alternate between them and paired differences are printed. |
| `node bench/tab-ops.mjs [--build a\|b] [runs]` | One `tabs.move`, `create` and `remove` in the 1,400-tab window: time from Chrome finishing the call to the panel receiving the patch. |
| `node bench/compare.mjs <results.json>...` | A Markdown table of the key numbers from `measure.mjs` result files. |

The other two start their own browser and don't need the fixture:

| Script | What it measures |
| --- | --- |
| `node bench/scroll-js.mjs [build] [second build] [--tabs N]` | The JavaScript cost of one scroll step (scroll handler plus Svelte's update) at 1x and 4x CPU, alternating between builds. |
| `node bench/cpu-profile.mjs [build] [--tabs N]` | A sampled CPU profile of a full scroll sweep at 4x CPU, with the top functions by self time. Build with `minify: false` first for readable names (see the script). |

## Comparing builds fairly

- The machine's load moves these numbers by tens of milliseconds between runs. Compare
  builds in alternating runs, not one batch after another.
- **`measure.mjs` and `tab-ops.mjs`: one build per fixture.** With two builds loaded,
  both workers react to every tab event and slow each other down, and the first slot is
  about 80 ms slower on cold opens even with identical builds. Run the fixture once per
  build and compare with `compare.mjs`.
- **`side-panel.mjs`: two builds in one fixture**, alternating. Run it twice with the
  builds swapped, or once with the same build in both slots as a control, before
  trusting a difference: the noise on cold opens is around ±50 ms.
- Timing marks in the worker hang off string literals in the minified code; when one
  can't be found the fixture prints `worker mark ... skipped` and that number is left out.
