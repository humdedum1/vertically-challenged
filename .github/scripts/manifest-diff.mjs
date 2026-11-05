// Usage: node manifest-diff.mjs <base-output-dir> <head-output-dir>
// Compares permission-bearing manifest keys per browser build. Prints markdown
// and exits 0 always; writes "changed=true|false" to $GITHUB_OUTPUT.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, head] = process.argv.slice(2);
const KEYS = [
  'permissions',
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
  'content_scripts',
];
const builds = ['chrome-mv3', 'firefox-mv3'];
const load = (dir, b) => {
  const f = join(dir, b, 'manifest.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
};
const norm = (v) => (v === undefined ? [] : v);
let out = '';
for (const b of builds) {
  const [a, h] = [load(base, b), load(head, b)];
  for (const k of KEYS) {
    const [x, y] = [norm(a[k]), norm(h[k])];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const s = (v) => v.map((i) => JSON.stringify(i));
    const added = s(y).filter((i) => !s(x).includes(i));
    const removed = s(x).filter((i) => !s(y).includes(i));
    out += `- **${b}** \`${k}\`: ${
      added
        .map((i) => `+${i}`)
        .concat(removed.map((i) => `-${i}`))
        .join(', ') || 'reordered'
    }\n`;
  }
}
const body = out
  ? `⚠️ **Permissions changed — requires maintainer review (Chrome Web Store / AMO re-review)**\n\n${out}`
  : 'No permission changes in the built manifests.';
console.log(body);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${out ? 'true' : 'false'}\n`);
if (process.env.BODY_FILE) writeFileSync(process.env.BODY_FILE, body);
