import { expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../src/settings/schema';

it('enables child tabs for new installs and upgrades without resetting preferences', () => {
  expect(SETTINGS_VERSION).toBe(7);
  expect(DEFAULT_SETTINGS.tabs.childTabs).toBe(true);
  const settings = migrateSettings({
    version: 6,
    tabs: { showClose: false },
    display: { mode: 'popup' },
  });
  expect(settings.tabs.childTabs).toBe(true);
  expect(settings.tabs.showClose).toBe(false);
  expect(settings.display.mode).toBe('popup');
});

it('preserves opting out and repairs invalid child-tab settings', () => {
  expect(migrateSettings({ version: 7, tabs: { childTabs: false } }).tabs.childTabs).toBe(false);
  expect(migrateSettings({ version: 7, tabs: { childTabs: 'false' } }).tabs.childTabs).toBe(true);
  expect(migrateSettings(migrateSettings({ version: 6 }))).toEqual(migrateSettings({ version: 6 }));
});
