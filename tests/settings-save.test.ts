import { describe, expect, it } from 'vitest';
import { saveSettings } from '../src/settings/save';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../src/settings/schema';

function fakeArea(initial: Record<string, unknown>) {
  const data = structuredClone(initial);
  return {
    data,
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  };
}

describe('saveSettings', () => {
  it('does not overwrite settings written by a newer build', async () => {
    const newer = { ...DEFAULT_SETTINGS, version: SETTINGS_VERSION + 1, futureKey: { on: true } };
    const area = fakeArea({ settings: newer });
    const saved = await saveSettings(area, structuredClone(DEFAULT_SETTINGS));
    expect(saved).toBe(false);
    expect(area.data.settings).toEqual(newer);
  });

  it('writes over current, older or missing settings', async () => {
    for (const stored of [undefined, { version: 1 }, { ...DEFAULT_SETTINGS }]) {
      const area = fakeArea(stored === undefined ? {} : { settings: stored });
      const next = structuredClone(DEFAULT_SETTINGS);
      expect(await saveSettings(area, next)).toBe(true);
      expect(area.data.settings).toEqual(next);
    }
  });
});
