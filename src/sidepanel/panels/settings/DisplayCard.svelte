<script lang="ts">
import type { DisplayMode } from '../../../settings/schema';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'sidebar', label: 'Side panel' },
  { value: 'popup', label: 'In-page popup' },
];

const mode = $derived(settings.value.display.mode);

// Chrome lets extensions read the side (getLayout, Chrome 140+) but not set it.
let side: 'left' | 'right' | null = $state(null);
$effect(() => {
  browser.sidePanel?.getLayout?.().then(
    (l) => (side = l.side),
    () => {},
  );
});

// Notifications are optional: asked for (in this click's gesture) only when switching on.
async function setOpenOnLaunch(on: boolean): Promise<void> {
  if (on && !(await browser.permissions.request({ permissions: ['notifications'] }))) return;
  settings.update((s) => ({ ...s, display: { ...s.display, openOnLaunch: on } }));
}
</script>

<SegmentCard title="Display">
  {#snippet icon()}<Icon name="windows" size={12} />{/snippet}
  <div class="fields">
    <Field label="Open as">
      <SegmentedControl
        label="Open the panel as"
        options={MODES}
        value={mode}
        onchange={(next) => settings.update((s) => ({ ...s, display: { ...s.display, mode: next } }))}
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
    {#if mode === 'sidebar'}
      <Field label="Side">
        <Button onclick={() => void browser.tabs.create({ url: 'chrome://settings/appearance' })}>
          {side ? `On the ${side} · ` : ''}Change in Chrome settings
        </Button>
      </Field>
    {/if}
    <Toggle
      label="Open on browser launch"
      hint="Chrome doesn’t let extensions open the panel on their own, so a notification appears at launch; click it to open the panel."
      checked={settings.value.display.openOnLaunch}
      onchange={(on) => void setOpenOnLaunch(on)}
    />
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
