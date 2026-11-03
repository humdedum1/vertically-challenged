// "?" shows the keyboard help (and never steals a "?" typed into a field); forced-colour mode
// keeps borders and theme swatches visible; settings sections still open with their animation.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 900 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const search = page.getByRole('searchbox', { name: 'Search tabs' });
  await search.waitFor();

  await search.click();
  await page.keyboard.type('?');
  assert.equal(await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(), 0);
  assert.equal(await search.inputValue(), '?');
  await search.fill('');

  // Move focus out of the search field first: "?" only counts outside text fields.
  await page.getByRole('button', { name: 'New tab', exact: true }).focus();
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await dialog.waitFor();
  await dialog.getByText('Command palette').waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    'Close',
    'focus moves into the dialog',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    'Close',
    'Tab cannot leave the dialog',
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    'New tab',
    'focus returns to where it was',
  );
  console.log('PASS ? opens the shortcut help, Escape closes it, typing ? in search is untouched');

  // Alt+N jumps to the Nth tab of the list.
  const target = await page.evaluate(async () => {
    const w = await chrome.windows.getCurrent();
    const t = await chrome.tabs.create({ windowId: w.id, url: 'chrome://version/', active: false });
    const all = await chrome.tabs.query({ windowId: w.id });
    return { id: t.id, n: all.findIndex((x) => x.id === t.id) + 1 };
  });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'New tab', exact: true }).focus();
  await page.keyboard.press(`Alt+${target.n}`);
  await page.waitForFunction(async (id) => (await chrome.tabs.get(id)).active, target.id);
  console.log('PASS Alt+number activates that tab');

  await page.emulateMedia({ forcedColors: 'active' });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const appearance = page.locator('summary').filter({ hasText: 'Appearance' });
  await appearance.waitFor();
  const { border, swatch } = await page.evaluate(() => {
    const card = document.querySelector('section.card');
    const sw = document.querySelector('.strip span');
    return {
      border: card ? getComputedStyle(card).borderTopWidth : '0px',
      swatch: sw ? getComputedStyle(sw).backgroundColor : '',
    };
  });
  assert.notEqual(border, '0px', 'cards keep a border in forced-colour mode');
  assert.ok(swatch && swatch !== 'rgba(0, 0, 0, 0)', 'theme swatches keep their colour');
  console.log('PASS forced-colour mode keeps card borders and theme swatches');

  await page.locator('summary').filter({ hasText: 'Shortcuts' }).click();
  await page.getByText('Key bindings', { exact: true }).waitFor();
  console.log('PASS a settings section opens and shows its card');
} finally {
  await close();
}
