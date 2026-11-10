import type { Palette, Role, Theme } from './palette';

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text-on-background pairs the UI actually renders; each must reach WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [Role, Role])[] = [
  ['mOnPrimary', 'mPrimary'],
  ['mOnSecondary', 'mSecondary'],
  ['mOnTertiary', 'mTertiary'],
  ['mOnError', 'mError'],
  ['mOnSurface', 'mSurface'],
  ['mOnSurfaceVariant', 'mSurfaceVariant'],
  ['mOnHover', 'mHover'],
  ['mOnSurface', 'mSurfaceVariant'],
  ['mOnSurfaceVariant', 'mSurface'],
];

export interface ContrastIssue {
  mode: 'dark' | 'light';
  fg: Role;
  bg: Role;
  ratio: number;
}

/** Imported themes aren't rejected for low contrast, but the editor (M4) surfaces these. */
export function contrastIssues(theme: Theme, min = 4.5): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const mode of ['dark', 'light'] as const) {
    const p: Palette = theme[mode];
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(p[fg], p[bg]);
      if (ratio < min) issues.push({ mode, fg, bg, ratio });
    }
  }
  return issues;
}

const toRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
const toHex = (c: readonly number[]): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const mixHex = (a: string, b: string, wa: number): string =>
  toHex(toRgb(a).map((v, i) => v * wa + (toRgb(b)[i] ?? 0) * (1 - wa)));

/**
 * Nudges `fg` toward black or white (whichever the background is further from) in small steps
 * until it reaches `min` against `bg`, keeping its hue as long as it can.
 */
export function legibleOn(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const [r, g, b] = toRgb(fg);
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    const next = toHex([
      r + ((target[0] ?? 0) - r) * t,
      g + ((target[1] ?? 0) - g) * t,
      b + ((target[2] ?? 0) - b) * t,
    ]);
    if (contrastRatio(next, bg) >= min) return next;
  }
  return toHex(target);
}

/**
 * Built-in third-party palettes ship as their authors made them, and several fall below
 * WCAG AA in places. This returns the theme with only the text roles adjusted, so text stays
 * readable and the backgrounds and accents (the look) are untouched. User themes are not
 * changed: the editor reports their contrast instead.
 */
export function legibleTheme(theme: Theme, min = 4.5): Theme {
  const fix = (p: Palette): Palette => {
    const out: Palette = { ...p };
    for (const [fg, bg] of TEXT_PAIRS) out[fg] = legibleOn(out[fg], out[bg], min);
    // base.css --surface-3 (and 2) sit on mSurfaceVariant mixed 8% toward mOnSurface: text
    // that passes on the plain surface can fall under 4.5:1 on cards, chips and badges.
    const deep = mixHex(out.mSurfaceVariant, out.mOnSurface, 0.92);
    out.mOnSurfaceVariant = legibleOn(out.mOnSurfaceVariant, deep, min);
    out.mOnSurface = legibleOn(out.mOnSurface, deep, min);
    return out;
  };
  return { ...theme, dark: fix(theme.dark), light: fix(theme.light) };
}
