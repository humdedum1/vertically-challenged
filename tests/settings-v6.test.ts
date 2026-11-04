import { describe, expect, it } from 'vitest';
import { migrateSettings, parseRuleTarget } from '../src/settings/migrate';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../src/settings/schema';

describe('v5 -> v6 migration', () => {
  it('adds display, side panel by default, and keeps everything else', () => {
    const r = migrateSettings({
      version: 5,
      appearance: { mode: 'dark' },
      sync: { workspaces: false, sessions: true },
    });
    expect(r.version).toBe(SETTINGS_VERSION);
    expect(r.display).toEqual({ mode: 'sidebar', openOnLaunch: false, closeOnClickOutside: true });
    expect(r.appearance.mode).toBe('dark');
    expect(r.sync.workspaces).toBe(false);
  });

  it('keeps closeOnClickOutside and repairs bad values', () => {
    expect(
      migrateSettings({ version: 9, display: { closeOnClickOutside: false } }).display
        .closeOnClickOutside,
    ).toBe(false);
    expect(
      migrateSettings({ version: 9, display: { closeOnClickOutside: 'no' } }).display
        .closeOnClickOutside,
    ).toBe(true);
  });

  it('keeps the popup mode and repairs bad values', () => {
    expect(migrateSettings({ version: 6, display: { mode: 'popup' } }).display).toEqual({
      mode: 'popup',
      openOnLaunch: false,
      closeOnClickOutside: true,
    });
    expect(
      migrateSettings({ version: 9, display: { mode: 'sidebar', openOnLaunch: true } }).display
        .openOnLaunch,
    ).toBe(true);
    expect(
      migrateSettings({ version: 9, display: { openOnLaunch: 'yes' } }).display.openOnLaunch,
    ).toBe(false);
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

describe('tab rules', () => {
  it('normalizes hosts, trims group names and drops invalid or duplicate rules', () => {
    const r = migrateSettings({
      version: 9,
      rules: [
        { host: 'https://www.GitHub.com/x', group: '  Code  ' },
        { host: 'github.com', group: 'Again' },
        { host: 'not a host', group: 'Bad' },
        { host: 'docs.rs', group: '' },
        { host: 'docs.rs', group: 'x'.repeat(100) },
        'junk',
      ],
    });
    expect(r.rules).toEqual([
      { host: 'github.com', path: '', action: 'group', group: 'Code' },
      { host: 'docs.rs', path: '', action: 'group', group: 'x'.repeat(40) },
    ]);
  });

  it('keeps path rules and non-group actions, and rejects bad paths', () => {
    const r = migrateSettings({
      version: 9,
      rules: [
        { host: 'github.com', path: '/myorg/x?y=1', action: 'pin' },
        { host: 'github.com', path: '/myorg/x', action: 'mute' },
        { host: 'github.com', group: 'All' },
        { host: 'a.com', path: 'no-slash', action: 'pin' },
        { host: 'b.com', path: '/', action: 'mute', group: 'ignored' },
        { host: 'c.com', action: 'explode' },
      ],
    });
    expect(r.rules).toEqual([
      { host: 'github.com', path: '/myorg/x', action: 'pin', group: '' },
      { host: 'github.com', path: '', action: 'group', group: 'All' },
      { host: 'b.com', path: '', action: 'mute', group: '' },
    ]);
  });
});

describe('parseRuleTarget', () => {
  it('splits a site and an optional path, from text or a pasted URL', () => {
    expect(parseRuleTarget('github.com')).toEqual({ host: 'github.com', path: '' });
    expect(parseRuleTarget('github.com/myorg')).toEqual({ host: 'github.com', path: '/myorg' });
    expect(parseRuleTarget('https://www.github.com/myorg/x?q=1#h')).toEqual({
      host: 'github.com',
      path: '/myorg/x',
    });
    expect(parseRuleTarget('*.google.com/')).toEqual({ host: '*.google.com', path: '' });
    expect(parseRuleTarget('not a site')).toBeNull();
  });
});
