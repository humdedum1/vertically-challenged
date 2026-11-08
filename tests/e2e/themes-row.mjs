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

  // Hovering a theme previews it; leaving restores the real one.
  const primary = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mPrimary').trim(),
    );
  const original = await primary();
  const dracula = page.getByRole('button', { name: 'Use Dracula', exact: true });
  await dracula.hover();
  await page.waitForFunction(
    (o) => getComputedStyle(document.documentElement).getPropertyValue('--mPrimary').trim() !== o,
    original,
  );
  await page.mouse.move(2, 2);
  await page.waitForFunction(
    (o) => getComputedStyle(document.documentElement).getPropertyValue('--mPrimary').trim() === o,
    original,
  );
  console.log('PASS hovering a theme previews it and leaving restores the current one');

  const pick = page.getByRole('button', { name: 'Use Nord', exact: true });
  assert.equal(await pick.getAttribute('aria-pressed'), 'false');
  await pick.click();
  assert.equal(await pick.getAttribute('aria-pressed'), 'true');

  const dup = page.getByRole('button', { name: 'Duplicate Nord', exact: true });
  assert.equal(await dup.count(), 0);
  await page.getByRole('button', { name: 'More actions for Nord', exact: true }).click();
  await dup.waitFor();
  console.log('PASS a theme row picks on click and reveals its other actions behind More');

  await page.locator('summary').filter({ hasText: 'Data' }).click();
  await page.getByLabel('Where to save', { exact: true }).selectOption('webdav');
  for (const label of ['Folder URL', 'User', 'Password (use an app password)']) {
    assert.equal(await page.locator('label', { hasText: label }).count(), 1, label);
  }
  console.log('PASS backup server fields have visible labels');

  // Sessions: the common actions are visible; Rename, Export and Delete sit behind More.
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      sessions: [
        {
          id: 'ss1',
          name: 'Trip',
          createdAt: Date.now(),
          windows: [
            {
              groups: [],
              tabs: [{ url: 'https://a.example/', title: 'A', pinned: false, group: null }],
            },
          ],
        },
      ],
    });
  });
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Rename', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'More actions for Trip', exact: true }).click();
  await page.getByRole('button', { name: 'Export Trip as Markdown', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rename', exact: true }).waitFor();
  console.log('PASS session rows keep rare actions behind More');
} finally {
  await close();
}
