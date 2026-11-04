<script lang="ts">
import { browser } from 'wxt/browser';
import {
  type BackupConfig,
  type BackupStatus,
  CONFIG_KEY,
  DEFAULT_CONFIG,
  type Interval,
  parseConfig,
  requiredAccess,
  STATUS_KEY,
  type TargetKind,
} from '../../../background/backup/scheduler';
import {
  authUrl,
  codeFromRedirect,
  DROPBOX_ORIGINS,
  exchangeCode,
  newPkce,
} from '../../../backup/dropbox';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import Select from '../../components/controls/Select.svelte';
import TextInput from '../../components/controls/TextInput.svelte';

/** Shared with the manual backup in BackupCard; saved with these settings. */
let { passphrase }: { passphrase: string } = $props();

let cfg = $state<BackupConfig>(structuredClone(DEFAULT_CONFIG));
let status = $state<BackupStatus>({});
let error = $state('');
let running = $state(false);
let saved = $state(false);

$effect(() => {
  const read = async (config: boolean) => {
    const s = await browser.storage.local.get([CONFIG_KEY, STATUS_KEY]);
    // Status changes while a run is going must not wipe fields the user is typing.
    if (config) cfg = parseConfig(s[CONFIG_KEY]);
    status = (s[STATUS_KEY] ?? {}) as BackupStatus;
  };
  void read(true);
  const on = (c: Record<string, unknown>, area: string) =>
    area === 'local' && void read(CONFIG_KEY in c);
  browser.storage.onChanged.addListener(on);
  return () => browser.storage.onChanged.removeListener(on);
});

/** Runs on a click, because permission requests need a user gesture. */
async function save(next: BackupConfig): Promise<void> {
  error = '';
  saved = false;
  try {
    if (next.interval !== 'off' || next.target !== 'downloads') {
      if (!(await browser.permissions.request(requiredAccess(next) as never)))
        throw new Error('Permission was not granted, so nothing was saved');
    }
    await browser.storage.local.set({ [CONFIG_KEY]: parseConfig({ ...next, passphrase }) });
    saved = true;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t save the backup settings';
  }
}

async function connectDropbox(): Promise<void> {
  error = '';
  saved = false;
  try {
    const appKey = cfg.dropbox.appKey.trim();
    if (!appKey) throw new Error('Enter your Dropbox app key first');
    if (
      !(await browser.permissions.request({ permissions: ['identity'], origins: DROPBOX_ORIGINS }))
    )
      throw new Error('Permission was not granted');
    const redirect = browser.identity.getRedirectURL();
    const p = await newPkce();
    const back = await browser.identity.launchWebAuthFlow({
      url: authUrl(appKey, redirect, p.challenge, p.state),
      interactive: true,
    });
    if (!back) throw new Error('Dropbox sign-in was cancelled');
    const refreshToken = await exchangeCode(
      appKey,
      codeFromRedirect(back, p.state),
      p.verifier,
      redirect,
    );
    await save({ ...cfg, dropbox: { appKey, refreshToken } });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Couldn’t connect to Dropbox';
  }
}

async function runNow(): Promise<void> {
  running = true;
  error = '';
  try {
    // Ask first, whatever the schedule: this click is the user gesture the prompt needs.
    if (!(await browser.permissions.request(requiredAccess(cfg) as never)))
      throw new Error('Permission was not granted');
    // Back up with what is on screen, not an older saved version.
    await save(cfg);
    if (error) return;
    const r: BackupStatus = await browser.runtime.sendMessage({ type: 'runBackup' });
    if (r?.error) error = r.error;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Backup failed';
  } finally {
    running = false;
  }
}

const last = $derived(status.at ? new Date(status.at).toLocaleString() : 'never');
const redirectUri = browser.identity?.getRedirectURL?.() ?? '';
const insecure = $derived(
  (cfg.target === 'webdav' && cfg.webdav.url.startsWith('http:')) ||
    (cfg.target === 's3' && cfg.s3.endpoint.startsWith('http:')),
);
const remote = $derived(cfg.target !== 'downloads');
</script>

<div class="auto" data-sf-group>
  <Field label="Where to save" for="vc-backup-target">
    <Select id="vc-backup-target" value={cfg.target} onchange={(v) => (cfg.target = v as TargetKind)}>
      <option value="downloads">Downloads folder</option>
      <option value="webdav">WebDAV (Nextcloud, ownCloud…)</option>
      <option value="s3">S3-compatible (AWS, R2, B2, MinIO…)</option>
      <option value="dropbox">Dropbox</option>
    </Select>
  </Field>

  {#if cfg.target === 'webdav'}
    <Field label="Folder URL" for="vc-wd-url">
      <TextInput id="vc-wd-url" label="WebDAV folder URL" placeholder="https://cloud.example.com/remote.php/dav/files/me/Backups" mono value={cfg.webdav.url} oninput={(v) => (cfg.webdav.url = v)} />
    </Field>
    <Field label="User" for="vc-wd-user">
      <TextInput id="vc-wd-user" label="WebDAV user" value={cfg.webdav.user} oninput={(v) => (cfg.webdav.user = v)} />
    </Field>
    <Field label="Password (use an app password)" for="vc-wd-pass">
      <TextInput id="vc-wd-pass" secret label="WebDAV password" value={cfg.webdav.password} oninput={(v) => (cfg.webdav.password = v)} />
    </Field>
  {:else if cfg.target === 'dropbox'}
    <p class="hint">
      Create an “App folder” app at dropbox.com/developers/apps (scoped access, permissions
      files.content.write and files.content.read), add <code>{redirectUri}</code> as a redirect URI,
      then paste its app key. Backups go to Apps/&lt;your app&gt; only.
    </p>
    <Field label="Dropbox app key" for="vc-db-key">
      <TextInput id="vc-db-key" label="Dropbox app key" mono value={cfg.dropbox.appKey} oninput={(v) => (cfg.dropbox.appKey = v)} />
    </Field>
    <div class="row">
      <Button onclick={connectDropbox}>{cfg.dropbox.refreshToken ? 'Reconnect Dropbox' : 'Connect Dropbox'}</Button>
      <span class="hint">{cfg.dropbox.refreshToken ? 'Connected' : 'Not connected'}</span>
    </div>
  {:else if cfg.target === 's3'}
    <Field label="Endpoint" for="vc-s3-endpoint">
      <TextInput id="vc-s3-endpoint" label="S3 endpoint" placeholder="https://s3.eu-west-1.amazonaws.com" mono value={cfg.s3.endpoint} oninput={(v) => (cfg.s3.endpoint = v)} />
    </Field>
    <Field label="Region (use auto for R2)" for="vc-s3-region">
      <TextInput id="vc-s3-region" label="S3 region" value={cfg.s3.region} oninput={(v) => (cfg.s3.region = v)} />
    </Field>
    <Field label="Bucket" for="vc-s3-bucket">
      <TextInput id="vc-s3-bucket" label="S3 bucket" value={cfg.s3.bucket} oninput={(v) => (cfg.s3.bucket = v)} />
    </Field>
    <Field label="Folder (optional)" for="vc-s3-prefix">
      <TextInput id="vc-s3-prefix" label="S3 folder prefix" value={cfg.s3.prefix} oninput={(v) => (cfg.s3.prefix = v)} />
    </Field>
    <Field label="Access key" for="vc-s3-access">
      <TextInput id="vc-s3-access" label="S3 access key" mono value={cfg.s3.accessKey} oninput={(v) => (cfg.s3.accessKey = v)} />
    </Field>
    <Field label="Secret key" for="vc-s3-secret">
      <TextInput id="vc-s3-secret" secret label="S3 secret key" mono value={cfg.s3.secretKey} oninput={(v) => (cfg.s3.secretKey = v)} />
    </Field>
  {/if}

  <Field label="How often" for="vc-backup-interval">
    <Select id="vc-backup-interval" value={cfg.interval} onchange={(v) => (cfg.interval = v as Interval)}>
      <option value="off">Off</option>
      <option value="daily">Daily</option>
      <option value="weekly">Weekly</option>
    </Select>
  </Field>
  {#if remote}
    <Field label="Copies to keep" for="vc-backup-keep">
      <Select id="vc-backup-keep" value={String(cfg.keep)} onchange={(v) => (cfg.keep = Number(v))}>
        {#each [3, 7, 14, 30] as n}<option value={String(n)}>{n}</option>{/each}
      </Select>
    </Field>
  {/if}

  {#if insecure}
    <p class="error" role="alert">
      This address uses http://, so your login and backup travel unencrypted. Use https:// unless
      the server is on a network you fully trust, and set a passphrase.
    </p>
  {/if}
  <details class="how">
    <summary>How automatic backups work</summary>
    <p class="hint">
      {#if remote}
        Only the server you choose is contacted; the browser asks permission for that address
        alone. Copies beyond the number to keep are deleted from that folder (only files named
        vc-backup-….vcb). Without a passphrase the server can read every saved URL.
      {:else}
        Saved to Downloads/Vertically Challenged Backups. Browsers can’t delete old files for you.
      {/if}
      Unchanged data is skipped. Credentials and the passphrase stay on this device in plain form,
      and are never synced or included in a backup.
    </p>
  </details>

  <div class="row">
    <Button variant="primary" onclick={() => save(cfg)}>Save schedule</Button>
    <Button disabled={running} onclick={runNow}>{running ? 'Backing up…' : 'Back up now'}</Button>
  </div>
  <p class="hint" role="status">{saved ? 'Saved. ' : ''}Last backup: {last}{status.name ? ` (${status.name})` : ''}</p>
  <p class="error" role="alert">{status.error && !error ? `Last run failed: ${status.error}` : error}</p>
</div>

<style>
  .auto { display: flex; flex-direction: column; gap: var(--gap); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .hint, .error { margin: 0; font-size: calc(var(--font-size) - 1px); color: var(--mOnSurfaceVariant); }
  .error { color: var(--mError); }
  .error:empty { display: none; }
  .how summary { cursor: pointer; font-size: calc(var(--font-size) - 1px); color: var(--mOnSurfaceVariant); }
  .how p { margin-top: 6px; }
</style>
