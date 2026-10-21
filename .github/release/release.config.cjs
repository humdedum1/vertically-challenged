// semantic-release configuration (release kit, semantic-versioning skill).
// Do not edit per project: project settings live in ./config.json next to this file.
// Run with: semantic-release --extends ./.github/release/release.config.cjs
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const cfg = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const tagFormat = cfg.tagFormat || 'v${version}';
const versionFiles = cfg.versionFiles || [];
const changelog = cfg.changelog && cfg.changelog.enabled ? cfg.changelog : null;
const commitFiles = cfg.commitVersionFiles !== false && (versionFiles.length > 0 || changelog);
// Local integration tests run without GitHub; never set this in CI.
const localTest = process.env.RELEASE_KIT_LOCAL_TEST === '1';

// 0.x initial development: a breaking change bumps MINOR, not MAJOR, until the project
// explicitly sets "initialDevelopment": false. Only applies while the latest release is 0.x.
function latestMajor() {
  const [prefix, suffix] = tagFormat.split('${version}');
  let tags = [];
  try { tags = execFileSync('git', ['tag', '--merged', 'HEAD'], { encoding: 'utf8' }).split('\n'); } catch { return null; }
  const majors = tags
    .filter((t) => t.startsWith(prefix) && t.endsWith(suffix))
    .map((t) => /^(\d+)\.\d+\.\d+$/.exec(t.slice(prefix.length, t.length - suffix.length)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return majors.length ? Math.max(...majors) : null;
}
const zeroMajor = cfg.initialDevelopment === true && latestMajor() === 0;

const noteKeywords = ['BREAKING CHANGE', 'BREAKING-CHANGE', 'BREAKING CHANGES'];

const plugins = [
  ['@semantic-release/commit-analyzer', {
    preset: 'conventionalcommits',
    parserOpts: { noteKeywords },
    // Matches semver-analyze.mjs: breaking -> major, feat -> minor, fix/perf/revert -> patch.
    releaseRules: [
      { breaking: true, release: zeroMajor ? 'minor' : 'major' },
      { revert: true, release: 'patch' },
      { type: 'feat', release: 'minor' },
      { type: 'fix', release: 'patch' },
      { type: 'perf', release: 'patch' },
      { type: 'revert', release: 'patch' },
    ],
  }],
  ['@semantic-release/release-notes-generator', {
    preset: 'conventionalcommits',
    parserOpts: { noteKeywords },
    presetConfig: {
      types: [
        { type: 'feat', section: 'Features' },
        { type: 'fix', section: 'Bug Fixes' },
        { type: 'perf', section: 'Performance' },
        { type: 'revert', section: 'Reverts' },
        { type: 'refactor', section: 'Refactoring', hidden: true },
        { type: 'docs', section: 'Documentation', hidden: true },
        { type: 'build', section: 'Build', hidden: true },
        { type: 'ci', hidden: true }, { type: 'test', hidden: true },
        { type: 'style', hidden: true }, { type: 'chore', hidden: true },
      ],
    },
  }],
];

if (changelog) plugins.push(['@semantic-release/changelog', { changelogFile: changelog.file || 'CHANGELOG.md', changelogTitle: changelog.title }]);

plugins.push(['@semantic-release/exec', {
  ...(versionFiles.length ? { prepareCmd: 'node .github/release/bump-version.mjs "${nextRelease.version}"' } : {}),
  successCmd: 'node .github/release/write-output.mjs "${nextRelease.version}" "${nextRelease.gitTag}" "${nextRelease.channel || \'\'}"',
}]);

if (commitFiles) {
  plugins.push(['@semantic-release/git', {
    assets: [...versionFiles.map((f) => f.path), ...(changelog ? [changelog.file || 'CHANGELOG.md'] : [])],
    message: 'chore(release): ${nextRelease.version} [skip ci]',
  }]);
}

if (!localTest) {
  plugins.push(['@semantic-release/github', {
    // Keep the token at contents:write: no issue/PR comments, labels or failure issues.
    successComment: false,
    failComment: false,
    releasedLabels: false,
    assets: cfg.releaseAssets || [],
  }]);
}

module.exports = {
  tagFormat,
  branches: [
    ...(cfg.branches || ['main']),
    ...(cfg.prereleaseBranches || []).map((b) => (typeof b === 'string' ? { name: b, prerelease: true } : b)),
  ],
  plugins,
};
