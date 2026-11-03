<script lang="ts">
import { formatCombo } from '../../lib/keymap';
import { type Keymap, SHORTCUT_ACTIONS } from '../../settings/schema';
import { SHORTCUT_LABELS } from '../panels/settings/shortcut-labels';

let { shortcuts, onclose }: { shortcuts: Keymap; onclose: () => void } = $props();

let closeBtn: HTMLButtonElement | undefined = $state();
// Focus moves into the dialog, stays there, and goes back to where it was on close.
const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
$effect(() => closeBtn?.focus());
$effect(() => () => previous?.focus());

/** Keys that always work and cannot be rebound. */
const FIXED: [string, string][] = [
  ['↑ ↓ Home End', 'Move through tabs'],
  ['Alt 1 to 9', 'Jump to the first nine tabs'],
  ['Enter', 'Open the tab'],
  ['Space', 'Select the tab'],
  ['Esc', 'Clear search or selection'],
  ['>', 'Run a command (type it in the search box)'],
  ['?', 'Show this help'],
];

function onkeydown(e: KeyboardEvent): void {
  // The Close button is the only control, so Tab has nowhere else to go inside the dialog.
  if (e.key === 'Tab') {
    e.preventDefault();
    closeBtn?.focus();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    onclose();
  }
}
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="backdrop" role="presentation" onclick={onclose}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <h2>Keyboard shortcuts</h2>
      <button bind:this={closeBtn} type="button" class="close" aria-label="Close shortcuts" onclick={onclose}>Close</button>
    </header>
    <dl>
      {#each SHORTCUT_ACTIONS as a (a)}
        <dt>{SHORTCUT_LABELS[a]}</dt>
        <dd>{shortcuts[a]?.length ? shortcuts[a].map(formatCombo).join(' or ') : 'Not set'}</dd>
      {/each}
      {#each FIXED as [keys, what] (keys)}
        <dt>{what}</dt>
        <dd>{keys}</dd>
      {/each}
    </dl>
    <p class="note">Change these in Settings → Shortcuts. The panel toggle is set at chrome://extensions/shortcuts.</p>
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
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  h2 { margin: 0; font-size: 14px; }
  .close {
    padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-control);
    background: transparent; color: inherit; font: inherit; cursor: pointer;
  }
  .close:hover { background: var(--state-hover); }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; margin: 0; }
  dt { min-width: 0; }
  dd { margin: 0; color: var(--mOnSurfaceVariant); text-align: right; font-variant-numeric: tabular-nums; }
  .note { margin: 10px 0 0; color: var(--mOnSurfaceVariant); font-size: 12px; }
</style>
