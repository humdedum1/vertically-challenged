<script lang="ts">
import type { Range } from '../../lib/search/search-index';
import { displayUrl } from '../../lib/search/search-index';
import { faviconUrl } from '../../shared/favicon';
import type { TabInfo } from '../../shared/types';
import { segments } from '../model/highlight';

interface Props {
  tab: TabInfo;
  level: 1 | 2;
  pos: number;
  size: number;
  focused: boolean;
  /** ARIA selection state (always accurate). */
  selected: boolean;
  /** Visual selection; suppressed when the selection is just the active tab. */
  selectedLook: boolean;
  pinnedEnd: boolean;
  /** CSS colour of the owning group, for the indent guide. */
  groupColor?: string;
  highlight?: { title: Range[]; url: Range[] };
  /** Second (URL) line in search results; only when the row is tall enough. */
  showUrl: boolean;
  onclick: (e: MouseEvent) => void;
  oncontextmenu: (e: MouseEvent) => void;
  onclose: () => void;
  onmute: () => void;
}

let {
  tab,
  level,
  pos,
  size,
  focused,
  selected,
  selectedLook,
  pinnedEnd,
  groupColor,
  highlight,
  showUrl,
  onclick,
  oncontextmenu,
  onclose,
  onmute,
}: Props = $props();

const icon = $derived(faviconUrl(tab.url, 16));
// Tracks the URL that failed so a navigation to a new page retries the favicon.
let failedFor: string | null = $state(null);
const showImg = $derived(icon !== null && failedFor !== icon);
const label = $derived(tab.title || tab.url || 'New Tab');
const titleParts = $derived(highlight && tab.title ? segments(tab.title, highlight.title) : null);
const shownUrl = $derived(displayUrl(tab.url));
const urlParts = $derived(highlight ? segments(shownUrl, highlight.url) : null);

function onauxclick(e: MouseEvent): void {
  if (e.button !== 1) return;
  e.preventDefault();
  onclose();
}

function closeClick(e: MouseEvent): void {
  e.stopPropagation();
  onclose();
}

function muteClick(e: MouseEvent): void {
  e.stopPropagation();
  onmute();
}
</script>

<!-- Keyboard activation is handled on the owning tree via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-row-t{tab.id}"
  class="row"
  class:active={tab.active}
  class:focused
  class:selected={selectedLook}
  class:discarded={tab.discarded}
  class:indent={level === 2}
  class:pinned-end={pinnedEnd}
  class:two-line={showUrl}
  style:--gc={groupColor}
  role="treeitem"
  tabindex="-1"
  aria-level={level}
  aria-posinset={pos}
  aria-setsize={size}
  aria-selected={selected}
  aria-current={tab.active ? 'page' : undefined}
  title="{label}{tab.url ? `\n${tab.url}` : ''}"
  {onclick}
  {oncontextmenu}
  {onauxclick}
>
  {#if level === 2}<span class="guide" aria-hidden="true"></span>{/if}

  <span class="icon">
    {#if tab.loading}
      <span class="spinner" aria-hidden="true"></span>
    {:else if showImg && icon}
      <img src={icon} width="16" height="16" alt="" loading="lazy" decoding="async" onerror={() => (failedFor = icon)} />
    {:else}
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2">
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
      </svg>
    {/if}
  </span>

  <span class="text">
    <span class="label"
      >{#if titleParts}{#each titleParts as s, i (i)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}{:else}{label}{/if}</span
    >
    {#if showUrl && urlParts}
      <span class="url"
        >{#each urlParts as s, i (i)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}</span
      >
    {/if}
  </span>

  {#if tab.pinned}
    <svg class="pin" viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="Pinned" fill="currentColor">
      <path d="M9.5 1.5 14.5 6.5l-1.4.6-2.6 2.6.3 3-1.1 1.1-2.9-2.9L2.5 14l-.5-.5 3.2-3.3-2.9-2.9 1.1-1.1 3 .3 2.6-2.6z" />
    </svg>
  {/if}

  {#if tab.audible || tab.muted}
    <button
      class="mute"
      class:muted={tab.muted}
      type="button"
      tabindex="-1"
      aria-label="{tab.muted ? 'Unmute' : 'Mute'} tab: {label}"
      title={tab.muted ? 'Unmute tab' : 'Mute tab'}
      onclick={muteClick}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" />
        {#if tab.muted}
          <path d="m11 6 3 4m0-4-3 4" />
        {:else}
          <path d="M11 5.5a3.5 3.5 0 0 1 0 5" />
        {/if}
      </svg>
    </button>
  {/if}

  <button class="close" type="button" tabindex="-1" aria-label="Close tab: {label}" onclick={closeClick}>
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="m4 4 8 8m0-8-8 8" />
    </svg>
  </button>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-height);
    padding: 0 6px 0 12px;
    border-radius: var(--radius-row);
    cursor: default;
    user-select: none;
    transition: background-color var(--dur) var(--ease);
  }

  .row.indent {
    padding-left: 36px;
  }

  /* Group colour guide, aligned under the header's colour dot. */
  .guide {
    position: absolute;
    left: 24px;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--gc);
    opacity: 0.65;
  }

  .row:hover {
    background: var(--state-hover);
  }

  .row:active {
    background: var(--state-pressed);
  }

  .row.active {
    background: var(--state-selected);
    color: var(--mOnSurface);
  }

  .row.active::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background: var(--mPrimary);
  }

  /* Selection: tinted fill plus an inset ring, so it reads differently from the active bar. */
  .row.selected {
    background: color-mix(in srgb, var(--mPrimary) 20%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mPrimary) 55%, transparent);
  }

  .row.pinned-end::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 1px;
    background: var(--border);
  }

  /* Focus lives on the tree (aria-activedescendant), so the ring is drawn on the row. */
  .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  :global([role='tree']:not(:focus-visible)) .row.focused {
    outline: none;
  }

  .row.discarded .label {
    opacity: 0.6;
    font-style: italic;
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--mOnSurfaceVariant);
  }

  .icon img {
    display: block;
    border-radius: 3px;
  }

  .row.discarded .icon {
    opacity: 0.6;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .label,
  .url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .row.two-line .label {
    line-height: 1.2;
  }

  .url {
    color: var(--mOnSurfaceVariant);
    font-size: 10.5px;
    line-height: 1.15;
  }

  mark {
    padding: 0;
    border-radius: 2px;
    background: color-mix(in srgb, var(--mPrimary) 22%, transparent);
    color: inherit;
  }

  .pin {
    flex: none;
    color: var(--mTertiary);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--mOutline);
    border-top-color: var(--mPrimary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .mute,
  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
    transition:
      opacity var(--dur),
      background-color var(--dur);
  }

  .mute.muted {
    opacity: 0.6;
  }

  .mute:hover {
    background: var(--state-pressed);
    color: var(--mOnSurface);
  }

  .close {
    opacity: 0;
  }

  .row:hover .close,
  .row.focused .close,
  .row.active .close,
  .close:focus-visible {
    opacity: 1;
  }

  .close:hover {
    background: var(--state-pressed);
    color: var(--mError);
  }
</style>
