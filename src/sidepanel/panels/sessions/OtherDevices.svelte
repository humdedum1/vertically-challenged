<script lang="ts">
import { onMount } from 'svelte';
import { type Browser, browser } from 'wxt/browser';
import { displayUrl } from '../../../lib/search/search-index';
import { isRestorableUrl, type SavedPinNode, sessionTabCount } from '../../../shared/sessions';
import type { SyncDoc, SyncWorkspace } from '../../../shared/sync';
import { DEVICE_KEY, DEVICE_PREFIX, readSync } from '../../../shared/sync-store';
import Button from '../../components/controls/Button.svelte';
import Favicon from '../../components/Favicon.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { TabState } from '../../tab-state.svelte';
import { pluralize, relativeTime } from './relative-time';

let {
  tabState,
  now,
  onstatus,
}: { tabState: TabState; now: number; onstatus: (s: string) => void } = $props();

const STRIP = 8;
const TAB_PAGE = 50;

/** Other devices' documents (shared through Vertically Challenged's sync). */
let docs = $state.raw<SyncDoc[]>([]);
/** Chrome's own synced open tabs of the user's other devices. */
let chromeDevices = $state.raw<Browser.sessions.Device[]>([]);
let loading = $state(true);
let expanded = $state.raw<ReadonlySet<string>>(new Set());

async function loadDocs(): Promise<void> {
  try {
    const [all, local] = await Promise.all([
      browser.storage.sync.get(null),
      browser.storage.local.get(DEVICE_KEY),
    ]);
    const me = (local[DEVICE_KEY] as { id?: string } | undefined)?.id;
    docs = (await readSync(all)).docs.filter((d) => d.device.id !== me);
  } catch {
    docs = [];
  } finally {
    loading = false;
  }
}

async function loadChrome(): Promise<void> {
  try {
    chromeDevices = await browser.sessions.getDevices({ maxResults: 25 });
  } catch {
    chromeDevices = [];
  }
}

onMount(() => {
  void loadDocs();
  void loadChrome();
  const onStorage = (changes: Record<string, unknown>, area: string) => {
    if (area === 'sync' && Object.keys(changes).some((k) => k.startsWith(DEVICE_PREFIX)))
      void loadDocs();
  };
  const onSessions = () => void loadChrome();
  browser.storage.onChanged.addListener(onStorage);
  browser.sessions.onChanged.addListener(onSessions);
  return () => {
    browser.storage.onChanged.removeListener(onStorage);
    browser.sessions.onChanged.removeListener(onSessions);
  };
});

function toggle(key: string): void {
  const next = new Set(expanded);
  if (!next.delete(key)) next.add(key);
  expanded = next;
}

const countFolders = (nodes: readonly SavedPinNode[]): number =>
  nodes.reduce((n, x) => n + (x.kind === 'folder' ? 1 + countFolders(x.children) : 0), 0);

function workspaceCounts(w: SyncWorkspace): string {
  const essentials = w.window.layout?.essentials.length ?? 0;
  const folders = countFolders(w.window.layout?.pinned ?? []);
  const pinned = w.window.tabs.length - essentials;
  return [
    essentials ? pluralize(essentials, 'Staple') : '',
    folders ? pluralize(folders, 'folder') : '',
    pinned > 0 ? `${pinned} pinned` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const essentialsOf = (w: SyncWorkspace) =>
  (w.window.layout?.essentials ?? []).map((i) => w.window.tabs[i]).filter((t) => t !== undefined);

function workspace(d: SyncDoc, w: SyncWorkspace, action: 'open' | 'apply' | 'keep'): void {
  if (tabState.windowId === null) return;
  tabState.send({
    type: 'syncWorkspace',
    deviceId: d.device.id,
    workspaceId: w.id,
    action,
    windowId: tabState.windowId,
  });
  onstatus(
    action === 'open'
      ? `Opening “${w.name}” in a new window…`
      : action === 'apply'
        ? `Adding “${w.name}” to this window…`
        : `Keeping “${w.name}”…`,
  );
}

function session(
  d: SyncDoc,
  id: string,
  name: string,
  action: 'newWindow' | 'currentWindow' | 'keep',
): void {
  if (tabState.windowId === null) return;
  tabState.send({
    type: 'syncSession',
    deviceId: d.device.id,
    sessionId: id,
    action,
    windowId: tabState.windowId,
  });
  onstatus(action === 'keep' ? `Keeping “${name}”…` : `Restoring “${name}”…`);
}

/** Tabs of one of Chrome's synced windows, or a lone synced tab. */
const chromeTabs = (s: Browser.sessions.Session): Browser.tabs.Tab[] =>
  s.window?.tabs ?? (s.tab ? [s.tab] : []);

async function openUrl(url: string | undefined): Promise<void> {
  if (!url || !isRestorableUrl(url)) return;
  try {
    await browser.tabs.create({ url });
  } catch (e) {
    onstatus(e instanceof Error ? e.message : 'Could not open that page.');
  }
}

async function openWindow(tabs: Browser.tabs.Tab[]): Promise<void> {
  const urls = tabs.map((t) => t.url).filter((u): u is string => !!u && isRestorableUrl(u));
  if (!urls.length) return;
  try {
    await browser.windows.create({ url: urls, focused: true });
    onstatus(`Opened ${pluralize(urls.length, 'tab')} in a new window`);
  } catch (e) {
    onstatus(e instanceof Error ? e.message : 'Could not open that window.');
  }
}

const synced = (ts: number): string => (ts ? `updated ${relativeTime(ts, now)}` : '');
const total = $derived(docs.length + chromeDevices.length);
</script>

<SegmentCard title="Other devices">
  {#snippet icon()}<Icon name="devices" size={12} />{/snippet}
  {#snippet trailing()}
    {#if total > 0}<span class="count" role="img" aria-label="{total} devices">{total}</span>{/if}
  {/snippet}

  {#if loading}
    <p class="message" role="status">Looking for your other devices…</p>
  {:else if total === 0}
    <p class="message">
      Your other computers show up here when Chrome Sync is on there and Vertically Challenged is installed.
      Their open tabs need Chrome’s “Open tabs” sync.
    </p>
  {:else}
    <div class="devices">
      {#each docs as d (d.device.id)}
        <section class="device" aria-label={d.device.name}>
          <h3 class="dev-head">
            <Icon name="devices" size={14} />
            <span class="dev-name">{d.device.name}</span>
            <span class="dev-sub">{synced(d.updatedAt)}</span>
          </h3>

          {#if d.workspaces.length === 0 && d.sessions.length === 0}
            <p class="note">Nothing shared from this device yet.</p>
          {/if}

          <ul class="list" aria-label="Workspaces on {d.device.name}">
            {#each d.workspaces as w (w.id)}
              {@const ess = essentialsOf(w)}
              <li class="item">
                <div class="meta">
                  <span class="name" title={w.name}>{w.name}</span>
                  <span class="sub">
                    {w.kind === 'window' ? 'Open window' : 'Window setup'}{workspaceCounts(w) ? ` · ${workspaceCounts(w)}` : ''}
                  </span>
                </div>
                {#if ess.length > 0}
                  <div class="strip" aria-hidden="true">
                    {#each ess.slice(0, STRIP) as t, i (i)}<Favicon url={t.url} size={14} />{/each}
                    {#if ess.length > STRIP}<span class="more">+{ess.length - STRIP}</span>{/if}
                  </div>
                {/if}
                <div class="actions" role="group" aria-label="Actions for {w.name}">
                  <Button variant="tonal" onclick={() => workspace(d, w, 'open')}>Open in new window</Button>
                  {#if tabState.incognito === false}
                    <Button variant="text" onclick={() => workspace(d, w, 'apply')}>Add to this window</Button>
                  {/if}
                  <Button variant="text" onclick={() => workspace(d, w, 'keep')}>Keep here</Button>
                </div>
              </li>
            {/each}
            {#each d.sessions as s (s.id)}
              {@const tabs = sessionTabCount(s)}
              <li class="item">
                <div class="meta">
                  <span class="name" title={s.name}>{s.name}</span>
                  <span class="sub">
                    Saved session · {pluralize(tabs, 'tab')} · {pluralize(s.windows.length, 'window')}
                  </span>
                </div>
                <div class="strip" aria-hidden="true">
                  {#each s.windows.flatMap((w) => w.tabs).slice(0, STRIP) as t, i (i)}<Favicon url={t.url} size={14} />{/each}
                  {#if tabs > STRIP}<span class="more">+{tabs - STRIP}</span>{/if}
                </div>
                <div class="actions" role="group" aria-label="Actions for {s.name}">
                  <Button variant="tonal" onclick={() => session(d, s.id, s.name, 'newWindow')}>Restore</Button>
                  <Button variant="text" onclick={() => session(d, s.id, s.name, 'currentWindow')}>Into this window</Button>
                  <Button variant="text" onclick={() => session(d, s.id, s.name, 'keep')}>Keep here</Button>
                </div>
              </li>
            {/each}
          </ul>
          {#if d.omitted.workspaces + d.omitted.sessions > 0}
            <p class="note">
              {pluralize(d.omitted.workspaces + d.omitted.sessions, 'more item')} didn’t fit in Chrome’s sync storage.
            </p>
          {/if}
        </section>
      {/each}

      {#each chromeDevices as cd (cd.deviceName)}
        <section class="device" aria-label="Open tabs on {cd.deviceName}">
          <h3 class="dev-head">
            <Icon name="windows" size={14} />
            <span class="dev-name">{cd.deviceName}</span>
            <span class="dev-sub">open tabs</span>
          </h3>
          <ul class="list">
            {#each cd.sessions as s, si (si)}
              {@const tabs = chromeTabs(s)}
              {@const key = `${cd.deviceName}:${si}`}
              {@const open = expanded.has(key)}
              {#if tabs.length > 0}
                <li class="item">
                  <div class="head">
                    <button
                      type="button"
                      class="chev"
                      class:open
                      aria-expanded={open}
                      aria-label="{open ? 'Hide' : 'Show'} tabs"
                      onclick={() => toggle(key)}
                    >
                      <Icon name="chevron" size={14} />
                    </button>
                    <div class="meta">
                      <span class="name">{s.window ? `Window · ${pluralize(tabs.length, 'tab')}` : (tabs[0]?.title ?? 'Tab')}</span>
                      <span class="sub">{relativeTime(s.lastModified * 1000, now)}</span>
                    </div>
                    {#if tabs.length > 1}
                      <Button variant="text" onclick={() => void openWindow(tabs)}>Open all</Button>
                    {/if}
                  </div>
                  {#if open}
                    <ul class="tab-list">
                      {#each tabs.slice(0, TAB_PAGE) as t, ti (ti)}
                        {@const ok = !!t.url && isRestorableUrl(t.url)}
                        <li>
                          <button
                            type="button"
                            class="tab"
                            disabled={!ok}
                            title={t.url}
                            onclick={() => void openUrl(t.url)}
                          >
                            <Favicon url={t.url ?? ''} />
                            <span class="tt">
                              <span class="t-title">{t.title || displayUrl(t.url ?? '')}</span>
                              <span class="t-url">{displayUrl(t.url ?? '')}</span>
                            </span>
                          </button>
                        </li>
                      {/each}
                    </ul>
                    {#if tabs.length > TAB_PAGE}
                      <p class="note">{pluralize(tabs.length - TAB_PAGE, 'more tab')}: use Open all.</p>
                    {/if}
                  {/if}
                </li>
              {/if}
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</SegmentCard>

<style>
  .count {
    min-width: 22px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .message {
    margin: 0;
    padding: 16px var(--pad-card) 20px;
    color: var(--mOnSurfaceVariant);
    text-align: left;
  }

  .devices {
    display: grid;
    gap: 10px;
    max-height: 360px;
    padding: 2px 6px 8px;
    overflow-y: auto;
  }

  .dev-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 6px 2px;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
    font-weight: 600;
  }

  .dev-name {
    color: var(--mOnSurface);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .dev-sub {
    margin-left: auto;
    flex: none;
    font-weight: 400;
    font-size: 11px;
  }

  .note {
    margin: 2px 8px;
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: grid;
    gap: 6px;
    padding: 8px 6px;
    border-radius: var(--radius-row);
  }

  .item + .item {
    border-top: 1px solid var(--border);
    border-radius: 0 0 var(--radius-row) var(--radius-row);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .chev {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
    transition:
      background-color var(--dur) var(--ease),
      transform var(--dur) var(--ease);
  }

  .chev:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding-left: 4px;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .sub {
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 4px;
  }

  .more {
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .actions :global(button),
  .head :global(button:not(.chev)) {
    height: 26px;
    padding: 0 10px;
  }

  .tab-list {
    margin: 0 0 0 24px;
    padding: 0;
    list-style: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 32px;
    padding: 3px 8px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  .tab:hover:not(:disabled) {
    background: var(--state-hover);
  }

  .tab:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tt {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .t-title,
  .t-url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .t-url {
    color: var(--mOnSurfaceVariant);
    font-size: 10.5px;
  }
</style>
