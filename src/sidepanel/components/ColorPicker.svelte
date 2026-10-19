<script lang="ts">
import { GROUP_COLORS, type GroupColor } from '../../shared/types';

interface Props {
  value: GroupColor;
  onpick: (color: GroupColor) => void;
}

let { value, onpick }: Props = $props();

// Roving tabindex: arrows move focus, Enter/Space (native button click) commits.
// svelte-ignore state_referenced_locally -- only the initial selection seeds the cursor
let cursor = $state(Math.max(0, GROUP_COLORS.indexOf(value)));
let group: HTMLDivElement | undefined = $state();

function onkeydown(e: KeyboardEvent): void {
  const n = GROUP_COLORS.length;
  let next = cursor;
  if (e.key === 'ArrowRight') next = (cursor + 1) % n;
  else if (e.key === 'ArrowLeft') next = (cursor + n - 1) % n;
  else if (e.key === 'ArrowDown' && cursor + 3 < n) next = cursor + 3;
  else if (e.key === 'ArrowUp' && cursor - 3 >= 0) next = cursor - 3;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = n - 1;
  else return; // ArrowUp on the top row bubbles so the menu can move focus to "Back".
  e.preventDefault();
  e.stopPropagation();
  cursor = next;
  group?.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus();
}
</script>

<div class="grid" role="radiogroup" aria-label="Group colour" bind:this={group}>
  {#each GROUP_COLORS as c, i (c)}
    <button
      type="button"
      role="radio"
      class="swatch"
      class:on={c === value}
      aria-checked={c === value}
      aria-label={c}
      title={c}
      tabindex={i === cursor ? 0 : -1}
      data-nav={i === cursor ? '' : undefined}
      style:--sw="var(--g-{c})"
      {onkeydown}
      onclick={() => onpick(c)}
    ></button>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 28px);
    gap: 8px;
    padding: 8px 12px 10px;
    justify-content: center;
  }

  .swatch {
    width: 28px;
    height: 28px;
    padding: 2px;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--sw);
    background-clip: content-box;
    cursor: pointer;
  }

  .swatch.on {
    border-color: var(--mOnSurface);
  }

  .swatch:hover:not(.on) {
    border-color: var(--state-pressed);
  }
</style>
