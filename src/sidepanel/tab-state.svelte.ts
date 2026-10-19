import { type Browser, browser } from 'wxt/browser';
import { PANEL_PORT_NAME, type PanelMessage, type WorkerMessage } from '../shared/protocol';
import type { GroupInfo, TabInfo, WindowInfo, WindowPatch } from '../shared/types';

export type ConnectionStatus = 'connecting' | 'ready' | 'error';

export interface WindowView {
  info: WindowInfo;
  tabs: TabInfo[];
  groups: GroupInfo[];
}

interface Mirror {
  byId: Map<number, TabInfo>;
  order: number[];
  groups: GroupInfo[];
  tabs: TabInfo[];
}

/**
 * Panel-side mirror of the home window (and, in multi-window mode, every window). Tab
 * arrays are $state.raw: patches replace changed TabInfo objects by reference, so a keyed
 * {#each} re-renders only the rows that changed instead of Svelte deep-proxying 1,000+
 * objects. `tabs` / `groups` always mean the home window, so single-window code is
 * unaffected by multi-window mode.
 */
export class TabState {
  tabs = $state.raw<TabInfo[]>([]);
  groups = $state.raw<GroupInfo[]>([]);
  /** Every subscribed window in display order (home first); just the home one unless `all`. */
  windows = $state.raw<WindowView[]>([]);
  /** All normal windows, regardless of subscription (for "Move to window"). */
  windowList = $state.raw<WindowInfo[]>([]);
  status = $state<ConnectionStatus>('connecting');
  error = $state<string | null>(null);
  windowId: number | null = null;

  onFocusSearch: (() => void) | null = null;
  onNotice: ((n: { level: 'info' | 'error'; text: string }) => void) | null = null;

  private all = false;
  private mirrors = new Map<number, Mirror>();
  private port: Browser.runtime.Port | null = null;
  private retries = 0;
  private disposed = false;

  async start(all = false): Promise<void> {
    this.all = all;
    try {
      const win = await browser.windows.getCurrent();
      if (win.id === undefined) throw new Error('No window id');
      this.windowId = win.id;
      this.connect();
    } catch (err) {
      this.fail(err);
    }
  }

  /** Switches between this-window and all-windows; the worker re-sends snapshots. */
  setAllWindows(all: boolean): void {
    if (all === this.all) return;
    this.all = all;
    // Keep the home mirror so the list doesn't blank while the new snapshots arrive.
    for (const id of [...this.mirrors.keys()]) if (id !== this.windowId) this.mirrors.delete(id);
    this.publish();
    this.subscribe();
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

  private subscribe(): void {
    if (this.windowId === null) return;
    this.send({ type: 'subscribe', windowId: this.windowId, all: this.all });
  }

  private connect(): void {
    if (this.disposed || this.windowId === null) return;
    const port = browser.runtime.connect({ name: PANEL_PORT_NAME });
    this.port = port;
    port.onMessage.addListener((msg: WorkerMessage) => this.receive(msg));
    // The worker is suspended after ~30s idle (or restarted on update). Reconnecting
    // wakes it, and the fresh snapshots it sends resynchronise us.
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it handled; the worker not being up yet is expected.
      void browser.runtime.lastError;
      if (this.port !== port || this.disposed) return;
      this.port = null;
      this.status = 'connecting';
      const delay = Math.min(1000, 50 * 2 ** this.retries++);
      setTimeout(() => this.connect(), delay);
    });
    this.subscribe();
  }

  private receive(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        const m: Mirror = {
          byId: new Map(msg.tabs.map((t) => [t.id, t])),
          order: msg.order,
          groups: msg.groups,
          tabs: [],
        };
        rebuild(m);
        this.mirrors.set(msg.windowId, m);
        if (msg.windowId === this.windowId) {
          this.retries = 0;
          this.status = 'ready';
          this.error = null;
        }
        this.publish();
        return;
      }
      case 'patch': {
        let m = this.mirrors.get(msg.patch.windowId);
        // A window opened after we subscribed: its first patch describes it in full
        // (the store diffs against an empty window), so start a mirror from it.
        if (!m && this.all) {
          m = { byId: new Map(), order: [], groups: [], tabs: [] };
          this.mirrors.set(msg.patch.windowId, m);
        }
        if (!m) return;
        this.publish(msg.patch.windowId, !applyPatch(m, msg.patch));
        return;
      }
      case 'windows':
        this.windowList = msg.windows;
        // Drop mirrors of closed windows; new windows arrive with their own snapshot.
        for (const id of [...this.mirrors.keys()]) {
          if (!msg.windows.some((w) => w.id === id)) this.mirrors.delete(id);
        }
        this.publish();
        return;
      case 'focusSearch':
        this.onFocusSearch?.();
        return;
      case 'notice':
        this.onNotice?.({ level: msg.level, text: msg.text });
        return;
    }
  }

  /**
   * Pushes mirrors into the reactive fields. `changed` limits work to one window;
   * `groupsOnly` leaves the tab array alone so group renames don't rebuild rows.
   */
  private publish(changed?: number, groupsOnly = false): void {
    const home = this.windowId === null ? undefined : this.mirrors.get(this.windowId);
    if (changed === undefined || changed === this.windowId) {
      if (!groupsOnly) this.tabs = home?.tabs ?? [];
      this.groups = home?.groups ?? [];
    }
    const info = (id: number): WindowInfo =>
      this.windowList.find((w) => w.id === id) ?? { id, incognito: false, focused: false };
    const ids = [...this.mirrors.keys()].sort((a, b) =>
      a === this.windowId ? -1 : b === this.windowId ? 1 : a - b,
    );
    this.windows = ids.map((id) => {
      const m = this.mirrors.get(id) as Mirror;
      return { info: info(id), tabs: m.tabs, groups: m.groups };
    });
  }

  private fail(err: unknown): void {
    this.status = 'error';
    this.error = err instanceof Error ? err.message : String(err);
  }
}

/** Returns false when only groups changed (the tab array is left as is). */
function applyPatch(m: Mirror, patch: WindowPatch): boolean {
  for (const id of patch.removed ?? []) m.byId.delete(id);
  for (const t of patch.upserts ?? []) m.byId.set(t.id, t);
  if (patch.groups) m.groups = patch.groups;
  if (patch.order) m.order = patch.order;
  if (!(patch.upserts || patch.removed || patch.order)) return false;
  rebuild(m);
  return true;
}

/** O(n) over ids only; cheap enough for 1,500 tabs and keeps object identity stable. */
function rebuild(m: Mirror): void {
  const next: TabInfo[] = [];
  for (const id of m.order) {
    const t = m.byId.get(id);
    if (t) next.push(t);
  }
  m.tabs = next;
}
