// Themes list: the whole row picks a theme; Duplicate/Export sit behind "More". The Data
// card's backup fields have visible labels, not placeholders alone.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 340, height: 1200 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Appearance' }).waitFor();

  const pick = page.getByRole('button', { name: 'Use Noctalia', exact: true });
  assert.equal(await pick.getAttribute('aria-pressed'), 'false');
  await pick.click();
  assert.equal(await pick.getAttribute('aria-pressed'), 'true');

  const dup = page.getByRole('button', { name: 'Duplicate Noctalia', exact: true });
  assert.equal(await dup.count(), 0);
  await page.getByRole('button', { name: 'More actions for Noctalia', exact: true }).click();
  await dup.waitFor();
  console.log('PASS a theme row picks on click and reveals its other actions behind More');

  await page.locator('summary').filter({ hasText: 'Data' }).click();
  await page.getByLabel('Where to save', { exact: true }).selectOption('webdav');
  for (const label of ['Folder URL', 'User', 'Password (use an app password)']) {
    assert.equal(await page.locator('label', { hasText: label }).count(), 1, label);
  }
  console.log('PASS backup server fields have visible labels');
} finally {
  await close();
}
