#!/usr/bin/env node
// Version-file adapter (release kit). Reads "versionFiles" from ./config.json.
//
//   bump-version.mjs <version>   write <version> into every configured file
//   bump-version.mjs --check     print the version in every file; fail if a file or pattern is missing
//
// Entry types:
//   { "path": "package.json", "type": "json", "keys": ["version"] }
//   { "path": "package-lock.json", "type": "json", "keys": ["version", ["packages", "", "version"]] }
//   { "path": "src/Plugin.cs", "type": "regex", "pattern": "ModVersion = \"(?<version>[^\"]+)\"" }
// A regex must contain a named group "version" and match at least once; every match is replaced.
// A missing file or a pattern with no match fails the release instead of silently skipping it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cfg = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const files = cfg.versionFiles || [];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const arg = process.argv[2];
if (!arg || (arg !== '--check' && !SEMVER.test(arg))) {
  console.error('usage: bump-version.mjs <semver> | --check');
  process.exit(2);
}
const check = arg === '--check';

const keyPath = (k) => (Array.isArray(k) ? k : k.split('.'));

function jsonFile(f, text) {
  const data = JSON.parse(text);
  const found = [];
  for (const k of f.keys || ['version']) {
    const path = keyPath(k);
    let obj = data;
    for (const p of path.slice(0, -1)) obj = obj?.[p];
    const last = path[path.length - 1];
    if (!obj || typeof obj[last] !== 'string') throw new Error(`${f.path}: key ${JSON.stringify(k)} not found`);
    found.push(obj[last]);
    if (!check) obj[last] = arg;
  }
  const indent = (/^\{\n([ \t]+)/.exec(text) || [, '  '])[1];
  return { found, out: JSON.stringify(data, null, indent) + (text.endsWith('\n') ? '\n' : '') };
}

function regexFile(f, text) {
  const re = new RegExp(f.pattern, `${f.flags ?? 'm'}gd`);
  const found = [];
  let out = '', last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.indices?.groups?.version;
    if (!idx) throw new Error(`${f.path}: pattern needs a named group (?<version>...)`);
    found.push(m.groups.version);
    out += text.slice(last, idx[0]) + (check ? m.groups.version : arg);
    last = idx[1];
  }
  if (!found.length) throw new Error(`${f.path}: pattern ${f.pattern} did not match`);
  return { found, out: out + text.slice(last) };
}

let failed = false;
const seen = new Set();
for (const f of files) {
  const p = join(root, f.path);
  try {
    const text = readFileSync(p, 'utf8');
    const { found, out } = (f.type === 'regex' ? regexFile : jsonFile)(f, text);
    found.forEach((v) => seen.add(v));
    if (check) console.log(`${f.path}: ${found.join(', ')}`);
    else { writeFileSync(p, out); console.log(`${f.path}: ${found.join(', ')} -> ${arg}`); }
  } catch (e) {
    failed = true;
    console.error(`::error::${e.code === 'ENOENT' ? `${f.path}: file not found` : e.message}`);
  }
}
if (!files.length) console.log('No version files configured (tags and GitHub Releases carry the version).');
if (check && seen.size > 1) console.log(`::warning::version files disagree: ${[...seen].join(', ')}`);
process.exit(failed ? 1 : 0);
