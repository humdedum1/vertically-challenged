<script lang="ts">
import type { PinItem } from '../../shared/layout';
import type { TabInfo } from '../../shared/types';
import { awayFromHome } from '../model/menus';
import Favicon from './Favicon.svelte';
import Icon from './Icon.svelte';

interface Props {
  item: PinItem;
  /** The live tab, or null while the item is dormant. */
  tab: TabInfo | null;
  /** Site colour from the tint cache; null falls back to the theme's primary. */
  tint: string | null;
  index: number;
  /** Roving tabindex: exactly one tile of the grid is in the tab order. */
  tabbable: boolean;
  onopen: () => void;
  onclose: () => void;
  onhome: () => void;
  onmute: () => void;
  oncontextmenu: (e: MouseEvent) => void;
  onfocus: () => void;
}

let {
  item,
  tab,
  tint,
  index,
  tabbable,
  onopen,
  onclose,
  onhome,
  onmute,
  oncontextmenu,
  onfocus,
}: Props = $props();

const url = $derived(tab?.url || item.lastUrl || item.homeUrl);
const title = $derived(tab?.title || item.title || hostOf(url));
const active = $derived(tab?.active === true);
// Dormant (no tab) and discarded tabs look the same: nothing is loaded behind the tile.
const unloaded = $derived(tab === null || tab.discarded);
const away = $derived(tab !== null && awayFromHome(tab.url, item.homeUrl));
const audio = $derived(tab !== null && (tab.audible || tab.muted));
// State goes into the name too, since colour and glow alone don't reach a screen reader.
const label = $derived(
  [
    title,
    active && 'active',
    unloaded && 'suspended',
    tab?.muted ? 'muted' : tab?.audible && 'playing audio',
    away && 'away from home page',
  ]
    .filter(Boolean)
    .join(', '),
);

function hostOf(u: string): string {
  try {
    return new URL(u).hostname || u;
  } catch {
    return u;
  }
}

function onauxclick(e: MouseEvent): void {
  if (e.button !== 1) return;
  e.preventDefault();
  onclose();
}

// Middle-button press would otherwise start Chrome's autoscroll.
function onmousedown(e: MouseEvent): void {
  if (e.button === 1) e.preventDefault();
}

function homeClick(e: MouseEvent): void {
  e.stopPropagation();
  onhome();
}

function muteClick(e: MouseEvent): void {
  e.stopPropagation();
  onmute();
}
</script>

<!-- Keys are handled by the grid (roving focus), so the tile only takes clicks here. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="tile"
  class:active
  class:unloaded
  style:--c={tint ?? undefined}
  role="option"
  tabindex={tabbable ? 0 : -1}
  aria-selected={active}
  aria-label={label}
  title={title}
  data-index={index}
  data-item={item.id}
  onclick={onopen}
  {onauxclick}
  {onmousedown}
  {oncontextmenu}
  {onfocus}
>
  <span class="fav"><Favicon {url} size={18} /></span>

  <!-- The hover controls repeat menu entries ("Back to home URL", "Mute"), so they stay
       out of the tab order and the accessibility tree; the tile's label carries the state. -->
  {#if away}
    <button class="home" type="button" tabindex="-1" aria-hidden="true" title="Back to home URL" onclick={homeClick}>
      <Icon name="home" size={11} />
    </button>
  {/if}

  {#if audio && tab}
    <button
      class="audio"
      class:muted={tab.muted}
      type="button"
      tabindex="-1"
      aria-hidden="true"
      title={tab.muted ? 'Unmute tab' : 'Mute tab'}
      onclick={muteClick}
    >
      <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" />
        {#if tab.muted}
          <path d="m11 6 3 4m0-4-3 4" />
        {:else}
          <path d="M11 5.5a3.5 3.5 0 0 1 0 5" />
        {/if}
      </svg>
    </button>
  {/if}
</div>

<style>
  /* Option B of the approved mockup: each tile is washed with its site's colour (--c). */
  .tile {
    --c: var(--mPrimary);
    position: relative;
    flex: 1 1 64px;
    min-width: 64px;
    height: 48px;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--c) 22%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--c) 14%, var(--mSurfaceVariant));
    cursor: default;
    user-select: none;
    transition:
      background-color var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease),
      transform var(--dur) var(--ease);
  }

  .tile:hover {
    background: color-mix(in srgb, var(--c) 21%, var(--mSurfaceVariant));
  }

  .tile:active {
    transform: scale(0.97);
  }

  .tile:focus-visible {
    outline-offset: 1px;
  }

  .tile.active {
    background: color-mix(in srgb, var(--c) 30%, var(--mSurfaceVariant));
    border-color: color-mix(in srgb, var(--c) 60%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent),
      0 4px 12px -4px color-mix(in srgb, var(--c) 60%, transparent);
  }

  /* Indicator bar along the bottom edge of the active tile. */
  .tile.active::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 5px;
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: var(--c);
    transform: translateX(-50%);
  }

  /* Nothing loaded: neutral surface, dimmed greyscale favicon. */
  .tile.unloaded {
    border-color: color-mix(in srgb, var(--mOutline) 70%, transparent);
    background: var(--mSurfaceVariant);
  }

  .tile.unloaded:hover {
    background: color-mix(in srgb, var(--mOnSurface) 6%, var(--mSurfaceVariant));
  }

  .fav {
    display: grid;
    transition:
      opacity var(--dur) var(--ease),
      filter var(--dur) var(--ease);
  }

  .tile.unloaded .fav {
    opacity: 0.5;
    filter: grayscale(1);
  }

  .home,
  .audio {
    position: absolute;
    top: 3px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: color-mix(in srgb, var(--mSurface) 80%, transparent);
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
    transition:
      opacity var(--dur) var(--ease),
      background-color var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }

  .home:hover,
  .audio:hover {
    background: var(--mSurface);
    color: var(--mOnSurface);
  }

  .home {
    left: 3px;
    opacity: 0;
  }

  .tile:hover .home,
  .tile:focus-visible .home {
    opacity: 1;
  }

  /* Setting: keep row buttons visible everywhere; the home control follows it. */
  :global(html[data-actions='always']) .home {
    opacity: 1;
  }

  .audio {
    right: 3px;
  }

  .audio.muted {
    color: color-mix(in srgb, var(--mOnSurfaceVariant) 70%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .tile:active {
      transform: none;
    }
  }
</style>
