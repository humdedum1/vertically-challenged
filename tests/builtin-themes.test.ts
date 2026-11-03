import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, findTheme } from '../src/themes/builtin';
import { contrastIssues, legibleTheme } from '../src/themes/contrast';
import { NOCTALIA_THEMES } from '../src/themes/noctalia';
import { TERMINAL_THEMES } from '../src/themes/terminal';

describe('built-in themes', () => {
  it('all parse with unique ids', () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('abyss meets WCAG AA for every text pair', () => {
    expect(contrastIssues(findTheme('abyss'))).toEqual([]);
  });

  it('derives terminal palettes that meet WCAG AA', () => {
    for (const t of TERMINAL_THEMES) expect(contrastIssues(findTheme(t.id)), t.id).toEqual([]);
  });

  // What the panel shows: built-in text roles are corrected to AA while the look is untouched.
  it('every built-in theme is legible once corrected, without moving its backgrounds', () => {
    for (const { id } of [...NOCTALIA_THEMES, ...TERMINAL_THEMES]) {
      const t = findTheme(id);
      const fixed = legibleTheme(t);
      expect(contrastIssues(fixed), id).toEqual([]);
      for (const mode of ['dark', 'light'] as const) {
        expect(fixed[mode].mSurface, id).toBe(t[mode].mSurface);
        expect(fixed[mode].mPrimary, id).toBe(t[mode].mPrimary);
      }
    }
  });

  // Third-party palettes are shipped verbatim; this documents their contrast so a
  // regression in the data (or the checker) shows up as a snapshot diff.
  it('records contrast issues of the bundled Noctalia palettes', () => {
    const report = Object.fromEntries(
      NOCTALIA_THEMES.map(({ id }) => findTheme(id)).map((t) => [
        t.id,
        contrastIssues(t).map((i) => `${i.mode} ${i.fg}/${i.bg} ${i.ratio.toFixed(2)}`),
      ]),
    );
    expect(report).toMatchSnapshot();
  });
});
