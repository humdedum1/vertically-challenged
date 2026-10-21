import { describe, expect, it } from 'vitest';
import { visibleTo } from '../src/background/visibility';
import { migrateSettings } from '../src/settings/migrate';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../src/settings/schema';

const D = DEFAULT_SETTINGS;

describe('v3 -> v4 migration', () => {
  const v3 = {
    version: 3,
    appearance: { ...D.appearance, mode: 'dark' },
    tabs: { ...D.tabs, layout: 'double', showClose: false, allWindows: true },
    suspend: { ...D.suspend, auto: true },
  };

  it('drops tabs.allWindows and keeps everything else', () => {
    const r = migrateSettings(v3);
    expect(r.version).toBe(SETTINGS_VERSION);
    expect('allWindows' in r.tabs).toBe(false);
    expect(r.tabs).toEqual({ ...D.tabs, layout: 'double', showClose: false });
    expect(r.appearance.mode).toBe('dark');
    expect(r.suspend.auto).toBe(true);
  });

  it('copes with a missing or malformed tabs group', () => {
    expect(migrateSettings({ version: 3 }).tabs).toEqual(D.tabs);
    expect(migrateSettings({ version: 3, tabs: 5 }).tabs).toEqual(D.tabs);
  });

  it('is idempotent, and the default has no allWindows', () => {
    const once = migrateSettings(v3);
    expect(migrateSettings(once)).toEqual(once);
    expect(migrateSettings(D)).toEqual(D);
    expect('allWindows' in D.tabs).toBe(false);
  });

  it('reads newer versions best-effort without the key', () => {
    const r = migrateSettings({ version: 99, tabs: { layout: 'double', allWindows: true } });
    expect(r.tabs.layout).toBe('double');
    expect('allWindows' in r.tabs).toBe(false);
  });
});

describe('visibleTo', () => {
  it('hides incognito windows from normal panels and vice versa', () => {
    expect(visibleTo(false, { incognito: false })).toBe(true);
    expect(visibleTo(false, { incognito: true })).toBe(false);
    expect(visibleTo(true, { incognito: true })).toBe(true);
    expect(visibleTo(true, { incognito: false })).toBe(false);
  });
});
