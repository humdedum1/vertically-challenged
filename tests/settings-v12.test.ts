import { expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { SETTINGS_VERSION } from '../src/settings/schema';
import { createBackup, parseBackup } from '../src/themes/transfer';

it('moves v11 users of the removed Ember theme to Velo and keeps the rest of appearance', () => {
  const s = migrateSettings({
    version: 11,
    appearance: { themeId: 'ember', skin: 'glass', density: 'compact', accent: '#ff0000' },
  });
  expect(s.version).toBe(SETTINGS_VERSION);
  expect(s.appearance).toMatchObject({
    themeId: 'velo',
    skin: 'glass',
    density: 'compact',
    accent: '#ff0000',
  });
});

it('leaves every other theme id alone', () => {
  for (const id of ['noctalia', 'abyss', 'custom-ember-copy']) {
    expect(migrateSettings({ version: 11, appearance: { themeId: id } }).appearance.themeId).toBe(
      id,
    );
  }
});

it('restores a v11 backup that used Ember with Velo', () => {
  const old = JSON.parse(createBackup(migrateSettings(null), [], new Date(0)));
  old.settings = { version: 11, appearance: { themeId: 'ember' } };
  const r = parseBackup(JSON.stringify(old), () => false);
  if (!r.ok) throw new Error(r.error);
  expect(r.value.settings.appearance.themeId).toBe('velo');
});
