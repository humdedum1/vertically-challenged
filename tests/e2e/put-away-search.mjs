// The search box also finds pages inside saved sessions and snoozed tabs, and a snoozed hit
// reopens the tab.
import assert from 'node:assert/strict';
import { extensionDir, launch, waitUntil } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 800 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      sessions: [
        {
          id: 'ss1',
          name: 'Trip',
          createdAt: now,
          windows: [
            {
              groups: [],
              tabs: [
                {
                  url: 'https://hotels.example/rome',
                  title: 'Hotels in Rome',
                  pinned: false,
                  group: null,
                },
              ],
            },
          ],
        },
      ],
      'vc:snoozed': [
        {
          id: 'sn1',
          url: 'chrome://version/',
          title: 'Zebra reference page',
          wakeAt: now + 3_600_000,
          snoozedAt: now,
        },
      ],
    });
  });
  await page.reload();
  const search = page.getByRole('searchbox', { name: 'Search tabs' });
  await search.fill('rome');
  await page.getByRole('button', { name: /Hotels in Rome/ }).waitFor();
  await page.getByText('Saved sessions', { exact: true }).waitFor();
  console.log('PASS a page inside a saved session is found by search');

  await search.fill('zebra');
  await page.getByText('Put away', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Zebra reference page/ }).click();
  await waitUntil(
    page,
    async () => (await chrome.storage.local.get('vc:snoozed'))['vc:snoozed']?.length === 0,
  );
  const opened = await page.evaluate(async () =>
    (await chrome.tabs.query({})).some((t) =>
      (t.pendingUrl || t.url || '').includes('chrome://version'),
    ),
  );
  assert.equal(opened, true);
  console.log('PASS choosing a snoozed result reopens that tab');
} finally {
  await close();
}
