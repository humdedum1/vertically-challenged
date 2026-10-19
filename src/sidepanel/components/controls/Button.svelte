<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

interface Props extends HTMLButtonAttributes {
  variant?: 'tonal' | 'primary' | 'danger' | 'text';
  children: Snippet;
}

let { variant = 'tonal', children, type = 'button', ...rest }: Props = $props();
</script>

<button {type} class={variant} {...rest}>{@render children()}</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 999px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--dur) var(--ease),
      filter var(--dur) var(--ease);
  }

  .tonal {
    background: var(--state-selected);
    color: var(--mOnSurface);
    border-color: var(--border);
  }

  .tonal:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mPrimary) 22%, transparent);
  }

  .primary {
    background: var(--mPrimary);
    color: var(--mOnPrimary);
  }

  .primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .danger {
    background: transparent;
    color: var(--mError);
    border-color: var(--mError);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mError) 14%, transparent);
  }

  .text {
    background: transparent;
    color: var(--mOnSurfaceVariant);
  }

  .text:hover:not(:disabled) {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  button:active:not(:disabled) {
    filter: brightness(0.94);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
