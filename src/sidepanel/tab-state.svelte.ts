import { type Browser, browser } from 'wxt/browser';
import type { WindowLayout } from '../shared/layout';
import {
  PANEL_PORT_NAME,
  type PanelMessage,
  type SetupSummary,
  type WorkerMessage,
} from '../shared/protocol';
import type { SurfaceInfo } from '../shared/surface';
import type { GroupInfo, TabInfo, WindowInfo, WindowPatch } from '../shared/types';

export type ConnectionStatus = 'connecting' | 'ready' | 'error';

const LAYOUT_WAIT_MS = 500;
const HEARTBEAT_MS = 20_000;
const REPLY_WAIT_MS = 5_000;

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
 * Panel-side mirror of every window the worker shows this panel. Tab
 * arrays are $state.raw: patches replace changed TabInfo objects by reference, so a keyed
 * {#each} re-renders only the rows that changed instead of Svelte deep-proxying 1,000+
 * objects. `tabs` / `groups` always mean the home window.
 */
export class TabState {
  tabs = $state.raw<TabInfo[]>([]);
  groups = $state.raw<GroupInfo[]>([]);
  /** Every visible window in display order (home first). */
  windows = $state.raw<WindowView[]>([]);
  /** All normal windows, regardless of subscription (for "Move to window"). */
  windowList = $state.raw<WindowInfo[]>([]);
  /** Per-window pinned layouts (Essentials and the pinned tree), as sent by the worker. */
  layouts = $state.raw<ReadonlyMap<number, WindowLayout>>(new Map());
  /** Saved setups (layouts of closed windows), most recently used first. */
  setups = $state.raw<SetupSummary[]>([]);
  status = $state<ConnectionStatus>('connecting');
  error = $state<string | null>(null);
  windowId: number | null = null;
  /** Whether this panel's own window is incognito; null until start() knows. */
  incognito = $state<boolean | null>(null);

  onFocusSearch: (() => void) | null = null;
  onNotice: ((n: { level: 'info' | 'error'; text: string }) => void) | null = null;

  /** Where this panel is shown; a popup window lists the browser window it was opened for. */
  private readonly where: SurfaceInfo;

  constructor(where: SurfaceInfo = { surface: 'sidebar', windowId: null }) {
    this.where = where;
  }

  private mirrors = new Map<number, Mirror>();
  /**
   * Windows whose snapshot arrived before their layout. The worker sends the layouts
   * right behind the snapshots, but in separate messages; publishing in between would
   * show pinned tabs as plain rows for a few frames and then reflow the whole list.
   * Publishing waits for them, at most LAYOUT_WAIT_MS.
   */
  private layoutWait = new Set<number>();
  private layoutTimer: ReturnType<typeof setTimeout> | undefined;
  /** The home snapshot is in; `ready` is announced once the held rows are published. */
  private homeArrived = false;
  private port: Browser.runtime.Port | null = null;
  private retries = 0;
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private replyTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRetryable: Extract<
    PanelMessage,
    { type: 'activate' | 'renameWindow' }
  > | null = null;
  private retryable: Extract<PanelMessage, { type: 'activate' | 'renameWindow' }> | null = null;
  private disposed = false;

  async start(): Promise<void> {
    try {
      const win =
        this.where.windowId === null
          ? await browser.windows.getCurrent()
          : await browser.windows.get(this.where.windowId);
      if (win.id === undefined) throw new Error('No window id');
      this.windowId = win.id;
      this.incognito = win.incognito;
      this.connect();
    } catch (err) {
      this.fail(err);
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.layoutTimer);
    clearTimeout(this.heartbeat);
    clearTimeout(this.replyTimer);
    clearTimeout(this.reconnectTimer);
    this.port?.disconnect();
    this.port = null;
  }

  send(msg: PanelMessage): void {
    if (this.disposed) return;
    try {
      if (!this.port) throw new Error('Disconnected');
      if (msg.type === 'activate' || msg.type === 'renameWindow') this.lastRetryable = msg;
      this.port.postMessage(msg);
    } catch {
      this.reconnect();
      if (msg.type !== 'subscribe' && msg.type !== 'ping') {
        this.onNotice?.({ level: 'error', text: 'Reconnecting to the browser. Please try again.' });
      }
    }
  }

  private reconnect(): void {
    if (this.disposed) return;
    clearTimeout(this.heartbeat);
    clearTimeout(this.replyTimer);
    clearTimeout(this.reconnectTimer);
    const port = this.port;
    this.retryable = this.lastRetryable;
    this.port = null;
    port?.disconnect();
    this.status = 'connecting';
    const delay = Math.min(1000, 50 * 2 ** this.retries++);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private checkConnection(): void {
    this.heartbeat = setTimeout(() => {
      this.replyTimer = setTimeout(() => this.reconnect(), REPLY_WAIT_MS);
      this.send({ type: 'ping' });
    }, HEARTBEAT_MS);
  }

  private subscribe(): void {
    if (this.windowId === null) return;
    const { surface } = this.where;
    this.send(
      surface === 'sidebar'
        ? { type: 'subscribe', windowId: this.windowId }
        : { type: 'subscribe', windowId: this.windowId, surface },
    );
  }

  private connect(): void {
    if (this.disposed || this.windowId === null) return;
    const port = browser.runtime.connect({ name: PANEL_PORT_NAME });
    this.port = port;
    port.onMessage.addListener((msg: WorkerMessage) => {
      if (this.port === port && !this.disposed) this.receive(msg);
    });
    // Worker shutdown or an extension update can disconnect the port. Reconnecting
    // wakes the worker, whose fresh snapshots resynchronise the panel.
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it handled; the worker not being up yet is expected.
      void browser.runtime.lastError;
      if (this.port !== port || this.disposed) return;
      this.reconnect();
    });
    this.subscribe();
    if (this.port === port) this.checkConnection();
  }

  private receive(msg: WorkerMessage): void {
    if (msg.type !== 'pong') this.lastRetryable = null;
    switch (msg.type) {
      case 'pong':
        clearTimeout(this.replyTimer);
        this.checkConnection();
        return;
      case 'snapshot': {
        const m: Mirror = {
          byId: new Map(msg.tabs.map((t) => [t.id, t])),
          order: msg.order,
          groups: msg.groups,
          tabs: [],
        };
        rebuild(m);
        this.mirrors.set(msg.windowId, m);
        if (msg.windowId === this.windowId) this.homeArrived = true;
        if (!this.layouts.has(msg.windowId)) this.holdForLayout(msg.windowId);
        this.flush();
        return;
      }
      case 'patch': {
        // Only windows the worker listed for this panel; anything else is not ours to show.
        if (!this.windowList.some((w) => w.id === msg.patch.windowId)) return;
        let m = this.mirrors.get(msg.patch.windowId);
        // A window opened after we subscribed: its first patch describes it in full
        // (the store diffs against an empty window), so start a mirror from it.
        if (!m) {
          m = { byId: new Map(), order: [], groups: [], tabs: [] };
          this.mirrors.set(msg.patch.windowId, m);
        }
        this.publish(msg.patch.windowId, !applyPatch(m, msg.patch));
        return;
      }
      case 'windows':
        this.windowList = msg.windows;
        // Drop mirrors of closed windows; new windows are sent a snapshot right after the list.
        for (const id of [...this.mirrors.keys()]) {
          if (!msg.windows.some((w) => w.id === id)) this.mirrors.delete(id);
        }
        // A window that closed before its layout came will never get one.
        for (const id of this.layoutWait) {
          if (!msg.windows.some((w) => w.id === id)) this.layoutWait.delete(id);
        }
        if ([...this.layouts.keys()].some((id) => !msg.windows.some((w) => w.id === id))) {
          this.layouts = new Map(
            [...this.layouts].filter(([id]) => msg.windows.some((w) => w.id === id)),
          );
        }
        this.flush();
        return;
      case 'layout':
        this.layouts = new Map(this.layouts).set(msg.windowId, msg.layout);
        if (this.layoutWait.delete(msg.windowId) && this.layoutWait.size === 0) this.flush();
        return;
      case 'setups':
        this.setups = msg.setups;
        return;
      case 'focusSearch':
        this.onFocusSearch?.();
        return;
      case 'notice':
        this.onNotice?.({ level: msg.level, text: msg.text });
        return;
    }
  }

  private holdForLayout(windowId: number): void {
    this.layoutWait.add(windowId);
    if (this.layoutTimer !== undefined) return;
    this.layoutTimer = setTimeout(() => {
      // A layout that never came (worker trouble): show the tabs without it.
      this.layoutWait.clear();
      this.flush();
    }, LAYOUT_WAIT_MS);
  }

  /** Publishes everything once no layout is outstanding, and announces readiness. */
  private flush(): void {
    if (this.layoutWait.size > 0) return;
    clearTimeout(this.layoutTimer);
    this.layoutTimer = undefined;
    if (this.homeArrived) {
      this.homeArrived = false;
      this.retries = 0;
      this.status = 'ready';
      this.error = null;
      const retryable = this.retryable;
      this.retryable = null;
      if (retryable) this.send(retryable);
    }
    this.publish();
  }

  /**
   * Pushes mirrors into the reactive fields. `changed` limits work to one window;
   * `groupsOnly` leaves the tab array alone so group renames don't rebuild rows.
   */
  private publish(changed?: number, groupsOnly = false): void {
    // Held until the outstanding layouts arrive; flush() then publishes everything.
    if (this.layoutWait.size > 0) return;
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

  layoutOf(windowId: number): WindowLayout | undefined {
    return this.layouts.get(windowId);
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
