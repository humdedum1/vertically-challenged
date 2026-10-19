<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
  id: string;
  value: string;
  onchange: (value: string) => void;
  /** <option> / <optgroup> elements. */
  children: Snippet;
  label?: string;
}

let { id, value, onchange, children, label }: Props = $props();
</script>

<select {id} {value} aria-label={label} onchange={(e) => onchange(e.currentTarget.value)}>
  {@render children()}
</select>

<style>
  select {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    cursor: pointer;
  }

  select:hover {
    background: color-mix(in srgb, var(--surface-0) 92%, var(--mOnSurface));
  }
</style>
