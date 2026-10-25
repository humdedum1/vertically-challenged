import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('CRX packaging refuses a missing signing key instead of generating a new identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-pack-test-'));
  const key = join(dir, 'missing.pem');
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/pack-crx.mjs')], {
      env: { ...process.env, CRX_KEY_PATH: key },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Existing signing key required');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
