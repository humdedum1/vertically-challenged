// Snooze closes a tab and keeps it until woken; the welcome card shows once on a fresh install.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 900 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);

  // Welcome: only when the worker marked a fresh install.
  await page.evaluate(() => chrome.storage.local.set({ 'vc:welcome': 'pending' }));
  await page.reload();
  const welcome = page.getByRole('heading', { name: 'Welcome', exact: true });
  await welcome.waitFor();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search tabs' }).waitFor();
  assert.equal(await welcome.count(), 0);
  console.log('PASS the welcome card appears once and stays dismissed');

  // Snooze through the panel's own port, as the menu does.
  // data: pages aren't restorable, so (correctly) can't be snoozed; chrome:// pages can.
  const url = 'chrome://version/';
  const tabId = await page.evaluate(async (u) => {
    const w = await chrome.windows.getCurrent();
    return (await chrome.tabs.create({ windowId: w.id, url: u, active: false })).id;
  }, url);
  // The worker's tab store learns of the new tab through events; give it a moment.
  await page.waitForTimeout(1200);
  const sendSnooze = (type, extra) =>
    page.evaluate(
      async ([type, extra]) => {
        const w = await chrome.windows.getCurrent();
        const port = chrome.runtime.connect({ name: 'vc-panel' });
        port.postMessage({ type: 'subscribe', windowId: w.id });
        port.postMessage({ type, ...extra });
        await new Promise((r) => setTimeout(r, 800));
        port.disconnect();
      },
      [type, extra],
    );
  const stored = () =>
    page.evaluate(async () => (await chrome.storage.local.get('vc:snoozed'))['vc:snoozed'] ?? []);
  const exists = () =>
    page.evaluate(async (id) => !!(await chrome.tabs.get(id).catch(() => null)), tabId);

  await sendSnooze('snooze', { tabIds: [tabId], wakeAt: Date.now() + 3_600_000 });
  const list = await stored();
  assert.equal(list.length, 1);
  assert.equal(list[0].url, 'chrome://version/');
  assert.equal(await exists(), false);
  console.log('PASS snoozing stores the tab and closes it');

  await sendSnooze('wakeSnoozed', { id: list[0].id });
  assert.equal((await stored()).length, 0);
  const reopened = await page.evaluate(async () =>
    (await chrome.tabs.query({})).some((t) =>
      (t.pendingUrl || t.url || '').includes('chrome://version'),
    ),
  );
  assert.equal(reopened, true);
  console.log('PASS waking a snoozed tab reopens it and clears the entry');
} finally {
  await close();
}
