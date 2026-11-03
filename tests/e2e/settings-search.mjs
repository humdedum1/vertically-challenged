// The Settings search box narrows the page to matching settings, opens their sections, and
// clearing it puts everything back as it was.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 1400 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Appearance' }).waitFor();

  const visibleSummaries = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.cards > details')]
        .filter((d) => !d.hidden)
        .map((d) => d.querySelector('strong')?.textContent),
    );
  const opens = () =>
    page.evaluate(() => [...document.querySelectorAll('.cards > details')].map((d) => d.open));
  const before = await opens();
  const box = page.getByRole('textbox', { name: 'Search settings', exact: true });

  await box.fill('passphrase');
  await page.getByText(/settings? found/).waitFor();
  assert.deepEqual(await visibleSummaries(), ['Data']);
  // The section eases open, so the field is zero-sized for a moment after the search.
  await page.getByLabel('Backup passphrase', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(
    await page.getByLabel('Where to save', { exact: true }).isVisible(),
    false,
    'unrelated settings are hidden',
  );
  console.log('PASS search narrows Settings to the matching controls and opens their section');

  await box.fill('zzzz-nothing');
  await page.getByText('No settings match', { exact: false }).waitFor();
  assert.deepEqual(await visibleSummaries(), []);

  await box.fill('');
  assert.deepEqual(await visibleSummaries(), [
    'Appearance',
    'Panel & tabs',
    'Rules & suspending',
    'Shortcuts',
    'Data',
  ]);
  assert.deepEqual(await opens(), before, 'accordions return to how they were');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-sf]').length), 0);
  console.log('PASS clearing the search restores every setting and section');
} finally {
  await close();
}
