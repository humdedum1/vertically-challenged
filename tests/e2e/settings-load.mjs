// Settings must remain available when a separate settings chunk cannot be loaded.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
try {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/chunks/SettingsPanel-*.js', (route) => route.abort());
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Appearance' }).waitFor({ timeout: 5000 });
  await page.locator('summary').filter({ hasText: 'Panel & tabs' }).click();
  await page.getByRole('textbox', { name: 'New tab URL', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Tabs', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Appearance' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS settings opens and reopens without a separate settings-file request');
} finally {
  await close();
}
