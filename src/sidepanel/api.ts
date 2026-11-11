import { type Browser, browser } from 'wxt/browser';
import type { RelayMethod, RelayRequest, RelayResponse } from '../shared/relay';

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
