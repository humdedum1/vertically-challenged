// Real-Firefox smoke test: loads the built extension in headless Firefox and checks that the
// panel renders, lists tabs, and that tab groups, favicons and storage.sync work.
//   FIREFOX_BIN=/path/to/firefox node tests/e2e-firefox/smoke.mjs [extension dir]
// geckodriver is fetched by selenium-manager.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Browser, Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command, Name } from 'selenium-webdriver/lib/command.js';

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
opts.setPreference('dom.w3c_touch_events.enabled', 1);
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
  await check('a site icon reaches bookmarks of pages that were never opened', async () => {
    // The worker stores each site's icon (shared/site-icons.ts) about 3 s after the tab reports it.
    const stored = await waitFor(() =>
      inPanel(async () => (await browser.storage.local.get('siteIcons')).siteIcons),
    );
    // Firefox re-encodes the data: icon, so only its type is stable.
    assert.match(stored[`http://127.0.0.1:${port}`] ?? '', /^data:image\/png/);
    await inPanel(async (url) => {
      await browser.bookmarks.create({ parentId: 'toolbar_____', title: 'Never opened', url });
      localStorage.setItem('vc.bookmarks.expanded', JSON.stringify(['toolbar_____']));
    }, `http://127.0.0.1:${port}/never-opened`);
    await driver.get(PANEL);
    await (
      await waitFor(() => driver.findElements(By.css('#vc-tab-bookmarks')).then((t) => t[0]))
    ).click();
    await waitFor(() =>
      driver.executeScript(
        `const row = [...document.querySelectorAll('#vc-panel-bookmarks [role=treeitem]')]
           .find((r) => r.textContent.includes('Never opened'));
         return row?.querySelector('img')?.src.startsWith('data:image/png') ?? false;`,
      ),
    );
    await (await driver.findElement(By.css('#vc-tab-tabs'))).click();
  });
  await check('clearing all history forgets the site icons', async () => {
    await inPanel(() => browser.history.deleteAll());
    await waitFor(() =>
      inPanel(async () => !('siteIcons' in (await browser.storage.local.get('siteIcons')))),
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
    // Firefox restarts its idle timer on every event; a loaded CI machine can take a while.
    const end = Date.now() + 60000;
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
  await check('touch: a tap opens the tab and a swipe leaves no drag behind', async () => {
    await driver.get(PANEL);
    await waitFor(async () => (await driver.findElements(By.css('[id^=vc-row-t]'))).length > 2);
    const touch = (finger) =>
      driver.execute(
        new Command(Name.ACTIONS).setParameter('actions', [
          { type: 'pointer', id: 'f1', parameters: { pointerType: 'touch' }, actions: finger },
        ]),
      );
    const move = (x, y, duration = 0) => ({
      type: 'pointerMove',
      x: Math.round(x),
      y: Math.round(y),
      duration,
    });
    const geometry = await driver.executeScript(`
      const v = document.querySelector('.viewport').getBoundingClientRect();
      const row = [...document.querySelectorAll('[id^=vc-row-t]')].find((e) => {
        const r = e.getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom && !e.getAttribute('aria-current'); });
      const r = row.getBoundingClientRect();
      return { vx: v.left + v.width / 2, vtop: v.top, vbottom: v.bottom, id: Number(row.id.slice(8)), rx: r.left + r.width / 2, ry: r.top + r.height / 2 };`);
    // Tap a row.
    const g = await driver.executeScript(`
      const v = document.querySelector('.viewport').getBoundingClientRect();
      const row = [...document.querySelectorAll('[id^=vc-row-t]')].find((e) => {
        const r = e.getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; });
      const r = row.getBoundingClientRect();
      return { id: Number(row.id.slice(8)), x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
    await touch([
      move(g.x, g.y),
      { type: 'pointerDown', button: 0 },
      { type: 'pointerUp', button: 0 },
    ]);
    await driver.sleep(700);
    const active = await inPanel(
      async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0].id,
    );
    assert.equal(active, g.id, 'the tapped tab is not the active one');
    await inPanel(async () => {
      const me = await browser.tabs.getCurrent();
      await browser.tabs.update(me.id, { active: true });
    });
    await driver.sleep(300);
    // Swipe up inside the list. Headless Firefox has no touch panning (a wheel does scroll), so a
    // swipe reaches the app as a plain drag; only the aftermath is asserted. Scrolling by swipe
    // is covered in Chromium.
    await touch([
      move(geometry.vx, geometry.vbottom - 10),
      { type: 'pointerDown', button: 0 },
      move(geometry.vx, geometry.vtop + 20, 400),
      { type: 'pointerUp', button: 0 },
    ]);
    await driver.sleep(500);
    assert.equal(await driver.executeScript("return !!document.querySelector('.ghost')"), false);
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
    // Size the page, not the window: newer Firefox's sidebar and launcher take part of the width.
    await driver.manage().window().setRect({ width: 360, height: 800 });
    const taken = 360 - (await driver.executeScript('return document.documentElement.clientWidth'));
    if (taken > 0)
      await driver
        .manage()
        .window()
        .setRect({ width: 360 + taken, height: 800 });
    const count = () =>
      driver.executeScript(
        "return document.querySelectorAll('[role=treeitem],[role=option],[data-tab-id]').length",
      );
    await waitFor(async () => (await count()) > 5, 15000);
    const m = await driver.executeScript(`return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      width: document.documentElement.clientWidth,
      xss: document.querySelectorAll('img[src="x"]').length,
      text: document.body.innerText.includes('<img src=x onerror=alert(1)>'),
      wide: [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 4)
        .slice(0, 3)
        .map((e) => e.tagName.toLowerCase() + '.' + [...e.classList].join('.') + ' ' + Math.round(e.getBoundingClientRect().right)),
    }`);
    // A few px can come from rounding or a scrollbar.
    assert.ok(
      m.overflow <= 4,
      `horizontal overflow of ${m.overflow}px at ${m.width}px: ${m.wide.join(', ')}`,
    );
    assert.equal(m.xss, 0, 'a title was rendered as HTML');
  });
  await check('axe: no serious or critical violations on any panel', async () => {
    const axeSrc = readFileSync(
      createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
      'utf8',
    );
    await driver.executeScript(axeSrc);
    const tabs = await driver.findElements(By.css('[role=tab]'));
    assert.ok(tabs.length >= 4, `found ${tabs.length} panel tabs`);
    const all = [];
    for (let i = 0; i < tabs.length; i++) {
      const tab = (await driver.findElements(By.css('[role=tab]')))[i];
      const name = (await tab.getAttribute('aria-label')) || (await tab.getText()) || `panel ${i}`;
      await tab.click();
      await driver.sleep(700);
      const found = await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         axe.run(document, {
           resultTypes: ['violations'],
           // Accepted: the theme buttons are named "Use <theme>" (the e2e tests rely on it) while the
           // row also shows an "In use" badge; the name still contains the visible theme name.
           rules: { 'label-content-name-mismatch': { enabled: false } },
         }).then(
           (r) => done(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
             .map((v) => v.id + ' (' + v.nodes.length + '): ' + v.nodes[0].target.join(' ') + ' - ' +
               v.nodes[0].any.concat(v.nodes[0].all).map((a) => a.message).join('; '))),
           (e) => done(['axe failed: ' + e]));`,
      );
      // Known: the trailing "New page" / "Search more" controls sit inside the tab list's role=tree
      // scroller. Fixing it means moving the tree role, focus and keys off VirtualList's scroll
      // container; not done without a visual check.
      const known = (f) => f.startsWith('aria-required-children') && f.includes('.viewport');
      all.push(...found.filter((f) => !known(f)).map((f) => `[${name}] ${f}`));
    }
    assert.deepEqual(all, []);
  });
  await check('sidebar mode explains that Firefox cannot open it at launch', async () => {
    // sidebarAction.open needs user input, and Firefox doesn't count a notification click.
    await driver.get(PANEL);
    await (
      await waitFor(() => driver.findElements(By.css('#vc-tab-settings')).then((t) => t[0]))
    ).click();
    const text = await waitFor(async () => {
      const body = await driver.executeScript('return document.body.textContent');
      return /Open as/.test(body) ? body : null;
    });
    assert.match(text, /Firefox doesn’t let extensions open the sidebar at launch/);
    assert.doesNotMatch(text, /Open on browser launch/);
  });
  await check('a popup setting (synced from Chrome) opens the window on Firefox', async () => {
    // Firefox gives a panel framed in a web page no tabs/windows API, so there is no in-page popup.
    await driver.get(PANEL);
    await inPanel(async () => {
      const { settings } = await browser.storage.sync.get('settings');
      await browser.storage.sync.set({
        settings: {
          ...(settings ?? {}),
          version: 10,
          display: { ...(settings?.display ?? {}), mode: 'popup' },
        },
      });
    });
    await driver.sleep(1500);
    const main = await driver.getWindowHandle();
    const before = (await driver.getAllWindowHandles()).length;
    await driver.get(`http://127.0.0.1:${port}/`);
    await inChrome(
      `const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
       ExtensionParent.apiManager.global.browserActionFor(ext).triggerAction(w); ${sleepIn}`,
    );
    await waitFor(async () => (await driver.getAllWindowHandles()).length === before + 1);
    await driver.get(PANEL);
    // Selenium's handle for the new window stays on its initial about:blank, so look at the page
    // through the extension API: it must have mounted and be listing tabs.
    const rows = await waitFor(async () => {
      const r = await inPanel(async () => {
        const win = (await browser.windows.getAll({ populate: true })).find(
          (w) =>
            w.type === 'popup' && /sidepanel\.html\?surface=window/.test(w.tabs?.[0]?.url ?? ''),
        );
        if (!win) return -1;
        const view = browser.extension.getViews({ windowId: win.id })[0];
        return view ? view.document.querySelectorAll('[id^=vc-row-t]').length : -2;
      });
      return typeof r === 'number' && r > 2 ? r : null;
    });
    assert.ok(rows > 2);
    await inPanel(async () => {
      for (const w of await browser.windows.getAll())
        if (w.type === 'popup') await browser.windows.remove(w.id);
    });
    await driver.switchTo().window(main);
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
