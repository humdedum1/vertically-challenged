import { POPUP_CLOSE } from '../shared/surface';

/**
 * The in-page popup: the panel page in an iframe floating over the current web page,
 * injected on demand (toolbar button, shortcut, toolbar menu) by the popup-toggle script.
 *
 * Runs in the content-script world, whose globals persist between injections into the same
 * document, so a second injection finds the open popup and closes it (toggle). The host
 * element uses a closed shadow root and `all: initial`, so page CSS and page scripts can't
 * restyle or reach into it. The iframe URL is the extension's dynamic web-accessible URL:
 * other sites can't frame the panel because they can't know it.
 *
 * Closes on: a click outside it, Escape in the page, the panel's close request (Escape with
 * nothing else to cancel, or its close button), the tab being hidden (switching tabs, which
 * clicking a tab in the list does) and navigation.
 */

const STATE = '__verticallyChallengedPopup';
const WIDTH = 360;
const MARGIN = 8;

interface PopupState {
  close(): void;
}

type Global = typeof globalThis & { [STATE]?: PopupState };

export function togglePopupOverlay(url: string): 'opened' | 'closed' {
  const g = globalThis as Global;
  const open = g[STATE];
  if (open) {
    open.close();
    return 'closed';
  }

  const previousFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: 2147483647;`;
  const root = host.attachShadow({ mode: 'closed' });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const style = document.createElement('style');
  style.textContent = `
    .backdrop { position: fixed; inset: 0; background: transparent; }
    iframe {
      position: fixed;
      top: ${MARGIN}px;
      right: ${MARGIN}px;
      bottom: ${MARGIN}px;
      width: min(${WIDTH}px, calc(100vw - ${MARGIN * 2}px));
      height: calc(100vh - ${MARGIN * 2}px);
      border: 0;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(127, 127, 127, 0.25);
      background: transparent;
      color-scheme: normal;
    }`;

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = 'Vertically Challenged';
  frame.setAttribute('allow', 'clipboard-write');
  root.append(style, backdrop, frame);

  const onMessage = (e: MessageEvent) => {
    // Only the panel's own frame can close it; a page can't post as that window.
    if (e.source === frame.contentWindow && (e.data as { type?: unknown })?.type === POPUP_CLOSE)
      close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') close();
  };

  function close(): void {
    if (g[STATE] !== state) return;
    delete g[STATE];
    window.removeEventListener('message', onMessage);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', close);
    host.remove();
    // Hand the keyboard back to where it was, if that element is still there.
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  const state: PopupState = { close };
  g[STATE] = state;
  backdrop.addEventListener('pointerdown', close);
  window.addEventListener('message', onMessage);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', close);
  frame.addEventListener('load', () => frame.focus(), { once: true });

  (document.body ?? document.documentElement).append(host);
  if (!reduceMotion) {
    frame.animate(
      [
        { opacity: 0, transform: 'translateX(12px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 140, easing: 'ease-out' },
    );
  }
  return 'opened';
}
