import { describe, expect, it } from 'vitest';
import { buildUndo } from '../src/backup/undo';
import { DEFAULT_SETTINGS } from '../src/settings/schema';
import type { Theme } from '../src/themes/palette';

const theme = (id: string, name: string) => ({ id, name }) as unknown as Theme;

describe('buildUndo', () => {
  it('keeps overwritten themes and lists the ones the restore added', () => {
    const before = {
      settings: DEFAULT_SETTINGS,
      customCss: 'a{}',
      themes: [theme('custom-aaaaaa', 'Mine'), theme('custom-bbbbbb', 'Other')],
    };
    const u = buildUndo(
      before,
      [theme('custom-aaaaaa', 'From file'), theme('custom-cccccc', 'New')],
      7,
    );
    expect(u.themes.map((t) => t.name)).toEqual(['Mine']);
    expect(u.addedThemeIds).toEqual(['custom-cccccc']);
    expect(u.customCss).toBe('a{}');
    expect(u.at).toBe(7);
  });
});
