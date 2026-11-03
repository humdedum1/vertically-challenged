import { expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';

it('upgrades v9 with archiving off and keeps existing suspend settings', () => {
  const s = migrateSettings({
    version: 9,
    suspend: { auto: true, minutes: 45, whitelist: ['a.com'] },
  });
  expect(s.version).toBe(10);
  expect(s.suspend).toMatchObject({
    auto: true,
    minutes: 45,
    whitelist: ['a.com'],
    archiveDays: 0,
  });
  expect(s.shortcuts.commandPalette).toEqual(['Ctrl+K']);
});

it('only accepts the offered archive ages', () => {
  expect(migrateSettings({ suspend: { archiveDays: 14 } }).suspend.archiveDays).toBe(14);
  for (const v of [1, -7, 1e9, '7', null]) {
    expect(migrateSettings({ suspend: { archiveDays: v } }).suspend.archiveDays).toBe(0);
  }
});
