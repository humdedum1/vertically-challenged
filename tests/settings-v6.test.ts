import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../src/settings/schema';

describe('v5 -> v6 migration', () => {
  it('adds display, side panel by default, and keeps everything else', () => {
    const r = migrateSettings({
      version: 5,
      appearance: { mode: 'dark' },
      sync: { workspaces: false, sessions: true },
    });
    expect(r.version).toBe(SETTINGS_VERSION);
    expect(r.display).toEqual({ mode: 'sidebar' });
    expect(r.appearance.mode).toBe('dark');
    expect(r.sync.workspaces).toBe(false);
  });

  it('keeps the popup mode and repairs bad values', () => {
    expect(migrateSettings({ version: 6, display: { mode: 'popup' } }).display).toEqual({
      mode: 'popup',
    });
    expect(migrateSettings({ version: 6, display: { mode: 'window' } }).display).toEqual(
      DEFAULT_SETTINGS.display,
    );
    expect(migrateSettings({ version: 6, display: 'popup' }).display).toEqual(
      DEFAULT_SETTINGS.display,
    );
  });

  it('is idempotent', () => {
    const once = migrateSettings({ version: 5 });
    expect(migrateSettings(once)).toEqual(once);
    expect(migrateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
