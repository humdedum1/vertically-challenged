import { check, extensionDir, finish, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir());
ctx.setDefaultTimeout(10_000);
try {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check(false, 'no page errors', e.message));
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.waitForSelector('[role=treeitem]');
  const ids = await page.evaluate(async () => {
    const create = async (name, openerTabId) =>
      (
        await chrome.tabs.create({
          url: `about:blank#${name}`,
          active: false,
          ...(openerTabId ? { openerTabId } : {}),
        })
      ).id;
    const source = await create('source');
    const child = await create('child', source);
    const target = await create('target');
    return { source, child, target };
  });
  const row = (id) => page.locator(`#vc-row-t${id}`);
  await row(ids.target).waitFor();
  await page.waitForFunction(
    ({ child }) => document.querySelector(`#vc-row-t${child}`)?.getAttribute('aria-level') === '2',
    ids,
  );
  const from = await row(ids.source).boundingBox();
  const to = await row(ids.target).boundingBox();
  await page.mouse.move(from.x + 45, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 45, to.y + to.height / 2, { steps: 12 });
  await page.waitForSelector('.drop-box');
  await page.mouse.up();
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '2',
    ids,
  );
  check(
    (await row(ids.child).getAttribute('aria-level')) === '1',
    'existing children stay behind when their parent is dragged',
  );
  const after = await page.evaluate(async ({ source, target }) => {
    const tab = await chrome.tabs.get(source);
    return { opener: tab.openerTabId, group: tab.groupId, target };
  }, ids);
  check(
    after.opener === ids.target && after.group === -1,
    'center drop nests without creating a native group',
  );

  const adjacent = await page.evaluate(async () => {
    const create = async (name, openerTabId) =>
      (
        await chrome.tabs.create({
          url: `about:blank#${name}`,
          active: false,
          ...(openerTabId ? { openerTabId } : {}),
        })
      ).id;
    const parent = await create('adjacent-parent');
    const source = await create('adjacent-source');
    const child = await create('adjacent-child', source);
    const port = chrome.runtime.connect({ name: 'vc-panel' });
    globalThis.__nestPort = port;
    port.postMessage({ type: 'nestTab', tabId: source, parentTabId: parent });
    return { parent, source, child };
  });
  await page.waitForFunction(async ({ parent, source, child }) => {
    const s = await chrome.tabs.get(source);
    const c = await chrome.tabs.get(child);
    return s.openerTabId === parent && c.openerTabId !== source;
  }, adjacent);
  await page.waitForFunction(
    ({ source, child }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '2' &&
      document.querySelector(`#vc-row-t${child}`)?.getAttribute('aria-level') === '1',
    adjacent,
  );
  check(true, 'an adjacent center drop nests only the dragged tab');

  const button = page.getByRole('button', { name: 'New page', exact: true });
  await button.scrollIntoViewIfNeeded();
  const buttonBox = await button.boundingBox();
  const lastBox = await row(adjacent.child).boundingBox();
  check(
    Math.abs(buttonBox.y - (lastBox.y + lastBox.height)) < 2,
    'New page sits directly below the last tab',
  );
  const before = await page.evaluate(
    async () => (await chrome.tabs.query({ currentWindow: true })).length,
  );
  await button.focus();
  await page.keyboard.press('Delete');
  check(
    (await page.evaluate(async () => (await chrome.tabs.query({ currentWindow: true })).length)) ===
      before,
    'tab shortcuts do not run while New page has focus',
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    async (before) => (await chrome.tabs.query({ currentWindow: true })).length === before + 1,
    before,
  );
  check(true, 'New page creates a tab');
} finally {
  await close();
}
finish();
