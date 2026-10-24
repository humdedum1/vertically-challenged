import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../src/settings/schema';

describe('v4 -> v5 migration', () => {
  it('adds sync, on by default, and keeps everything else', () => {
    const r = migrateSettings({
      version: 4,
      appearance: { mode: 'dark' },
      sessions: { restoreDiscarded: false },
    });
    expect(r.version).toBe(SETTINGS_VERSION);
    expect(r.sync).toEqual({ workspaces: true, sessions: true, intervalMinutes: 1 });
    expect(r.appearance.mode).toBe('dark');
    expect(r.sessions.restoreDiscarded).toBe(false);
  });

  it('keeps switches that were turned off and repairs bad values', () => {
    expect(
      migrateSettings({ version: 5, sync: { workspaces: false, sessions: 'yes' } }).sync,
    ).toEqual({
      workspaces: false,
      sessions: true,
      intervalMinutes: 1,
    });
    expect(migrateSettings({ version: 5, sync: 7 }).sync).toEqual(DEFAULT_SETTINGS.sync);
  });

  it('is idempotent', () => {
    const once = migrateSettings({ version: 4 });
    expect(migrateSettings(once)).toEqual(once);
    expect(migrateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
