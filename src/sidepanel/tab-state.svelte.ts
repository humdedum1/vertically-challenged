import { type Browser, browser } from 'wxt/browser';
import { PANEL_PORT_NAME, type PanelMessage, type WorkerMessage } from '../shared/protocol';
import type { TabInfo, WindowPatch } from '../shared/types';

export type ConnectionStatus = 'connecting' | 'ready' | 'error';

/**
 * Panel-side mirror of one window's tabs. `tabs` is $state.raw: patches replace changed
 * TabInfo objects by reference, so a keyed {#each} re-renders only the rows that changed
 * instead of Svelte deep-proxying 1,000+ objects.
 */
export class TabState {
  tabs = $state.raw<TabInfo[]>([]);
  status = $state<ConnectionStatus>('connecting');
  error = $state<string | null>(null);

  private byId = new Map<number, TabInfo>();
  private order: number[] = [];
  private port: Browser.runtime.Port | null = null;
  private windowId: number | null = null;
  private retries = 0;
  private disposed = false;

  async start(): Promise<void> {
    try {
      const win = await browser.windows.getCurrent();
      if (win.id === undefined) throw new Error('No window id');
      this.windowId = win.id;
      this.connect();
    } catch (err) {
      this.fail(err);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.port?.disconnect();
    this.port = null;
  }

  send(msg: PanelMessage): void {
    try {
      this.port?.postMessage(msg);
    } catch {
      // Port is reconnecting; user actions during that gap are dropped, which is
      // preferable to replaying stale clicks.
    }
  }

  private connect(): void {
    if (this.disposed || this.windowId === null) return;
    const port = browser.runtime.connect({ name: PANEL_PORT_NAME });
    this.port = port;
    port.onMessage.addListener((msg: WorkerMessage) => this.receive(msg));
    // The worker is suspended after ~30s idle (or restarted on update). Reconnecting
    // wakes it, and the fresh snapshot it sends resynchronises us.
    port.onDisconnect.addListener(() => {
      if (this.port !== port || this.disposed) return;
      this.port = null;
      this.status = 'connecting';
      const delay = Math.min(1000, 50 * 2 ** this.retries++);
      setTimeout(() => this.connect(), delay);
    });
    port.postMessage({ type: 'subscribe', windowId: this.windowId } satisfies PanelMessage);
  }

  private receive(msg: WorkerMessage): void {
    if (msg.type === 'snapshot') {
      this.byId = new Map(msg.tabs.map((t) => [t.id, t]));
      this.order = msg.order;
      this.retries = 0;
      this.status = 'ready';
      this.error = null;
      this.rebuild();
    } else if (msg.patch.windowId === this.windowId) {
      this.applyPatch(msg.patch);
    }
  }

  private applyPatch(patch: WindowPatch): void {
    for (const id of patch.removed ?? []) this.byId.delete(id);
    for (const t of patch.upserts ?? []) this.byId.set(t.id, t);
    if (patch.order) this.order = patch.order;
    this.rebuild();
  }

  /** O(n) over ids only; cheap enough for 1,500 tabs and keeps object identity stable. */
  private rebuild(): void {
    const next: TabInfo[] = [];
    for (const id of this.order) {
      const t = this.byId.get(id);
      if (t) next.push(t);
    }
    this.tabs = next;
  }

  private fail(err: unknown): void {
    this.status = 'error';
    this.error = err instanceof Error ? err.message : String(err);
  }
}
