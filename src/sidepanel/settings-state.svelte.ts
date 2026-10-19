import { browser } from 'wxt/browser';
import { migrateSettings } from '../settings/migrate';
import type { Settings } from '../settings/schema';

const KEY = 'settings';
// storage.sync allows ~120 writes/minute; sliders and colour pickers in the settings UI
// would blow through that without coalescing.
const WRITE_DELAY_MS = 400;

/**
 * Panel-side settings. Every open panel (one per window) listens to storage changes, so a
 * change made in one window applies live in all of them.
 */
export class SettingsState {
  value = $state.raw<Settings>(migrateSettings(null));
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(initial: Settings) {
    this.value = initial;
  }

  async start(): Promise<void> {
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[KEY];
      // Ignore echoes of our own pending write so a fast sequence of edits doesn't
      // bounce back to an intermediate value.
      if (area !== 'sync' || !change || this.timer !== null) return;
      this.value = migrateSettings(change.newValue);
    });
    try {
      const stored = await browser.storage.sync.get(KEY);
      if (this.timer === null) this.value = migrateSettings(stored[KEY]);
    } catch (err) {
      console.warn('[vc] settings load failed; using defaults', err);
    }
  }

  update(fn: (s: Settings) => Settings): void {
    this.value = migrateSettings(fn(this.value));
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      browser.storage.sync
        .set({ [KEY]: this.value })
        .catch((err: unknown) => console.warn('[vc] settings save failed', err))
        .finally(() => {
          this.timer = null;
        });
    }, WRITE_DELAY_MS);
  }
}
