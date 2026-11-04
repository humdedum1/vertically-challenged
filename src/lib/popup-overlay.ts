import { POPUP_CLOSE } from "../shared/surface";

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
 * Closes on: a click outside it (unless turned off in Settings), Escape in the page, the panel's close request (Escape with
 * nothing else to cancel, or its close button), the tab being hidden (switching tabs, which
 * clicking a tab in the list does) and navigation.
 */

const STATE = "__verticallyChallengedPopup";
const WIDTH = 360;
const MARGIN = 8;

interface PopupState {
  close(): void;
}

type Global = typeof globalThis & { [STATE]?: PopupState };

export function togglePopupOverlay(
  url: string,
  closeOnClickOutside = true,
): "opened" | "closed" {
  const g = globalThis as Global;
  const open = g[STATE];
  if (open) {
    open.close();
    return "closed";
  }

  const previousFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: 2147483647;`;
  const root = host.attachShadow({ mode: "closed" });

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const style = document.createElement("style");
  style.textContent = `
    .backdrop { position: fixed; inset: 0; background: transparent; }
    .box {
      position: fixed;
      top: ${MARGIN}px;
      right: ${MARGIN}px;
      width: min(${WIDTH}px, calc(100vw - ${MARGIN * 2}px));
      height: calc(100vh - ${MARGIN * 2}px);
    }
    .grip {
      position: absolute;
      top: -${MARGIN}px;
      left: 50%;
      width: 48px;
      height: 14px;
      margin-left: -24px;
      cursor: grab;
      touch-action: none;
      z-index: 1;
    }
    .grip::after {
      content: '';
      position: absolute;
      inset: 5px 4px;
      border-radius: 2px;
      background: rgba(127, 127, 127, 0.6);
    }
    .grip:active { cursor: grabbing; }
    iframe {
      width: 100%;
      height: 100%;
      display: block;
      border: 0;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(127, 127, 127, 0.25);
      background: transparent;
      color-scheme: normal;
    }`;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Vertically Challenged";
  frame.setAttribute("allow", "clipboard-write");
  const box = document.createElement("div");
  box.className = "box";
  const grip = document.createElement("div");
  grip.className = "grip";
  grip.title = "Drag to move";
  box.append(grip, frame);
  root.append(style, backdrop, box);

  // Drag by the grip; pointer capture keeps the moves coming while over the iframe.
  let drag: { x: number; y: number; dx: number; dy: number } | null = null;
  let dx = 0;
  let dy = 0;
  grip.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, dx, dy };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = box.getBoundingClientRect();
    const baseX = r.left - dx;
    const baseY = r.top - dy;
    // Keep the grip on screen so the popup can always be dragged back.
    dx = Math.min(
      Math.max(drag.dx + e.clientX - drag.x, -baseX - r.width + 60),
      innerWidth - baseX - 60,
    );
    dy = Math.min(
      Math.max(drag.dy + e.clientY - drag.y, -baseY + MARGIN),
      innerHeight - baseY - 40,
    );
    box.style.translate = `${dx}px ${dy}px`;
  });
  const endDrag = () => (drag = null);
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);

  const onMessage = (e: MessageEvent) => {
    // Only the panel's own frame can close it; a page can't post as that window.
    if (
      e.source === frame.contentWindow &&
      (e.data as { type?: unknown })?.type === POPUP_CLOSE
    )
      close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") close();
  };

  function close(): void {
    if (g[STATE] !== state) return;
    delete g[STATE];
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", close);
    host.remove();
    // Hand the keyboard back to where it was, if that element is still there.
    if (previousFocus?.isConnected)
      previousFocus.focus({ preventScroll: true });
  }

  const state: PopupState = { close };
  g[STATE] = state;
  // Off: no backdrop, so clicks reach the page and the popup stays open.
  if (closeOnClickOutside) backdrop.addEventListener("pointerdown", close);
  else backdrop.remove();
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", close);
  frame.addEventListener("load", () => frame.focus(), { once: true });

  (document.body ?? document.documentElement).append(host);
  if (!reduceMotion) {
    frame.animate(
      [
        { opacity: 0, transform: "translateX(12px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 140, easing: "ease-out" },
    );
  }
  return "opened";
}
