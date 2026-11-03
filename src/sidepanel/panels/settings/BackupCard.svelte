<script lang="ts">
import { browser } from 'wxt/browser';
import { CONFIG_KEY, parseConfig } from '../../../background/backup/scheduler';
import type { RestoredFull } from '../../../backup/snapshot';
import { buildUndo, type RestoreUndo, UNDO_KEY } from '../../../backup/undo';
import { DEFAULT_SETTINGS } from '../../../settings/schema';
import { MAX_IMPORT_BYTES, parseBackup, type RestoredBackup } from '../../../themes/transfer';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import { isCustomId, type ThemeRegistry } from '../../theme-registry.svelte';
import AutoBackup from './AutoBackup.svelte';
import { downloadBytes, today } from './download';
import {
  createFullBackup,
  listRemoteBackups,
  openFullBackup,
  openRemoteBackup,
  restoreFullExtras,
} from './full-backup';

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
let passphrase = $state('');
// The same passphrase serves manual and automatic backups; prefill what this device saved.
$effect(() => {
  void browser.storage.local.get(CONFIG_KEY).then((s) => {
    const saved = parseConfig(s[CONFIG_KEY]).passphrase;
    if (saved && !passphrase) passphrase = saved;
  });
});
let fullPending = $state<RestoredFull | null>(null);
let fullFile = $state<File | null>(null);
let fullInput: HTMLInputElement | undefined = $state();

async function fullExport(): Promise<void> {
  if (exporting) return;
  exporting = true;
  clear();
  try {
    const r = await createFullBackup(settings.value, themes.custom, passphrase);
    downloadBytes(`vertically-challenged-full-${today()}.vcb`, r.bytes);
    status = `Full backup saved${passphrase ? ' (encrypted)' : ' (not encrypted)'}: settings, ${themes.custom.length} themes, ${r.layouts} layouts, ${r.sessions} sessions.`;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t create the backup';
  } finally {
    exporting = false;
  }
}

async function openFull(file: File): Promise<void> {
  clear();
  fullPending = null;
  const r = await openFullBackup(file, passphrase);
  if (!r.ok) {
    error = r.needsPassphrase
      ? 'This backup is encrypted: enter its passphrase above, then choose the file again.'
      : r.error;
    return;
  }
  fullFile = file;
  fullPending = r.value;
  warnings = r.warnings;
}

let remoteNames = $state<string[] | null>(null);
let remoteBusy = $state(false);

async function showRemote(): Promise<void> {
  clear();
  remoteBusy = true;
  try {
    remoteNames = await listRemoteBackups();
    if (!remoteNames.length) status = 'No backups found on the server yet.';
  } catch (err) {
    remoteNames = null;
    error = err instanceof Error ? err.message : 'Couldn’t reach the server';
  } finally {
    remoteBusy = false;
  }
}

async function openRemote(name: string): Promise<void> {
  clear();
  fullPending = null;
  remoteBusy = true;
  try {
    const r = await openRemoteBackup(name, passphrase);
    if (!r.ok) {
      error = r.needsPassphrase
        ? 'This backup is encrypted: enter its passphrase above, then pick it again.'
        : r.error;
      return;
    }
    fullFile = { name } as File;
    fullPending = r.value;
    warnings = r.warnings;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t download the backup';
  } finally {
    remoteBusy = false;
  }
}

async function onFullFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
  const input = e.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (file) await openFull(file);
}

let undo = $state<RestoreUndo | null>(null);
$effect(() => {
  void browser.storage.local.get(UNDO_KEY).then((s) => {
    undo = (s[UNDO_KEY] as RestoreUndo | undefined) ?? null;
  });
});

async function undoRestore(): Promise<void> {
  const u = undo;
  if (!u || applying) return;
  applying = true;
  clear();
  try {
    for (const t of u.themes) await themes.save(t);
    for (const id of u.addedThemeIds) await themes.remove(id);
    settings.update(() => u.settings);
    await browser.storage.local.set({ customCss: u.customCss });
    await browser.storage.local.remove(UNDO_KEY);
    undo = null;
    status =
      'Restore undone: settings, custom CSS and themes are back as they were. Sessions and setups the restore added stay; remove them in Sessions.';
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t undo the restore';
  } finally {
    applying = false;
  }
}

async function applyFull(): Promise<void> {
  const r = fullPending;
  if (!r || applying) return;
  applying = true;
  clear();
  try {
    const css = (await browser.storage.local.get('customCss')).customCss;
    const saved = buildUndo(
      {
        settings: $state.snapshot(settings.value),
        customCss: typeof css === 'string' ? css : '',
        themes: $state.snapshot(themes.custom) as typeof themes.custom,
      },
      r.themes,
    );
    await browser.storage.local.set({ [UNDO_KEY]: saved });
    undo = saved;
    const added = await restoreFullExtras(r);
    for (const t of r.themes) await themes.save(t);
    settings.update(() => r.settings);
    status = `Restored settings, ${r.themes.length} themes, ${r.layouts.length} layouts (as Window setups) and ${added} new sessions${added < r.sessions.length ? ` (${r.sessions.length - added} already existed or didn’t fit the limit)` : ''}. Existing sessions and setups were kept.`;
    fullPending = null;
    fullFile = null;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t restore the backup';
  } finally {
    applying = false;
  }
}

let fileInput: HTMLInputElement | undefined = $state();

function clear(): void {
  status = '';
  error = '';
  warnings = [];
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
    <section class="block" aria-labelledby="vc-bk-now">
      <h3 id="vc-bk-now">Back up now</h3>
      <Field label="Passphrase (encrypts the backup file)" for="vc-bk-pass">
        <TextInput id="vc-bk-pass" secret label="Backup passphrase" value={passphrase} oninput={(v) => (passphrase = v)} />
      </Field>
      <div class="row">
        <Button variant="primary" disabled={exporting || applying} onclick={fullExport}>{exporting ? 'Saving…' : 'Save full backup'}</Button>
        <Button disabled={exporting || applying} onclick={() => fullInput?.click()}>Restore full backup…</Button>
        <input
          bind:this={fullInput}
          type="file"
          accept=".vcb,application/octet-stream"
          hidden
          aria-label="Full backup file"
          onchange={onFullFile}
        />
      </div>
      <div class="row">
        <Button disabled={remoteBusy || applying} onclick={showRemote}>{remoteBusy ? 'Contacting server…' : 'Restore from server…'}</Button>
      </div>
      {#if remoteNames?.length}
        <ul class="remote" aria-label="Backups on the server">
          {#each remoteNames.slice(0, 10) as n (n)}
            <li><span>{n}</span><Button disabled={remoteBusy || applying} onclick={() => openRemote(n)}>Restore</Button></li>
          {/each}
        </ul>
      {/if}
      <details class="how">
        <summary>What a full backup contains</summary>
        <p class="hint">
          Settings, themes, Staples, pins, folders, Window setups, sessions and custom CSS.
          Without a passphrase the file lists every saved URL in plain form, and a lost passphrase
          can’t be recovered. Restoring adds to what you have: existing sessions and setups are
          kept, and incognito windows are never included.
        </p>
      </details>
      {#if fullPending}
        <div class="confirm" role="group" aria-label="Restore full backup">
          <p>Restore {fullFile?.name}: settings (replaced), {fullPending.themes.length} themes, {fullPending.layouts.length} layouts, {fullPending.sessions.length} sessions{fullPending.customCss ? ' and custom CSS (replaced)' : ''}?</p>
          <div class="row">
            <Button variant="primary" disabled={applying} onclick={applyFull}>Restore</Button>
            <Button variant="text" disabled={applying} onclick={() => { fullPending = null; fullFile = null; }}>Cancel</Button>
          </div>
        </div>
      {/if}
    </section>

    <section class="block" aria-labelledby="vc-bk-auto">
      <h3 id="vc-bk-auto">Automatic backups</h3>
      <AutoBackup {passphrase} />
    </section>

    <section class="block" aria-labelledby="vc-bk-import">
      <h3 id="vc-bk-import">Import and reset</h3>
      <div class="row">
        <Button disabled={exporting || applying} onclick={() => fileInput?.click()}>Import older settings &amp; themes backup…</Button>
        <input
          bind:this={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Backup file"
          onchange={onFile}
        />
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
        become a saved session you can restore from Sessions. Imported layouts appear in Sessions →
        Window setups.
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
    </section>

    {#if undo}
      <div class="row">
        <Button disabled={applying} onclick={undoRestore}>Undo last restore</Button>
        <span class="hint">from {new Date(undo.at).toLocaleString()}</span>
      </div>
    {/if}
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
  .remote {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
  }

  .remote li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .remote span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .block + .block {
    padding-top: var(--gap);
    border-top: 1px solid var(--border);
  }

  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .how summary {
    cursor: pointer;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }

  .how p {
    margin-top: 6px;
  }

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
