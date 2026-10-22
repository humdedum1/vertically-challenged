// Exercises the real menu, native groups, repeat invocation and preserved pinned/grouped tabs.
import http from 'node:http';
import { check, extensionDir, finish, launch } from './harness.mjs';

const server = http.createServer((req, res) => res.end(`<title>${req.url}</title>`));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${server.address().port}`;
const { ctx, extId, close } = await launch(extensionDir());
try {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const initial = await page.evaluate(async (site) => {
    const windowId = (await chrome.windows.getCurrent()).id;
    const create = async (path, pinned = false) =>
      (await chrome.tabs.create({ windowId, url: site + path, pinned, active: false })).id;
    const pinned = await create('/pinned', true);
    const grouped = await create('/existing');
    const existingGroup = await chrome.tabs.group({ tabIds: [grouped] });
    await chrome.tabGroups.update(existingGroup, { title: 'Keep me', color: 'red' });
    const ids = [await create('/a'), await create('/b')];
    return { windowId, pinned, grouped, existingGroup, ids };
  }, site);

  const groupFromMenu = async () => {
    await page.getByRole('treeitem', { name: /^End of pinned tabs/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Group tabs by website', exact: true }).click();
  };
  await groupFromMenu();
  await page.waitForFunction(async ([a, b]) => {
    const first = await chrome.tabs.get(a);
    return first.groupId !== -1 && first.groupId === (await chrome.tabs.get(b)).groupId;
  }, initial.ids);
  const state = await page.evaluate(
    async ({ pinned, grouped, ids }) => ({
      pinned: await chrome.tabs.get(pinned),
      grouped: await chrome.tabs.get(grouped),
      group: await chrome.tabGroups.get((await chrome.tabs.get(ids[0])).groupId),
    }),
    initial,
  );
  check(
    state.group.title === '127.0.0.1',
    'menu groups same-website tabs and names the native group',
  );
  check(
    state.pinned.pinned && state.pinned.groupId === -1,
    'pinned tabs stay pinned and ungrouped',
  );
  check(state.grouped.groupId === initial.existingGroup, 'existing group membership is preserved');
  const existing = await page.evaluate((id) => chrome.tabGroups.get(id), initial.existingGroup);
  check(
    existing.title === 'Keep me' && existing.color === 'red',
    'existing group title and colour are preserved',
  );
  await groupFromMenu();
  await page.getByText('No ungrouped websites with multiple tabs', { exact: true }).waitFor();
  check(true, 'repeat invocation reports that there is nothing to group');
  // Chrome returns [] for unknown windows; inject an API rejection to exercise the error path.
  const [worker] = ctx.serviceWorkers();
  await worker.evaluate(() => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (options) =>
      options.windowId === 2147483647
        ? Promise.reject(new Error('Injected grouping failure'))
        : query(options);
  });
  const failure = await page.evaluate(
    (windowId) =>
      new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'vc-panel' });
        const timer = setTimeout(() => {
          port.disconnect();
          reject(new Error('No grouping error notice'));
        }, 3000);
        port.onMessage.addListener((message) => {
          if (message.type !== 'notice' || message.level !== 'error') return;
          clearTimeout(timer);
          port.disconnect();
          resolve(message.text);
        });
        port.postMessage({ type: 'subscribe', windowId });
        port.postMessage({ type: 'autoGroup', windowId: 2147483647 });
      }),
    initial.windowId,
  );
  check(
    failure.startsWith("Couldn't complete that:"),
    'grouping errors produce a visible error notice',
  );
} finally {
  await close();
  server.close();
}
finish();
