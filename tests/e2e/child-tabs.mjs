import http from 'node:http';
import { check, extensionDir, finish, launch } from './harness.mjs';

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>${req.url}</title><a href="/child-a">Open A</a>
    <a href="/child-b">Open B</a><a href="/grandchild">Open grandchild</a>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { ctx, extId, close } = await launch(extensionDir());
ctx.setDefaultTimeout(10_000);
try {
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const main = await ctx.newPage();
  await main.goto(`${origin}/main`);
  const open = async (page, label, options) => {
    await page.bringToFront();
    const [child] = await Promise.all([
      ctx.waitForEvent('page'),
      page.getByRole('link', { name: label, exact: true }).click(options),
    ]);
    await child.waitForLoadState();
    return child;
  };
  const child = await open(main, 'Open A', { modifiers: ['Control'] });
  await open(child, 'Open grandchild', { button: 'middle' });
  await open(main, 'Open B', { button: 'middle' });
  const endTab = await panel.evaluate(async (origin) => {
    const parent = (await chrome.tabs.query({})).find((t) => t.url === `${origin}/main`);
    const unrelated = await chrome.tabs.create({
      windowId: parent.windowId,
      url: `${origin}/unrelated`,
      active: false,
    });
    const child = await chrome.tabs.create({
      windowId: parent.windowId,
      url: `${origin}/at-end`,
      openerTabId: parent.id,
      index: 9999,
      active: false,
    });
    return { child: child.id, unrelated: unrelated.id };
  }, origin);
  await panel.waitForFunction(
    async ({ child, unrelated }) =>
      (await chrome.tabs.get(child)).index < (await chrome.tabs.get(unrelated)).index,
    endTab,
  );
  check(true, 'a child opened at the end joins its opener branch');
  const ids = await panel.evaluate(
    async (origin) =>
      Object.fromEntries(
        (await chrome.tabs.query({}))
          .filter((t) => t.url?.startsWith(origin))
          .map((t) => [new URL(t.url).pathname, t.id]),
      ),
    origin,
  );
  const row = (path) => panel.locator(`#vc-row-t${ids[path]}`);
  for (const [path, level] of [
    ['/main', '1'],
    ['/child-a', '2'],
    ['/grandchild', '3'],
    ['/child-b', '2'],
  ]) {
    await panel.waitForFunction(
      ({ id, level }) =>
        document.getElementById(`vc-row-t${id}`)?.getAttribute('aria-level') === level,
      { id: ids[path], level },
    );
  }
  check(true, 'Ctrl+click and middle-click create nested siblings and grandchildren by default');
  check(
    await panel.evaluate(
      async (ids) =>
        (await Promise.all(Object.values(ids).map((id) => chrome.tabs.get(id)))).every(
          (t) => t.groupId === -1,
        ),
      ids,
    ),
    'child tabs do not create native browser groups',
  );

  await panel.evaluate((id) => chrome.tabs.update(id, { active: true }), ids['/main']);
  await panel.waitForFunction(
    (id) => document.getElementById(`vc-row-t${id}`)?.getAttribute('aria-current') === 'page',
    ids['/main'],
  );
  check(
    await row('/main').evaluate((element) => {
      const row = element.getBoundingClientRect();
      const arrow = element.querySelector('.branch-toggle').getBoundingClientRect();
      const icon = element.querySelector('.icon').getBoundingClientRect();
      const bar = getComputedStyle(element, '::before');
      return (
        arrow.left >= row.left + parseFloat(bar.left) + parseFloat(bar.width) + 2 &&
        arrow.right <= icon.left
      );
    }),
    'the collapse arrow clears the active bar and favicon',
  );

  await row('/main')
    .getByRole('button', { name: 'Collapse children of /main', exact: true })
    .click();
  await row('/child-a').waitFor({ state: 'detached' });
  check((await row('/grandchild').count()) === 0, 'collapsing a parent hides its descendants');
  await panel.getByRole('tree').press('ArrowRight');
  await row('/child-a').waitFor();
  await panel.getByRole('tree').press('ArrowRight');
  check(
    (await panel.getByRole('tree').getAttribute('aria-activedescendant')) ===
      `vc-row-t${ids['/child-a']}`,
    'Right moves into the first child',
  );
  await panel.getByRole('tree').press('ArrowLeft');
  await panel.getByRole('tree').press('ArrowLeft');
  check(
    (await panel.getByRole('tree').getAttribute('aria-activedescendant')) ===
      `vc-row-t${ids['/main']}`,
    'Left returns from a child to its parent',
  );

  await panel.getByRole('tab', { name: 'Settings', exact: true }).click();
  const toggle = panel.getByRole('switch', { name: 'Child tabs', exact: true });
  check(
    (await toggle.getAttribute('aria-checked')) === 'true',
    'Child tabs setting is enabled by default',
  );
  await toggle.click();
  await panel.waitForFunction(
    async () => (await chrome.storage.sync.get('settings')).settings?.tabs?.childTabs === false,
  );
  await panel.getByRole('tab', { name: 'Tabs', exact: true }).click();
  await panel.waitForFunction(
    (id) => document.getElementById(`vc-row-t${id}`)?.getAttribute('aria-level') === '1',
    ids['/child-a'],
  );
  check(true, 'disabling Child tabs restores flat rows');
  await panel.reload();
  await panel.waitForFunction(
    (id) => document.getElementById(`vc-row-t${id}`)?.getAttribute('aria-level') === '1',
    ids['/grandchild'],
  );
  check(true, 'the disabled setting survives panel reload');

  await panel.getByRole('tab', { name: 'Settings', exact: true }).click();
  await panel.getByRole('switch', { name: 'Child tabs', exact: true }).click();
  await panel.getByRole('tab', { name: 'Tabs', exact: true }).click();
  await row('/grandchild').waitFor();
  await main.close();
  await panel.waitForFunction(
    (id) => document.getElementById(`vc-row-t${id}`)?.getAttribute('aria-level') === '1',
    ids['/child-a'],
  );
  check(true, 'closing the parent promotes surviving children');
} finally {
  await close();
  server.close();
}
finish();
