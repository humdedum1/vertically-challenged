<script lang="ts">
import { browser } from 'wxt/browser';
import { isRestorableUrl } from '../../shared/sessions';
import Favicon from './Favicon.svelte';

/**
 * Bookmarks and history matching the tab search, below the tab results (like Vivaldi's
 * quick commands). Pages already open as tabs are left out; each list is capped at 5.
 */
let {
  text,
  windowId,
  openUrls,
}: { text: string; windowId: number | null; openUrls: ReadonlySet<string> } = $props();

interface Hit {
  url: string;
  title: string;
}
let bookmarks = $state.raw<Hit[]>([]);
let history = $state.raw<Hit[]>([]);
const LIMIT = 5;

// Debounced: each keystroke would otherwise query both APIs.
$effect(() => {
  const q = text;
  const open = openUrls;
  if (q.length < 2) {
    bookmarks = history = [];
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
    if (stale) return;
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

<div class="more" aria-live="polite">
  {@render section('Bookmarks', bookmarks)}
  {@render section('History', history)}
</div>

<style>
  .more {
    padding: 4px 6px 8px;
  }

  .label {
    margin: 8px 8px 4px;
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
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

  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
