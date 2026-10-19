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
