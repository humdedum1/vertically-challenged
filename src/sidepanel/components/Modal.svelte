<script lang="ts">
import type { Snippet } from 'svelte';

let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } =
  $props();

let dialog: HTMLElement | undefined = $state();
// Focus moves into the dialog, cycles inside it, and goes back to where it was on close.
const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
$effect(() => {
  dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
});
$effect(() => () => previous?.focus());

const focusables = (): HTMLElement[] =>
  [
    ...(dialog?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ].filter((el) => !el.hasAttribute('disabled'));

function onkeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    onclose();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables();
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const at = document.activeElement;
  if (e.shiftKey && at === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  } else if (!dialog?.contains(at)) {
    e.preventDefault();
    first.focus();
  }
}
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="backdrop" role="presentation" onclick={onclose}>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => {}}
  >
    <header>
      <h2>{title}</h2>
      <button type="button" class="close" data-autofocus aria-label="Close {title.toLowerCase()}" onclick={onclose}>Close</button>
    </header>
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: start center;
    padding: 56px 12px 12px;
    background: color-mix(in srgb, var(--mScrim, #000) 45%, transparent);
  }
  .dialog {
    width: min(100%, 420px);
    max-height: calc(100vh - 80px);
    overflow: auto;
    padding: 12px var(--pad-card) var(--pad-card);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-card);
    background: var(--mSurface);
    color: var(--mOnSurface);
    box-shadow: var(--shadow-2, 0 8px 28px rgb(0 0 0 / 0.35));
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
  }
  .close {
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .close:hover {
    background: var(--state-hover);
  }
</style>
