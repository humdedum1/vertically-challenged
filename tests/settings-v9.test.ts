import { expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';

it('preserves browser defaults when upgrading existing settings', () => {
  const settings = migrateSettings({ version: 8, tabs: { childTabs: false } });
  expect(settings.tabs.newTabUrl).toBe('');
  expect(settings.tabs.childTabs).toBe(false);
});

it('validates new-tab URLs from synced settings and backups', () => {
  for (const url of [
    'https://example.com/start',
    'http://localhost:3000/',
    'chrome://bookmarks/',
    'about:blank',
  ]) {
    expect(migrateSettings({ tabs: { newTabUrl: ` ${url} ` } }).tabs.newTabUrl).toBe(url);
  }
  for (const url of [
    'example.com',
    'not a url',
    'javascript:alert(1)',
    'data:text/html,hi',
    'chrome://quit/',
    'chrome://crash/',
    123,
    null,
  ]) {
    expect(migrateSettings({ tabs: { newTabUrl: url } }).tabs.newTabUrl).toBe('');
  }
});
