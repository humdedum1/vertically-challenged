#!/usr/bin/env node
// semver-analyze: Conventional Commits linter and release-impact calculator.
//
// One implementation shared by the Claude Code skill, the global PreToolUse hook and
// (vendored as .github/release/semver-analyze.mjs) the GitHub Actions release kit, so that
// local proposals and CI releases follow the same rules as semantic-release's
// conventionalcommits preset (breaking -> major, feat -> minor, fix/perf/revert -> patch).
//
// The commit-derived bump is only half of the answer: it also prints diff-based review
// hints (removed files, runtime requirement changes, migrations, ...) that a human or
// Claude must reconcile with the commit types before trusting the proposal.
//
// Usage:
//   semver-analyze.mjs [--repo DIR] [--from REF] [--to REF] [--path P]... [--tag-format 'v${version}']
//                      [--initial-development|--no-initial-development] [--prerelease ID] [--json]
//   semver-analyze.mjs --lint-message "feat(x): msg"     exit 0 if valid, 1 if not
//   semver-analyze.mjs --lint-range A..B [--repo DIR]   exit 0 if every non-merge commit is valid
//
// Exit codes (analyze mode): 0 = ok, 1 = invalid commits in range, 2 = usage/git error.
// Requires Node >= 18 and git. No npm dependencies.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TYPES = ['feat', 'fix', 'perf', 'revert', 'refactor', 'docs', 'style', 'test', 'build', 'ci', 'chore'];
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };
const HEADER_RE = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()\r\n]+)\))?(?<bang>!)?: (?<subject>\S.*)$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGES?:\s*\S/m;
const GIT_REVERT_RE = /^Revert ".+"$/;
const AUTOSQUASH_RE = /^(fixup|squash|amend)! /;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseArgs(argv) {
  const o = { paths: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case '--repo': o.repo = next(); break;
      case '--from': o.from = next(); break;
      case '--to': o.to = next(); break;
      case '--path': o.paths.push(next()); break;
      case '--tag-format': o.tagFormat = next(); break;
      case '--initial-development': o.initialDevelopment = true; break;
      case '--no-initial-development': o.initialDevelopment = false; break;
      case '--prerelease': o.prerelease = next(); break;
      case '--json': o.json = true; break;
      case '--lint-message': o.lintMessage = next(); break;
      case '--lint-range': o.lintRange = next(); break;
      case '--types': o.types = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  return o;
}

function git(repo, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trimEnd();
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}

// Kit config (.github/release/config.json) supplies defaults so CI and local runs agree.
export function loadKitConfig(repo) {
  const p = join(repo, '.github', 'release', 'config.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

export function allowedTypes(repo, o, kit) {
  if (o.types) return o.types;
  const extra = [...(kit.extraTypes || [])];
  const fromGit = repo ? git(repo, ['config', '--get', 'semver.extraTypes'], { allowFail: true }) : null;
  if (fromGit) extra.push(...fromGit.split(',').map((s) => s.trim()).filter(Boolean));
  return [...DEFAULT_TYPES, ...extra];
}

export function lintMessage(message, types = DEFAULT_TYPES) {
  const header = message.split(/\r?\n/, 1)[0].trim();
  if (!header) return { valid: false, reason: 'empty commit message' };
  if (header.startsWith('Merge ')) return { valid: true, kind: 'merge' };
  if (GIT_REVERT_RE.test(header)) return { valid: true, kind: 'git-revert' };
  if (AUTOSQUASH_RE.test(header)) return { valid: true, kind: 'autosquash' };
  const m = HEADER_RE.exec(header);
  if (!m) return { valid: false, reason: `header "${header}" is not "<type>[(scope)][!]: <description>"` };
  const type = m.groups.type;
  if (!types.includes(type)) {
    const lower = type.toLowerCase();
    const hint = types.includes(lower) ? ` (use lowercase "${lower}")` : '';
    return { valid: false, reason: `type "${type}" is not one of: ${types.join(', ')}${hint}` };
  }
  return { valid: true, kind: 'conventional' };
}

export function classify(message, types = DEFAULT_TYPES) {
  const header = message.split(/\r?\n/, 1)[0].trim();
  const lint = lintMessage(message, types);
  const body = message.slice(header.length);
  const footerBreaking = BREAKING_FOOTER_RE.test(body);
  if (!lint.valid) return { header, valid: false, reason: lint.reason, impact: footerBreaking ? 'major' : 'unknown', breaking: footerBreaking };
  if (lint.kind === 'git-revert') return { header, valid: true, type: 'revert', impact: 'patch', breaking: false };
  if (lint.kind === 'autosquash') return { header, valid: true, type: 'autosquash', impact: 'none', breaking: false, note: 'unsquashed fixup commit' };
  if (lint.kind === 'merge') return { header, valid: true, type: 'merge', impact: 'none', breaking: false };
  const { type, scope, bang } = HEADER_RE.exec(header).groups;
  const breaking = Boolean(bang) || footerBreaking;
  let impact = 'none';
  if (breaking) impact = 'major';
  else if (type === 'feat') impact = 'minor';
  else if (type === 'fix' || type === 'perf' || type === 'revert') impact = 'patch';
  return { header, valid: true, type, scope: scope || null, impact, breaking };
}

function parseSemver(v) {
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

function cmpSemver(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] - b[k];
  if (!a.pre.length && b.pre.length) return 1;
  if (a.pre.length && !b.pre.length) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny && +x !== +y) return +x - +y;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const fmt = (v) => `${v.major}.${v.minor}.${v.patch}${v.pre.length ? '-' + v.pre.join('.') : ''}`;

function tagRegex(tagFormat) {
  const [prefix, suffix] = tagFormat.split('${version}');
  if (suffix === undefined) throw new Error(`tag format "${tagFormat}" must contain \${version}`);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc(prefix)}(.+)${esc(suffix)}$`);
}

function findTags(repo, to, tagFormat) {
  const re = tagRegex(tagFormat);
  const merged = (git(repo, ['tag', '--merged', to], { allowFail: true }) || '').split('\n').filter(Boolean);
  const all = (git(repo, ['tag', '--list'], { allowFail: true }) || '').split('\n').filter(Boolean);
  const pick = (list) => list.map((t) => { const m = re.exec(t); const v = m && parseSemver(m[1]); return v ? { tag: t, v } : null; }).filter(Boolean).sort((a, b) => cmpSemver(a.v, b.v));
  const mergedTags = pick(merged);
  const allTags = pick(all);
  // Semver-looking tags that do not follow the configured format are a classic source of
  // "semantic-release starts over at 1.0.0" accidents, so surface them.
  const foreign = all.filter((t) => !re.test(t) && /\d+\.\d+\.\d+/.test(t));
  const unmerged = allTags.filter((t) => !merged.includes(t.tag));
  return { mergedTags, allTags, foreign, unmerged };
}

function bump(cur, impact, initialDevelopment) {
  const v = { major: cur.major, minor: cur.minor, patch: cur.patch, pre: [] };
  let eff = impact;
  if (initialDevelopment && cur.major === 0 && impact === 'major') eff = 'minor';
  if (eff === 'major') { v.major++; v.minor = 0; v.patch = 0; }
  else if (eff === 'minor') { v.minor++; v.patch = 0; }
  else if (eff === 'patch') v.patch++;
  return { v, effective: eff };
}

const HINTS = [
  { re: /(^|\/)(package\.json)$/, why: 'package manifest changed: check exports/main/bin/types/engines/peerDependencies for breaking changes' },
  { re: /\.(csproj|fsproj|vbproj)$|(^|\/)Directory\.Build\.(props|targets)$/, why: '.NET project file changed: check TargetFramework, package references and public assembly surface' },
  { re: /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg)$/, why: 'Python packaging changed: check requires-python, entry points and dependency ranges' },
  { re: /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml)$/, why: 'container definition changed: check ports, volumes, env vars, user/UID and base image for self-hosted upgrade breakage' },
  { re: /(^|\/)\.env\.example$|(^|\/)config(\.schema)?\.(json|ya?ml|toml)$/, why: 'configuration surface changed: renamed/removed settings break existing deployments' },
  { re: /(^|\/)(migrations?|alembic|drizzle|prisma)(\/|$)|\.sql$/, why: 'database migration: check for irreversible or data-dropping changes' },
  { re: /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$|\.proto$|\.graphql$/, why: 'API contract changed: removed/renamed fields are breaking' },
  { re: /(^|\/)routes\/api\/|(^|\/)(api|controllers)\//, why: 'HTTP API code changed: check request/response compatibility' },
  { re: /\.d\.ts$|(^|\/)(index|mod|lib|__init__)\.(ts|js|mjs|cjs|py)$/, why: 'module entry point changed: check removed or renamed exports' },
  { re: /(^|\/)manifest\.json$|(^|\/)wxt\.config\.ts$/, why: 'app/extension manifest changed: check permissions and minimum platform versions' },
];

function diffHints(repo, from, to, paths) {
  if (!from) return { files: [], hints: [] };
  const out = git(repo, ['diff', '--name-status', '-M', `${from}..${to}`, '--', ...paths], { allowFail: true }) || '';
  const files = out.split('\n').filter(Boolean).map((l) => { const [st, ...p] = l.split('\t'); return { status: st[0], path: p[p.length - 1], from: p.length > 1 ? p[0] : undefined }; });
  const hints = [];
  for (const f of files) {
    if (f.status === 'D' || f.status === 'R') {
      if (!/(^|\/)(tests?|__tests__|docs?|\.github)\/|\.(md|txt)$|\.test\.|\.spec\./.test(f.from || f.path)) {
        hints.push({ path: f.from || f.path, why: f.status === 'D' ? 'file deleted: was it part of a public API, CLI, config or documented behaviour?' : `renamed to ${f.path}: check imports/paths consumers rely on` });
      }
    }
    for (const h of HINTS) if (h.re.test(f.path)) hints.push({ path: f.path, why: h.why });
  }
  return { files, hints };
}

export function analyze(o) {
  const repo = o.repo || process.cwd();
  if (!git(repo, ['rev-parse', '--git-dir'], { allowFail: true })) throw new Error(`${repo} is not a git repository`);
  const kit = loadKitConfig(repo);
  const types = allowedTypes(repo, o, kit);
  const tagFormat = o.tagFormat || kit.tagFormat || 'v${version}';
  const to = o.to || 'HEAD';
  const paths = o.paths.length ? o.paths : (kit.paths || []);
  const { mergedTags, foreign, unmerged } = findTags(repo, to, tagFormat);
  const stableTags = mergedTags.filter((t) => !t.v.pre.length);
  const last = stableTags[stableTags.length - 1] || null;
  const from = o.from || (last ? last.tag : null);
  const range = from ? `${from}..${to}` : to;
  const sep = '\x1f', rs = '\x1e';
  const log = git(repo, ['log', '--no-merges', `--format=%H${sep}%an${sep}%B${rs}`, range, '--', ...paths]) || '';
  const commits = log.split(rs).map((s) => s.replace(/^\n/, '')).filter((s) => s.trim()).map((rec) => {
    const [sha, author, message] = rec.split(sep);
    return { sha: sha.slice(0, 10), author, ...classify(message.trim(), types) };
  }).filter((c) => !/^chore\(release\)/.test(c.header));

  let impact = 'none';
  for (const c of commits) if (c.valid && RANK[c.impact] > RANK[impact]) impact = c.impact;
  const invalid = commits.filter((c) => !c.valid);
  if (invalid.some((c) => c.breaking)) impact = 'major';

  const current = last ? last.v : null;
  const initialDevelopment = o.initialDevelopment ?? kit.initialDevelopment ?? (current ? current.major === 0 : false);
  let next = null, effective = impact;
  if (impact !== 'none') {
    if (current) ({ v: next, effective } = bump(current, impact, initialDevelopment));
    else next = parseSemver(initialDevelopment ? '0.1.0' : '1.0.0');
    if (o.prerelease && next) {
      const base = fmt(next);
      const existing = mergedTags.concat(unmerged).filter((t) => fmt({ ...t.v, pre: [] }) === base && t.v.pre[0] === o.prerelease);
      const n = existing.length ? Math.max(...existing.map((t) => +t.v.pre[1] || 0)) + 1 : 1;
      next = { ...next, pre: [o.prerelease, String(n)] };
    }
  }

  const { files, hints } = diffHints(repo, from, to, paths);
  const warnings = [];
  if (!last) warnings.push(`no release tag matching "${tagFormat}" is reachable from ${to}; the first release would be ${next ? fmt(next) : '(none)'}. Do not invent a baseline: verify history and get the user's decision before tagging.`);
  if (foreign.length) warnings.push(`tags that look like versions but do not match "${tagFormat}": ${foreign.slice(0, 8).join(', ')}${foreign.length > 8 ? ', ...' : ''}`);
  const newerUnmerged = unmerged.filter((t) => !last || cmpSemver(t.v, last.v) > 0);
  if (newerUnmerged.length) warnings.push(`newer release tags exist that are not reachable from ${to}: ${newerUnmerged.map((t) => t.tag).join(', ')} (release branch diverged?)`);
  if (invalid.length) warnings.push(`${invalid.length} commit(s) are not valid Conventional Commits; their impact is unknown and CI would ignore them`);
  if (initialDevelopment && current && current.major === 0 && impact === 'major') warnings.push('breaking change while in 0.x initial development: bumped MINOR. Set initialDevelopment=false when the project should go to 1.0.0.');

  return {
    repo, tagFormat, range, paths,
    lastRelease: last ? { tag: last.tag, version: fmt(last.v) } : null,
    commitImpact: impact,
    releaseType: next ? (current ? effective.toUpperCase() : 'INITIAL') : 'NONE',
    nextVersion: next ? fmt(next) : null,
    nextTag: next ? tagFormat.replace('${version}', fmt(next)) : null,
    initialDevelopment,
    commits, invalid: invalid.map((c) => ({ sha: c.sha, header: c.header, reason: c.reason })),
    changedFiles: files.length, reviewHints: hints, warnings,
  };
}

function printHuman(r) {
  const L = [];
  L.push(`Range:          ${r.range}${r.paths.length ? `  (paths: ${r.paths.join(', ')})` : ''}`);
  L.push(`Last release:   ${r.lastRelease ? `${r.lastRelease.tag} (${r.lastRelease.version})` : 'none'}`);
  L.push(`Commit impact:  ${r.commitImpact.toUpperCase()}`);
  L.push(`Release type:   ${r.releaseType}${r.nextVersion ? `  ->  ${r.nextVersion} (tag ${r.nextTag})` : ''}`);
  L.push('', `Commits (${r.commits.length}):`);
  for (const c of r.commits) L.push(`  ${c.valid ? ' ' : '!'} ${c.sha} ${c.impact.padEnd(7)} ${c.breaking ? '[BREAKING] ' : ''}${c.header}${c.valid ? '' : `\n      -> ${c.reason}`}`);
  if (r.reviewHints.length) {
    L.push('', `Review hints from ${r.changedFiles} changed file(s) (verify against the commit types):`);
    for (const h of r.reviewHints.slice(0, 40)) L.push(`  - ${h.path}: ${h.why}`);
    if (r.reviewHints.length > 40) L.push(`  ... ${r.reviewHints.length - 40} more`);
  }
  if (r.warnings.length) { L.push('', 'Warnings:'); for (const w of r.warnings) L.push(`  - ${w}`); }
  console.log(L.join('\n'));
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`semver-analyze: ${e.message}`); process.exit(2); }
  if (o.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); return; }
  try {
    if (o.lintMessage !== undefined) {
      const repo = o.repo || process.cwd();
      const r = lintMessage(o.lintMessage, allowedTypes(existsSync(repo) ? repo : null, o, existsSync(repo) ? loadKitConfig(repo) : {}));
      if (o.json) console.log(JSON.stringify(r)); else if (!r.valid) console.error(r.reason);
      process.exit(r.valid ? 0 : 1);
    }
    if (o.lintRange !== undefined) {
      const repo = o.repo || process.cwd();
      const types = allowedTypes(repo, o, loadKitConfig(repo));
      const log = git(repo, ['log', '--no-merges', '--format=%H%x1f%B%x1e', o.lintRange]) || '';
      const bad = log.split('\x1e').map((s) => s.replace(/^\n/, '')).filter((s) => s.trim()).map((rec) => {
        const [sha, msg] = rec.split('\x1f');
        return { sha: sha.slice(0, 10), header: msg.trim().split('\n')[0], ...lintMessage(msg.trim(), types) };
      }).filter((c) => !c.valid);
      if (o.json) console.log(JSON.stringify({ invalid: bad }));
      else for (const b of bad) console.error(`${b.sha} ${b.header}\n  -> ${b.reason}`);
      process.exit(bad.length ? 1 : 0);
    }
    const r = analyze(o);
    if (o.json) console.log(JSON.stringify(r, null, 2)); else printHuman(r);
    process.exit(r.invalid.length ? 1 : 0);
  } catch (e) {
    console.error(`semver-analyze: ${e.message}`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('semver-analyze.mjs')) main();
