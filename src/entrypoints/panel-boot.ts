import { browser } from 'wxt/browser';
import { PANEL_PORT_NAME, type WorkerMessage } from '../shared/protocol';
import type { PanelBoot } from '../sidepanel/boot';

/**
 * Loaded as a plain script at the top of the side panel, ahead of the module bundle.
 * It only opens the port and subscribes; TabState takes the port over when it starts.
 */
export default defineUnlistedScript(() => {
  const port = browser.runtime.connect({ name: PANEL_PORT_NAME });
  const messages: WorkerMessage[] = [];
  const buffer = (m: WorkerMessage) => messages.push(m);
  const boot: PanelBoot = {
    port,
    window: browser.windows.getCurrent(),
    messages,
    disconnected: false,
    release: () => port.onMessage.removeListener(buffer),
  };
  port.onMessage.addListener(buffer);
  port.onDisconnect.addListener(() => {
    // Reading lastError marks it handled; TabState reconnects on its own.
    void browser.runtime.lastError;
    boot.disconnected = true;
  });
  boot.window.then(
    (w) => {
      if (w.id === undefined || boot.disconnected) return;
      try {
        port.postMessage({ type: 'subscribe', windowId: w.id });
      } catch {}
    },
    () => {},
  );
  globalThis.__vcBoot = boot;
});
