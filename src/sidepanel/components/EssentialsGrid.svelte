<script lang="ts">
/*
 * Keyboard map (roving tabindex: focus sits on one tile at a time):
 *   Left / Right       previous / next tile        Home / End    first / last tile
 *   Up / Down          tile above / below (rows are measured, see `vertical`);
 *                      Down from the last row leaves for the list (`onexit`)
 *   Enter / Space      open
 *   Alt+Left / Right   move the tile one place (onmove)
 * Configurable: closeTab (Delete) suspends the tile's tab, openMenu (Shift+F10, ContextMenu).
 */
import { tileInsertionIndex } from '../../lib/drag/tile-hit';
import { actionFor } from '../../lib/keymap';
import type { Keymap } from '../../settings/schema';
import type { PinItem } from '../../shared/layout';
import type { PanelMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import type { TintCache } from '../tint-cache.svelte';
import EssentialTile from './EssentialTile.svelte';

interface Props {
  windowId: number;
  items: PinItem[];
  /** Live tabs of the window by id; an item whose tab is missing is dormant. */
  tabs: ReadonlyMap<number, TabInfo>;
  tints: TintCache;
  send: (m: PanelMessage) => void;
  onmenu: (x: number, y: number, item: PinItem) => void;
  shortcuts: Keymap;
  /** Down from the last row: hand focus to the list below. */
  onexit?: () => void;
  /** A press on a tile, which may become a drag (the list's drag session runs it). */
  onpress?: (e: PointerEvent, item: PinItem) => void;
  /** Alt+Left / Right on a tile. */
  onmove?: (item: PinItem, dir: -1 | 1) => void;
  /** Insertion index of an allowed drop being aimed here, for the indicator bar. */
  dropIndex?: number | null;
  /** A drag that could land here is running: an empty grid shows a drop area. */
  dropping?: boolean;
}

let {
  windowId,
  items,
  tabs,
  tints,
  send,
  onmenu,
  shortcuts,
  onexit,
  onpress,
  onmove,
  dropIndex = null,
  dropping = false,
}: Props = $props();

let el: HTMLDivElement | undefined = $state();
let focusId = $state<string | null>(null);

const tabOf = (item: PinItem): TabInfo | null =>
  item.tabId === null ? null : (tabs.get(item.tabId) ?? null);

// The tab stop: the last focused tile while it exists, else the active one, else the first.
const stopId = $derived.by(() => {
  if (focusId !== null && items.some((i) => i.id === focusId)) return focusId;
  return (items.find((i) => tabOf(i)?.active) ?? items[0])?.id ?? null;
});

const tileEls = (): HTMLElement[] => [
  ...(el?.querySelectorAll<HTMLElement>('[role=option]') ?? []),
];

function focusAt(i: number): void {
  const n = Math.max(0, Math.min(i, items.length - 1));
  tileEls()[n]?.focus();
}

/** Moves focus into the grid at its tab stop (from the list above/below, or after a menu). */
export function focus(): void {
  const i = items.findIndex((it) => it.id === stopId);
  focusAt(Math.max(0, i));
}

/**
 * The tile above/below tile `i`, or null past the first/last row. Rows come from layout,
 * not arithmetic: tiles sharing an offsetTop form a row, which stays right when short
 * rows stretch (4 + 1) and as the panel width changes the column count. The target is
 * the tile in the next row whose centre is nearest, so Down from any of the top four
 * lands on a full-width fifth; `column` keeps the starting x across a run of Up/Down so
 * coming back up returns to the tile you came from.
 */
let column: number | null = null;
/** Set while Up/Down moves focus, so that focus keeps `column`; any other focus resets it. */
let verticalFocus = false;

function vertical(i: number, dir: -1 | 1): number | null {
  const els = tileEls();
  const cur = els[i];
  if (!cur) return null;
  const tops = [...new Set(els.map((e) => e.offsetTop))].sort((a, b) => a - b);
  const target = tops[tops.indexOf(cur.offsetTop) + dir];
  if (target === undefined) return null;
  const centre = (e: HTMLElement) => e.offsetLeft + e.offsetWidth / 2;
  const from = column ?? centre(cur);
  column = from;
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [j, e] of els.entries()) {
    const d = Math.abs(centre(e) - from);
    if (e.offsetTop === target && d < bestDist) {
      best = j;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Where a drop at the client point would insert, or null when the point is outside the
 * grid. Reads tile rects, so it is only called while a drag is running.
 */
export function targetAt(x: number, y: number): number | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  return tileInsertionIndex(
    tileEls().map((t) => t.getBoundingClientRect()),
    x,
    y,
  );
}

/** The vertical bar in the gap before tile `dropIndex` (after the last tile at the end). */
const bar = $derived.by(() => {
  void items;
  if (dropIndex === null || !el) return null;
  const els = tileEls();
  const before = els[dropIndex];
  const last = els[els.length - 1];
  if (before)
    return { left: before.offsetLeft - 4, top: before.offsetTop, height: before.offsetHeight };
  if (last) {
    return {
      left: last.offsetLeft + last.offsetWidth + 2,
      top: last.offsetTop,
      height: last.offsetHeight,
    };
  }
  return null;
});

function onpointerdown(e: PointerEvent): void {
  const tile = (e.target as Element).closest<HTMLElement>('[role=option]');
  const item = tile && items[Number(tile.dataset.index)];
  if (item) onpress?.(e, item);
}

function open(item: PinItem): void {
  send({ type: 'pinOpen', windowId, itemId: item.id });
}

function close(item: PinItem): void {
  send({ type: 'pinClose', windowId, itemIds: [item.id] });
}

function menuAt(item: PinItem, tile: HTMLElement): void {
  const r = tile.getBoundingClientRect();
  onmenu(r.left + 8, r.bottom + 2, item);
}

function onkeydown(e: KeyboardEvent): void {
  const tile = (e.target as Element).closest<HTMLElement>('[role=option]');
  if (!tile) return;
  const i = Number(tile.dataset.index);
  const item = items[i];
  if (!item) return;
  const action = actionFor(shortcuts, e);
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') column = null;
  if (action === 'closeTab') close(item);
  else if (action === 'openMenu') menuAt(item, tile);
  else if (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  ) {
    onmove?.(item, e.key === 'ArrowLeft' ? -1 : 1);
  } else if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  else {
    switch (e.key) {
      case 'ArrowLeft':
        focusAt(i - 1);
        break;
      case 'ArrowRight':
        focusAt(i + 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const j = vertical(i, e.key === 'ArrowUp' ? -1 : 1);
        if (j !== null) {
          verticalFocus = true;
          focusAt(j);
          verticalFocus = false;
        } else if (e.key === 'ArrowDown') onexit?.();
        break;
      }
      case 'Enter':
      case ' ':
        open(item);
        break;
      default:
        return;
    }
  }
  e.preventDefault();
}
</script>

<div
  class="grid"
  role="listbox"
  aria-label="Staples"
  aria-orientation="horizontal"
  tabindex="-1"
  bind:this={el}
  {onkeydown}
  {onpointerdown}
  ondragstart={(e) => e.preventDefault()}
>
  {#if items.length === 0 && dropping}
    <div class="empty" class:target={dropIndex !== null}>Drop here to add to Staples</div>
  {/if}
  {#each items as item, i (item.id)}
    {@const tab = tabOf(item)}
    <EssentialTile
      {item}
      {tab}
      tint={tints.get(item.lastUrl || item.homeUrl)}
      index={i}
      tabbable={item.id === stopId}
      onopen={() => {
        focusId = item.id;
        column = null;
        open(item);
      }}
      onclose={() => close(item)}
      onhome={() => send({ type: 'pinHome', windowId, itemId: item.id })}
      onmute={() => {
        if (tab) send({ type: 'setMuted', tabIds: [tab.id], muted: !tab.muted });
      }}
      oncontextmenu={(e) => {
        e.preventDefault();
        focusId = item.id;
        column = null;
        onmenu(e.clientX, e.clientY, item);
      }}
      onfocus={() => {
        focusId = item.id;
        // Focus that didn't come from Up/Down (a click, Tab, the list) starts a new column.
        if (!verticalFocus) column = null;
      }}
    />
  {/each}
  {#if bar && items.length > 0}
    <div class="bar" style:left="{bar.left}px" style:top="{bar.top}px" style:height="{bar.height}px"></div>
  {/if}
</div>

<style>
  .grid {
    /* Rows always fill the width: tiles grow from 64px, so a short last row stretches. */
    position: relative;
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 40vh;
    padding: 4px 8px 8px;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    outline: none;
  }

  /* Drop indicator: a vertical bar in the gap between two tiles. */
  .bar {
    position: absolute;
    width: 2px;
    border-radius: 2px;
    background: var(--mPrimary);
    pointer-events: none;
  }

  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    height: 48px;
    border: 1px dashed var(--mOutline);
    border-radius: 12px;
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
  }

  .empty.target {
    border: 2px solid var(--mPrimary);
    background: color-mix(in srgb, var(--mPrimary) 12%, transparent);
    color: var(--mOnSurface);
  }
</style>
