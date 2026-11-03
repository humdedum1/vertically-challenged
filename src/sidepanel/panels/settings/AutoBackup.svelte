<script lang="ts">
import { browser } from 'wxt/browser';
import {
  type BackupConfig,
  type BackupStatus,
  CONFIG_KEY,
  DEFAULT_CONFIG,
  type Interval,
  originPattern,
  parseConfig,
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
import Select from '../../components/controls/Select.svelte';
import TextInput from '../../components/controls/TextInput.svelte';

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

/** The permission to ask for with the current settings, or an error for incomplete ones. */
function needed(c: BackupConfig): { permissions?: string[]; origins?: string[] } {
  if (c.target === 'downloads') return { permissions: ['downloads'] };
  if (c.target === 'dropbox') {
    if (!c.dropbox.refreshToken) throw new Error('Connect Dropbox first');
    return { origins: DROPBOX_ORIGINS };
  }
  const server = c.target === 'webdav' ? c.webdav.url : c.s3.endpoint;
  const origin = originPattern(server);
  if (!origin) throw new Error('Enter a valid http(s) server address first');
  if (c.target === 'webdav' && !(c.webdav.user && c.webdav.password))
    throw new Error('Enter the WebDAV user and password');
  if (c.target === 's3' && !(c.s3.bucket && c.s3.accessKey && c.s3.secretKey))
    throw new Error('Enter the bucket, access key and secret key');
  return { origins: [origin] };
}

/** Runs on a click, because permission requests need a user gesture. */
async function save(next: BackupConfig): Promise<void> {
  error = '';
  saved = false;
  try {
    if (next.interval !== 'off' || next.target !== 'downloads') {
      if (!(await browser.permissions.request(needed(next) as never)))
        throw new Error('Permission was not granted, so nothing was saved');
    }
    await browser.storage.local.set({ [CONFIG_KEY]: parseConfig(next) });
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

<div class="auto">
  <label for="vc-backup-target">Automatic backups: where</label>
  <Select id="vc-backup-target" value={cfg.target} onchange={(v) => (cfg.target = v as TargetKind)}>
    <option value="downloads">Downloads folder</option>
    <option value="webdav">WebDAV (Nextcloud, ownCloud…)</option>
    <option value="s3">S3-compatible (AWS, R2, B2, MinIO…)</option>
    <option value="dropbox">Dropbox</option>
  </Select>

  {#if cfg.target === 'webdav'}
    <TextInput label="WebDAV folder URL" placeholder="https://cloud.example.com/remote.php/dav/files/me/Backups" mono value={cfg.webdav.url} oninput={(v) => (cfg.webdav.url = v)} />
    <TextInput label="WebDAV user" placeholder="User" value={cfg.webdav.user} oninput={(v) => (cfg.webdav.user = v)} />
    <TextInput secret label="WebDAV password" placeholder="Password (use an app password)" value={cfg.webdav.password} oninput={(v) => (cfg.webdav.password = v)} />
  {:else if cfg.target === 'dropbox'}
    <p class="hint">
      Create an "App folder" app at dropbox.com/developers/apps (scoped access, permissions
      files.content.write, files.content.read), add <code>{redirectUri}</code> as a redirect URI, then paste its app key.
      Backups go to Apps/&lt;your app&gt; only.
    </p>
    <TextInput label="Dropbox app key" placeholder="App key" mono value={cfg.dropbox.appKey} oninput={(v) => (cfg.dropbox.appKey = v)} />
    <div class="row">
      <Button onclick={connectDropbox}>{cfg.dropbox.refreshToken ? 'Reconnect Dropbox' : 'Connect Dropbox'}</Button>
      <span class="hint">{cfg.dropbox.refreshToken ? 'Connected' : 'Not connected'}</span>
    </div>
  {:else if cfg.target === 's3'}
    <TextInput label="S3 endpoint" placeholder="https://s3.eu-west-1.amazonaws.com" mono value={cfg.s3.endpoint} oninput={(v) => (cfg.s3.endpoint = v)} />
    <TextInput label="S3 region" placeholder="Region (us-east-1; auto for R2)" value={cfg.s3.region} oninput={(v) => (cfg.s3.region = v)} />
    <TextInput label="S3 bucket" placeholder="Bucket" value={cfg.s3.bucket} oninput={(v) => (cfg.s3.bucket = v)} />
    <TextInput label="S3 folder prefix" placeholder="Folder (optional)" value={cfg.s3.prefix} oninput={(v) => (cfg.s3.prefix = v)} />
    <TextInput label="S3 access key" placeholder="Access key" mono value={cfg.s3.accessKey} oninput={(v) => (cfg.s3.accessKey = v)} />
    <TextInput secret label="S3 secret key" placeholder="Secret key" mono value={cfg.s3.secretKey} oninput={(v) => (cfg.s3.secretKey = v)} />
  {/if}

  <label for="vc-backup-interval">How often</label>
  <Select id="vc-backup-interval" value={cfg.interval} onchange={(v) => (cfg.interval = v as Interval)}>
    <option value="off">Off</option>
    <option value="daily">Daily</option>
    <option value="weekly">Weekly</option>
  </Select>
  {#if remote}
    <label for="vc-backup-keep">Copies to keep</label>
    <Select id="vc-backup-keep" value={String(cfg.keep)} onchange={(v) => (cfg.keep = Number(v))}>
      {#each [3, 7, 14, 30] as n}<option value={String(n)}>{n}</option>{/each}
    </Select>
  {/if}
  <TextInput secret label="Automatic backup passphrase" placeholder="Passphrase (recommended)" value={cfg.passphrase} oninput={(v) => (cfg.passphrase = v)} />
  <p class="hint">
    {#if remote}
      Only the server you choose is contacted; the browser asks permission for that address alone.
      Older copies beyond the number to keep are deleted from that folder (only files named
      vc-backup-….vcb). Without a passphrase the server can read every saved URL.
    {:else}
      Saved to Downloads/Vertically Challenged Backups. Browsers can't delete old files for you.
    {/if}
    Unchanged data is skipped. Credentials and the passphrase are kept on this device only, in
    plain form, and are never included in a backup or synced.
  </p>

  {#if insecure}
    <p class="error" role="alert">
      This address uses http://, so your login and backup travel unencrypted. Use https:// unless
      the server is on a network you fully trust, and set a passphrase.
    </p>
  {/if}
  <div class="row">
    <Button variant="primary" onclick={() => save(cfg)}>Save</Button>
    <Button disabled={running} onclick={runNow}>{running ? 'Backing up…' : 'Back up now'}</Button>
  </div>
  <p class="hint" role="status">{saved ? 'Saved. ' : ''}Last backup: {last}{status.name ? ` (${status.name})` : ''}</p>
  <p class="error" role="alert">{status.error && !error ? `Last run failed: ${status.error}` : error}</p>
</div>

<style>
  .auto { display: flex; flex-direction: column; gap: var(--gap); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .hint, .error { margin: 0; font-size: 12px; color: var(--mOnSurfaceVariant); }
  .error { color: var(--mError); }
  .error:empty { display: none; }
</style>
