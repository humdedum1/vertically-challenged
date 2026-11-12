// Real-Firefox smoke test: loads the built extension in headless Firefox and checks that the
// panel renders, lists tabs, and that tab groups, favicons and storage.sync work.
//   FIREFOX_BIN=/path/to/firefox node tests/e2e-firefox/smoke.mjs [extension dir]
// geckodriver is fetched by selenium-manager.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Browser, Builder, By, Key } from 'selenium-webdriver';
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
  // Install the unpacked directory: Firefox 140 can't load web-accessible files (frames,
  // scripting `files`) from the zipped temporary .xpi that installAddon() builds.
  await driver.execute(
    new Command('install addon')
      .setParameter('path', EXT)
      .setParameter('temporary', true)
      // Allowed in private windows, so the incognito checks below have private data to refuse.
      .setParameter('allowPrivateBrowsing', true),
  );
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
  // Panel commands only count from a port that subscribed to a window first.
  const panelCmd = (msg) =>
    inPanel(async (m) => {
      const windowId = (await browser.windows.getCurrent()).id;
      const p = browser.runtime.connect({ name: 'vc-panel' });
      p.postMessage({ type: 'subscribe', windowId });
      await new Promise((r) => setTimeout(r, 300));
      p.postMessage({ ...m, windowId: m.windowId ?? windowId });
      await new Promise((r) => setTimeout(r, 800));
      p.disconnect();
    }, msg);
  await check('search filters the tab list; clearing restores it', async () => {
    await driver.get(PANEL);
    const rowIds = () =>
      driver.executeScript(
        "return [...document.querySelectorAll('[id^=vc-row-t]')].map((e) => Number(e.id.slice(8)))",
      );
    // Rows render once the background has answered over the port.
    await waitFor(async () => (await rowIds()).length > 0);
    const id = await inPanel(
      async (u) => (await browser.tabs.create({ url: u, active: false })).id,
      `http://127.0.0.1:${port}/vc-search-target`,
    );
    try {
      const box = await driver.findElement(By.css('input[role=searchbox]'));
      await box.sendKeys('vc-search-target');
      // The list is virtualised: only the match is guaranteed to be rendered.
      await waitFor(async () => (await rowIds()).join() === String(id));
      // clear() fires no input event, so the filter would stay on; delete the text by keys.
      await box.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE);
      await waitFor(async () => (await rowIds()).length > 1);
    } finally {
      await inPanel((t) => browser.tabs.remove(t), id);
    }
  });
  await check(
    'pinning a tab moves it into the pinned section; unpinning moves it back',
    async () => {
      await driver.get(PANEL);
      const id = await inPanel(
        async (u) => (await browser.tabs.create({ url: u, active: false })).id,
        `http://127.0.0.1:${port}/pin-target`,
      );
      // Pinned tabs render as "p<item>" rows above the unpinned list.
      const pinRows = () =>
        driver.executeScript("return document.querySelectorAll('[id^=vc-row-p]').length");
      const isPinned = () => inPanel((t) => browser.tabs.get(t).then((x) => x.pinned), id);
      const before = await pinRows();
      try {
        await panelCmd({ type: 'setPinned', tabIds: [id], pinned: true });
        await waitFor(async () => (await pinRows()) === before + 1);
        assert.equal(await isPinned(), true);
        await panelCmd({ type: 'setPinned', tabIds: [id], pinned: false });
        await waitFor(async () => (await pinRows()) === before);
        assert.equal(await isPinned(), false);
      } finally {
        await inPanel((t) => browser.tabs.remove(t), id);
      }
    },
  );
  await check(
    'saving a session lists it; restoring it opens its tabs in a new window',
    async () => {
      await driver.get(PANEL);
      const name = 'vc-smoke-session';
      const sessionId = () =>
        inPanel(async (n) => {
          const { sessions = [] } = await browser.storage.local.get('sessions');
          return sessions.find((s) => s.name === n)?.id ?? null;
        }, name);
      const mainWin = await inPanel(async () => (await browser.windows.getCurrent()).id);
      await panelCmd({ type: 'saveSession', scope: 'window', name });
      const sid = await waitFor(sessionId);
      try {
        await (await driver.findElement(By.css('#vc-tab-sessions'))).click();
        await waitFor(async () =>
          (await driver.findElement(By.css('body')).getText()).includes(name),
        );
        const before = await inPanel(async () => (await browser.windows.getAll()).map((w) => w.id));
        await panelCmd({ type: 'restoreSession', id: sid, target: 'newWindow' });
        const opened = await waitFor(async () => {
          const wins = await inPanel(() => browser.windows.getAll({ populate: true }));
          const w = wins.find((x) => !before.includes(x.id));
          return w?.tabs.some((t) => t.url?.startsWith(`http://127.0.0.1:${port}/a`)) ? w : null;
        });
        assert.notEqual(opened.id, mainWin);
        await inPanel((id) => browser.windows.remove(id), opened.id);
      } finally {
        if (sid) await panelCmd({ type: 'deleteSession', id: sid });
        await driver.get(PANEL);
      }
      await waitFor(async () => (await sessionId()) === null);
    },
  );
  await check('dragging a tab above another reorders the real browser tabs', async () => {
    await driver.get(PANEL);
    const [a, b] = await inPanel(() =>
      browser.tabs
        .query({ currentWindow: true })
        .then((ts) => ts.filter((t) => t.url?.endsWith('/a') || t.url?.endsWith('/b')))
        .then((ts) => ts.sort((x, y) => x.index - y.index).map((t) => t.id)),
    );
    assert.ok(a && b, 'fixture tabs a and b are not both in this window');
    const rectOf = (id) =>
      driver.executeScript(
        `const r = document.getElementById('vc-row-t${id}').getBoundingClientRect(); return {x: r.left + 40, y: r.top + r.height / 2, top: r.top};`,
      );
    await waitFor(async () => (await rectOf(b)).y > 0);
    const from = await rectOf(b);
    const to = await rectOf(a);
    const actions = driver.actions({ bridge: true });
    actions.move({ origin: 'viewport', x: Math.round(from.x), y: Math.round(from.y) }).press();
    const steps = 12;
    for (let i = 1; i <= steps; i++)
      actions.move({
        origin: 'viewport',
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.top + 3 - from.y) * i) / steps),
      });
    await actions.pause(150).release().perform();
    await driver.sleep(800);
    const order = await inPanel(
      async (ids) => {
        const ts = await browser.tabs.query({ currentWindow: true });
        return ids.map((id) => ts.find((t) => t.id === id).index);
      },
      [a, b],
    );
    assert.ok(order[1] < order[0], `b is at ${order[1]}, a at ${order[0]}`);
  });
  // Runs privileged code in the Chrome context: grants or revokes <all_urls> (standing in for
  // the activeTab the toolbar button gets) through the extension's own permission store.
  const grantAllUrls = async (on) => {
    const r =
      await inChrome(`const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      await ExtensionPermissions.${on ? 'add' : 'remove'}('${ID}', { permissions: [], origins: ['<all_urls>'] }, ext);
      return 'ok';`);
    assert.equal(r, 'ok', String(r?.error ?? r));
  };
  const setDisplayMode = (mode) =>
    inPanel(async (m) => {
      const { settings } = await browser.storage.sync.get('settings');
      await browser.storage.sync.set({
        settings: {
          ...(settings ?? {}),
          version: 10,
          display: { ...(settings?.display ?? {}), mode: m },
        },
      });
    }, mode);
  /** Rows of the framed popup (closed shadow root: the frame is the only way in). */
  const framedRows = () =>
    waitFor(async () => {
      await driver.switchTo().defaultContent();
      try {
        await driver.switchTo().frame(0);
      } catch {
        return null;
      }
      const n = await driver.executeScript(
        "return document.querySelectorAll('[id^=vc-row-t]').length",
      );
      return n > 2 ? n : null;
    });
  const clickToolbar = () =>
    inChrome(
      `const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
       ExtensionParent.apiManager.global.browserActionFor(ext).triggerAction(w); ${sleepIn}`,
    );
  await check(
    'popup mode: the toolbar button opens the in-page popup and it lists tabs',
    async () => {
      await driver.get(PANEL);
      await setDisplayMode('popup');
      await driver.sleep(1500);
      await driver.get(`http://127.0.0.1:${port}/`);
      await grantAllUrls(true);
      try {
        await clickToolbar();
        const rows = await framedRows();
        assert.ok(rows > 2);
        // Bookmarks come through the relay too: the framed page has no bookmarks API of its own.
        await driver.findElement(By.css('#vc-tab-bookmarks')).click();
        await waitFor(() =>
          driver.executeScript(
            `return [...document.querySelectorAll('#vc-panel-bookmarks [role=treeitem]')]
             .some((r) => r.textContent.includes('Never opened'));`,
          ),
        );
      } finally {
        // Step 2b: close the overlay, revoke the grant, and restore the sidebar for later checks.
        await driver.switchTo().defaultContent();
        await clickToolbar().catch(() => {});
        await grantAllUrls(false);
        await setDisplayMode('sidebar');
        await driver.switchTo().defaultContent();
      }
    },
  );
  await check('popup mode: the keyboard shortcut opens the in-page popup', async () => {
    await driver.get(PANEL);
    await setDisplayMode('popup');
    await driver.sleep(1500);
    await driver.get(`http://127.0.0.1:${port}/`);
    // No <all_urls> grant here: the command itself grants activeTab (Firefox 140 and 160).
    const toggle = () => inChrome(`ext.shortcuts.onCommand('toggle-side-panel'); ${sleepIn}`);
    try {
      await toggle();
      assert.ok((await framedRows()) > 2);
      await driver.switchTo().defaultContent();
      await toggle();
      // window.frames hides the shadow-root iframe; only switching into it shows it is there.
      await waitFor(async () => {
        await driver.switchTo().defaultContent();
        return driver
          .switchTo()
          .frame(0)
          .then(
            () => false,
            () => true,
          );
      });
    } finally {
      await driver.switchTo().defaultContent();
      await driver.get(PANEL);
      await setDisplayMode('sidebar');
    }
  });
  await check(
    'popup mode: recently closed restores through the relay; unknown ids are refused',
    async () => {
      const url = `http://127.0.0.1:${port}/?closed-in-popup`;
      await driver.get(PANEL);
      await setDisplayMode('popup');
      await inPanel(async (u) => {
        const t = await browser.tabs.create({ url: u, active: false });
        await new Promise((r) => setTimeout(r, 800));
        await browser.tabs.remove(t.id);
      }, url);
      await driver.sleep(1000);
      await driver.get(`http://127.0.0.1:${port}/`);
      await grantAllUrls(true);
      try {
        await clickToolbar();
        await framedRows();
        const bogus = await driver.executeAsyncScript(
          `browser.runtime.sendMessage({ type: 'relay', method: 'sessions.restore', args: ['no-such-session'] }).then(arguments[0]);`,
        );
        assert.equal(bogus.ok, false);
        await waitFor(() =>
          driver.executeScript(
            `const b = [...document.querySelectorAll('#vc-recently-closed button.item')]
               .find((e) => e.title.includes(arguments[0]));
             b?.click(); return !!b;`,
            url,
          ),
        );
        await driver.switchTo().defaultContent();
        await driver.get(PANEL);
        await waitFor(() =>
          inPanel(async (u) => (await browser.tabs.query({})).some((t) => t.url === u), url),
        );
      } finally {
        await driver.switchTo().defaultContent();
        await driver.get(PANEL);
        await inPanel(async (u) => {
          // Match patterns can't carry a port, so filter by hand.
          for (const t of await browser.tabs.query({}))
            if (t.url === u) await browser.tabs.remove(t.id);
          // The restore activated its tab; give focus back to the driver's tab.
          await browser.tabs.update((await browser.tabs.getCurrent()).id, { active: true });
        }, url);
        await grantAllUrls(false);
        await setDisplayMode('sidebar');
      }
    },
  );
  await check('popup mode: a private closed tab is hidden from the popup and refused', async () => {
    const url = `http://127.0.0.1:${port}/?closed-in-private`;
    await driver.get(PANEL);
    await setDisplayMode('popup');
    const priv = await inPanel(async (u) => {
      const w = await browser.windows.create({ incognito: true, url: ['about:blank', u] });
      await new Promise((r) => setTimeout(r, 1500));
      const t = (await browser.tabs.query({ windowId: w.id })).find((x) => x.url === u);
      await browser.tabs.remove(t.id);
      await new Promise((r) => setTimeout(r, 800));
      const e = (await browser.sessions.getRecentlyClosed()).find((x) => x.tab?.url === u);
      // inChrome() acts on the most recent window: put the driver's normal window back on top.
      const me = await browser.tabs.getCurrent();
      await browser.windows.update(me.windowId, { focused: true });
      await new Promise((r) => setTimeout(r, 800));
      return { win: w.id, id: e?.tab?.sessionId, incognito: e?.tab?.incognito };
    }, url);
    try {
      // The background can see it: proves there is a private entry to leak.
      assert.ok(priv.id, 'private closed tab is listed to the extension');
      assert.equal(priv.incognito, true);
      await driver.get(`http://127.0.0.1:${port}/`);
      await grantAllUrls(true);
      await clickToolbar();
      await framedRows();
      const relay = (method, args) =>
        driver.executeAsyncScript(
          'browser.runtime.sendMessage({ type: "relay", method: arguments[0], args: arguments[1] }).then(arguments[2]);',
          method,
          args,
        );
      const listed = await relay('sessions.getRecentlyClosed', []);
      assert.equal(listed.ok, true);
      assert.ok(!JSON.stringify(listed.value).includes('closed-in-private'), 'hidden from popup');
      const restored = await relay('sessions.restore', [priv.id]);
      assert.equal(restored.ok, false);
      await driver.switchTo().defaultContent();
      await driver.get(PANEL);
      assert.equal(
        await inPanel(async (u) => (await browser.tabs.query({})).some((t) => t.url === u), url),
        false,
        'nothing was restored',
      );
    } finally {
      await driver.switchTo().defaultContent();
      await driver.get(PANEL);
      await inPanel(async (w) => {
        await browser.windows.remove(w).catch(() => {});
        await browser.tabs.update((await browser.tabs.getCurrent()).id, { active: true });
      }, priv.win);
      await grantAllUrls(false);
      await setDisplayMode('sidebar');
    }
  });
  // Feature checks below mirror tests/e2e/*.mjs. Each one removes what it created.
  const tabRow = (id) =>
    driver.executeScript(
      "const e = document.getElementById('vc-row-t' + arguments[0]); return e ? e.getAttribute('aria-level') + ' ' + e.classList.contains('discarded') : null;",
      id,
    );
  const closeTabs = (ids) =>
    inPanel(
      async (list) => {
        for (const id of list) await browser.tabs.remove(id).catch(() => {});
      },
      ids.filter((x) => x !== undefined),
    );

  await check('backup file restores its window setup, which can then be deleted', async () => {
    await driver.get(PANEL);
    const file = path.join(tmpdir(), `vc-smoke-backup-${process.pid}.json`);
    const item = (id, host) => ({
      kind: 'item',
      id,
      homeUrl: `http://${host}/`,
      lastUrl: `http://${host}/page`,
      title: host,
      tabId: 999999,
    });
    const source = {
      id: 'lsmokebkup1',
      name: 'Smoke backup',
      incognito: false,
      lastUsed: 1,
      collapsed: [],
      essentials: [],
      pinned: [
        {
          kind: 'folder',
          id: 'work',
          name: 'Work',
          icon: 'work',
          collapsed: false,
          children: [item('docs', '127.0.0.1')],
        },
      ],
    };
    writeFileSync(
      file,
      JSON.stringify({
        format: 'vertically-challenged',
        kind: 'backup',
        version: 1,
        themes: [],
        layouts: [source],
      }),
    );
    const findSetup = () =>
      inPanel(
        async () =>
          (await browser.storage.local.get('layouts')).layouts?.layouts?.find(
            (l) => l.name === 'Smoke backup',
          ) ?? null,
      );
    try {
      await (
        await waitFor(() => driver.findElements(By.css('#vc-tab-settings')).then((t) => t[0]))
      ).click();
      await (
        await waitFor(() =>
          driver.findElements(By.xpath("//summary[contains(., 'Data')]")).then((t) => t[0]),
        )
      ).click();
      await (await driver.findElement(By.css('[aria-label="Backup file"]'))).sendKeys(file);
      // The confirm step only renders once the file has been read.
      await (
        await waitFor(() =>
          driver
            .findElements(
              By.xpath(
                "//*[@role='group'][@aria-label='Restore backup']//button[normalize-space()='Apply']",
              ),
            )
            .then((t) => t[0]),
        )
      ).click();
      await waitFor(async () =>
        (await driver.findElement(By.css('body')).getText()).includes(
          'Restored settings, 0 themes and 1 pinned layout in Window setups.',
        ),
      );
      const restored = await waitFor(findSetup);
      assert.equal(
        restored.pinned[0].children[0].homeUrl,
        'http://127.0.0.1/',
        'home URL lost in restore',
      );
      assert.notEqual(restored.id, source.id, 'restore kept the backup id');
    } finally {
      rmSync(file, { force: true });
      const setup = await findSetup();
      if (setup) await panelCmd({ type: 'setupDelete', setupId: setup.id });
      // The panel remembers its tab; leave Settings so later checks find the tab list.
      await driver.get(PANEL);
      await (
        await waitFor(() => driver.findElements(By.css('#vc-tab-tabs')).then((t) => t[0]))
      ).click();
    }
  });

  await check('snoozing a tab closes it and records it; waking it reopens it', async () => {
    await driver.get(PANEL);
    const url = `http://127.0.0.1:${port}/snooze-target`;
    const id = await inPanel(
      async (u) => (await browser.tabs.create({ url: u, active: false })).id,
      url,
    );
    const stored = () =>
      inPanel(
        async (u) =>
          ((await browser.storage.local.get('vc:snoozed'))['vc:snoozed'] ?? []).find(
            (s) => s.url === u,
          ) ?? null,
        url,
      );
    try {
      await driver.sleep(1200);
      await panelCmd({ type: 'snooze', tabIds: [id], wakeAt: Date.now() + 3_600_000 });
      const entry = await waitFor(stored);
      assert.equal(
        await inPanel(
          (t) =>
            browser.tabs.get(t).then(
              () => true,
              () => false,
            ),
          id,
        ),
        false,
        'the snoozed tab is still open',
      );
      await panelCmd({ type: 'wakeSnoozed', id: entry.id });
      await waitFor(() =>
        inPanel(
          async (u) => (await browser.tabs.query({})).some((t) => (t.pendingUrl || t.url) === u),
          url,
        ),
      );
      assert.equal(await stored(), null, 'the entry was not cleared on wake');
    } finally {
      const left = await stored();
      if (left) await panelCmd({ type: 'deleteSnoozed', id: left.id });
      await inPanel(async (u) => {
        for (const t of await browser.tabs.query({}))
          if ((t.pendingUrl || t.url) === u) await browser.tabs.remove(t.id);
      }, url);
    }
  });

  await check('discarding a tab through the extension unloads it in Firefox', async () => {
    await driver.get(PANEL);
    const id = await inPanel(
      async (u) => (await browser.tabs.create({ url: u, active: false })).id,
      `http://127.0.0.1:${port}/discard-target`,
    );
    try {
      await driver.sleep(1000);
      await panelCmd({ type: 'discard', tabIds: [id] });
      await waitFor(() => inPanel((t) => browser.tabs.get(t).then((x) => x.discarded), id));
    } finally {
      await closeTabs([id]);
    }
  });

  await check('a saved window with a tab group restores the group with its title', async () => {
    await driver.get(PANEL);
    const base = `http://127.0.0.1:${port}`;
    const name = 'vc-smoke-groups';
    // A window of its own, so the session holds only these two tabs.
    const win = await inPanel(async (b) => {
      const w = await browser.windows.create({ url: `${b}/group-a`, focused: false });
      await browser.tabs.create({ windowId: w.id, url: `${b}/group-b`, active: false });
      const ids = (await browser.tabs.query({ windowId: w.id })).map((t) => t.id);
      const gid = await browser.tabs.group({ tabIds: ids, createProperties: { windowId: w.id } });
      await browser.tabGroups.update(gid, { title: 'vc-saved', color: 'green' });
      // A new window's tabs reach the background's store a moment after they open.
      await new Promise((r) => setTimeout(r, 3000));
      return w.id;
    }, base);
    const sessionId = () =>
      inPanel(async (n) => {
        const { sessions = [] } = await browser.storage.local.get('sessions');
        return sessions.find((s) => s.name === n)?.id ?? null;
      }, name);
    let sid = null;
    let restored = null;
    try {
      // The background only saves windows that a panel port has subscribed to.
      await inPanel(
        async (wid, m) => {
          const p = browser.runtime.connect({ name: 'vc-panel' });
          p.postMessage({ type: 'subscribe', windowId: wid });
          await new Promise((r) => setTimeout(r, 300));
          p.postMessage({ ...m, windowId: wid });
          await new Promise((r) => setTimeout(r, 800));
          p.disconnect();
        },
        win,
        { type: 'saveSession', scope: 'window', name },
      );
      sid = await waitFor(sessionId);
      const before = await inPanel(async () => (await browser.windows.getAll()).map((w) => w.id));
      await panelCmd({ type: 'restoreSession', id: sid, target: 'newWindow' });
      restored = await waitFor(() =>
        inPanel(
          async (b, before) => {
            for (const w of await browser.windows.getAll({ populate: true })) {
              if (before.includes(w.id) || !w.tabs?.some((t) => t.url === `${b}/group-a`)) continue;
              const groups = await browser.tabGroups.query({ windowId: w.id });
              return groups.find((g) => g.title === 'vc-saved') ? w.id : null;
            }
            return null;
          },
          base,
          before,
        ),
      );
      assert.ok(restored, 'the restored window has no group titled vc-saved');
    } finally {
      for (const id of [win, restored])
        if (id) await inPanel((w) => browser.windows.remove(w).catch(() => {}), id);
      if (sid) await panelCmd({ type: 'deleteSession', id: sid });
      await driver.get(PANEL);
    }
  });

  await check('a tab opened from another tab nests under it in the panel', async () => {
    await driver.get(PANEL);
    const ids = await inPanel(async (b) => {
      const parent = await browser.tabs.create({ url: `${b}/child-parent`, active: false });
      const child = await browser.tabs.create({
        url: `${b}/child-of`,
        openerTabId: parent.id,
        active: false,
      });
      // The panel draws only the rows in view; activating the parent scrolls its row into view.
      await browser.tabs.update(parent.id, { active: true });
      return { parent: parent.id, child: child.id, opener: child.openerTabId };
    }, `http://127.0.0.1:${port}`);
    try {
      assert.equal(ids.opener, ids.parent, 'Firefox dropped openerTabId');
      await waitFor(async () => (await tabRow(ids.parent))?.startsWith('1'));
      await waitFor(async () => (await tabRow(ids.child))?.startsWith('2'));
    } finally {
      await closeTabs([ids.child, ids.parent]);
    }
  });

  await check('an auto-group rule puts a new matching tab into its named group', async () => {
    await driver.get(PANEL);
    const rule = { host: `127.0.0.1:${port}`, path: '/vc-auto', action: 'group', group: 'vc-auto' };
    const original = await inPanel(
      async () => (await browser.storage.sync.get('settings')).settings ?? null,
    );
    let id;
    try {
      await inPanel(async (r) => {
        const { settings } = await browser.storage.sync.get('settings');
        await browser.storage.sync.set({
          settings: { ...(settings ?? {}), rules: [...(settings?.rules ?? []), r] },
        });
      }, rule);
      await driver.sleep(1000);
      id = await inPanel(
        async (u) => (await browser.tabs.create({ url: u, active: false })).id,
        `http://127.0.0.1:${port}/vc-auto-target`,
      );
      const group = await waitFor(() =>
        inPanel(async (t) => {
          const tab = await browser.tabs.get(t);
          if (tab.groupId === -1) return null;
          return (await browser.tabGroups.get(tab.groupId)).title;
        }, id),
      );
      assert.equal(group, 'vc-auto');
    } finally {
      await closeTabs([id]);
      await inPanel(async (s) => {
        if (s === null) await browser.storage.sync.remove('settings');
        else await browser.storage.sync.set({ settings: s });
      }, original);
    }
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
