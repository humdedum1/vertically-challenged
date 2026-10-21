#!/usr/bin/env node
// Release preflight (release kit). Fails before semantic-release runs when the repository state
// could produce a wrong or duplicate version:
//   - shallow clone (release history incomplete)
//   - semver-looking tags that do not follow tagFormat (semantic-release would ignore them and
//     start again at 1.0.0)
//   - no previous release tag, unless config.json says "firstRelease": "allow"
//   - "initialDevelopment": true without an existing 0.x tag
//   - version files missing or patterns not matching
// Warnings: version files that disagree with the last release, newer tags on other branches.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const errors = [], warnings = [];

const tagFormat = cfg.tagFormat || 'v${version}';
if (!tagFormat.includes('${version}')) errors.push(`tagFormat "${tagFormat}" must contain \${version}`);
if (!Array.isArray(cfg.branches) || !cfg.branches.length) errors.push('config.json "branches" must list at least one release branch');
if (git('rev-parse', '--is-shallow-repository') === 'true') errors.push('shallow clone: checkout with fetch-depth: 0 so the full release history is visible');

const [prefix, suffix = ''] = tagFormat.split('${version}');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const parse = (t) => (t.startsWith(prefix) && t.endsWith(suffix) ? SEMVER.exec(t.slice(prefix.length, t.length - suffix.length || undefined)) : null);
const allTags = git('tag', '--list').split('\n').filter(Boolean);
const merged = new Set(git('tag', '--merged', 'HEAD').split('\n').filter(Boolean));
const releaseTags = allTags.filter((t) => parse(t));
const foreign = allTags.filter((t) => !parse(t) && /^\D{0,20}\d+\.\d+\.\d+/.test(t));
if (foreign.length && !cfg.ignoreForeignTags) {
  errors.push(`tags look like versions but do not match tagFormat "${tagFormat}": ${foreign.slice(0, 10).join(', ')}. ` +
    'Fix tagFormat or set "ignoreForeignTags": true after verifying they are not release tags.');
}
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i]; return 0; };
const reachable = releaseTags.filter((t) => merged.has(t)).sort(cmp);
const last = reachable[reachable.length - 1];

if (!last) {
  if (cfg.initialDevelopment) errors.push('"initialDevelopment" needs an existing 0.x release tag; semantic-release would start at 1.0.0. Create a verified baseline tag first (with approval) or disable it.');
  else if (cfg.firstRelease !== 'allow') errors.push(`no release tag matching "${tagFormat}" is reachable from HEAD, so the next release would be the first one (1.0.0). ` +
    'If that is intended, set "firstRelease": "allow" in .github/release/config.json; otherwise create a baseline tag on the verified release commit.');
} else {
  console.log(`Last release reachable from HEAD: ${last}`);
  const newer = releaseTags.filter((t) => !merged.has(t) && cmp(t, last) > 0);
  if (newer.length) warnings.push(`newer release tags are not reachable from HEAD: ${newer.join(', ')}`);
}

try {
  const out = execFileSync('node', [join(here, 'bump-version.mjs'), '--check'], { encoding: 'utf8' });
  process.stdout.write(out);
  if (last) {
    const lastVersion = last.slice(prefix.length, last.length - suffix.length || undefined);
    const mismatched = out.split('\n').filter((l) => /^[^:]+: /.test(l) && !l.startsWith('::') && !l.endsWith(`: ${lastVersion}`) && !l.includes(`${lastVersion},`));
    if (mismatched.length) warnings.push(`version files differ from last release ${lastVersion}: ${mismatched.join('; ')} (they will be overwritten with the next version)`);
  }
} catch (e) {
  errors.push(`version files: ${(e.stderr || e.stdout || e.message).toString().trim()}`);
}

for (const w of warnings) console.log(`::warning::${w}`);
for (const e of errors) console.log(`::error::${e}`);
if (errors.length) process.exit(1);
console.log('Preflight passed.');
