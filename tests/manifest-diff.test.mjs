import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'manifest-diff-'));
  roots.push(root);
  const base = join(root, 'base');
  const head = join(root, 'head');
  const output = join(root, 'output');
  const body = join(root, 'body');
  const manifest = (dir, build, permissions = []) => {
    mkdirSync(join(dir, build), { recursive: true });
    writeFileSync(join(dir, build, 'manifest.json'), JSON.stringify({ permissions }));
  };
  const run = () =>
    spawnSync(process.execPath, [resolve('.github/scripts/manifest-diff.mjs'), base, head], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, BODY_FILE: body },
    });
  return { base, head, output, body, manifest, run };
}

it.each(['chrome-mv3', 'firefox-mv3'])('fails when the head %s manifest is missing', (missing) => {
  const f = fixture();
  for (const build of ['chrome-mv3', 'firefox-mv3']) {
    f.manifest(f.base, build);
    if (build !== missing) f.manifest(f.head, build);
  }
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(join(f.head, missing, 'manifest.json'));
  expect(result.stdout).toBe('');
});

it('treats missing base manifests as empty and reports added permissions', () => {
  const f = fixture();
  for (const build of ['chrome-mv3', 'firefox-mv3']) f.manifest(f.head, build, ['tabs']);
  const result = f.run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('+"tabs"');
  expect(readFileSync(f.output, 'utf8')).toBe('changed=true\n');
  expect(readFileSync(f.body, 'utf8')).toContain('Permissions changed');
});

it('reports no changes for matching manifests', () => {
  const f = fixture();
  for (const dir of [f.base, f.head]) {
    for (const build of ['chrome-mv3', 'firefox-mv3']) f.manifest(dir, build, ['tabs']);
  }
  expect(f.run().status).toBe(0);
  expect(readFileSync(f.output, 'utf8')).toBe('changed=false\n');
  expect(readFileSync(f.body, 'utf8')).toBe('No permission changes in the built manifests.');
});
