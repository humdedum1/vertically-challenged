// Regenerates the README screenshots (docs/store/readme-*.png) in the Noctalia theme.
//   node tests/e2e/shots.mjs [extension dir]
import { extensionDir, launch, sleep } from './harness.mjs';

const SITES = [
  'https://en.wikipedia.org/wiki/Tab_(interface)',
  'https://github.com/',
  'https://developer.mozilla.org/en-US/',
  'https://news.ycombinator.com/',
  'https://www.rust-lang.org/',
  'https://svelte.dev/',
];
const { ctx, extId, close } = await launch(extensionDir(), {
  width: 360,
  height: 760,
  scale: 2,
  headed: !process.env.SHOTS_HEADLESS, // headless often misses favicons
});
try {
  // Background tabs often never store a favicon, so load each site in the foreground first.
  const warm = ctx.pages()[0];
  for (const url of SITES) {
    await warm.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(1500);
  }
  // One windows.create call, so the tabs open flat rather than as each other's children.
  const boot = await ctx.newPage();
  await boot.goto(`chrome-extension://${extId}/sidepanel.html`);
  const opened = ctx.waitForEvent('page', (p) => p.url().includes('sidepanel.html'));
  await boot.evaluate(
    (urls) => chrome.windows.create({ url: urls }),
    [`chrome-extension://${extId}/sidepanel.html`, ...SITES],
  );
  const page = await opened;
  await warm.close(); // on a real site, so Recently closed shows it rather than about:blank
  await boot.close();
  await page.bringToFront();
  await sleep(5000);
  await page.reload();
  await sleep(2000);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
  await tab('Settings');
  await page.getByRole('button', { name: 'Use Noctalia', exact: true }).click();
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details[open]')) d.removeAttribute('open');
  });
  await page.mouse.move(2, 2);
  // Color mode defaults to system, so emulating the OS scheme flips Noctalia light/dark.
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const n of ['Tabs', 'History', 'Settings']) {
      await tab(n);
      await sleep(1000);
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('details[open]')) d.removeAttribute('open');
      });
      await page.mouse.move(2, 2);
      await sleep(300);
      await page.screenshot({ path: `docs/store/readme-${n.toLowerCase()}-${scheme}.png` });
    }
  }
  // One view per store image, in each style. store-assets.mjs lays the three side by side.
  await page.setViewportSize({ width: 360, height: 640 });
  const search = page.getByRole('searchbox', { name: 'Search tabs' });
  const appearance = async () => {
    await tab('Settings');
    const style = page.getByRole('radio', { name: 'Classic', exact: true });
    if (!(await style.isVisible())) await page.getByText('Appearance', { exact: true }).click();
    return style;
  };
  for (const skin of ['classic', 'dense', 'glass']) {
    await appearance();
    await page
      .getByRole('radio', { name: skin[0].toUpperCase() + skin.slice(1), exact: true })
      .click();
    for (const [view, scheme] of [
      ['tabs', 'light'],
      ['search', 'dark'],
      ['history', 'light'],
      ['settings', 'dark'],
    ]) {
      await page.emulateMedia({ colorScheme: scheme });
      if (view === 'settings') {
        await (await appearance()).scrollIntoViewIfNeeded();
        await page.evaluate(() => document.activeElement?.blur());
      } else {
        await tab(view === 'history' ? 'History' : 'Tabs');
        await search.fill(view === 'search' ? 'web' : '').catch(() => {});
      }
      await page.mouse.move(2, 2);
      await sleep(1000);
      await page.screenshot({ path: `docs/store/style-${view}-${skin}.png` });
    }
    await tab('Tabs');
    await search.fill('');
  }
} finally {
  await close();
}
