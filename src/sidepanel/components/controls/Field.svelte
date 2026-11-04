<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
  label: string;
  /** Id of the control the label points at; omit for groups that carry their own aria-label. */
  for?: string;
  children: Snippet;
}

let { label, for: forId, children }: Props = $props();
</script>

<div class="field">
  {#if forId}
    <label for={forId}>{label}</label>
  {:else}
    <span class="label" aria-hidden="true">{label}</span>
  {/if}
  {@render children()}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label,
  .label {
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
    font-weight: 500;
  }
</style>
