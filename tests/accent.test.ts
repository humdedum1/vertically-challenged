import { describe, expect, it } from 'vitest';
import { withAccent } from '../src/themes/accent';
import { BUILTIN_THEMES } from '../src/themes/builtin';
import { ROLES, type Theme } from '../src/themes/palette';

const base = BUILTIN_THEMES[0] as Theme;

describe('withAccent', () => {
  it('null returns the same object', () => {
    expect(withAccent(base, null)).toBe(base);
  });

  it('replaces mPrimary in both modes', () => {
    const t = withAccent(base, '#336699');
    expect(t.dark.mPrimary).toBe('#336699');
    expect(t.light.mPrimary).toBe('#336699');
  });

  it('picks black on a light accent and white on a dark one', () => {
    const light = withAccent(base, '#ffeb3b');
    expect(light.dark.mOnPrimary).toBe('#000000');
    expect(light.light.mOnPrimary).toBe('#000000');
    const dark = withAccent(base, '#1a237e');
    expect(dark.dark.mOnPrimary).toBe('#ffffff');
    expect(dark.light.mOnPrimary).toBe('#ffffff');
  });

  it('leaves every other role, id and name untouched', () => {
    const t = withAccent(base, '#336699');
    expect(t.id).toBe(base.id);
    expect(t.name).toBe(base.name);
    for (const mode of ['dark', 'light'] as const) {
      for (const r of ROLES) {
        if (r === 'mPrimary' || r === 'mOnPrimary') continue;
        expect(t[mode][r]).toBe(base[mode][r]);
      }
    }
  });

  it('does not mutate the input theme', () => {
    const before = structuredClone(base);
    const t = withAccent(base, '#336699');
    expect(base).toEqual(before);
    expect(t).not.toBe(base);
    expect(t.dark).not.toBe(base.dark);
    expect(t.light).not.toBe(base.light);
  });
});
