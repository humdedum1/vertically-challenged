import { expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { SETTINGS_VERSION } from '../src/settings/schema';
import { createBackup, parseBackup } from '../src/themes/transfer';

it('upgrades v10 with the classic skin and keeps the rest of appearance', () => {
  const s = migrateSettings({ version: 10, appearance: { density: 'compact', radius: 8 } });
  expect(s.version).toBe(SETTINGS_VERSION);
  expect(s.appearance).toMatchObject({ skin: 'classic', density: 'compact', radius: 8 });
});

it('keeps a valid skin and sanitizes invalid ones to classic', () => {
  expect(migrateSettings({ appearance: { skin: 'glass' } }).appearance.skin).toBe('glass');
  for (const v of ['neon', 1, null, {}]) {
    expect(migrateSettings({ appearance: { skin: v } }).appearance.skin).toBe('classic');
  }
});

it('restores an old backup with the classic skin', () => {
  const old = JSON.parse(createBackup(migrateSettings(null), [], new Date(0)));
  old.settings = { version: 10, appearance: { density: 'compact' } };
  const r = parseBackup(JSON.stringify(old), () => false);
  if (!r.ok) throw new Error(r.error);
  expect(r.value.settings.appearance).toMatchObject({ skin: 'classic', density: 'compact' });
});
