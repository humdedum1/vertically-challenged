<script lang="ts">
import { untrack } from 'svelte';

interface Props {
  /** Names both inputs, e.g. "Accent colour" → "Accent colour picker" / "Accent colour hex". */
  label: string;
  value: string;
  onchange: (hex: string) => void;
}

let { label, value, onchange }: Props = $props();

const HEX = /^#[0-9a-f]{6}$/i;
const normalize = (s: string): string => {
  const t = s.trim();
  return t.startsWith('#') ? t : `#${t}`;
};

// Seeded once; the effect below keeps it in step afterwards.
let text = $state(untrack(() => value));
// Re-sync when the colour changes from outside (picker, theme switch), but leave a
// half-typed value alone as long as it already means the current colour.
$effect(() => {
  if (normalize(text).toLowerCase() !== value.toLowerCase()) text = value;
});

const valid = $derived(HEX.test(normalize(text)));

function onText(e: Event & { currentTarget: HTMLInputElement }): void {
  text = e.currentTarget.value;
  const n = normalize(text);
  if (HEX.test(n)) onchange(n.toLowerCase());
}
</script>

<div class="color">
  <input
    class="picker"
    type="color"
    aria-label="{label} picker"
    value={HEX.test(value) ? value : '#000000'}
    oninput={(e) => onchange(e.currentTarget.value)}
  />
  <input
    class="hex"
    type="text"
    aria-label="{label} hex"
    aria-invalid={!valid}
    maxlength="7"
    spellcheck="false"
    autocomplete="off"
    value={text}
    oninput={onText}
  />
</div>

<style>
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .picker {
    flex: none;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    cursor: pointer;
  }

  .picker::-webkit-color-swatch-wrapper {
    padding: 3px;
  }

  .picker::-webkit-color-swatch {
    border: 0;
    border-radius: calc(var(--radius-control) - 3px);
  }

  .hex {
    width: 92px;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: inherit;
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  }

  .hex[aria-invalid='true'] {
    border-color: var(--mError);
  }
</style>
