<script lang="ts">
import { browser } from 'wxt/browser';
import {
  type BackupConfig,
  type BackupStatus,
  CONFIG_KEY,
  DEFAULT_CONFIG,
  type Interval,
  parseConfig,
  STATUS_KEY,
} from '../../../background/backup/scheduler';
import Button from '../../components/controls/Button.svelte';
import Select from '../../components/controls/Select.svelte';
import TextInput from '../../components/controls/TextInput.svelte';

let cfg = $state<BackupConfig>({ ...DEFAULT_CONFIG });
let status = $state<BackupStatus>({});
let error = $state('');
let running = $state(false);

$effect(() => {
  const read = async () => {
    const s = await browser.storage.local.get([CONFIG_KEY, STATUS_KEY]);
    cfg = parseConfig(s[CONFIG_KEY]);
    status = (s[STATUS_KEY] ?? {}) as BackupStatus;
  };
  void read();
  const on = (_: unknown, area: string) => area === 'local' && void read();
  browser.storage.onChanged.addListener(on);
  return () => browser.storage.onChanged.removeListener(on);
});

async function save(next: BackupConfig): Promise<void> {
  error = '';
  try {
    // Requested on the click that enables it; the user gesture is required.
    if (
      next.interval !== 'off' &&
      !(await browser.permissions.request({ permissions: ['downloads'] }))
    )
      throw new Error('Automatic backups need permission to save files to your Downloads folder');
    await browser.storage.local.set({ [CONFIG_KEY]: next });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t save the backup schedule';
  }
}

async function runNow(): Promise<void> {
  running = true;
  error = '';
  try {
    if (!(await browser.permissions.request({ permissions: ['downloads'] })))
      throw new Error('Saving needs permission to use your Downloads folder');
    const r: BackupStatus = await browser.runtime.sendMessage({ type: 'runBackup' });
    if (r?.error) error = r.error;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Backup failed';
  } finally {
    running = false;
  }
}

const last = $derived(status.at ? new Date(status.at).toLocaleString() : 'never');
</script>

<div class="auto">
  <label for="vc-backup-interval">Automatic backups</label>
  <Select id="vc-backup-interval" value={cfg.interval} onchange={(v) => save({ ...cfg, interval: v as Interval })}>
    <option value="off">Off</option>
    <option value="daily">Daily</option>
    <option value="weekly">Weekly</option>
  </Select>
  {#if cfg.interval !== 'off'}
    <p class="hint">
      Saved to Downloads/Vertically Challenged Backups. Browsers can't delete old files for you, so
      clear out old backups yourself. Unchanged data is skipped. The passphrase below is kept on
      this device so backups can be encrypted without you.
    </p>
    <TextInput secret label="Automatic backup passphrase" placeholder="Passphrase (optional)" value={cfg.passphrase} oninput={(v) => save({ ...cfg, passphrase: v })} />
  {/if}
  <div class="row">
    <Button disabled={running} onclick={runNow}>{running ? 'Saving…' : 'Back up to Downloads now'}</Button>
  </div>
  <p class="hint" role="status">Last backup: {last}{status.name ? ` (${status.name})` : ''}</p>
  <p class="error" role="alert">{status.error && !error ? `Last run failed: ${status.error}` : error}</p>
</div>

<style>
  .auto { display: flex; flex-direction: column; gap: var(--gap); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .hint, .error { margin: 0; font-size: 12px; color: var(--mOnSurfaceVariant); }
  .error { color: var(--mError); }
  .error:empty { display: none; }
</style>
