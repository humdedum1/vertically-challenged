<script lang="ts">
import { onMount } from 'svelte';
import { browser } from 'wxt/browser';
import { displayUrl } from '../../../lib/search/search-index';
import type { SetupSummary } from '../../../shared/protocol';
import {
  isRestorableUrl,
  parseSessions,
  SESSIONS_KEY,
  type Session,
  sessionTabCount,
} from '../../../shared/sessions';
import Button from '../../components/controls/Button.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Favicon from '../../components/Favicon.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import type { TabState } from '../../tab-state.svelte';
import OtherDevices from './OtherDevices.svelte';
import { pluralize, relativeTime } from './relative-time';
import SnoozedCard from './SnoozedCard.svelte';

let { tabState, settings }: { tabState: TabState; settings: SettingsState } = $props();

const STRIP = 8;
// Expanded lists render every row, so cap them; sessions can hold thousands of tabs.
const TAB_PAGE = 100;

let sessions = $state.raw<Session[]>([]);
let loading = $state(true);
let loadError = $state<string | null>(null);
let status = $state('');
let now = $state(Date.now());

let name = $state('');
let expanded = $state.raw<ReadonlySet<string>>(new Set());
let shown = $state.raw<ReadonlyMap<string, number>>(new Map());
let renaming = $state<{ id: string; value: string } | null>(null);
let confirmDelete = $state<string | null>(null);

let renamingSetup = $state<{ id: string; value: string } | null>(null);
let confirmDeleteSetup = $state<string | null>(null);

const setups = $derived(tabState.setups);
const sorted = $derived([...sessions].sort((a, b) => b.createdAt - a.createdAt));
const canSaveAll = $derived(tabState.windowList.length > 1);
const canSave = $derived(tabState.windowId !== null);

function defaultName(): string {
  const d = new Date();
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Window · ${date}, ${time}`;
}

async function load(): Promise<void> {
  try {
    const raw = (await browser.storage.local.get(SESSIONS_KEY))[SESSIONS_KEY];
    sessions = parseSessions(raw);
    loadError = null;
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Could not read saved sessions.';
  } finally {
    loading = false;
  }
}

onMount(() => {
  void load();
  const onChanged = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && SESSIONS_KEY in changes) void load();
  };
  browser.storage.onChanged.addListener(onChanged);
  // Keeps "5 minutes ago" honest while the panel stays open.
  const timer = setInterval(() => (now = Date.now()), 60_000);
  return () => {
    browser.storage.onChanged.removeListener(onChanged);
    clearInterval(timer);
  };
});

function save(scope: 'window' | 'all'): void {
  if (tabState.windowId === null) return;
  const finalName = name.trim() || defaultName();
  tabState.send({ type: 'saveSession', scope, windowId: tabState.windowId, name: finalName });
  name = '';
  status = `Saving “${finalName}”…`;
}

function restore(s: Session, target: 'newWindow' | 'currentWindow'): void {
  if (tabState.windowId === null) return;
  tabState.send({ type: 'restoreSession', id: s.id, target, windowId: tabState.windowId });
  status = `Restoring “${s.name}”…`;
}

function toggle(id: string): void {
  const next = new Set(expanded);
  if (!next.delete(id)) next.add(id);
  expanded = next;
}

function more(key: string): void {
  shown = new Map(shown).set(key, (shown.get(key) ?? TAB_PAGE) + TAB_PAGE);
}

function startRename(s: Session): void {
  confirmDelete = null;
  renaming = { id: s.id, value: s.name };
}

function commitRename(): void {
  if (!renaming) return;
  const { id, value } = renaming;
  renaming = null;
  const next = value.trim();
  const current = sessions.find((s) => s.id === id);
  if (next && current && next !== current.name) {
    tabState.send({ type: 'renameSession', id, name: next });
    status = `Renamed to “${next}”.`;
  }
}

function remove(s: Session): void {
  tabState.send({ type: 'deleteSession', id: s.id });
  confirmDelete = null;
  status = `Deleted “${s.name}”.`;
}

async function openTab(url: string): Promise<void> {
  try {
    await browser.tabs.create({ url });
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not open that page.';
  }
}

function setupCounts(u: SetupSummary): string {
  const pinned = u.itemCount - u.essentials.length;
  return [
    u.essentials.length ? pluralize(u.essentials.length, 'Staple') : '',
    u.folderCount ? pluralize(u.folderCount, 'folder') : '',
    pinned > 0 ? `${pinned} pinned` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function openSetup(u: SetupSummary): void {
  tabState.send({ type: 'setupOpen', setupId: u.id });
  status = `Opening “${u.name}” in a new window…`;
}

function applySetup(u: SetupSummary): void {
  if (tabState.windowId === null) return;
  tabState.send({ type: 'setupApply', setupId: u.id, windowId: tabState.windowId });
  status = `Applying “${u.name}” to this window…`;
}

function startRenameSetup(u: SetupSummary): void {
  confirmDeleteSetup = null;
  renamingSetup = { id: u.id, value: u.name };
}

function commitRenameSetup(): void {
  if (!renamingSetup) return;
  const { id, value } = renamingSetup;
  renamingSetup = null;
  const next = value.trim();
  const current = setups.find((u) => u.id === id);
  if (next && current && next !== current.name) {
    tabState.send({ type: 'setupRename', setupId: id, name: next });
    status = `Renamed to “${next}”.`;
  }
}

function onRenameSetupKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRenameSetup();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    renamingSetup = null;
  }
}

function removeSetup(u: SetupSummary): void {
  tabState.send({ type: 'setupDelete', setupId: u.id });
  confirmDeleteSetup = null;
  status = `Deleted “${u.name}”.`;
}

function focusOnMount(node: HTMLInputElement): void {
  node.focus();
  node.select();
}

function onRenameKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRename();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    renaming = null;
  }
}

const strip = (s: Session) => s.windows.flatMap((w) => w.tabs).slice(0, STRIP);
</script>

<div class="panel">
  <SegmentCard title="Save">
    {#snippet icon()}<Icon name="sessions" size={12} />{/snippet}
    <div class="save">
      <form
        class="name-row"
        onsubmit={(e) => {
          e.preventDefault();
          save('window');
        }}
      >
        <TextInput
          label="Session name"
          value={name}
          oninput={(v) => (name = v)}
          placeholder={defaultName()}
          maxlength={100}
        />
      </form>
      <div class="buttons">
        <Button variant="primary" disabled={!canSave} onclick={() => save('window')}>Save this window</Button>
        {#if canSaveAll}
          <Button disabled={!canSave} onclick={() => save('all')}>Save all windows</Button>
        {/if}
      </div>
      <Toggle
        label="Restore tabs suspended (saves memory)"
        checked={settings.value.sessions.restoreDiscarded}
        onchange={(restoreDiscarded) =>
          settings.update((s) => ({ ...s, sessions: { ...s.sessions, restoreDiscarded } }))}
      />
    </div>
  </SegmentCard>

  <SegmentCard title="Window setups">
    {#snippet icon()}<Icon name="sessions" size={12} />{/snippet}
    {#snippet trailing()}
      {#if setups.length > 0}
        <span class="count" role="img" aria-label="{setups.length} window setups">{setups.length}</span>
      {/if}
    {/snippet}

    {#if setups.length === 0}
      <p class="message">No saved window setups — closing a window that has Staples or folders saves it here.</p>
    {:else}
      <ul class="list setups" aria-label="Window setups">
        {#each setups as u (u.id)}
          <li class="item">
            <div class="head">
              <div class="meta setup-meta">
                {#if renamingSetup?.id === u.id}
                  <input
                    class="rename"
                    aria-label="Rename window setup"
                    maxlength="100"
                    value={renamingSetup.value}
                    oninput={(e) => {
                      if (renamingSetup) renamingSetup.value = e.currentTarget.value;
                    }}
                    onkeydown={onRenameSetupKey}
                    onblur={commitRenameSetup}
                    use:focusOnMount
                  />
                {:else}
                  <span class="name" title={u.name}>{u.name}</span>
                {/if}
                <span class="sub">
                  {#if setupCounts(u)}{setupCounts(u)} ·{/if}
                  <time
                    datetime={new Date(u.lastUsed).toISOString()}
                    title={new Date(u.lastUsed).toLocaleString()}
                    >{relativeTime(u.lastUsed, now)}</time
                  >
                </span>
              </div>
            </div>

            {#if u.essentials.length > 0}
              <div class="strip setup-strip" aria-hidden="true">
                {#each u.essentials.slice(0, STRIP) as t, i (i)}<Favicon url={t.url} size={14} />{/each}
                {#if u.essentials.length > STRIP}<span class="more">+{u.essentials.length - STRIP}</span>{/if}
              </div>
            {/if}

            {#if confirmDeleteSetup === u.id}
              <div class="actions setup-actions confirm" role="group" aria-label="Confirm delete">
                <span>Delete this setup?</span>
                <Button variant="danger" onclick={() => removeSetup(u)}>Delete</Button>
                <Button variant="text" onclick={() => (confirmDeleteSetup = null)}>Keep</Button>
              </div>
            {:else}
              <div class="actions setup-actions" role="group" aria-label="Actions for {u.name}">
                <Button variant="tonal" onclick={() => openSetup(u)}>Open in new window</Button>
                <!-- An incognito window's layout is session-only; the worker refuses there too. -->
                {#if tabState.incognito === false}
                  <Button variant="text" onclick={() => applySetup(u)}>Apply to this window</Button>
                {/if}
                <Button variant="text" onclick={() => startRenameSetup(u)}>Rename</Button>
                <Button variant="text" onclick={() => (confirmDeleteSetup = u.id)}>Delete</Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </SegmentCard>

  <SnoozedCard {tabState} />

  <OtherDevices {tabState} {now} onstatus={(s) => (status = s)} />

  <SegmentCard title="Saved sessions" fill={sorted.length > 0}>
    {#snippet icon()}<Icon name="list" size={12} />{/snippet}
    {#snippet trailing()}
      {#if !loading && !loadError && sorted.length > 0}
        <span class="count" role="img" aria-label="{sorted.length} sessions">{sorted.length}</span>
      {/if}
    {/snippet}

    {#if loading}
      <p class="message" role="status">Loading sessions…</p>
    {:else if loadError}
      <div class="message" role="alert">
        <p>{loadError}</p>
        <Button onclick={() => void load()}>Retry</Button>
      </div>
    {:else if sorted.length === 0}
      <p class="message">No saved sessions yet. Use “Save this window” above to keep this window’s tabs.</p>
    {:else}
      <ul class="list" aria-label="Saved sessions">
        {#each sorted as s (s.id)}
          {@const open = expanded.has(s.id)}
          {@const tabs = sessionTabCount(s)}
          <li class="item">
            <div class="head">
              <button
                type="button"
                class="chev"
                class:open
                aria-expanded={open}
                aria-controls="vc-ses-{s.id}"
                aria-label="{open ? 'Hide' : 'Show'} tabs of {s.name}"
                onclick={() => toggle(s.id)}
              >
                <Icon name="chevron" size={14} />
              </button>
              <div class="meta">
                {#if renaming?.id === s.id}
                  <input
                    class="rename"
                    aria-label="Rename session"
                    maxlength="100"
                    value={renaming.value}
                    oninput={(e) => {
                      if (renaming) renaming.value = e.currentTarget.value;
                    }}
                    onkeydown={onRenameKey}
                    onblur={commitRename}
                    use:focusOnMount
                  />
                {:else}
                  <span class="name" title={s.name}>{s.name}</span>
                {/if}
                <span class="sub">
                  <time
                    datetime={new Date(s.createdAt).toISOString()}
                    title={new Date(s.createdAt).toLocaleString()}
                    >{relativeTime(s.createdAt, now)}</time
                  >
                  · {pluralize(tabs, 'tab')} · {pluralize(s.windows.length, 'window')}
                </span>
              </div>
            </div>

            <div class="strip" aria-hidden="true">
              {#each strip(s) as t, i (i)}<Favicon url={t.url} size={14} />{/each}
              {#if tabs > STRIP}<span class="more">+{tabs - STRIP}</span>{/if}
            </div>

            {#if confirmDelete === s.id}
              <div class="actions confirm" role="group" aria-label="Confirm delete">
                <span>Delete this session?</span>
                <Button variant="danger" onclick={() => remove(s)}>Delete</Button>
                <Button variant="text" onclick={() => (confirmDelete = null)}>Keep</Button>
              </div>
            {:else}
              <div class="actions" role="group" aria-label="Actions for {s.name}">
                <Button variant="tonal" onclick={() => restore(s, 'newWindow')}>Restore</Button>
                <Button variant="text" onclick={() => restore(s, 'currentWindow')}>Into this window</Button>
                <Button variant="text" onclick={() => startRename(s)}>Rename</Button>
                <Button variant="text" onclick={() => (confirmDelete = s.id)}>Delete</Button>
              </div>
            {/if}

            {#if open}
              <div class="tabs" id="vc-ses-{s.id}">
                {#each s.windows as w, wi (wi)}
                  {@const key = `${s.id}:${wi}`}
                  {@const limit = shown.get(key) ?? TAB_PAGE}
                  {#if s.windows.length > 1}
                    <h3>Window {wi + 1} · {pluralize(w.tabs.length, 'tab')}</h3>
                  {/if}
                  <ul class="tab-list">
                    {#each w.tabs.slice(0, limit) as t, ti (ti)}
                      {@const ok = isRestorableUrl(t.url)}
                      <li>
                        <button
                          type="button"
                          class="tab"
                          disabled={!ok}
                          title={ok ? t.url : `${t.url}\nCan’t be opened from here`}
                          onclick={() => void openTab(t.url)}
                        >
                          <Favicon url={t.url} />
                          <span class="tt">
                            <span class="t-title">{t.title || displayUrl(t.url)}</span>
                            <span class="t-url">{displayUrl(t.url)}</span>
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                  {#if w.tabs.length > limit}
                    <Button variant="text" onclick={() => more(key)}>Show {w.tabs.length - limit} more</Button>
                  {/if}
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </SegmentCard>

  <p class="sr" role="status" aria-live="polite">{status}</p>
</div>

<style>
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .panel :global(.card.fill) {
    min-height: 120px;
  }

  .save {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .name-row {
    display: flex;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

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

  .list.setups {
    height: auto;
    max-height: 240px;
  }

  .setup-meta {
    padding-left: 4px;
  }

  .item .setup-strip,
  .item .setup-actions {
    padding-left: 4px;
  }

  .message {
    margin: 0;
    padding: 12px var(--pad-card) 16px;
    color: var(--mOnSurfaceVariant);
  }

  .list {
    height: 100%;
    margin: 0;
    padding: 4px 6px 8px;
    list-style: none;
    overflow-y: auto;
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
    align-items: flex-start;
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

  .rename {
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--mPrimary);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: inherit;
    font-weight: 600;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 28px;
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
    padding-left: 24px;
  }

  .actions :global(button) {
    height: 26px;
    padding: 0 10px;
  }

  .confirm span {
    margin-right: 4px;
    font-size: 12px;
  }

  .tabs {
    margin-left: 24px;
    display: grid;
    gap: 2px;
  }

  h3 {
    margin: 6px 0 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--mOnSurfaceVariant);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .tab-list {
    margin: 0;
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

  .tab:active:not(:disabled) {
    background: var(--state-pressed);
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

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
