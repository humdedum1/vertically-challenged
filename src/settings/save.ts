import { SETTINGS_VERSION, type Settings } from './schema';

const KEY = 'settings';

interface Area {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * Writes settings unless storage holds a newer version from a later build on another synced
 * machine: this build would drop the fields it doesn't know, so it leaves them alone.
 * Returns whether it wrote.
 */
export async function saveSettings(area: Area, next: Settings): Promise<boolean> {
  const stored = (await area.get(KEY))[KEY] as { version?: unknown } | undefined;
  if (typeof stored?.version === 'number' && stored.version > SETTINGS_VERSION) return false;
  await area.set({ [KEY]: next });
  return true;
}
