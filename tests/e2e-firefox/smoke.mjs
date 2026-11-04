// Real-Firefox smoke test: loads the built extension in headless Firefox and checks that the
// panel renders, lists tabs, and that tab groups, favicons and storage.sync work.
//   FIREFOX_BIN=/path/to/firefox node tests/e2e-firefox/smoke.mjs [extension dir]
// geckodriver is fetched by selenium-manager.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { Browser, Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

// Without this Firefox refuses WebDriver navigation to moz-extension:// pages.
process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = '1';

const EXT = path.resolve(process.argv[2] ?? '.output/firefox-mv3');
const BIN = process.env.FIREFOX_BIN;
assert(BIN, 'Set FIREFOX_BIN to a Firefox >= 140 binary');
const ID = 'vertically-challenged@humdedum1.github.io';
const UUID = '11111111-2222-4333-8444-555555555555';
const PANEL = `moz-extension://${UUID}/sidepanel.html`;

// A 1x1 PNG: Firefox reports data: icons as the tab's favIconUrl.
const ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const site = http
  .createServer((_q, r) => {
    r.setHeader('content-type', 'text/html');
    r.end(
      `<!doctype html><title>Fixture page</title><link rel="icon" href="${ICON}"><body>fixture</body>`,
    );
  })
  .listen(0);
const port = site.address().port;

const opts = new firefox.Options().setBinary(BIN).addArguments('-headless');
// Let the event page go idle after 3 s instead of 30 s.
opts.setPreference('extensions.background.idle.timeout', 3000);
opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ID]: UUID }));
const driver = await new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(opts).build();
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([name, true]);
  } catch (e) {
    results.push([name, false, e.message.split('\n').slice(0, 5).join(' ')]);
  }
}
/** Runs privileged JS in the browser chrome (needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS). */
async function inChrome(body) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       const w = Services.wm.getMostRecentWindow('navigator:browser');
       const ext = WebExtensionPolicy.getByID('${ID}').extension;
       (async () => { ${body} })().then(done, (e) => done({ error: String(e) }));`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}
const sidebarOpen = async () => (await inChrome('return w.SidebarController.isOpen;')) === true;
const sleepIn = 'await new Promise((r) => setTimeout(r, 1200));';
const inPanel = (fn, ...args) =>
  driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
   Promise.resolve((${fn.toString()})(...Array.prototype.slice.call(arguments, 0, -1))).then(done, (e) => done({ error: String(e) }));`,
    ...args,
  );
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await driver.sleep(200);
  }
}

try {
  await driver.installAddon(EXT, true);
  const fixtures = [];
  for (const p of ['a', 'b']) {
    await driver.switchTo().newWindow('tab');
    await driver.get(`http://127.0.0.1:${port}/${p}`);
    fixtures.push(await driver.getWindowHandle());
  }
  await driver.switchTo().newWindow('tab');
  // The extension page can be opened right after install only once its background is up.
  await waitFor(async () => {
    try {
      await driver.get(PANEL);
      return true;
    } catch {
      return false;
    }
  });

  await check('panel renders', async () => {
    await waitFor(async () =>
      (await driver.findElement(By.css('body')).getText()).includes('Settings'),
    );
  });
  await check('lists the open tabs', async () => {
    // Rows only appear once the background answered over the panel port.
    await waitFor(async () =>
      (await driver.findElement(By.css('body')).getText()).includes('Fixture page'),
    );
  });
  await check('tabs.group + tabGroups work', async () => {
    const r = await inPanel(async () => {
      const tabs = await browser.tabs.query({ url: '*://127.0.0.1/*' });
      const gid = await browser.tabs.group({ tabIds: tabs.map((t) => t.id) });
      await browser.tabGroups.update(gid, { title: 'smoke', color: 'blue' });
      const g = await browser.tabGroups.get(gid);
      await browser.tabs.ungroup(tabs.map((t) => t.id));
      return g.title;
    });
    assert.equal(r, 'smoke');
  });
  await check('background accepts runtime messages from the panel page', async () => {
    const r = await inPanel(() =>
      browser.runtime.sendMessage({ type: 'restoreSessions', sessions: [] }),
    );
    assert.equal(r?.ok, true, JSON.stringify(r));
  });
  await check('shortcut settings can be opened (about: URLs are refused)', async () => {
    const r = await inPanel(async () => {
      try {
        await browser.commands.openShortcutSettings();
        return 'ok';
      } catch (e) {
        return String(e);
      }
    });
    assert.equal(r, 'ok');
  });
  await check('storage.sync round-trips', async () => {
    const r = await inPanel(async () => {
      await browser.storage.sync.set({ 'vc-smoke': 1 });
      const v = (await browser.storage.sync.get('vc-smoke'))['vc-smoke'];
      await browser.storage.sync.remove('vc-smoke');
      return v;
    });
    assert.equal(r, 1);
  });
  await check('sidebarAction API present', async () => {
    const r = await inPanel(() => typeof browser.sidebarAction.toggle);
    assert.equal(r, 'function');
  });
  await check('favicon CSP allows https images', async () => {
    const csp = await inPanel(
      () => browser.runtime.getManifest().content_security_policy.extension_pages,
    );
    assert.match(csp, /img-src 'self' data: https:/);
  });
  await check('favicon from a data: URL reaches the row', async () => {
    await waitFor(() =>
      driver.executeScript(
        "return [...document.querySelectorAll('img')].some((i) => i.src.startsWith('data:image/png'))",
      ),
    );
  });
  await check('toolbar button toggles the sidebar', async () => {
    assert.equal(await sidebarOpen(), true, 'open after install');
    const click = `const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      ExtensionParent.apiManager.global.browserActionFor(ext).triggerAction(w); ${sleepIn}`;
    await inChrome(click);
    assert.equal(await sidebarOpen(), false, 'closed by first click');
    await inChrome(click);
    assert.equal(await sidebarOpen(), true, 'reopened by second click');
  });
  await check('shortcut: default key registered and command toggles the sidebar', async () => {
    // The command decides open/close from connected panels; a panel page in a tab would count.
    await driver.get('about:blank');
    await driver.sleep(500);
    const key = await inChrome(
      "return (await ext.shortcuts.allCommands()).find((c) => c.name === 'toggle-side-panel')?.shortcut;",
    );
    assert.equal(key, 'Alt+Shift+V');
    await inChrome(`ext.shortcuts.onCommand('toggle-side-panel'); ${sleepIn}`);
    assert.equal(await sidebarOpen(), false);
    await inChrome(`ext.shortcuts.onCommand('toggle-side-panel'); ${sleepIn}`);
    assert.equal(await sidebarOpen(), true);
  });
  await check('event page suspends when idle and wakes for the panel', async () => {
    // Leaving the panel drops its port, so nothing keeps the background page alive.
    await driver.get('about:blank');
    await inChrome('await new Promise((r) => setTimeout(r, 1)); return 1;');
    const end = Date.now() + 20000;
    let state = '';
    while (Date.now() < end) {
      state = await inChrome('return ext.backgroundState;');
      if (state === 'stopped') break;
      await driver.sleep(500);
    }
    assert.equal(state, 'stopped', 'background never went idle');
    await driver.get(PANEL);
    await waitFor(async () =>
      (await driver.findElement(By.css('body')).getText()).includes('Fixture page'),
    );
    assert.equal(await inChrome('return ext.backgroundState;'), 'running');
  });
  await check('many tabs with hostile titles: list renders, no horizontal overflow', async () => {
    const titles = [
      'L'.repeat(400),
      'مرحبا بالعالم '.repeat(20),
      '😀'.repeat(150),
      '漢字かな交じり文'.repeat(30),
      '<img src=x onerror=alert(1)>',
    ];
    await driver.get(PANEL);
    await inPanel(
      async (base, titles) => {
        for (let i = 0; i < 100; i++) {
          const t = `${titles[i % titles.length]} ${i}`;
          await browser.tabs.create({ url: `${base}/?t=${encodeURIComponent(t)}`, active: false });
        }
      },
      `http://127.0.0.1:${port}`,
      titles,
    );
    await driver.manage().window().setRect({ width: 360, height: 800 });
    const count = () =>
      driver.executeScript(
        "return document.querySelectorAll('[role=treeitem],[role=option],[data-tab-id]').length",
      );
    await waitFor(async () => (await count()) > 5, 15000);
    const m = await driver.executeScript(`return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      xss: document.querySelectorAll('img[src="x"]').length,
      text: document.body.innerText.includes('<img src=x onerror=alert(1)>'),
    }`);
    assert.ok(m.overflow <= 1, `horizontal overflow of ${m.overflow}px`);
    assert.equal(m.xss, 0, 'a title was rendered as HTML');
  });
} finally {
  await driver.quit();
  site.close();
}
let failed = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${why}`}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
