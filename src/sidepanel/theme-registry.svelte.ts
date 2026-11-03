import { browser } from 'wxt/browser';
import { BUILTIN_THEMES } from '../themes/builtin';
import {
  CUSTOM_ID_PREFIX,
  isCustomId,
  parseCustomThemes,
  THEME_PREFIX,
} from '../themes/custom-themes';
import type { Theme } from '../themes/palette';

/** storage.sync caps total size at ~100 KB; a theme is ~1.2 KB, settings a few hundred bytes. */
export const MAX_CUSTOM_THEMES = 40;

export { CUSTOM_ID_PREFIX, isCustomId };
export const newCustomId = (): string =>
  `${CUSTOM_ID_PREFIX}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

/**
 * Built-in plus user themes. Each custom theme is its own storage.sync key (the per-item
 * quota is 8 KB, so one key holding all themes would cap out at a handful). Stored values
 * are re-validated on load: sync data can come from any other machine or build.
 */
export class ThemeRegistry {
  custom = $state.raw<Theme[]>([]);
  loaded = $state(false);
  readonly all = $derived<readonly Theme[]>([...BUILTIN_THEMES, ...this.custom]);

  resolve(id: string): Theme {
    return this.all.find((t) => t.id === id) ?? (BUILTIN_THEMES[0] as Theme);
  }

  /**
   * Like resolve, but null while a custom theme can't be known yet, so callers keep the
   * cached colours instead of flashing the fallback theme during startup.
   */
  resolveReady(id: string): Theme | null {
    return !this.loaded && isCustomId(id) ? null : this.resolve(id);
  }

  async start(): Promise<void> {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(THEME_PREFIX)))
        void this.load();
    });
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const all = await browser.storage.sync.get(null);
      const out = parseCustomThemes(all);
      this.custom = out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.warn('[vc] custom themes failed to load', err);
    } finally {
      this.loaded = true;
    }
  }

  /** Throws with a user-facing message when the limit or quota is hit. */
  async save(theme: Theme): Promise<void> {
    if (!isCustomId(theme.id))
      throw new Error('Built-in themes can’t be changed; duplicate it first');
    if (!this.custom.some((t) => t.id === theme.id) && this.custom.length >= MAX_CUSTOM_THEMES) {
      throw new Error(`You can keep up to ${MAX_CUSTOM_THEMES} custom themes`);
    }
    const { id, name, dark, light } = theme;
    try {
      await browser.storage.sync.set({ [THEME_PREFIX + id]: { name, dark, light } });
    } catch (err) {
      throw new Error(
        `Couldn’t save the theme (${err instanceof Error ? err.message : 'storage error'})`,
      );
    }
    await this.load();
  }

  async remove(id: string): Promise<void> {
    if (!isCustomId(id)) return;
    await browser.storage.sync.remove(THEME_PREFIX + id);
    await this.load();
  }
}
