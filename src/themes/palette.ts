/** The 16 Noctalia shell palette roles, so Noctalia theme files load unchanged. */
export const ROLES = [
  'mPrimary',
  'mOnPrimary',
  'mSecondary',
  'mOnSecondary',
  'mTertiary',
  'mOnTertiary',
  'mError',
  'mOnError',
  'mSurface',
  'mOnSurface',
  'mSurfaceVariant',
  'mOnSurfaceVariant',
  'mOutline',
  'mShadow',
  'mHover',
  'mOnHover',
] as const;

export type Role = (typeof ROLES)[number];
export type Palette = Record<Role, string>;

export interface Theme {
  id: string;
  name: string;
  dark: Palette;
  light: Palette;
}

export type ParseResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; error: string };

const HEX = /^#[0-9a-f]{6}$/i;

function parsePalette(raw: unknown, label: string): Palette | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${label}: expected an object of colour roles`;
  }
  const src = raw as Record<string, unknown>;
  const out = {} as Palette;
  for (const role of ROLES) {
    const v = src[role];
    if (typeof v !== 'string' || !HEX.test(v)) {
      return `${label}.${role}: expected a #rrggbb colour, got ${JSON.stringify(v) ?? 'nothing'}`;
    }
    out[role] = v.toLowerCase();
  }
  return out;
}

/**
 * Accepts the Noctalia scheme layout ({ dark, light }) and also a flat single palette
 * (Noctalia's generated colors.json), which is then used for both modes.
 * Values are validated strictly: they end up inside a stylesheet, so anything beyond
 * #rrggbb (e.g. `red; } body { …`) must never get through.
 */
export function parseTheme(raw: unknown, meta: { id: string; name: string }): ParseResult<Theme> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Theme file must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const warnings: string[] = [];
  let dark: Palette | string;
  let light: Palette | string;
  if ('dark' in obj || 'light' in obj) {
    dark = parsePalette(obj.dark ?? obj.light, 'dark');
    light = parsePalette(obj.light ?? obj.dark, 'light');
    if (!('dark' in obj)) warnings.push('No dark variant; using the light palette for both modes');
    if (!('light' in obj)) warnings.push('No light variant; using the dark palette for both modes');
  } else {
    dark = light = parsePalette(obj, 'palette');
    warnings.push('Single palette; it is used for both light and dark mode');
  }
  if (typeof dark === 'string') return { ok: false, error: dark };
  if (typeof light === 'string') return { ok: false, error: light };
  return { ok: true, value: { ...meta, dark, light }, warnings };
}
