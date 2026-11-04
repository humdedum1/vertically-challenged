// Runs every real-Chrome check in this folder one after another and prints a summary.
//   node tests/e2e/run-all.mjs [extension dir]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = [
  'tab-sync.mjs',
  'reconnect.mjs',
  'panel-recovery.mjs',
  'settings-load.mjs',
  'themes-row.mjs',
  'snooze-welcome.mjs',
  'csp.mjs',
  'put-away-search.mjs',
  'settings-search.mjs',
  'help-and-contrast.mjs',
  'undo-toasts.mjs',
  'tidy-up.mjs',
  'command-palette.mjs',
  'child-tabs.mjs',
  'new-tab-url.mjs',
  'nest-tabs.mjs',
  'drag.mjs',
  'essentials-keys.mjs',
  'pin-transfer.mjs',
  'discard.mjs',
  'restart.mjs',
  'auto-group.mjs',
  'incognito.mjs',
  'sync.mjs',
  'backup.mjs',
  'popup.mjs',
  'hostile-titles.mjs',
  'touch.mjs',
  'a11y-tree.mjs',
];
const results = [];
for (const s of SCRIPTS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, s), ...process.argv.slice(2)], {
    encoding: 'utf8',
    timeout: 180_000, // a hung browser fails this script instead of stalling CI for hours
  });
  const out = `${r.stdout}${r.stderr}`;
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL') || /Error/.test(l));
  results.push({ s, ok: r.status === 0, secs: Math.round((Date.now() - t0) / 1000), fails });
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${s} (${results.at(-1).secs}s)`);
  for (const f of fails) console.log(`     ${f}`);
  if (r.status !== 0) console.log(out.split('\n').slice(-25).join('\n'));
}
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `ALL ${results.length} PASS`
    : `${failed.length} of ${results.length} FAILED`,
);
process.exit(failed.length === 0 ? 0 : 1);
