import { describe, expect, it } from 'vitest';
import { createDisplay, type DisplayApi, launchAction } from '../src/background/display';
import { mayRender, parseSurface, popupQuery, popupTokenOk } from '../src/shared/surface';

function fakeApi(opts: { injectFails?: boolean; noClose?: boolean; noOverlay?: boolean } = {}) {
  const calls: string[] = [];
  let nextWindow = 900;
  const api: DisplayApi = {
    setPanelBehavior: async (b) => void calls.push(`behavior:${b.openPanelOnActionClick}`),
    openSidePanel: async (w) => void calls.push(`side:open:${w}`),
    closeSidePanel: opts.noClose ? undefined : async (w) => void calls.push(`side:close:${w}`),
    injectToggle: async (t) => {
      calls.push(`inject:${t}`);
      if (opts.injectFails) throw new Error('Cannot access a chrome:// URL');
    },
    createPopupWindow: async (url) => {
      calls.push(`window:create:${url}`);
      return { id: nextWindow++ };
    },
    removeWindow: async (w) => void calls.push(`window:remove:${w}`),
    getURL: (p) => `chrome-extension://dyn${p}`,
    ...(opts.noOverlay ? { overlay: false } : {}),
  };
  return { api, calls };
}

const tab = { id: 7, windowId: 1, incognito: false };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('launchAction', () => {
  it('Chrome side panel: a notification, whose click is the gesture', () => {
    expect(launchAction('sidebar', false)).toBe('notify');
  });
  it('Firefox sidebar: nothing, since a notification click is not user input there', () => {
    expect(launchAction('sidebar', true)).toBe('none');
  });
  it('popup and window open directly in both browsers', () => {
    for (const firefox of [false, true]) {
      expect(launchAction('popup', firefox)).toBe('open');
      expect(launchAction('window', firefox)).toBe('open');
    }
  });
});

describe('display without the in-page popup (Firefox)', () => {
  it('a popup setting opens the window instead, and never injects', async () => {
    const { api, calls } = fakeApi({ noOverlay: true });
    const d = createDisplay(api);
    d.setMode('popup');
    expect(d.mode).toBe('window');
    await d.actionClicked(tab);
    expect(calls.some((c) => c.startsWith('inject:'))).toBe(false);
    expect(calls).toContain(
      'window:create:chrome-extension://dyn/sidepanel.html?surface=window&windowId=1',
    );
  });
});

describe('display', () => {
  it('side panel mode: the toolbar button stays Chrome-handled and open() opens the panel', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    d.setMode('sidebar');
    await d.open(tab, { toggle: false, sidebarOpen: false });
    expect(calls).toEqual(['behavior:true', 'side:open:1']);
  });

  it('side panel mode: the toggle shortcut closes an open panel', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    d.setMode('sidebar');
    await d.open(tab, { toggle: true, sidebarOpen: true });
    expect(calls).toEqual(['behavior:true', 'side:close:1']);
  });

  it('side panel mode before Chrome 141 can only open', async () => {
    const { api, calls } = fakeApi({ noClose: true });
    const d = createDisplay(api);
    d.setMode('sidebar');
    await d.open(tab, { toggle: true, sidebarOpen: true });
    expect(calls).toEqual(['behavior:true', 'side:open:1']);
  });

  it('popup mode: switches the toolbar behaviour off and injects into the tab', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    d.setMode('popup');
    await d.open(tab, { toggle: true, sidebarOpen: false });
    await d.actionClicked(tab);
    expect(calls).toEqual(['behavior:false', 'inject:7', 'inject:7']);
  });

  it('popup mode: pages that refuse injection get a popup window, which toggles', async () => {
    const { api, calls } = fakeApi({ injectFails: true });
    const d = createDisplay(api);
    d.setMode('popup');
    await d.actionClicked(tab);
    await d.actionClicked(tab);
    expect(calls).toEqual([
      'behavior:false',
      'inject:7',
      'window:create:chrome-extension://dyn/sidepanel.html?surface=window&windowId=1',
      'inject:7',
      'window:remove:900',
    ]);
  });

  it('popup mode: incognito tabs go straight to the window', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    d.setMode('popup');
    await d.actionClicked({ id: 3, windowId: 2, incognito: true });
    expect(calls).toEqual([
      'behavior:false',
      'window:create:chrome-extension://dyn/sidepanel.html?surface=window&windowId=2',
    ]);
  });

  it('a closed popup window is forgotten, so the next toggle opens a new one', async () => {
    const { api, calls } = fakeApi({ injectFails: true });
    const d = createDisplay(api);
    d.setMode('popup');
    await d.actionClicked(tab);
    d.windowRemoved(900);
    await d.actionClicked(tab);
    expect(calls.filter((c) => c.startsWith('window:'))).toHaveLength(2);
    expect(calls.some((c) => c.startsWith('window:remove'))).toBe(false);
  });

  it('woken by the gesture in side panel mode: opens at once, nothing else', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    const done = d.open(tab, { toggle: false, sidebarOpen: false });
    expect(calls).toEqual(['side:open:1']); // synchronously, inside the gesture
    d.setMode('sidebar');
    await done;
    expect(calls).toEqual(['side:open:1', 'behavior:true']);
  });

  it('window mode: always a window, never injected, and it toggles', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    d.setMode('window');
    await d.open(tab, { toggle: true, sidebarOpen: false });
    await d.actionClicked(tab);
    expect(calls).toEqual([
      'behavior:false',
      'window:create:chrome-extension://dyn/sidepanel.html?surface=window&windowId=1',
      'window:remove:900',
    ]);
  });

  it('woken by the gesture in popup mode: replaces the side panel with the popup', async () => {
    const { api, calls } = fakeApi();
    const d = createDisplay(api);
    const done = d.open(tab, { toggle: false, sidebarOpen: false });
    await flush();
    d.setMode('popup');
    await done;
    expect(calls).toEqual(['side:open:1', 'behavior:false', 'side:close:1', 'inject:7']);
  });
});

describe('parseSurface', () => {
  it('reads the three surfaces', () => {
    expect(parseSurface('')).toEqual({ surface: 'sidebar', windowId: null });
    expect(parseSurface('?surface=popup')).toEqual({ surface: 'popup', windowId: null });
    expect(parseSurface('?surface=window&windowId=42')).toEqual({
      surface: 'window',
      windowId: 42,
    });
  });

  it('falls back to the side panel UI on anything malformed', () => {
    expect(parseSurface('?surface=window')).toEqual({ surface: 'sidebar', windowId: null });
    expect(parseSurface('?surface=window&windowId=-1')).toEqual({
      surface: 'sidebar',
      windowId: null,
    });
    expect(parseSurface('?surface=window&windowId=1e3')).toEqual({
      surface: 'sidebar',
      windowId: null,
    });
    expect(parseSurface('?surface=frame')).toEqual({ surface: 'sidebar', windowId: null });
  });
});

describe('popupTokenOk', () => {
  it('accepts only the stored token', () => {
    expect(popupTokenOk(popupQuery('abc'), 'abc')).toBe(true);
    expect(popupTokenOk(popupQuery('abc'), 'xyz')).toBe(false);
    expect(popupTokenOk('?surface=popup', 'abc')).toBe(false);
    expect(popupTokenOk('?surface=popup&t=', '')).toBe(false);
    expect(popupTokenOk(popupQuery('abc'), undefined)).toBe(false);
  });
});

// A page that learns the panel URL must not frame it by dropping or changing ?surface=popup.
describe('mayRender', () => {
  const t = 'tok-123';
  it('renders top-level surfaces without a token', () => {
    expect(mayRender('', false, undefined)).toBe(true);
    expect(mayRender('?surface=window&windowId=4', false, undefined)).toBe(true);
  });
  it('renders a framed popup only with the stored token', () => {
    expect(mayRender(popupQuery(t), true, t)).toBe(true);
    expect(mayRender(popupQuery('other'), true, t)).toBe(false);
  });
  it('refuses any other surface inside a frame', () => {
    expect(mayRender('', true, t)).toBe(false);
    expect(mayRender('?surface=window&windowId=4', true, t)).toBe(false);
    expect(mayRender('?surface=bogus', true, t)).toBe(false);
  });
  it('still checks the token for a top-level popup URL', () => {
    expect(mayRender(popupQuery('other'), false, t)).toBe(false);
  });
});
