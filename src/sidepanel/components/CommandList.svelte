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
    {#each commands as c, i (`${c.group}:${c.label}`)}
      {#if c.group && c.group !== commands[i - 1]?.group}
        <li class="group" role="presentation" aria-hidden="true">{c.group}</li>
      {/if}
      <li>
        <button type="button" class:danger={c.danger} onclick={() => onrun(c)}
          ><span class="label">{c.label}</span
          >{#if c.keys}<kbd aria-label="Shortcut {c.keys}">{c.keys}</kbd>{/if}</button
        >
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

  .group {
    padding: 8px 10px 2px;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--mOnSurface);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  kbd {
    flex: none;
    color: var(--mOnSurfaceVariant);
    font: inherit;
    font-size: var(--font-size-meta);
  }

  /* The first command is what Enter in the search field runs. */
  li:not(.group):first-of-type button,
  .group:first-child + li button {
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
