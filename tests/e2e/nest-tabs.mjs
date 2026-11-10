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

  const edgeDrop = async (zone) => {
    const from = await row(ids.source).boundingBox();
    const to = await row(ids.target).boundingBox();
    await page.mouse.move(from.x + 45, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 45, to.y + (zone === 'before' ? 2 : to.height - 2), {
      steps: 12,
    });
    await page.waitForSelector('.drop-line');
    await page.mouse.up();
    await page.waitForFunction(
      async ({ source, target, zone }) => {
        const s = await chrome.tabs.get(source);
        const t = await chrome.tabs.get(target);
        return zone === 'before' ? s.index < t.index : s.index > t.index;
      },
      { ...ids, zone },
    );
  };
  await edgeDrop('before');
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '1',
    ids,
  );
  await edgeDrop('after');
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '1',
    ids,
  );
  check(true, 'edge drops above then below the former parent keep the tab unnested');
  await page.reload();
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '1',
    ids,
  );
  check(true, 'unnesting survives a panel reload');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.reload();
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '1',
    ids,
  );
  await cdp.detach();
  check(true, 'unnesting survives a background worker restart');

  const againFrom = await row(ids.source).boundingBox();
  const againTo = await row(ids.target).boundingBox();
  await page.mouse.move(againFrom.x + 45, againFrom.y + againFrom.height / 2);
  await page.mouse.down();
  await page.mouse.move(againTo.x + 45, againTo.y + againTo.height / 2, { steps: 12 });
  await page.waitForSelector('.drop-box');
  await page.mouse.up();
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '2',
    ids,
  );
  check(true, 'a center drop can nest the detached tab again');
  await edgeDrop('after');
  await page.waitForFunction(
    ({ source }) =>
      document.querySelector(`#vc-row-t${source}`)?.getAttribute('aria-level') === '1',
    ids,
  );
  check(true, 'an adjacent edge drop detaches without changing tab order');

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
    // The worker refuses commands from a port whose window kind it doesn't know yet.
    const { windowId } = await chrome.tabs.get(source);
    port.postMessage({ type: 'subscribe', windowId });
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
