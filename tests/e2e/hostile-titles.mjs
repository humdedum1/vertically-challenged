// 100 tabs whose titles are very long, right-to-left, emoji, CJK or HTML-looking: the list
// still renders, nothing sticks out sideways, and no title is ever interpreted as markup.
//   node tests/e2e/hostile-titles.mjs [extension dir]
import http from 'node:http';
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const site = http
  .createServer((q, r) => {
    r.setHeader('content-type', 'text/html; charset=utf-8');
    const t = new URL(q.url, 'http://x').searchParams.get('t') ?? '';
    r.end(`<!doctype html><title>${t.replace(/</g, '&lt;')}</title><body>x</body>`);
  })
  .listen(0);
const base = `http://127.0.0.1:${site.address().port}`;
const TITLES = [
  'L'.repeat(400),
  'مرحبا بالعالم '.repeat(20),
  '😀'.repeat(150),
  '漢字かな交じり文'.repeat(30),
  '<img src=x onerror=window.__pwned=1>',
];

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 800 });
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
await page.evaluate(
  async ([b, titles]) => {
    for (let i = 0; i < 100; i++)
      await chrome.tabs.create({
        url: `${b}/?t=${encodeURIComponent(`${titles[i % titles.length]} ${i}`)}`,
        active: false,
      });
  },
  [base, TITLES],
);
await sleep(2500);

const rows = await page.evaluate(() => document.querySelectorAll('[id^="vc-row-t"]').length);
check(rows > 5, 'the list renders rows for the long and mixed-script titles', String(rows));
const m = await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  return {
    page: document.documentElement.scrollWidth - w,
    wide: [...document.querySelectorAll('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return (
          r.width > 0 &&
          s.position !== 'fixed' &&
          r.right > w + 1 &&
          !e.closest('[aria-hidden=true]')
        );
      })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${e.className}`),
    injected: document.querySelectorAll('img[src="x"]').length,
    pwned: window.__pwned === 1,
  };
});
check(m.page <= 1, 'the page does not scroll sideways', `${m.page}px`);
check(m.wide.length === 0, 'no element sticks out of the panel', m.wide.join(', '));
check(m.injected === 0 && !m.pwned, 'a title that looks like HTML stays text');

// Search copes with the same titles.
await page.keyboard.press('/');
const box = page
  .locator('input[type=search], input[role=searchbox], input[aria-label*="earch" i]')
  .first();
await box.fill('😀');
await sleep(500);
const shown = await page.evaluate(() =>
  [...document.querySelectorAll('[id^="vc-row-t"]')].map((e) => e.textContent ?? ''),
);
check(
  shown.length > 0 && shown.every((t) => t.includes('😀')),
  'searching for an emoji leaves only the emoji titles',
  `${shown.length} rows, ${shown.filter((t) => !t.includes('😀')).length} without the emoji`,
);

await close();
site.close();
finish();
