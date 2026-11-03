<script lang="ts">
import type { Command } from '../model/commands';

/** The command palette's results (search text starting with ">"). */
let { commands, onrun }: { commands: readonly Command[]; onrun: (c: Command) => void } = $props();

// Up/Down move between commands; Up from the first goes back to the search field.
function onkeydown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...(e.currentTarget as HTMLElement).querySelectorAll('button')];
  const i = all.indexOf(e.target as HTMLButtonElement) + (e.key === 'ArrowDown' ? 1 : -1);
  e.preventDefault();
  if (i >= 0) all[Math.min(i, all.length - 1)]?.focus();
  else document.querySelector<HTMLInputElement>('input[role="searchbox"]')?.focus();
}
</script>

{#if commands.length}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div {onkeydown}>
  <ul class="commands" aria-label="Commands">
    {#each commands as c (c.label)}
      <li>
        <button type="button" class:danger={c.danger} onclick={() => onrun(c)}>{c.label}</button>
      </li>
    {/each}
  </ul>
  </div>
{:else}
  <p class="empty" role="status">No matching commands</p>
{/if}

<style>
  .commands {
    margin: 0;
    padding: 4px 6px 8px;
    list-style: none;
  }

  button {
    display: block;
    width: 100%;
    min-height: 30px;
    padding: 0 10px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--mOnSurface);
    font: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  /* The first command is what Enter in the search field runs. */
  li:first-child button {
    background: var(--state-hover);
  }

  button:hover,
  button:focus-visible {
    background: var(--state-hover);
  }

  .danger {
    color: var(--mError);
  }

  .empty {
    margin: 0;
    padding: 24px 16px;
    color: var(--mOnSurfaceVariant);
    text-align: center;
  }
</style>
