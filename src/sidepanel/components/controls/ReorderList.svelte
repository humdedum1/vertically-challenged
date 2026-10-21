<script lang="ts" generics="Id extends string">
import { tick } from 'svelte';
import Icon from '../Icon.svelte';
import type { ReorderItem } from './reorder-types';

interface Props {
  label: string;
  items: readonly ReorderItem<Id>[];
  onmove: (from: number, to: number) => void;
  ontoggle: (id: Id, visible: boolean) => void;
}

let { label, items, onmove, ontoggle }: Props = $props();

let list: HTMLOListElement | undefined = $state();

async function move(i: number, delta: -1 | 1, id: Id): Promise<void> {
  const to = i + delta;
  if (to < 0 || to >= items.length) return;
  onmove(i, to);
  // Keep keyboard focus on the same button after the item changes position; if it just
  // reached the end (button now disabled), fall back to the opposite one.
  await tick();
  const li = list?.querySelector<HTMLElement>(`[data-id="${id}"]`);
  const want = li?.querySelector<HTMLButtonElement>(`button[data-dir="${delta}"]`);
  (want && !want.disabled
    ? want
    : li?.querySelector<HTMLButtonElement>('button[data-dir]:not(:disabled)')
  )?.focus();
}
</script>

<ol class="list" aria-label={label} bind:this={list}>
  {#each items as item, i (item.id)}
    {@const sw = `${label}-${item.id}`.replace(/\W/g, '-')}
    <li data-id={item.id} class:off={!item.visible}>
      <span class="name">
        <span id="{sw}-l" class="label">{item.label}</span>
        {#if item.hint}<span id="{sw}-h" class="hint">{item.hint}</span>{/if}
      </span>
      <button
        type="button"
        class="icon"
        data-dir="-1"
        aria-label="Move {item.label} up"
        title="Move up"
        disabled={i === 0}
        onclick={() => move(i, -1, item.id)}
      >
        <span class="up"><Icon name="chevron" size={14} /></span>
      </button>
      <button
        type="button"
        class="icon"
        data-dir="1"
        aria-label="Move {item.label} down"
        title="Move down"
        disabled={i === items.length - 1}
        onclick={() => move(i, 1, item.id)}
      >
        <span class="down"><Icon name="chevron" size={14} /></span>
      </button>
      <button
        type="button"
        class="sw"
        role="switch"
        aria-checked={item.visible}
        aria-labelledby="{sw}-l"
        aria-describedby={item.hint ? `${sw}-h` : undefined}
        title={item.toggleDisabled ? item.hint : item.visible ? 'Hide' : 'Show'}
        disabled={item.toggleDisabled}
        onclick={() => ontoggle(item.id, !item.visible)}
      >
        <span class="knob"></span>
      </button>
    </li>
  {/each}
</ol>

<style>
  /* One grouped list: rows divided by hairlines, not a box per row inside the card. */
  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-row);
    background: var(--surface-0);
    overflow: hidden;
  }

  li {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 4px 8px 4px 12px;
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  li.off .name {
    opacity: 0.6;
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .hint {
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  .icon:hover:not(:disabled) {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .icon:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .up {
    display: grid;
    transform: rotate(-90deg);
  }

  .down {
    display: grid;
    transform: rotate(90deg);
  }

  .sw {
    position: relative;
    flex: none;
    width: 38px;
    height: 22px;
    margin-left: 6px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-0);
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--mOnSurfaceVariant);
    transition: transform var(--dur) var(--ease);
  }

  .sw[aria-checked='true'] {
    border-color: var(--mPrimary);
    background: var(--mPrimary);
  }

  .sw[aria-checked='true'] .knob {
    background: var(--mOnPrimary);
    transform: translateX(16px);
  }

  .sw:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
