// Command palette: ">" (outside text fields) opens it in the search field, typing filters, Enter runs.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 300, height: 800 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const count = () =>
    page.evaluate(async () => {
      const w = await chrome.windows.getCurrent();
      return (await chrome.tabs.query({ windowId: w.id })).filter(
        (t) => (t.pendingUrl || t.url) === 'chrome://version/',
      ).length;
    });
  await page.evaluate(async () => {
    const windowId = (await chrome.windows.getCurrent()).id;
    for (let i = 0; i < 3; i++)
      await chrome.tabs.create({ windowId, url: 'chrome://version/', active: false });
  });
  assert.equal(await count(), 3);

  await page.locator('body').press('>');
  const search = page.getByRole('searchbox', { name: 'Search tabs' });
  assert.equal(await search.inputValue(), '>');
  await page.keyboard.type('dup close');
  const list = page.getByRole('list', { name: 'Commands' });
  assert.deepEqual(await list.getByRole('button').allTextContents(), ['Close duplicate tabs']);
  await search.press('Enter');
  for (let i = 0; i < 50 && (await count()) !== 1; i++) await page.waitForTimeout(100);
  assert.equal(await count(), 1);
  assert.equal(await search.inputValue(), '');

  // Closing tabs mounts this section below the list, shrinking it; wait so it can't land after the scroll.
  await page.getByText('Recently closed').waitFor();
  await search.fill('>theme');
  const last = list.getByRole('button').last();
  await last.scrollIntoViewIfNeeded();
  const box = await last.boundingBox();
  const clip = await page.locator('.list').boundingBox();
  assert.ok(
    box && clip && box.y + box.height <= clip.y + clip.height + 1,
    'the last command scrolls into view',
  );
  // Hover and the Enter default never show two identical highlights: under the pointer, only
  // the hovered command is lit.
  await search.fill('>');
  const third = list.getByRole('button').nth(2);
  await third.scrollIntoViewIfNeeded();
  await third.hover();
  const lit = await list
    .getByRole('button')
    .evaluateAll(
      (bs) => bs.filter((b) => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
    );
  assert.equal(lit, 1, 'only the hovered command is highlighted');
  console.log('PASS hovering the palette leaves one highlighted command');

  await search.fill('');
  await page.locator('[id^="vc-row-t"]').first().click({ button: 'right' });
  const items = page.getByRole('menuitem');
  await items.first().waitFor();
  await items.nth(2).hover();
  assert.equal(
    await items.nth(2).evaluate((el) => el === document.activeElement),
    true,
    'the hovered menu item takes focus',
  );
  await page.keyboard.press('Escape');
  console.log('PASS the context menu has one highlight: pointer moves focus');

  await search.fill('>nothing-like-this');
  await page.getByRole('status').filter({ hasText: 'No matching commands' }).waitFor();
  console.log('PASS palette opens with >, filters, and runs a command with Enter');
} finally {
  await close();
}
