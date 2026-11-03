<script lang="ts" generics="T">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import { computeRange, scrollToReveal } from '../../lib/virtual-range';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onscroll'> {
  items: readonly T[];
  rowHeight: number;
  key: (item: T) => string | number;
  /** Rendered inside the scrolling content (e.g. a drop indicator), in content coordinates. */
  overlay?: Snippet;
  footer?: Snippet;
  row: Snippet<[T, number]>;
}

// Remaining attributes land on the scroll container so the parent can make it the listbox.
let { items, rowHeight, key, row, overlay, footer, ...rest }: Props = $props();

let el: HTMLDivElement | undefined = $state();
let scrollTop = $state(0);
let viewportHeight = $state(0);

const range = $derived(computeRange(scrollTop, viewportHeight, rowHeight, items.length));
const visible = $derived(items.slice(range.start, range.end));

export function scroller(): HTMLDivElement | undefined {
  return el;
}

// Scrolling while a button is held moves rows under the pointer, so the click lands on
// another tab. Reveals requested meanwhile (active tab changed, remote update) wait for release.
let held = false;
let pending: number | null = null;

function release(): void {
  held = false;
  if (pending !== null) {
    const i = pending;
    pending = null;
    reveal(i);
  }
}

export function reveal(index: number): void {
  if (!el) return;
  if (held) {
    pending = index;
    return;
  }
  // clientHeight is read here rather than from bound state: this runs right after
  // mount/data changes, before the binding has necessarily updated.
  const top = scrollToReveal(index, el.scrollTop, el.clientHeight, rowHeight);
  if (top !== null) el.scrollTop = top;
}

function onscroll(e: Event & { currentTarget: HTMLDivElement }): void {
  scrollTop = e.currentTarget.scrollTop;
}
</script>

<svelte:window onpointerup={release} onpointercancel={release} />

<div
  {...rest}
  onpointerdowncapture={(e) => { held = e.target !== el; }}
  class="viewport"
  bind:this={el}
  bind:clientHeight={viewportHeight}
  {onscroll}
>
  <div class="spacer" role="presentation" style:height="{range.totalHeight}px">
    <div class="window" role="presentation" style:transform="translateY({range.offset}px)">
      {#each visible as item, i (key(item))}
        <!-- A derived, so rows that stay on screen while scrolling don't re-render: their
             absolute index is unchanged even though range.start and i both moved. -->
        {@const index = range.start + i}
        {@render row(item, index)}
      {/each}
    </div>
    {@render overlay?.()}
  </div>
  {@render footer?.()}
</div>

<style>
  .viewport {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--mOutline) transparent;
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  .window {
    position: absolute;
    inset: 0 0 auto 0;
    will-change: transform;
  }
</style>
