// Optional new-tab URL: setting validation, persistence, and browser-default fallback.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 1000 });
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const openSettings = async () => {
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Panel & tabs' }).click();
  };
  const waitForSetting = async (value) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const stored = await page.evaluate(
        async () => (await chrome.storage.sync.get('settings')).settings?.tabs?.newTabUrl,
      );
      if (stored === value) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail('New-tab URL was not persisted');
  };
  await openSettings();
  const input = page.getByRole('textbox', { name: 'New tab URL', exact: true });
  const save = page.getByRole('button', { name: 'Save URL', exact: true });
  assert.equal(await input.inputValue(), '');
  await input.fill('javascript:alert(1)');
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.equal(await save.isDisabled(), true);
  await input.fill('about:blank#custom-new-tab');
  await save.click();
  await waitForSetting('about:blank#custom-new-tab');
  await page.reload();
  await openSettings();
  await page.waitForFunction(
    () => document.getElementById('vc-new-tab-url')?.value === 'about:blank#custom-new-tab',
  );
  const create = async () =>
    page.evaluate(async () => {
      const windowId = (await chrome.windows.getCurrent()).id;
      const port = chrome.runtime.connect({ name: 'vc-panel' });
      port.postMessage({ type: 'subscribe', windowId });
      const created = new Promise((resolve) => {
        const listener = (tab) => {
          chrome.tabs.onCreated.removeListener(listener);
          resolve(tab.id);
        };
        chrome.tabs.onCreated.addListener(listener);
      });
      port.postMessage({ type: 'newTab', windowId, afterTabId: null });
      const id = await created;
      port.disconnect();
      return id;
    });
  const customId = await create();
  await page.waitForFunction(
    async (id) => (await chrome.tabs.get(id)).url === 'about:blank#custom-new-tab',
    customId,
  );
  await page.evaluate((id) => chrome.tabs.remove(id), customId);
  await input.fill('');
  await save.click();
  await waitForSetting('');
  const defaultId = await create();
  await page.waitForFunction(
    async (id) => (await chrome.tabs.get(id)).url?.startsWith('chrome://newtab'),
    defaultId,
  );
  console.log('PASS URL validation, persistence, custom new tab and browser-default fallback');
} finally {
  await close();
}
