// Runs every real-Chrome check in this folder one after another and prints a summary.
//   node tests/e2e/run-all.mjs [extension dir]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = [
  'tab-sync.mjs',
  'reconnect.mjs',
  'drag.mjs',
  'essentials-keys.mjs',
  'pin-transfer.mjs',
  'discard.mjs',
  'restart.mjs',
  'incognito.mjs',
  'sync.mjs',
  'popup.mjs',
];
const results = [];
for (const s of SCRIPTS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, s), ...process.argv.slice(2)], {
    encoding: 'utf8',
  });
  const out = `${r.stdout}${r.stderr}`;
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL') || /Error/.test(l));
  results.push({ s, ok: r.status === 0, secs: Math.round((Date.now() - t0) / 1000), fails });
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${s} (${results.at(-1).secs}s)`);
  for (const f of fails) console.log(`     ${f}`);
}
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `ALL ${results.length} PASS`
    : `${failed.length} of ${results.length} FAILED`,
);
process.exit(failed.length === 0 ? 0 : 1);
