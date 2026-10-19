import type { PanelId, SectionId } from '../settings/schema';
import type { IconName } from './components/Icon.svelte';

export const PANEL_LABELS: Record<PanelId, string> = {
  tabs: 'Tabs',
  sessions: 'Sessions',
  bookmarks: 'Bookmarks',
  history: 'History',
  settings: 'Settings',
};

/** Panels that exist in this build; M5 adds sessions / bookmarks / history here. */
export const IMPLEMENTED_PANELS: ReadonlySet<PanelId> = new Set<PanelId>(['tabs', 'settings']);

/** Only implemented panels need an icon. */
export const PANEL_ICONS: Partial<Record<PanelId, IconName>> = {
  tabs: 'tabs',
  settings: 'settings',
};

export const SECTION_LABELS: Record<SectionId, string> = {
  search: 'Search field',
  tabs: 'Open tabs',
  recentlyClosed: 'Recently closed',
};

export const IMPLEMENTED_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>(['search', 'tabs']);
