import { type Browser, browser } from 'wxt/browser';
import type {
  RelayEvent,
  RelayEventMessage,
  RelayMethod,
  RelayRequest,
  RelayResponse,
} from '../shared/relay';

// The framed Firefox popup has no tabs/bookmarks/history/sessions APIs, so it asks the background.
function call<T>(method: RelayMethod, args: unknown[]): Promise<T> {
  if (browser.tabs) {
    const [ns, fn] = method.split('.') as [string, string];
    // biome-ignore lint/suspicious/noExplicitAny: dynamic dispatch over RELAY_METHODS
    return (browser as any)[ns][fn](...args);
  }
  const req: RelayRequest = { type: 'relay', method, args };
  return browser.runtime.sendMessage(req).then((res: RelayResponse) => {
    if (!res.ok) throw new Error(res.error);
    return res.value as T;
  });
}

/**
 * Subscribes to a browser event. The framed popup has no such API, so it hears the
 * background's relayed copy instead. Returns the unsubscribe.
 */
export function onRelayed(
  event: 'history.onVisited',
  cb: (item: Browser.history.HistoryItem) => void,
): () => void;
export function onRelayed(
  event: 'history.onVisitRemoved',
  cb: (removed: { allHistory: boolean; urls?: string[] }) => void,
): () => void;
// biome-ignore lint/suspicious/noExplicitAny: callbacks take each event's own payload
export function onRelayed(event: RelayEvent, cb: (...args: any[]) => void): () => void;
// biome-ignore lint/suspicious/noExplicitAny: see the overload above
export function onRelayed(event: RelayEvent, cb: (...args: any[]) => void): () => void {
  const [ns, ev] = event.split('.') as [string, string];
  // biome-ignore lint/suspicious/noExplicitAny: dynamic dispatch over RELAY_EVENTS
  const target = (browser as any)[ns]?.[ev] as
    | { addListener(fn: unknown): void; removeListener(fn: unknown): void }
    | undefined;
  if (target) {
    // Some profiles (policy, kiosk) have the namespace but refuse the event.
    try {
      target.addListener(cb);
    } catch {
      return () => {};
    }
    return () => target.removeListener(cb);
  }
  const onMsg = (msg: unknown) => {
    const m = msg as Partial<RelayEventMessage> | null;
    if (m?.type === 'relayEvent' && m.event === event && Array.isArray(m.args)) cb(...m.args);
  };
  browser.runtime.onMessage.addListener(onMsg);
  return () => browser.runtime.onMessage.removeListener(onMsg);
}

export const api = {
  windows: {
    getCurrent: () => call<Browser.windows.Window>('windows.getCurrent', []),
    create: (props: Browser.windows.CreateData) =>
      call<Browser.windows.Window>('windows.create', [props]),
  },
  tabs: {
    create: (props: Browser.tabs.CreateProperties) =>
      call<Browser.tabs.Tab>('tabs.create', [props]),
    query: (info: Browser.tabs.QueryInfo) => call<Browser.tabs.Tab[]>('tabs.query', [info]),
    update: (tabId: number, props: Browser.tabs.UpdateProperties) =>
      call<Browser.tabs.Tab | undefined>('tabs.update', [tabId, props]),
  },
  bookmarks: {
    getTree: () => call<Browser.bookmarks.BookmarkTreeNode[]>('bookmarks.getTree', []),
    search: (query: string | Browser.bookmarks.SearchQuery) =>
      call<Browser.bookmarks.BookmarkTreeNode[]>('bookmarks.search', [query]),
    create: (bookmark: Browser.bookmarks.CreateDetails) =>
      call<Browser.bookmarks.BookmarkTreeNode>('bookmarks.create', [bookmark]),
    remove: (id: string) => call<void>('bookmarks.remove', [id]),
  },
  history: {
    search: (query: Browser.history.HistoryQuery) =>
      call<Browser.history.HistoryItem[]>('history.search', [query]),
    deleteUrl: (details: { url: string }) => call<void>('history.deleteUrl', [details]),
  },
  sessions: {
    getRecentlyClosed: (filter?: Browser.sessions.Filter) =>
      call<Browser.sessions.Session[]>('sessions.getRecentlyClosed', filter ? [filter] : []),
    restore: (sessionId: string) => call<Browser.sessions.Session>('sessions.restore', [sessionId]),
  },
};
