// File-backup import/export and applying a restored layout in real Chromium.

import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { check, extensionDir, finish, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 440, height: 1400 });
try {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check(false, 'no page errors', e.message));
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Data' }).click();
  const item = (id, host) => ({
    kind: 'item',
    id,
    homeUrl: `https://${host}/`,
    lastUrl: `https://${host}/page`,
    title: host,
    tabId: 999999,
  });
  const source = {
    id: 'laaaaaaaaaa',
    name: 'Backup work',
    incognito: false,
    lastUsed: 1,
    collapsed: [],
    essentials: [item('mail', 'mail.test')],
    pinned: [
      {
        kind: 'folder',
        id: 'work',
        name: 'Work',
        icon: 'work',
        collapsed: true,
        children: [
          item('docs', 'docs.test'),
          {
            kind: 'folder',
            id: 'nested',
            name: 'Nested',
            icon: 'code',
            collapsed: false,
            children: [item('code', 'code.test')],
          },
        ],
      },
    ],
  };
  const backup = {
    format: 'vertically-challenged',
    kind: 'backup',
    version: 1,
    themes: [],
    layouts: [source],
  };
  await page.getByLabel('Backup file', { exact: true }).setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page
    .getByRole('group', { name: 'Restore backup', exact: true })
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await page
    .getByText('Restored settings, 0 themes and 1 pinned layout in Window setups.', {
      exact: true,
    })
    .waitFor();
  const restored = await page.evaluate(async () =>
    (await chrome.storage.local.get('layouts')).layouts.layouts.find(
      (l) => l.name === 'Backup work',
    ),
  );
  check(
    restored?.essentials[0]?.homeUrl === 'https://mail.test/',
    'import restores Staples home URLs',
  );
  check(restored?.essentials[0]?.tabId === null, 'imported Staples are dormant');
  check(restored?.id !== source.id, 'import assigns fresh layout ids');
  check(
    restored?.pinned[0]?.children[1]?.children[0]?.lastUrl === 'https://code.test/page',
    'nested folders and last URLs survive',
  );
  check(restored?.pinned[0]?.collapsed === true, 'folder collapse state survives');

  await page.evaluate(async (setupId) => {
    const win = await chrome.windows.getCurrent();
    const port = chrome.runtime.connect({ name: 'vc-panel' });
    port.postMessage({ type: 'subscribe', windowId: win.id });
    port.postMessage({ type: 'setupApply', setupId, windowId: win.id });
    globalThis.__backupPort = port;
  }, restored.id);
  await page.waitForFunction(async () => {
    const data = (await chrome.storage.local.get('layouts')).layouts;
    return (
      data.layouts.filter((l) => l.essentials.length === 1 && l.pinned[0]?.children.length === 2)
        .length === 2
    );
  });
  await page.waitForFunction(
    async (id) =>
      !(await chrome.storage.local.get('layouts')).layouts.layouts.some((l) => l.id === id),
    restored.id,
  );
  check(true, 'restored setup can be applied to the current window');

  // Applying a setup consumes it, so import another copy to check both export paths.
  await page.getByLabel('Backup file', { exact: true }).setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page
    .getByRole('group', { name: 'Restore backup', exact: true })
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Restore backup', exact: true })
    .waitFor({ state: 'detached' });

  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save full backup', exact: true }).click();
  const download = await waiting;
  // A full backup is gzipped JSON (no passphrase here); its settings/themes/layouts sit under `backup`.
  const full = JSON.parse(gunzipSync(await fs.readFile(await download.path())).toString('utf8'));
  check(full.format === 'vc-full-backup', 'full backup file has its format marker');
  const exported = full.backup;
  check(
    exported.layouts.length === 2,
    'export includes both current layout and saved setup',
    JSON.stringify(exported.layouts),
  );
  check(
    exported.layouts.every((l) => l.essentials[0]?.tabId === null),
    'export removes live tab bindings',
  );
  check(
    exported.layouts.every(
      (l) => l.pinned[0]?.children[1]?.children[0]?.homeUrl === 'https://code.test/',
    ),
    'export preserves nested pinned folders',
  );

  await page.getByLabel('Backup file', { exact: true }).setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'vertically-challenged', themes: [] })),
  });
  await page
    .getByRole('group', { name: 'Restore backup', exact: true })
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await page
    .getByText('Restored settings, 0 themes and 0 pinned layouts in Window setups.', {
      exact: true,
    })
    .waitFor();
  const after = await page.evaluate(
    async () => (await chrome.storage.local.get('layouts')).layouts.layouts.length,
  );
  check(after === 2, 'old settings-only backups keep existing layouts');
} finally {
  await close();
}
finish();
