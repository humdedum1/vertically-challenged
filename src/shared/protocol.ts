import type { TabInfo, WindowPatch } from './types';

export const PANEL_PORT_NAME = 'vc-panel';

/** Panel → service worker. */
export type PanelMessage =
  | { type: 'subscribe'; windowId: number }
  | { type: 'activate'; tabId: number }
  | { type: 'close'; tabIds: number[] };

/** Service worker → panel. */
export type WorkerMessage =
  | { type: 'snapshot'; windowId: number; tabs: TabInfo[]; order: number[] }
  | { type: 'patch'; patch: WindowPatch };

const isTabId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Ports only carry messages from our own extension pages, but validating keeps a
 * buggy panel from passing garbage straight into chrome.tabs calls.
 */
export function parsePanelMessage(raw: unknown): PanelMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'subscribe':
      return isTabId(m.windowId) ? { type: 'subscribe', windowId: m.windowId } : null;
    case 'activate':
      return isTabId(m.tabId) ? { type: 'activate', tabId: m.tabId } : null;
    case 'close':
      return Array.isArray(m.tabIds) && m.tabIds.length > 0 && m.tabIds.every(isTabId)
        ? { type: 'close', tabIds: m.tabIds }
        : null;
    default:
      return null;
  }
}
