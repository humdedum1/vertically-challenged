import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const key = resolve(process.env.CRX_KEY_PATH || '.output/chrome-mv3.pem');
assert(existsSync(key), 'Existing signing key required: set CRX_KEY_PATH');
createPrivateKey(readFileSync(key));

const extension = resolve('.output/chrome-mv3');
const { version } = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(version, pkg.version, 'Build version must match package.json');

const name = `vertically-challenged-${version}`;
const output = resolve(`.output/${name}-crx.zip`);
const temp = mkdtempSync(resolve('.output/crx-'));
try {
  const input = join(temp, name);
  cpSync(extension, input, { recursive: true });
  execFileSync(
    process.env.CHROME_BIN || 'google-chrome',
    [
      '--headless',
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '--no-message-box',
      `--pack-extension=${input}`,
      `--pack-extension-key=${key}`,
    ],
    { stdio: 'inherit', timeout: 60_000 },
  );
  const crx = readFileSync(`${input}.crx`);
  assert.equal(crx.toString('ascii', 0, 4), 'Cr24', 'Invalid CRX header');
  assert.equal(crx.readUInt32LE(4), 3, 'Expected CRX3');
  execFileSync('zip', ['-j', join(temp, 'package.zip'), `${input}.crx`], { stdio: 'inherit' });
  execFileSync('unzip', ['-t', join(temp, 'package.zip')], { stdio: 'inherit' });
  renameSync(join(temp, 'package.zip'), output);
  console.log(output);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
