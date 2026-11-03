<script lang="ts">
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS } from '../../../settings/schema';
import type { WindowLayout } from '../../../shared/layout';
import {
  createBackup,
  MAX_IMPORT_BYTES,
  parseBackup,
  type RestoredBackup,
} from '../../../themes/transfer';
import Button from '../../components/controls/Button.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import { isCustomId, type ThemeRegistry } from '../../theme-registry.svelte';
import { downloadText, today } from './download';

let { settings, themes }: { settings: SettingsState; themes: ThemeRegistry } = $props();

let status = $state('');
let error = $state('');
let warnings = $state<string[]>([]);
let pending = $state<RestoredBackup | null>(null);
let confirmReset = $state(false);
let applying = $state(false);
let exporting = $state(false);
const summary = $derived(
  pending
    ? `Restores settings, ${pending.themes.length} ${pending.themes.length === 1 ? 'theme' : 'themes'} and ${pending.layouts.length} pinned ${pending.layouts.length === 1 ? 'layout' : 'layouts'} as saved Window setups.`
    : '',
);
let fileInput: HTMLInputElement | undefined = $state();

function clear(): void {
  status = '';
  error = '';
  warnings = [];
}

async function exportBackup(): Promise<void> {
  if (exporting) return;
  exporting = true;
  clear();
  try {
    const result: { ok: boolean; layouts: WindowLayout[]; error?: string } =
      await browser.runtime.sendMessage({ type: 'backupLayouts' });
    if (!result?.ok) throw new Error(result?.error ?? 'Couldn’t read pinned layouts');
    const text = createBackup(settings.value, themes.custom, new Date(), result.layouts);
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
      throw new Error('Backup exceeds the file size limit; no file was exported');
    downloadText(`vertically-challenged-backup-${today()}.json`, text);
    status = `Exported settings, ${themes.custom.length} custom themes and ${result.layouts.length} pinned layouts.`;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t export the backup';
  } finally {
    exporting = false;
  }
}

async function onFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
  const input = e.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  clear();
  pending = null;
  if (file.size > MAX_IMPORT_BYTES) {
    error = 'File is too large to be a backup';
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    error = 'Couldn’t read the backup file';
    return;
  }
  const r = parseBackup(text, isCustomId);
  if (!r.ok) {
    error = r.error;
    return;
  }
  pending = r.value;
  warnings = r.warnings;
}

let tabsInput: HTMLInputElement | undefined = $state();

/** Another tab manager's export (Sidebery, SideTab Pro, VertiTab, OneTab…) → a saved session. */
async function onTabsFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
  const input = e.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  clear();
  try {
    const result: { ok: boolean; count?: number; error?: string } =
      await browser.runtime.sendMessage({
        type: 'importTabs',
        text: await file.text(),
        name: `Imported: ${file.name.replace(/\.[^.]+$/, '')}`,
      });
    if (!result?.ok) throw new Error(result?.error ?? 'Couldn’t import tabs');
    status = `Imported ${result.count} tabs as a saved session (see Sessions).`;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t import tabs';
  }
}

async function apply(): Promise<void> {
  const restored = pending;
  if (!restored || applying) return;
  applying = true;
  clear();
  try {
    if (restored.layouts.length) {
      const result: { ok: boolean; error?: string } = await browser.runtime.sendMessage({
        type: 'restoreBackupLayouts',
        layouts: $state.snapshot(restored.layouts),
      });
      if (!result?.ok) throw new Error(result?.error ?? 'Couldn’t restore pinned layouts');
    }
    for (const t of restored.themes) await themes.save(t);
    settings.update(() => restored.settings);
    const n = restored.themes.length;
    status = `Restored settings, ${n} ${n === 1 ? 'theme' : 'themes'} and ${restored.layouts.length} pinned ${restored.layouts.length === 1 ? 'layout' : 'layouts'} in Window setups.`;
    pending = null;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t restore the backup';
  } finally {
    applying = false;
  }
}

function reset(): void {
  clear();
  confirmReset = false;
  settings.update(() => structuredClone(DEFAULT_SETTINGS));
  status = 'Settings reset to defaults. Custom themes were kept.';
}
</script>

<SegmentCard title="Backup">
  {#snippet icon()}<Icon name="settings" size={12} />{/snippet}
  <div class="body">
    <div class="row">
      <Button disabled={exporting || applying} onclick={exportBackup}>{exporting ? 'Exporting…' : 'Export backup'}</Button>
      <Button disabled={exporting || applying} onclick={() => fileInput?.click()}>Import backup…</Button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Backup file"
        onchange={onFile}
      />
    </div>
    <div class="row">
      <Button disabled={exporting || applying} onclick={() => tabsInput?.click()}>
        Import tabs from another extension…
      </Button>
      <input
        bind:this={tabsInput}
        type="file"
        accept=".json,.md,.txt,.html,.htm,application/json,text/plain,text/markdown,text/html"
        hidden
        aria-label="Tab export file"
        onchange={onTabsFile}
      />
    </div>
    <p class="hint">
      Sidebery, SideTab Pro, VertiTab and OneTab exports, bookmark files and plain URL lists
      become a saved session you can restore from Sessions.
    </p>

    {#if pending}
      <div class="confirm" role="group" aria-label="Restore backup">
        <p>{summary} Your current settings are replaced; custom themes with the same id are overwritten and the rest are kept. Existing windows and setups are kept.</p>
        <div class="row">
          <Button variant="primary" disabled={applying} onclick={apply}>Apply</Button>
          <Button variant="text" disabled={applying} onclick={() => (pending = null)}>Cancel</Button>
        </div>
      </div>
    {/if}

    <p class="status">Includes Staples, pinned tabs, nested folders and saved Window setups. Incognito layouts are excluded. Imported layouts are available in Sessions → Window setups.</p>

    <div class="row">
      {#if confirmReset}
        <div class="confirm" role="group" aria-label="Confirm reset">
          <p>Reset all settings to their defaults? Custom themes are kept.</p>
          <div class="row">
            <Button variant="danger" onclick={reset}>Reset</Button>
            <Button variant="text" onclick={() => (confirmReset = false)}>Keep settings</Button>
          </div>
        </div>
      {:else}
        <Button variant="danger" onclick={() => (confirmReset = true)}>Reset to defaults</Button>
      {/if}
    </div>

    <p class="status" role="status">{status}</p>
    {#if warnings.length > 0}
      <ul class="notes" aria-label="Backup notes">
        {#each warnings as w (w)}<li>{w}</li>{/each}
      </ul>
    {/if}
    <p class="error" role="alert">{error}</p>
  </div>
</SegmentCard>

<style>
  .hint {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .confirm {
    flex: 1;
    padding: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-row);
    background: var(--surface-0);
  }

  .confirm p {
    margin: 0 0 8px;
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
