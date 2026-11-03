// Deleting a session and resetting settings happen at once and offer Undo in a toast.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 1600 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
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
  const stored = () =>
    page.evaluate(async () =>
      ((await chrome.storage.local.get('sessions')).sessions ?? []).map((s) => s.id),
    );

  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'More actions for Trip', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Deleted “Trip”', { exact: true }).first().waitFor();
  await page.waitForFunction(
    async () => ((await chrome.storage.local.get('sessions')).sessions ?? []).length === 0,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(
    async () => ((await chrome.storage.local.get('sessions')).sessions ?? []).length === 1,
  );
  assert.deepEqual(await stored(), ['ss1']);
  console.log('PASS deleting a session is immediate and Undo brings it back');

  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Use Dracula', exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await chrome.storage.sync.get('settings')).settings?.appearance?.themeId === 'dracula',
  );
  await page.locator('summary').filter({ hasText: 'Data' }).click();
  await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await chrome.storage.sync.get('settings')).settings?.appearance?.themeId === 'abyss',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await chrome.storage.sync.get('settings')).settings?.appearance?.themeId === 'dracula',
  );
  console.log('PASS resetting settings is immediate and Undo restores them');
} finally {
  await close();
}
