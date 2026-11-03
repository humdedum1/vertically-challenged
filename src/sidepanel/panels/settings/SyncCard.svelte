<script lang="ts">
import { onMount } from 'svelte';
import { browser } from 'wxt/browser';
import { SYNC_INTERVALS } from '../../../settings/schema';
import { SYNC_QUOTA } from '../../../shared/sync';
import {
  DEVICE_KEY,
  DEVICE_PREFIX,
  readSync,
  SYNC_STATUS_KEY,
  type SyncStatus,
} from '../../../shared/sync-store';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import Select from '../../components/controls/Select.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import type { TabState } from '../../tab-state.svelte';
import { pluralize, relativeTime } from '../sessions/relative-time';

let { settings, tabState }: { settings: SettingsState; tabState: TabState } = $props();

let status = $state.raw<Partial<SyncStatus>>({});
let deviceName = $state('');
let nameDraft = $state('');
let others = $state.raw<{ id: string; name: string; updatedAt: number }[]>([]);
let confirmForget = $state<string | null>(null);
let now = $state(Date.now());
let syncing = $state(false);

async function load(): Promise<void> {
  const [local, all] = await Promise.all([
    browser.storage.local.get([DEVICE_KEY, SYNC_STATUS_KEY]),
    browser.storage.sync.get(null),
  ]);
  status = (local[SYNC_STATUS_KEY] ?? {}) as Partial<SyncStatus>;
  const me = local[DEVICE_KEY] as { id?: string; name?: string } | undefined;
  if (me?.name && me.name !== deviceName) {
    deviceName = me.name;
    nameDraft = me.name;
  }
  const snap = await readSync(all);
  others = [...snap.headers]
    .filter(([id]) => id !== me?.id)
    .map(([id, h]) => ({ id, name: h.name || 'Another device', updatedAt: h.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

onMount(() => {
  void load();
  const onChanged = (changes: Record<string, unknown>, area: string) => {
    const keys = Object.keys(changes);
    if (
      (area === 'local' && (DEVICE_KEY in changes || SYNC_STATUS_KEY in changes)) ||
      (area === 'sync' && keys.some((k) => k.startsWith(DEVICE_PREFIX)))
    )
      void load();
  };
  browser.storage.onChanged.addListener(onChanged);
  const timer = setInterval(() => (now = Date.now()), 30_000);
  return () => {
    browser.storage.onChanged.removeListener(onChanged);
    clearInterval(timer);
  };
});

const prefs = $derived(settings.value.sync);
const off = $derived(!prefs.workspaces && !prefs.sessions);
const kb = (b: number) => `${Math.max(1, Math.round(b / 1024))} KB`;
const omitted = $derived((status.omitted?.workspaces ?? 0) + (status.omitted?.sessions ?? 0));

function rename(): void {
  const next = nameDraft.trim();
  if (!next || next === deviceName) return;
  tabState.send({ type: 'syncRename', name: next });
}

function syncNow(): void {
  syncing = true;
  tabState.send({ type: 'syncNow' });
  // The status write ends it; a failure shows in the status line as well.
  setTimeout(() => (syncing = false), 1500);
}

function forget(id: string): void {
  tabState.send({ type: 'syncForget', deviceId: id });
  confirmForget = null;
}

function setPref(key: 'workspaces' | 'sessions', value: boolean): void {
  settings.update((s) => ({ ...s, sync: { ...s.sync, [key]: value } }));
}
</script>

<SegmentCard title="Sync">
  {#snippet icon()}<Icon name="sync" size={12} />{/snippet}
  <div class="fields">
    <p class="muted">
      Through Chrome Sync, so your other computers signed in to the same Google account see this one.
      Settings and themes always sync.
    </p>

    <Toggle
      label="Sync workspaces"
      hint="Each window’s tabs, groups, Staples, pinned tabs and folders, and window setups"
      checked={prefs.workspaces}
      onchange={(v) => setPref('workspaces', v)}
    />

    <Field label="Automatic sync" for="vc-sync-interval">
      <Select id="vc-sync-interval" value={String(prefs.intervalMinutes)} onchange={(v) => settings.update((s) => ({ ...s, sync: { ...s.sync, intervalMinutes: Number(v) } }))}>
        {#each SYNC_INTERVALS as minutes}
          <option value={String(minutes)}>{minutes === 0 ? 'Manual only' : `Every ${minutes} minute${minutes === 1 ? '' : 's'}`}</option>
        {/each}
      </Select>
      <p class="muted">Applies to workspace and session snapshots. Chrome controls delivery to other devices; settings and themes sync whenever changed. Synced tabs open only when you choose to restore them.</p>
    </Field>
    <Toggle
      label="Sync saved sessions"
      hint="As many as fit in Chrome’s sync storage, newest first"
      checked={prefs.sessions}
      onchange={(v) => setPref('sessions', v)}
    />

    <Field label="This device’s name" for="vc-device-name">
      <form
        class="name-row"
        onsubmit={(e) => {
          e.preventDefault();
          rename();
        }}
      >
        <TextInput id="vc-device-name" label="This device’s name" value={nameDraft} oninput={(v) => (nameDraft = v)} maxlength={40} />
        {#if nameDraft.trim() && nameDraft.trim() !== deviceName}
          <Button variant="tonal" type="submit">Rename</Button>
        {/if}
      </form>
    </Field>

    <div class="status" role="status" aria-live="polite">
      {#if off}
        <span>Not sharing anything from this device.</span>
      {:else if status.error}
        <span class="error">{status.error}</span>
      {:else if status.publishedAt}
        <span>
          Synced {relativeTime(status.publishedAt, now)} · {kb(status.used ?? 0)} of {kb(SYNC_QUOTA)} sync storage
          used, {kb(status.bytes ?? 0)} by this device
        </span>
      {:else}
        <span>Not synced yet</span>
      {/if}
      {#if !off && omitted > 0}
        <span class="warn">{pluralize(omitted, 'item')} didn’t fit and aren’t shared (the oldest go first).</span>
      {/if}
      {#if !off}
        <Button variant="text" disabled={syncing} onclick={syncNow}>{syncing ? 'Syncing…' : 'Sync now'}</Button>
      {/if}
    </div>

    {#if others.length > 0}
      <Field label="Other devices">
        <ul class="devices" aria-label="Other devices">
          {#each others as d (d.id)}
            <li>
              <span class="dev">
                <span class="dev-name">{d.name}</span>
                <span class="dev-sub">last seen {relativeTime(d.updatedAt, now)}</span>
              </span>
              {#if confirmForget === d.id}
                <Button variant="danger" onclick={() => forget(d.id)}>Forget</Button>
                <Button variant="text" onclick={() => (confirmForget = null)}>Keep</Button>
              {:else}
                <Button variant="text" onclick={() => (confirmForget = d.id)}>Forget</Button>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="muted">
          Forgetting removes what that device shared. It shares again the next time it syncs, unless its own switches are off.
        </p>
      </Field>
    {/if}
  </div>
</SegmentCard>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: calc(var(--gap) + 4px);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .muted {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }

  .name-row {
    display: flex;
    gap: 6px;
  }

  .name-row :global(input) {
    flex: 1;
    min-width: 0;
  }

  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    font-size: 12px;
    color: var(--mOnSurfaceVariant);
  }

  .error {
    color: var(--mError);
  }

  .warn {
    color: var(--mTertiary);
  }

  .devices {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-row);
    background: var(--surface-0);
    overflow: hidden;
  }

  .devices li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 4px 8px 4px 12px;
  }

  .devices li + li {
    border-top: 1px solid var(--border);
  }

  .dev {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .dev-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .dev-sub {
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
  }
</style>
