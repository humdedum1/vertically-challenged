<script lang="ts">
interface Props {
  value: string;
  label: string;
  maxlength: number;
  placeholder?: string;
  /** `name` is null when the rename was cancelled. */
  onrenamed: (name: string | null) => void;
}

let { value, label, maxlength, placeholder, onrenamed }: Props = $props();

// Blur fires after Enter/Escape too (and not at all when the row unmounts), so a flag
// keeps the rename from being committed twice.
let settled = false;

function focusSelect(node: HTMLInputElement) {
  node.focus();
  node.select();
}

function finish(input: HTMLInputElement, commit: boolean): void {
  if (settled) return;
  settled = true;
  onrenamed(commit ? input.value.trim() : null);
}

function onkeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    finish(e.currentTarget, true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    finish(e.currentTarget, false);
  }
}
</script>

<input
  class="rename"
  type="text"
  {maxlength}
  aria-label={label}
  {placeholder}
  {value}
  use:focusSelect
  {onkeydown}
  onblur={(e) => finish(e.currentTarget, true)}
  onclick={(e) => e.stopPropagation()}
  ondblclick={(e) => e.stopPropagation()}
/>

<style>
  .rename {
    flex: 1;
    min-width: 0;
    height: calc(var(--row-height) - 8px);
    padding: 0 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: inherit;
    font-weight: 600;
  }
</style>
