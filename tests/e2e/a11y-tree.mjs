// What a screen reader gets: named landmarks and panels, a well-formed tree whose rows are
// named and numbered, an active-descendant that follows the arrow keys, live regions, and
// panel switching from the keyboard. Read from Chromium's accessibility tree and the DOM;
// it is not a substitute for listening to a real screen reader.
//   node tests/e2e/a11y-tree.mjs [extension dir]
import { check, extensionDir, finish, launch, sleep } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 800 });
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'no page errors', e.message));
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await page.waitForSelector('[role=treeitem]');
for (let i = 0; i < 8; i++)
  await page.evaluate((n) => chrome.tabs.create({ url: `about:blank#t${n}`, active: false }), i);
await sleep(1000);

const snap = await page.locator('body').ariaSnapshot();
check(
  /- main:/.test(snap) && /heading "[^"]+" \[level=1\]/.test(snap),
  'a main landmark with a level-1 heading',
);
check(/tablist "[^"]+"/.test(snap), 'the panel switcher is a named tablist');
check(/tree "[^"]+"/.test(snap), 'the tab list is a named tree');
check(!/- treeitem:/.test(snap), 'every tree item has an accessible name');

const items = await page.evaluate(() =>
  [...document.querySelectorAll('[role=treeitem]')].map((e) => ({
    level: Number(e.getAttribute('aria-level')),
    pos: Number(e.getAttribute('aria-posinset')),
    size: Number(e.getAttribute('aria-setsize')),
  })),
);
check(items.length >= 5, 'the tree has rows', String(items.length));
check(
  items.every((i) => i.level >= 1 && i.pos >= 1 && i.size >= i.pos),
  'every row states its level and position (level >= 1, posinset <= setsize)',
);

const tabs = await page.evaluate(() => {
  const t = [...document.querySelectorAll('[role=tab]')];
  return {
    n: t.length,
    selected: t.filter((e) => e.getAttribute('aria-selected') === 'true').length,
  };
});
check(
  tabs.n === 5 && tabs.selected === 1,
  'five panels, exactly one selected',
  JSON.stringify(tabs),
);

// Keyboard: the arrow keys move the active descendant through real, distinct rows.
await page.locator('[role=tree]').focus();
const seen = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('ArrowDown');
  seen.push(
    await page.evaluate(() => {
      const id = document.querySelector('[role=tree]').getAttribute('aria-activedescendant');
      const el = id ? document.getElementById(id) : null;
      return el?.getAttribute('role') === 'treeitem' ? id : null;
    }),
  );
}
check(
  seen.every(Boolean) && new Set(seen).size === seen.length,
  'ArrowDown moves aria-activedescendant to a different real row each time',
  JSON.stringify(seen),
);

// Keyboard: arrows on the panel switcher change the panel and its tabpanel name.
await page.locator('[role=tab][aria-selected=true]').focus();
await page.keyboard.press('ArrowRight');
await sleep(300);
const switched = await page.locator('body').ariaSnapshot();
check(
  /- tab "Sessions" \[selected\]/.test(switched) && /tabpanel "Sessions"/.test(switched),
  'ArrowRight on the panel switcher selects the next panel, and its tabpanel is named after it',
);

const live = await page.evaluate(
  () => document.querySelectorAll('[role=status],[role=alert],[aria-live]').length,
);
check(live > 0, 'live regions exist for status messages', String(live));

await close();
finish();
