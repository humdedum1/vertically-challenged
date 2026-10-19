import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, findTheme } from '../src/themes/builtin';
import { contrastIssues } from '../src/themes/contrast';

describe('built-in themes', () => {
  it('all parse with unique ids', () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('abyss meets WCAG AA for every text pair', () => {
    expect(contrastIssues(findTheme('abyss'))).toEqual([]);
  });

  // Third-party palettes are shipped verbatim; this documents their contrast so a
  // regression in the data (or the checker) shows up as a snapshot diff.
  it('records contrast issues of the bundled Noctalia palettes', () => {
    const report = Object.fromEntries(
      BUILTIN_THEMES.filter((t) => t.id !== 'abyss').map((t) => [
        t.id,
        contrastIssues(t).map((i) => `${i.mode} ${i.fg}/${i.bg} ${i.ratio.toFixed(2)}`),
      ]),
    );
    expect(report).toMatchSnapshot();
  });
});
