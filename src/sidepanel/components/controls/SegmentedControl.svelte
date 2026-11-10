<script lang="ts" generics="V extends string">
import { tick } from 'svelte';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props {
  options: readonly Option<V>[];
  value: V;
  label: string;
  onchange: (value: V) => void;
}

let { options, value, label, onchange }: Props = $props();

let group: HTMLDivElement | undefined = $state();

function onkeydown(e: KeyboardEvent): void {
  const i = options.findIndex((o) => o.value === value);
  let n: number;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      n = (i + 1) % options.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      n = (i - 1 + options.length) % options.length;
      break;
    case 'Home':
      n = 0;
      break;
    case 'End':
      n = options.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  const o = options[n];
  if (!o) return;
  onchange(o.value);
  void tick().then(() => group?.querySelectorAll<HTMLElement>('[role=radio]')[n]?.focus());
}
</script>

<!-- Focus lives on the radios (roving tabindex); the group only receives their bubbled keys. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="group" role="radiogroup" aria-label={label} bind:this={group} {onkeydown}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      class:checked={o.value === value}
      onclick={() => onchange(o.value)}
    >
      {o.label}
    </button>
  {/each}
</div>

<style>
  .group {
    display: flex;
    padding: 2px;
    gap: 2px;
    border: 1px solid var(--border-strong);
    /* Half the one-line height: a pill on one line, a rounded box if a label wraps. */
    border-radius: 16px;
    background: var(--surface-0);
  }

  button {
    /* Size to the label; a long one ("In-page popup") wraps rather than overflowing at 300px. */
    flex: 1 1 auto;
    min-width: min-content;
    min-height: 28px;
    padding: 2px 8px;
    line-height: 1.15;
    text-wrap: balance;
    border: 0;
    border-radius: 14px;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }

  button:hover {
    background: var(--state-hover);
  }

  button.checked {
    background: var(--mPrimary);
    color: var(--mOnPrimary);
  }

  button:focus-visible {
    outline-offset: 1px;
  }
</style>
