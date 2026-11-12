import { DEFAULT_THEME_ID } from '../themes/builtin';

/** Bump when the stored shape changes, and add a step to MIGRATIONS in migrate.ts. */
export const SETTINGS_VERSION = 12;

export type ColorMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable';
/** classic is the original look; the others are CSS skins (sidepanel/styles/skin-*.css). */
export const SKINS = ['classic', 'dense', 'glass'] as const;
export type SkinName = (typeof SKINS)[number];
export type RowLayout = 'single' | 'double';
export type ActionVisibility = 'hover' | 'always';
/** system follows the OS "reduce motion" preference. */
export type Motion = 'system' | 'reduce' | 'full';
export const MOUSE_ACTIONS = [
  'none',
  'close',
  'suspend',
  'duplicate',
  'pin',
  'reload',
  'mute',
] as const;
export type MouseAction = (typeof MOUSE_ACTIONS)[number];
export const AGE_DAYS = [0, 1, 3, 7, 14, 30] as const;
/** Archive (save to the Archived tabs session, then close) tabs not opened for this long. */
export const ARCHIVE_DAYS = [0, 3, 7, 14, 30, 60] as const;
export const RULE_ACTIONS = ['group', 'pin', 'mute'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

/**
 * Every panel the strip can show, including ones not built yet, so a setting saved by a
 * newer build (or an older one) keeps its meaning. The UI filters to implemented panels.
 */
export const PANEL_IDS = ['tabs', 'sessions', 'bookmarks', 'history', 'settings'] as const;
export type PanelId = (typeof PANEL_IDS)[number];
/** Hiding these would leave no way back to the settings or the tab list. */
export const UNHIDEABLE_PANELS: readonly PanelId[] = ['tabs', 'settings'];

/** Sections inside the Tabs panel, top to bottom. */
export const SECTION_IDS = ['search', 'tabs', 'recentlyClosed'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface Appearance {
  themeId: string;
  mode: ColorMode;
  density: Density;
  skin: SkinName;
  /** Card corner radius in px; rows and controls derive theirs from it. */
  radius: number;
  fontFamily: string;
  /** Base font size in px. */
  fontSize: number;
  /** Overrides the theme's mPrimary in both modes; null uses the theme's own. */
  accent: string | null;
  motion: Motion;
}

/** What clicking a tab row does, besides a plain click (which always activates). */
export interface MouseSettings {
  middle: MouseAction;
  double: MouseAction;
  /** The mouse wheel over the panel's top bar switches to the previous/next tab. */
  wheelSwitch: boolean;
}

/**
 * Commands that can be bound to keys inside the panel. Tree navigation keys (arrows,
 * Home/End, Enter, Space, Escape) follow ARIA conventions and are deliberately fixed.
 */
export const SHORTCUT_ACTIONS = [
  'focusSearch',
  'commandPalette',
  'closeTab',
  'renameGroup',
  'moveUp',
  'moveDown',
  'openMenu',
  'selectAll',
  'newTab',
  'duplicateTab',
  'togglePin',
  'toggleMute',
  'suspendTab',
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
/** Up to two combos per action, in the normalized form produced by lib/keymap. */
export type Keymap = Record<ShortcutAction, string[]>;
export const MAX_BINDINGS = 2;

export interface SuspendSettings {
  /** Discard idle background tabs automatically. Manual suspending works either way. */
  auto: boolean;
  /** Minutes a tab must be inactive before it's discarded. */
  minutes: number;
  skipPinned: boolean;
  skipAudible: boolean;
  /** Host patterns never auto-suspended: "example.com" (and subdomains) or "*.example.com". */
  whitelist: string[];
  /** Archive tabs not opened for this many days; 0 = off. */
  archiveDays: number;
}

export interface SessionSettings {
  /** Restore saved sessions as discarded tabs, so a big session doesn't load everything. */
  restoreDiscarded: boolean;
}

/** What this device publishes for the user's other machines (see shared/sync.ts). */
export interface SyncSettings {
  /** Each window's Essentials, pinned tabs and folders, and saved window setups. */
  workspaces: boolean;
  /** Saved sessions, as far as the space allows. */
  sessions: boolean;
  /** Minimum automatic publish interval; zero means manual only. */
  intervalMinutes: number;
}

export const SYNC_INTERVALS = [0, 1, 5, 15, 30, 60] as const;

/** Where the toolbar button, the shortcuts and the toolbar menu open the panel. */
export type DisplayMode = 'sidebar' | 'popup' | 'window';
export const DISPLAY_MODES: readonly DisplayMode[] = ['sidebar', 'popup', 'window'];

export interface DisplaySettings {
  /**
   * sidebar: Chrome's side panel. popup: floating over the current page (in a small
   * window on pages extensions can't run on, such as chrome:// pages and incognito).
   * window: always that small window, which window managers can move.
   */
  mode: DisplayMode;
  /** Show a notification at browser launch whose click opens the panel (Chrome won't open it unprompted). */
  openOnLaunch: boolean;
  /** Popup mode: a click on the page outside the popup closes it. */
  closeOnClickOutside: boolean;
}

/**
 * Tabs that navigate to `host` (a normalized host pattern), and when `path` is set to a URL
 * path starting with it, get `action`: put in the tab group titled `group`, pinned or muted.
 */
export interface TabRule {
  host: string;
  /** "" matches any path; otherwise starts with "/". */
  path: string;
  action: RuleAction;
  /** Group title for the group action; "" otherwise. */
  group: string;
}

export interface TabRowSettings {
  /** Empty keeps the browser’s default new-tab page. */
  newTabUrl: string;
  childTabs: boolean;
  layout: RowLayout;
  actions: ActionVisibility;
  showClose: boolean;
  showMute: boolean;
  showNewTabButton: boolean;
  showCount: boolean;
  /** Dim tabs not opened for this many days; 0 = off. */
  ageDays: number;
  /** Load favicons only once scrolling settles, so fast scrolls don't decode images. */
  lazyFavicons: boolean;
}

export interface Ordered<T extends string> {
  id: T;
  visible: boolean;
}

export interface LayoutSettings {
  /** Full permutation of PANEL_IDS. */
  panels: Ordered<PanelId>[];
  /** Full permutation of SECTION_IDS. */
  sections: Ordered<SectionId>[];
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
  appearance: Appearance;
  tabs: TabRowSettings;
  layout: LayoutSettings;
  suspend: SuspendSettings;
  sessions: SessionSettings;
  sync: SyncSettings;
  display: DisplaySettings;
  rules: TabRule[];
  mouse: MouseSettings;
  shortcuts: Keymap;
}

export const DEFAULT_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Local fonts only; nothing is ever downloaded. */
export const FONT_PRESETS: readonly { label: string; value: string }[] = [
  { label: 'Default (Inter / system)', value: DEFAULT_FONT },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Roboto', value: 'Roboto, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: '"JetBrains Mono", "Cascadia Code", Consolas, monospace' },
];

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  appearance: {
    themeId: DEFAULT_THEME_ID,
    mode: 'system',
    density: 'comfortable',
    skin: 'classic',
    radius: 14,
    fontFamily: DEFAULT_FONT,
    fontSize: 13,
    accent: null,
    motion: 'system',
  },
  tabs: {
    newTabUrl: '',
    childTabs: true,
    layout: 'single',
    actions: 'hover',
    showClose: true,
    showMute: true,
    showNewTabButton: true,
    showCount: true,
    ageDays: 0,
    lazyFavicons: true,
  },
  layout: {
    panels: PANEL_IDS.map((id) => ({ id, visible: true })),
    sections: SECTION_IDS.map((id) => ({ id, visible: true })),
  },
  suspend: {
    auto: false,
    minutes: 30,
    skipPinned: true,
    skipAudible: true,
    whitelist: [],
    archiveDays: 0,
  },
  sessions: { restoreDiscarded: true },
  sync: { workspaces: true, sessions: true, intervalMinutes: 1 },
  display: { mode: 'sidebar', openOnLaunch: false, closeOnClickOutside: true },
  rules: [],
  mouse: { middle: 'close', double: 'none', wheelSwitch: true },
  shortcuts: {
    focusSearch: ['/', 'Ctrl+F'],
    // ">" like the search's own palette prefix; Ctrl+K would take Chrome's web search.
    commandPalette: ['>'],
    closeTab: ['Delete'],
    renameGroup: ['F2'],
    moveUp: ['Alt+ArrowUp'],
    moveDown: ['Alt+ArrowDown'],
    openMenu: ['Shift+F10', 'ContextMenu'],
    selectAll: ['Ctrl+A'],
    newTab: [],
    duplicateTab: [],
    togglePin: [],
    toggleMute: [],
    suspendTab: [],
  },
};

export const LIMITS = {
  radius: { min: 0, max: 24 },
  fontSize: { min: 11, max: 16 },
  suspendMinutes: { min: 1, max: 1440 },
  whitelist: 200,
  rules: 50,
  ruleGroup: 40,
  rulePath: 200,
} as const;

/** Row heights per layout and density; the virtual list and CSS both read these. */
export const ROW_HEIGHTS: Record<RowLayout, Record<Density, number>> = {
  single: { compact: 28, comfortable: 34 },
  double: { compact: 40, comfortable: 46 },
};

export const rowHeight = (s: Settings): number => ROW_HEIGHTS[s.tabs.layout][s.appearance.density];
