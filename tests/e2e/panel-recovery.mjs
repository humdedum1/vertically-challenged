// Reload actions and command recovery against a live Chromium extension.
import http from 'node:http';
import { check, extensionDir, finish, launch } from './harness.mjs';

let requests = 0;
const server = http.createServer((_req, res) => {
  requests++;
  res.end('<title>Reload test</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { ctx, extId, close } = await launch(extensionDir());
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const tab = await page.evaluate(async (url) => {
    const windowId = (await chrome.windows.getCurrent()).id;
    return chrome.tabs.create({ windowId, url, active: false });
  }, `http://127.0.0.1:${server.address().port}/`);
  const row = page.locator(`#vc-row-t${tab.id}`);
  await row.waitFor();
  await page.waitForFunction(
    async (id) => (await chrome.tabs.get(id)).status === 'complete',
    tab.id,
  );
  const before = requests;
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reload', exact: true }).click();
  await page.waitForFunction(
    async (id) => (await chrome.tabs.get(id)).status === 'complete',
    tab.id,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  check(requests > before, 'Reload requests the tab page again');

  await row.click({ button: 'right' });
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('menuitem', { name: 'Reload panel', exact: true }).click(),
  ]);
  await row.waitFor();
  check(true, 'Reload panel reloads and restores the tab list');

  const [worker] = ctx.serviceWorkers();
  await worker.evaluate(() => {
    globalThis.recoveryConnections = 0;
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'vc-panel') return;
      const first = ++globalThis.recoveryConnections === 1;
      const post = port.postMessage.bind(port);
      port.postMessage = (message) => {
        // Simulate a connection that looks open but no longer answers health checks.
        if (first && message.type === 'pong') return;
        post(message);
      };
    });
  });
  await page.clock.install();
  await page.reload();
  await row.waitFor();
  await page.clock.fastForward(20_000);
  await page.clock.fastForward(5_001);
  await page.clock.fastForward(1_000);
  await page.waitForFunction(() => document.querySelector('[role="tree"]'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const connections = await worker.evaluate(() => globalThis.recoveryConnections);
  check(connections >= 2, 'an unresponsive connection is replaced automatically');
  await row.click();
  await page.waitForFunction(async (id) => (await chrome.tabs.get(id)).active, tab.id);
  check(true, 'tab clicks activate the browser tab after recovery');

  const other = await page.evaluate(() =>
    chrome.windows.create({ url: 'about:blank', focused: false }),
  );
  const header = page.locator(`#vc-row-w${other.id}`);
  await header.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Window name', exact: true });
  await name.fill('Recovered window');
  await name.press('Enter');
  await header.getByText('Recovered window', { exact: true }).waitFor();
  await page.reload();
  await header.getByText('Recovered window', { exact: true }).waitFor();
  check(true, 'window names can be edited and persist after recovery');
} finally {
  await close();
  server.close();
}
finish();
