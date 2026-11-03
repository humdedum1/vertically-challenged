<script lang="ts">
import { DEFAULT_THEME_ID } from '../../../themes/builtin';
import { contrastIssues } from '../../../themes/contrast';
import type { Theme } from '../../../themes/palette';
import { cleanName, exportTheme, importTheme, MAX_IMPORT_BYTES } from '../../../themes/transfer';
import Button from '../../components/controls/Button.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import {
  isCustomId,
  MAX_CUSTOM_THEMES,
  newCustomId,
  type ThemeRegistry,
} from '../../theme-registry.svelte';
import { downloadText, fileSafe } from './download';
import { SystemDark } from './system-dark.svelte';

interface Props {
  settings: SettingsState;
  themes: ThemeRegistry;
  /** Opens the editor on a theme; `origin` says which button to give focus back to. */
  onedit: (theme: Theme, origin: { id: string; action: 'edit' | 'duplicate' }) => void;
}

let { settings, themes, onedit }: Props = $props();

const system = new SystemDark();
$effect(system.start);

const mode = $derived(system.resolve(settings.value.appearance.mode));
const activeId = $derived(settings.value.appearance.themeId);

let status = $state('');
let error = $state('');
let notes = $state<string[]>([]);
let confirmId = $state<string | null>(null);
let moreId = $state<string | null>(null);
let fileInput: HTMLInputElement | undefined = $state();

function clear(): void {
  status = '';
  error = '';
  notes = [];
}

function use(t: Theme): void {
  clear();
  settings.update((s) => ({ ...s, appearance: { ...s.appearance, themeId: t.id } }));
  status = `Using ${t.name}.`;
}

function duplicate(t: Theme): void {
  clear();
  if (themes.custom.length >= MAX_CUSTOM_THEMES) {
    error = `You can keep up to ${MAX_CUSTOM_THEMES} custom themes`;
    return;
  }
  onedit(
    { ...t, id: newCustomId(), name: cleanName(`${t.name} copy`, 'Theme copy') },
    { id: t.id, action: 'duplicate' },
  );
}

function exportOne(t: Theme): void {
  clear();
  downloadText(`${fileSafe(t.name)}.json`, exportTheme(t));
  status = `Exported ${t.name}.`;
}

async function remove(t: Theme): Promise<void> {
  clear();
  confirmId = null;
  try {
    await themes.remove(t.id);
    // Don't leave a dangling id selected; resolve() would silently fall back anyway.
    if (activeId === t.id) {
      settings.update((s) => ({
        ...s,
        appearance: { ...s.appearance, themeId: DEFAULT_THEME_ID },
      }));
    }
    status = `Deleted ${t.name}.`;
  } catch {
    error = `Couldn’t delete ${t.name}.`;
  }
}

async function onFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
  const input = e.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  clear();
  if (file.size > MAX_IMPORT_BYTES) {
    error = 'File is too large to be a theme';
    return;
  }
  const r = importTheme(await file.text(), file.name, newCustomId());
  if (!r.ok) {
    error = r.error;
    return;
  }
  try {
    await themes.save(r.value);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t save the theme';
    return;
  }
  const issues = contrastIssues(r.value).length;
  status = `Imported “${r.value.name}”.`;
  notes = [
    ...r.warnings,
    ...(issues > 0
      ? [
          `${issues} text colour ${issues === 1 ? 'pair is' : 'pairs are'} below WCAG AA contrast; the theme editor lists them.`,
        ]
      : []),
  ];
}
</script>

<SegmentCard title="Themes">
  {#snippet icon()}<Icon name="palette" size={12} />{/snippet}
  <div class="body">
    <ul class="list" aria-label="Themes">
      {#each themes.all as t (t.id)}
        {@const custom = isCustomId(t.id)}
        {@const p = t[mode]}
        <li data-theme-id={t.id} class:active={t.id === activeId}>
          <div class="head">
            <!-- The whole row picks the theme; the rarer actions sit behind "More". -->
            <button
              type="button"
              class="pick"
              data-action="use"
              aria-pressed={t.id === activeId}
              aria-label="Use {t.name}"
              onclick={() => use(t)}
            >
              <span class="strip" aria-hidden="true">
                {#each [p.mPrimary, p.mSecondary, p.mTertiary, p.mSurface, p.mSurfaceVariant] as c, i (i)}
                  <span style:background={c}></span>
                {/each}
              </span>
              <span class="name">{t.name}</span>
              {#if t.id === activeId}<span class="inuse">In use</span>{:else if custom}<span class="badge custom">Custom</span>{/if}
            </button>
            <button
              type="button"
              class="more"
              aria-expanded={moreId === t.id}
              aria-label="More actions for {t.name}"
              onclick={() => { moreId = moreId === t.id ? null : t.id; confirmId = null; }}
            >More</button>
          </div>

          {#if confirmId === t.id}
            <div class="actions" role="group" aria-label="Confirm deleting {t.name}">
              <span class="ask">Delete “{t.name}”?</span>
              <Button variant="danger" onclick={() => remove(t)}>Delete</Button>
              <Button variant="text" onclick={() => (confirmId = null)}>Keep</Button>
            </div>
          {:else if moreId === t.id}
            <div class="actions" role="group" aria-label="{t.name} actions">
              <Button data-action="duplicate" aria-label="Duplicate {t.name}" onclick={() => duplicate(t)}>Duplicate</Button>
              {#if custom}
                <Button data-action="edit" aria-label="Edit {t.name}" onclick={() => { clear(); onedit(t, { id: t.id, action: 'edit' }); }}>Edit</Button>
              {/if}
              <Button data-action="export" aria-label="Export {t.name}" onclick={() => exportOne(t)}>Export</Button>
              {#if custom}
                <Button variant="danger" data-action="delete" aria-label="Delete {t.name}" onclick={() => (confirmId = t.id)}>Delete</Button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="import">
      <Button variant="primary" onclick={() => fileInput?.click()}>Import theme…</Button>
      <span class="count">{themes.custom.length}/{MAX_CUSTOM_THEMES} custom</span>
      <input
        bind:this={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Theme file"
        onchange={onFile}
      />
    </div>

    <p class="status" role="status">{status}</p>
    {#if notes.length > 0}
      <ul class="notes" aria-label="Import notes">
        {#each notes as n (n)}<li>{n}</li>{/each}
      </ul>
    {/if}
    <p class="error" role="alert">{error}</p>
  </div>
</SegmentCard>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  /* One grouped list: rows divided by hairlines, not a box per theme inside the card. */
  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: var(--radius-row);
    overflow: hidden;
  }

  .list > li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
  }

  .list > li + li {
    border-top: 1px solid var(--border);
  }

  /* With its "In use" badge, the theme in use is the tinted row. */
  .list > li.active {
    background: var(--state-selected);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pick:hover {
    background: var(--state-hover);
  }

  .more {
    flex: none;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--mOnSurfaceVariant);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .more:hover,
  .more[aria-expanded='true'] {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .strip {
    flex: none;
    display: flex;
  }

  .strip span {
    display: block;
    width: 16px;
    height: 16px;
    margin-left: -4px;
    border-radius: 50%;
    border: 1.5px solid var(--surface-0);
    box-shadow: 0 0 0 1px var(--border);
  }

  .strip span:first-child {
    margin-left: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .badge {
    flex: none;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--mOnSurfaceVariant);
    font-size: 10.5px;
  }

  .badge.custom {
    border-color: var(--mTertiary);
    color: var(--mOnSurface);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .ask {
    flex: 1;
    min-width: 0;
  }

  .inuse {
    flex: none;
    color: var(--mPrimary);
    font-size: 12px;
    font-weight: 600;
  }

  .import {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .count {
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .status,
  .error {
    margin: 0;
    font-size: 12px;
  }

  .status {
    color: var(--mOnSurfaceVariant);
  }

  .error {
    color: var(--mError);
  }

  .status:empty,
  .error:empty {
    display: none;
  }

  .notes {
    margin: 0;
    padding-left: 18px;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }
</style>
