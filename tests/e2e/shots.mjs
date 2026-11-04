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
  headed: true,
});
try {
  // Background tabs often never store a favicon, so load each site in the foreground first.
  // One tab navigated in turn leaves nothing extra in Recently closed.
  const warm = ctx.pages()[0];
  for (const url of SITES) {
    await warm.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(1500);
  }
  await warm.goto('about:blank');
  // One windows.create call, so the tabs open flat rather than as each other's children.
  const boot = await ctx.newPage();
  await boot.goto(`chrome-extension://${extId}/sidepanel.html`);
  const opened = ctx.waitForEvent('page', (p) => p.url().includes('sidepanel.html'));
  await boot.evaluate(
    (urls) => chrome.windows.create({ url: urls }),
    [`chrome-extension://${extId}/sidepanel.html`, ...SITES],
  );
  const page = await opened;
  for (const p of ctx.pages()) if (p.url() === 'about:blank') await p.close();
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
} finally {
  await close();
}
