// "Tidy up tabs…" (command palette) lists tabs not used for a while by site; Park puts them away
// and Close closes them. Time is moved 40 days ahead in the page so fresh tabs count as old.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 900 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const ids = await page.evaluate(async () => {
    const w = await chrome.windows.getCurrent();
    const out = [];
    for (const url of ['chrome://version/', 'chrome://flags/'])
      out.push((await chrome.tabs.create({ windowId: w.id, url, active: false })).id);
    return out;
  });
  await page.waitForTimeout(1500);
  await page.clock.install();
  await page.clock.setFixedTime(Date.now() + 40 * 86_400_000);

  const search = page.getByRole('searchbox', { name: 'Search tabs' });
  await search.fill('>tidy');
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Tidy up tabs' });
  await dialog.waitFor();
  await dialog.getByText('Other pages', { exact: true }).waitFor();
  await dialog.getByText(/\d+ tabs? on 1 site/).waitFor();

  await dialog.getByRole('button', { name: /^Park \d+ tabs/ }).click();
  await page.waitForFunction(
    async () => ((await chrome.storage.local.get('vc:snoozed'))['vc:snoozed'] ?? []).length >= 2,
  );
  const gone = await page.evaluate(
    async (ids) =>
      (
        await Promise.all(
          ids.map((id) =>
            chrome.tabs.get(id).then(
              () => true,
              () => false,
            ),
          ),
        )
      ).every((x) => !x),
    ids,
  );
  assert.equal(gone, true);
  await dialog.getByText('Nothing to tidy up.').waitFor();
  console.log('PASS tidy up lists old tabs by site and Park puts them away');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  console.log('PASS Escape closes the dialog');
} finally {
  await close();
}
