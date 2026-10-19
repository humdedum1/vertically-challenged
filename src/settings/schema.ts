import { DEFAULT_THEME_ID } from '../themes/builtin';

/** Bump when the stored shape changes, and add a step to MIGRATIONS in migrate.ts. */
export const SETTINGS_VERSION = 1;

export type ColorMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable';

export interface Appearance {
  themeId: string;
  mode: ColorMode;
  density: Density;
  /** Card corner radius in px; rows and controls derive theirs from it. */
  radius: number;
  fontFamily: string;
  /** Base font size in px. */
  fontSize: number;
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
  appearance: Appearance;
}

export const DEFAULT_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  appearance: {
    themeId: DEFAULT_THEME_ID,
    mode: 'system',
    density: 'comfortable',
    radius: 14,
    fontFamily: DEFAULT_FONT,
    fontSize: 13,
  },
};

export const LIMITS = {
  radius: { min: 0, max: 24 },
  fontSize: { min: 11, max: 16 },
} as const;

/** Row heights per density; the virtual list and CSS both read these. */
export const ROW_HEIGHT: Record<Density, number> = { compact: 28, comfortable: 34 };
