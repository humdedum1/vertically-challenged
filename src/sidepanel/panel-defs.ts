import type { PanelId, SectionId } from '../settings/schema';
import type { IconName } from './components/Icon.svelte';

export const PANEL_LABELS: Record<PanelId, string> = {
  tabs: 'Tabs',
  sessions: 'Sessions',
  bookmarks: 'Bookmarks',
  history: 'History',
  settings: 'Settings',
};

/** Panels that exist in this build. */
export const IMPLEMENTED_PANELS: ReadonlySet<PanelId> = new Set<PanelId>([
  'tabs',
  'sessions',
  'bookmarks',
  'history',
  'settings',
]);

/** Only implemented panels need an icon. */
export const PANEL_ICONS: Partial<Record<PanelId, IconName>> = {
  tabs: 'tabs',
  sessions: 'sessions',
  bookmarks: 'bookmark',
  history: 'history',
  settings: 'settings',
};

export const SECTION_LABELS: Record<SectionId, string> = {
  search: 'Search field',
  tabs: 'Open tabs',
  recentlyClosed: 'Recently closed',
};

export const IMPLEMENTED_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'search',
  'tabs',
  'recentlyClosed',
]);
