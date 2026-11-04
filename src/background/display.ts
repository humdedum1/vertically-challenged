import type { DisplayMode } from '../settings/schema';
import { PANEL_PAGE, windowQuery } from '../shared/surface';

/** The Chrome calls display needs; injected so it runs in unit tests. */
export interface DisplayApi {
  setPanelBehavior(b: { openPanelOnActionClick: boolean }): Promise<void>;
  openSidePanel(windowId: number): Promise<void>;
  /** Absent before Chrome 141. */
  closeSidePanel?: (windowId: number) => Promise<void>;
  /** Injects the popup-toggle script into a tab; rejects where that isn't allowed. */
  injectToggle(tabId: number): Promise<void>;
  createPopupWindow(url: string): Promise<{ id?: number } | undefined>;
  removeWindow(windowId: number): Promise<void>;
  getURL(path: string): string;
  /**
   * False where a panel framed in a web page gets no tabs/windows API (Firefox): the in-page
   * popup can't work there, so that mode opens the window instead.
   */
  overlay?: boolean;
  /** Firefox only: the sidebar has no "open on action click" setting, so the button toggles it. */
  toggleSidebar?: () => Promise<void>;
}

export interface TargetTab {
  id?: number;
  windowId: number;
  incognito: boolean;
}

/** Fallback window size: a side-panel-like column. */
export const POPUP_WINDOW = { width: 380, height: 720 };

/**
 * Opens the panel the way the Display setting says: Chrome's side panel, or the in-page
 * popup. The mode is cached because sidePanel.open must be called synchronously inside the
 * user gesture (toolbar menu, keyboard shortcut), before any storage read could finish.
 *
 * The toolbar button itself is handled by Chrome while in side-panel mode
 * (openPanelOnActionClick), so it works even when the worker is asleep; in popup mode that
 * behaviour is switched off and the click arrives as action.onClicked instead.
 */
export function createDisplay(api: DisplayApi, warn: (...a: unknown[]) => void = () => {}) {
  /** null until the settings have been read after the worker woke up. */
  let mode: DisplayMode | null = null;
  let ready!: () => void;
  const loaded = new Promise<void>((r) => (ready = r));
  /** Fallback popup windows: browser window id -> the popup window listing it. */
  const windows = new Map<number, number>();

  function setMode(next: DisplayMode): void {
    const first = mode === null;
    mode = next === 'popup' && api.overlay === false ? 'window' : next;
    if (first) ready();
    api.setPanelBehavior({ openPanelOnActionClick: mode === 'sidebar' }).catch(() => {});
  }

  /** A popup window for pages that can't host the overlay; toggles like the overlay does. */
  async function toggleWindow(windowId: number): Promise<void> {
    const open = windows.get(windowId);
    if (open !== undefined) {
      windows.delete(windowId);
      await api.removeWindow(open).catch(() => {});
      return;
    }
    const url = `${api.getURL(PANEL_PAGE)}${windowQuery(windowId)}`;
    const win = await api.createPopupWindow(url);
    if (win?.id !== undefined) windows.set(windowId, win.id);
  }

  /**
   * The overlay can't run on chrome:// pages, the Web Store, the New Tab page or PDFs (the
   * injection is refused), nor in incognito (the panel page can't be framed there without
   * split incognito mode); those get the window.
   */
  async function togglePopup(tab: TargetTab): Promise<void> {
    if (tab.id !== undefined && !tab.incognito) {
      try {
        await api.injectToggle(tab.id);
        return;
      } catch {
        // Fall through to the window.
      }
    }
    await toggleWindow(tab.windowId);
  }

  /**
   * Opens (or for the toggle shortcut, toggles) the panel for a tab's window. Call it
   * synchronously from the gesture's event listener: in side-panel mode it opens the panel
   * before returning. `sidebarOpen` says whether this window already has a side panel.
   */
  function open(tab: TargetTab, opts: { toggle: boolean; sidebarOpen: boolean }): Promise<void> {
    if (mode === 'popup') return togglePopup(tab);
    if (mode === 'window') return toggleWindow(tab.windowId);
    if (mode === 'sidebar') {
      if (opts.toggle && opts.sidebarOpen && api.closeSidePanel) {
        return api.closeSidePanel(tab.windowId).catch(() => {});
      }
      return api.openSidePanel(tab.windowId).catch((err: unknown) => warn('[vc] open', err));
    }
    // Woken by this very gesture: open the side panel while the gesture lasts (the default
    // mode), then switch to the popup if that turns out to be the setting.
    const side = api.openSidePanel(tab.windowId).catch(() => {});
    return loaded.then(async () => {
      if (mode === 'sidebar') return side;
      await side;
      await api.closeSidePanel?.(tab.windowId).catch(() => {});
      await (mode === 'window' ? toggleWindow(tab.windowId) : togglePopup(tab));
    });
  }

  return {
    setMode,
    open,
    /** The toolbar button in popup and window modes. */
    actionClicked(tab: TargetTab): Promise<void> {
      if (mode === 'window') return toggleWindow(tab.windowId);
      if (mode === 'popup') return togglePopup(tab);
      // Firefox, sidebar mode: call synchronously, sidebarAction needs the gesture.
      if (api.toggleSidebar) {
        return api.toggleSidebar().catch((err: unknown) => warn('[vc] toggle', err));
      }
      return togglePopup(tab);
    },
    windowRemoved(id: number): void {
      windows.delete(id);
      for (const [target, popup] of windows) if (popup === id) windows.delete(target);
    },
    get mode(): DisplayMode | null {
      return mode;
    },
  };
}
