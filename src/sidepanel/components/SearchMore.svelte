<script lang="ts">
import { browser } from 'wxt/browser';
import { type SessionHit, searchPutAway } from '../../shared/put-away-search';
import { isRestorableUrl, parseSessions, SESSIONS_KEY } from '../../shared/sessions';
import { parseSnoozed, SNOOZE_KEY, type Snoozed } from '../../shared/snooze';
import Favicon from './Favicon.svelte';

/**
 * Bookmarks and history matching the tab search, below the tab results (like Vivaldi's
 * quick commands). Pages already open as tabs are left out; each list is capped at 5.
 */
let {
  text,
  windowId,
  openUrls,
  onwake,
}: {
  text: string;
  windowId: number | null;
  openUrls: ReadonlySet<string>;
  /** Reopens a snoozed tab now. */
  onwake: (id: string) => void;
} = $props();

interface Hit {
  url: string;
  title: string;
}
let bookmarks = $state.raw<Hit[]>([]);
let history = $state.raw<Hit[]>([]);
let sessionHits = $state.raw<SessionHit[]>([]);
let snoozedHits = $state.raw<Snoozed[]>([]);

// Saved sessions can be large, so they are parsed once and again only when storage changes.
let putAway: Promise<{
  sessions: ReturnType<typeof parseSessions>;
  snoozed: ReturnType<typeof parseSnoozed>;
}> | null = null;
const loadPutAway = () =>
  (putAway ??= browser.storage.local.get([SESSIONS_KEY, SNOOZE_KEY]).then((s) => ({
    sessions: parseSessions(s[SESSIONS_KEY]),
    snoozed: parseSnoozed(s[SNOOZE_KEY]),
  })));
$effect(() => {
  const on = (c: Record<string, unknown>, area: string) => {
    if (area === 'local' && (SESSIONS_KEY in c || SNOOZE_KEY in c)) putAway = null;
  };
  browser.storage.onChanged.addListener(on);
  return () => browser.storage.onChanged.removeListener(on);
});
const LIMIT = 5;

// Debounced: each keystroke would otherwise query both APIs.
$effect(() => {
  const q = text;
  const open = openUrls;
  if (q.length < 2) {
    bookmarks = history = [];
    sessionHits = [];
    snoozedHits = [];
    return;
  }
  let stale = false;
  const timer = setTimeout(async () => {
    const keep = (h: { url?: string; title?: string }): h is Hit =>
      !!h.url && isRestorableUrl(h.url) && !open.has(h.url);
    const [b, h] = await Promise.all([
      browser.bookmarks.search(q).catch(() => []),
      browser.history.search({ text: q, startTime: 0, maxResults: 25 }).catch(() => []),
    ]);
    const away = await loadPutAway().catch(() => null);
    if (stale) return;
    if (away) ({ sessionHits, snoozedHits } = searchPutAway(q, away.sessions, away.snoozed, open));
    bookmarks = b
      .filter(keep)
      .slice(0, LIMIT)
      .map((x) => ({ url: x.url as string, title: x.title || (x.url as string) }));
    const seen = new Set(bookmarks.map((x) => x.url));
    history = h
      .filter((x) => keep(x) && !seen.has(x.url as string))
      .slice(0, LIMIT)
      .map((x) => ({ url: x.url as string, title: x.title || (x.url as string) }));
  }, 150);
  return () => {
    stale = true;
    clearTimeout(timer);
  };
});

// Up/Down move between results; Up from the first goes back to the search field.
function onkeydown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...(e.currentTarget as HTMLElement).querySelectorAll('button')];
  const i = all.indexOf(e.target as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : -1);
  e.preventDefault();
  if (i >= 0) all[Math.min(i, all.length - 1)]?.focus();
  else document.querySelector<HTMLInputElement>('input[role="searchbox"]')?.focus();
}

const summary = $derived(
  [
    bookmarks.length && `${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'}`,
    history.length && `${history.length} from history`,
    sessionHits.length && `${sessionHits.length} from saved sessions`,
    snoozedHits.length && `${snoozedHits.length} snoozed`,
  ]
    .filter(Boolean)
    .join(', '),
);

function open(url: string): void {
  void browser.tabs.create({ url, ...(windowId === null ? {} : { windowId }) });
}
</script>

{#snippet section(label: string, hits: Hit[])}
  {#if hits.length}
    <p class="label">{label}</p>
    <ul>
      {#each hits as h (h.url)}
        <li>
          <button type="button" title={h.url} onclick={() => open(h.url)}>
            <Favicon url={h.url} size={14} />
            <span class="t">{h.title}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="more search-more" {onkeydown}>
  <p class="sr" role="status">{summary}</p>
  {@render section('Bookmarks', bookmarks)}
  {@render section('History', history)}
  {#if snoozedHits.length}
    <p class="label">Put away</p>
    <ul>
      {#each snoozedHits as s (s.id)}
        <li>
          <button type="button" title="{s.url} (put away; opens it now)" onclick={() => onwake(s.id)}>
            <Favicon url={s.url} size={14} />
            <span class="t">{s.title || s.url}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if sessionHits.length}
    <p class="label">Saved sessions</p>
    <ul>
      {#each sessionHits as h (h.url)}
        <li>
          <button type="button" title="{h.url} (in “{h.session}”)" onclick={() => open(h.url)}>
            <Favicon url={h.url} size={14} />
            <span class="t">{h.title}</span>
            <span class="from">{h.session}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .more {
    padding: 4px 6px 8px;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .label {
    margin: 8px 8px 4px;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--mOnSurface);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    background: var(--state-hover);
  }

  .from {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
  }

  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
