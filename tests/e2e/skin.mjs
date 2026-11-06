// Choosing a Style in Settings > Appearance sets html[data-skin].
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 1000 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const skin = () => page.evaluate(() => document.documentElement.dataset.skin);
  assert.equal(await skin(), 'classic');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Glass', exact: true }).click();
  assert.equal(await skin(), 'glass');
  await page.getByRole('radio', { name: 'Dense', exact: true }).click();
  assert.equal(await skin(), 'dense');
  console.log('PASS style control switches html[data-skin]');
} finally {
  await close();
}
