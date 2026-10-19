<script lang="ts">
import { faviconUrl } from '../../shared/favicon';
import type { TabInfo } from '../../shared/types';

interface Props {
  tab: TabInfo;
  focused: boolean;
  posinset: number;
  setsize: number;
  onactivate: () => void;
  onclose: () => void;
}

let { tab, focused, posinset, setsize, onactivate, onclose }: Props = $props();

const icon = $derived(faviconUrl(tab.url, 16));
// Tracks the URL that failed so a navigation to a new page retries the favicon.
let failedFor: string | null = $state(null);
const showImg = $derived(icon !== null && failedFor !== icon);
const label = $derived(tab.title || tab.url || 'New Tab');

function onauxclick(e: MouseEvent): void {
  if (e.button !== 1) return;
  e.preventDefault();
  onclose();
}

function closeClick(e: MouseEvent): void {
  e.stopPropagation();
  onclose();
}
</script>

<!-- Keyboard activation is handled on the owning listbox via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-tab-{tab.id}"
  class="row"
  class:active={tab.active}
  class:focused
  class:discarded={tab.discarded}
  role="option"
  tabindex="-1"
  aria-selected={tab.active}
  aria-setsize={setsize}
  aria-posinset={posinset}
  title="{label}{tab.url ? `\n${tab.url}` : ''}"
  onclick={onactivate}
  {onauxclick}
  onmousedown={(e) => {
    // Middle-click would otherwise start autoscroll before auxclick fires.
    if (e.button === 1) e.preventDefault();
  }}
>
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

  <span class="label">{label}</span>

  {#if tab.pinned}
    <svg class="pin" viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="Pinned" fill="currentColor">
      <path d="M9.5 1.5 14.5 6.5l-1.4.6-2.6 2.6.3 3-1.1 1.1-2.9-2.9L2.5 14l-.5-.5 3.2-3.3-2.9-2.9 1.1-1.1 3 .3 2.6-2.6z" />
    </svg>
  {/if}

  {#if tab.audible || tab.muted}
    <svg class="audio" class:muted={tab.muted} viewBox="0 0 16 16" width="13" height="13" role="img" aria-label={tab.muted ? 'Muted' : 'Playing audio'} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" />
      {#if tab.muted}
        <path d="m11 6 3 4m0-4-3 4" />
      {:else}
        <path d="M11 5.5a3.5 3.5 0 0 1 0 5" />
      {/if}
    </svg>
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
    transition: background-color var(--dur);
  }

  .row:hover {
    background: var(--state-hover);
  }

  .row:active {
    background: var(--state-pressed);
  }

  .row.active {
    background: var(--mHover);
    color: var(--mOnHover);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--mShadow) 30%, transparent);
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

  /* Focus lives on the listbox (aria-activedescendant), so the ring is drawn on the row. */
  .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  :global([role='listbox']:not(:focus-visible)) .row.focused {
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

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pin {
    flex: none;
    color: var(--mTertiary);
  }

  .audio {
    flex: none;
    color: var(--mOnSurfaceVariant);
  }

  .audio.muted {
    opacity: 0.6;
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
    opacity: 0;
    transition:
      opacity var(--dur),
      background-color var(--dur);
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
