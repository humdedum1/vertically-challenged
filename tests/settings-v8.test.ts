import { expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';

it('adds automatic sync timing without resetting existing preferences', () => {
  const s = migrateSettings({ version: 7, sync: { workspaces: false, sessions: true } });
  expect(s.sync).toEqual({ workspaces: false, sessions: true, intervalMinutes: 1 });
  for (const intervalMinutes of [0, 1, 5, 15, 30, 60]) {
    expect(migrateSettings({ sync: { intervalMinutes } }).sync.intervalMinutes).toBe(
      intervalMinutes,
    );
  }
  for (const intervalMinutes of [-1, 0.5, 2, Infinity, '5', null]) {
    expect(migrateSettings({ sync: { intervalMinutes } }).sync.intervalMinutes).toBe(1);
  }
});
