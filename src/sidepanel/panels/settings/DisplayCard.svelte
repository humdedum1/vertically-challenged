<script lang="ts">
import type { DisplayMode } from '../../../settings/schema';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'sidebar', label: 'Side panel' },
  { value: 'popup', label: 'In-page popup' },
];

const mode = $derived(settings.value.display.mode);
</script>

<SegmentCard title="Display">
  {#snippet icon()}<Icon name="windows" size={12} />{/snippet}
  <div class="fields">
    <Field label="Open as">
      <SegmentedControl
        label="Open the panel as"
        options={MODES}
        value={mode}
        onchange={(next) => settings.update((s) => ({ ...s, display: { mode: next } }))}
      />
    </Field>
    <p class="muted">
      {#if mode === 'sidebar'}
        The toolbar button and the shortcut open Chrome’s side panel.
      {:else}
        The toolbar button and the shortcut open the panel over the current page; click outside
        it or press Esc to close it. Where pages can’t show it (Chrome pages, the Web Store,
        incognito) it opens in a small window.
      {/if}
    </p>
  </div>
</SegmentCard>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .muted {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }
</style>
