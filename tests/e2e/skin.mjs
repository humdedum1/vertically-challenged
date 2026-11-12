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
  // A panel-in fade that stays filled after it ends keeps the panel a backdrop root, and
  // menus and the sticky Preview card then show sharp text through their glass.
  await page.getByRole('tab', { name: 'Tabs', exact: true }).click();
  await page.waitForTimeout(500);
  assert.deepEqual(
    await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.target?.parentElement?.classList.contains('panel'))
        .map((a) => a.animationName),
    ),
    [],
    'the glass panel fade stays applied after it ends',
  );
  console.log('PASS the glass panel fade ends, so overlays blur what is behind them');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dense', exact: true }).click();
  assert.equal(await skin(), 'dense');
  console.log('PASS style control switches html[data-skin]');
} finally {
  await close();
}
