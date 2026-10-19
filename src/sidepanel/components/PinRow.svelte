<script lang="ts">
import type { PinItem } from '../../shared/layout';
import type { TabInfo } from '../../shared/types';
import { awayFromHome } from '../model/menus';
import Favicon from './Favicon.svelte';
import Icon from './Icon.svelte';

interface Props {
  rowKey: string;
  item: PinItem;
  /** The live tab, or null while the item is dormant. */
  tab: TabInfo | null;
  /** 1 at the pinned root, +1 per enclosing folder (drives the indent). */
  depth: number;
  /** Under another window's header. */
  nested: boolean;
  level: number;
  pos: number;
  size: number;
  focused: boolean;
  selected: boolean;
  selectedLook: boolean;
  showClose?: boolean;
  showMute?: boolean;
  onclick: (e: MouseEvent) => void;
  oncontextmenu: (e: MouseEvent) => void;
  /** Suspends the tab; the row stays (pinClose). */
  onclose: () => void;
  onhome: () => void;
  onmute: () => void;
}

let {
  rowKey,
  item,
  tab,
  depth,
  nested,
  level,
  pos,
  size,
  focused,
  selected,
  selectedLook,
  showClose = true,
  showMute = true,
  onclick,
  oncontextmenu,
  onclose,
  onhome,
  onmute,
}: Props = $props();

const url = $derived(tab?.url || item.lastUrl || item.homeUrl);
const title = $derived(tab?.title || item.title || url);
const active = $derived(tab?.active === true);
// Same rule as the Essentials tiles: dormant and discarded look alike (nothing loaded).
const unloaded = $derived(tab === null || tab.discarded);
const away = $derived(tab !== null && awayFromHome(tab.url, item.homeUrl));
const audio = $derived(tab !== null && (tab.audible || tab.muted));
const indent = $derived(12 + (depth - 1) * 16 + (nested ? 16 : 0));
const label = $derived(
  [title, unloaded && 'suspended', tab?.muted && 'muted', away && 'away from home page']
    .filter(Boolean)
    .join(', '),
);

function onauxclick(e: MouseEvent): void {
  if (e.button !== 1) return;
  e.preventDefault();
  onclose();
}

// The buttons are pointer shortcuts for menu entries; focus stays on the tree.
function keepFocus(e: MouseEvent): void {
  e.preventDefault();
}

function button(fn: () => void): (e: MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    fn();
  };
}
</script>

<!-- Keyboard activation is handled on the owning tree via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-row-{rowKey}"
  class="row"
  class:active
  class:focused
  class:selected={selectedLook}
  class:unloaded
  style:padding-left="{indent}px"
  role="treeitem"
  tabindex="-1"
  aria-level={level}
  aria-posinset={pos}
  aria-setsize={size}
  aria-selected={selected}
  aria-current={active ? 'page' : undefined}
  aria-label={label}
  title="{title}{url ? `\n${url}` : ''}"
  {onclick}
  {oncontextmenu}
  {onauxclick}
>
  <span class="fav"><Favicon {url} size={16} /></span>
  <span class="label">{title}</span>

  <!-- Hover shortcuts repeat menu entries, so they stay out of the tab order. -->
  {#if away}
    <button class="act home" type="button" tabindex="-1" aria-hidden="true" title="Back to home URL" onmousedown={keepFocus} onclick={button(onhome)}>
      <Icon name="home" size={13} />
    </button>
  {/if}

  {#if showMute && audio && tab}
    <button
      class="act mute"
      class:muted={tab.muted}
      type="button"
      tabindex="-1"
      aria-hidden="true"
      title={tab.muted ? 'Unmute tab' : 'Mute tab'}
      onmousedown={keepFocus}
      onclick={button(onmute)}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" />
        {#if tab.muted}
          <path d="m11 6 3 4m0-4-3 4" />
        {:else}
          <path d="M11 5.5a3.5 3.5 0 0 1 0 5" />
        {/if}
      </svg>
    </button>
  {/if}

  {#if showClose && tab && !tab.discarded}
    <button class="act close" type="button" tabindex="-1" aria-hidden="true" title="Suspend tab" onmousedown={keepFocus} onclick={button(onclose)}>
      <Icon name="close" size={12} />
    </button>
  {/if}
</div>

<style>
  /* Same row language as TabRow (hover, active bar, selection ring, focus ring). */
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-height);
    padding-right: 6px;
    border-radius: var(--radius-row);
    cursor: default;
    user-select: none;
    transition: background-color var(--dur) var(--ease);
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

  .row.selected {
    background: color-mix(in srgb, var(--mPrimary) 20%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mPrimary) 55%, transparent);
  }

  .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  :global([role='tree']:not(:focus-visible)) .row.focused {
    outline: none;
  }

  .fav {
    flex: none;
    display: grid;
    transition:
      opacity var(--dur) var(--ease),
      filter var(--dur) var(--ease);
  }

  /* Nothing loaded: dimmed greyscale favicon, like a dormant Essentials tile. */
  .row.unloaded .fav {
    opacity: 0.5;
    filter: grayscale(1);
  }

  .row.unloaded .label {
    color: var(--mOnSurfaceVariant);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .act {
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

  .act:hover {
    background: var(--state-pressed);
    color: var(--mOnSurface);
  }

  .mute.muted {
    opacity: 0.6;
  }

  .home,
  .close {
    opacity: 0;
  }

  .row:hover .home,
  .row:hover .close,
  .row.focused .home,
  .row.focused .close,
  .row.active .close {
    opacity: 1;
  }

  :global(html[data-actions='always']) .row .home,
  :global(html[data-actions='always']) .row .close {
    opacity: 1;
  }

  .close:hover {
    color: var(--mError);
  }
</style>
