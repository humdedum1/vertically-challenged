<script lang="ts">
import { formatCombo } from '../../lib/keymap';
import { type Keymap, SHORTCUT_ACTIONS } from '../../settings/schema';
import { SHORTCUTS_HINT } from '../../shared/browser-urls';
import { SHORTCUT_LABELS } from '../panels/settings/shortcut-labels';
import Modal from './Modal.svelte';

let { shortcuts, onclose }: { shortcuts: Keymap; onclose: () => void } = $props();

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
</script>

<Modal title="Keyboard shortcuts" {onclose}>
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
  <p class="note">Change these in Settings → Shortcuts. The panel toggle is set at {SHORTCUTS_HINT}.</p>
</Modal>

<style>
  dl { display: grid; grid-template-columns: fit-content(65%) 1fr; gap: 6px 12px; margin: 0; }
  dt { min-width: 0; }
  dd { margin: 0; color: var(--mOnSurfaceVariant); text-align: right; font-variant-numeric: tabular-nums; }
  .note { margin: 10px 0 0; color: var(--mOnSurfaceVariant); font-size: calc(var(--font-size) - 1px); }
</style>
