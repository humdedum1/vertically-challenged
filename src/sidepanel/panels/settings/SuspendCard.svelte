<script lang="ts">
import { ARCHIVE_DAYS, LIMITS, type SuspendSettings } from '../../../settings/schema';
import { normalizeHostPattern } from '../../../shared/host-pattern';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import Select from '../../components/controls/Select.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import type { TabState } from '../../tab-state.svelte';

let { settings, tabState }: { settings: SettingsState; tabState: TabState } = $props();

const su = $derived(settings.value.suspend);

function patch(p: Partial<SuspendSettings>): void {
  settings.update((s) => ({ ...s, suspend: { ...s.suspend, ...p } }));
}

function span(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// The field keeps its own text so a half-typed value ("1" on the way to "15") isn't
// clamped under the user's fingers; it snaps to the stored value on blur.
let minutesText = $state<string | null>(null);
const minutesShown = $derived(minutesText ?? String(su.minutes));

function onMinutes(raw: string): void {
  minutesText = raw;
  const n = Number(raw);
  if (
    raw.trim() !== '' &&
    Number.isInteger(n) &&
    n >= LIMITS.suspendMinutes.min &&
    n <= LIMITS.suspendMinutes.max
  ) {
    patch({ minutes: n });
  }
}

let entry = $state('');
let entryError = $state('');
const full = $derived(su.whitelist.length >= LIMITS.whitelist);

function add(): void {
  const raw = entry.trim();
  if (raw === '') return;
  const host = normalizeHostPattern(raw);
  if (host === null) entryError = 'Enter a site like example.com or *.example.com';
  else if (su.whitelist.includes(host)) entryError = `${host} is already in the list`;
  else if (full) entryError = `The list is limited to ${LIMITS.whitelist} sites`;
  else {
    patch({ whitelist: [...su.whitelist, host] });
    entry = '';
    entryError = '';
  }
}

function remove(host: string): void {
  patch({ whitelist: su.whitelist.filter((h) => h !== host) });
}

const active = $derived(tabState.tabs.find((t) => t.active));
let done = $state('');

function suspendOthers(): void {
  if (!active) return;
  tabState.send({ type: 'discardOthers', tabId: active.id });
  done = 'Suspending the other tabs in this window.';
}
</script>

<SegmentCard title="Suspending">
  {#snippet icon()}<Icon name="list" size={12} />{/snippet}
  <div class="fields">
    <p class="muted">Suspended tabs free memory and reload when you click them.</p>

    <Toggle
      label="Suspend inactive tabs"
      hint="Background tabs are discarded after a while"
      checked={su.auto}
      onchange={(auto) => patch({ auto })}
    />

    <Field label="Inactive for" for="vc-suspend-minutes">
      <div class="minutes">
        <input
          id="vc-suspend-minutes"
          type="number"
          inputmode="numeric"
          min={LIMITS.suspendMinutes.min}
          max={LIMITS.suspendMinutes.max}
          value={minutesShown}
          disabled={!su.auto}
          aria-describedby="vc-suspend-after"
          oninput={(e) => onMinutes(e.currentTarget.value)}
          onblur={() => (minutesText = null)}
        />
        <span id="vc-suspend-after" class="muted">minutes · after {span(su.minutes)}</span>
      </div>
    </Field>

    <Toggle
      label="Keep pinned tabs"
      checked={su.skipPinned}
      disabled={!su.auto}
      hint={su.auto ? undefined : 'Turn on automatic suspending first'}
      onchange={(skipPinned) => patch({ skipPinned })}
    />
    <Toggle
      label="Keep tabs playing audio"
      checked={su.skipAudible}
      disabled={!su.auto}
      hint={su.auto ? undefined : 'Turn on automatic suspending first'}
      onchange={(skipAudible) => patch({ skipAudible })}
    />

    <Field label="Archive tabs not opened for" for="vc-archive-days">
      <Select id="vc-archive-days" value={String(su.archiveDays)} onchange={(v) => patch({ archiveDays: Number(v) })}>
        {#each ARCHIVE_DAYS as d}
          <option value={String(d)}>{d === 0 ? 'Off' : `${d} days`}</option>
        {/each}
      </Select>
      <p class="muted">
        Saves them to the “Archived tabs” session in Sessions, then closes them. Pinned tabs,
        tabs playing audio and the sites below are kept.
      </p>
    </Field>

    <Field label="Never suspend these sites" for="vc-whitelist-add">
      {#if su.whitelist.length > 0}
        <ul class="list" aria-label="Never suspended sites">
          {#each su.whitelist as host (host)}
            <li>
              <span class="host">{host}</span>
              <button type="button" class="x" aria-label="Remove {host}" onclick={() => remove(host)}>
                <Icon name="close" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No sites yet.</p>
      {/if}
      <div class="add">
        <TextInput
          id="vc-whitelist-add"
          label="Add a site"
          value={entry}
          placeholder="*.example.com"
          invalid={entryError !== ''}
          describedby="vc-whitelist-err"
          oninput={(v) => {
            entry = v;
            entryError = '';
          }}
          onenter={add}
        />
        <Button variant="tonal" disabled={entry.trim() === '' || full} onclick={add}>Add</Button>
      </div>
      <p id="vc-whitelist-err" class="error" role="alert">{entryError}</p>
    </Field>

    <div class="now">
      <Button variant="tonal" disabled={!active || tabState.tabs.length < 2} onclick={suspendOthers}>
        Suspend all other tabs now
      </Button>
      <span class="muted" role="status">{done}</span>
    </div>
  </div>
</SegmentCard>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .muted {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
  }

  .minutes {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .minutes input {
    width: 84px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }

  .minutes input:disabled {
    opacity: 0.55;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 0 4px 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-row);
    background: var(--surface-0);
  }

  .host {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
  }

  .x:hover {
    background: var(--state-hover);
    color: var(--mError);
  }

  .add {
    display: flex;
    gap: 6px;
  }

  .error {
    margin: 0;
    color: var(--mError);
    font-size: calc(var(--font-size) - 1px);
  }

  .error:empty {
    display: none;
  }

  .now {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .now .muted:empty {
    display: none;
  }
</style>
