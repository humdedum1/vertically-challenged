import type { Browser } from 'wxt/browser';
import type { WorkerMessage } from '../shared/protocol';

/**
 * Left on `globalThis` by the panel-boot script, which runs before the main bundle has
 * loaded. Connecting that early wakes the worker while the panel is still booting, so
 * the snapshots are usually waiting by the time the list mounts.
 */
export interface PanelBoot {
  port: Browser.runtime.Port;
  window: Promise<Browser.windows.Window>;
  /** Everything the worker sent before the panel took the port over, in order. */
  messages: WorkerMessage[];
  disconnected: boolean;
  /** Stops buffering; call after taking over the port. */
  release(): void;
}

declare global {
  var __vcBoot: PanelBoot | undefined;
}

/** Takes the boot connection, once; later calls (and pages without it) get undefined. */
export function takeBoot(): PanelBoot | undefined {
  const boot = globalThis.__vcBoot;
  globalThis.__vcBoot = undefined;
  return boot;
}
