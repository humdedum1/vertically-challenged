<script lang="ts">
import type { DisplayMode } from '../../../settings/schema';
import { BROWSER, FIREFOX } from '../../../shared/browser-urls';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

// Firefox gives a panel framed in a web page no tabs or windows API, so it has no in-page popup.
const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'sidebar', label: FIREFOX ? 'Sidebar' : 'Side panel' },
  ...(FIREFOX ? [] : [{ value: 'popup' as const, label: 'In-page popup' }]),
  { value: 'window', label: 'Window' },
];

// A popup setting that arrived by sync or a backup from Chrome behaves as a window here.
const mode = $derived(
  FIREFOX && settings.value.display.mode === 'popup' ? 'window' : settings.value.display.mode,
);

// Chrome lets extensions read the side (getLayout, Chrome 140+) but not set it.
let side: 'left' | 'right' | null = $state(null);
$effect(() => {
  browser.sidePanel?.getLayout?.().then(
    (l) => (side = l.side),
    () => {},
  );
});

// Asked for (in this click's gesture) only when switching on. The side panel needs a
// notification click as its gesture; the in-page popup needs site access to inject at launch.
async function setOpenOnLaunch(on: boolean): Promise<void> {
  const perm =
    mode === 'popup'
      ? { origins: ['https://*/*', 'http://*/*'] }
      : { permissions: ['notifications' as const] };
  if (on && mode !== 'window' && !(await browser.permissions.request(perm))) return;
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
        The toolbar button and the shortcut open {FIREFOX ? 'the Firefox sidebar' : 'Chrome’s side panel'}.
      {:else if mode === 'window'}
        The toolbar button and the shortcut open the panel in its own small window, which your
        window manager can move and size like any other.
      {:else}
        The toolbar button and the shortcut open the panel over the current page; press Esc{settings
          .value.display.closeOnClickOutside
          ? ' or click outside it'
          : ''} to close it. Drag the bar on its top edge to move it. Where pages can’t show it (Chrome pages, the Web Store,
        incognito) it opens in a small window.
      {/if}
    </p>
    {#if mode === 'sidebar' && !FIREFOX}
      <Field label="Side">
        <Button onclick={() => void browser.tabs.create({ url: 'chrome://settings/appearance' })}>
          {side ? `On the ${side} · ` : ''}Change in Chrome settings
        </Button>
      </Field>
    {/if}
    <Toggle
      label="Open on browser launch"
      hint={mode === 'window'
        ? 'Opens the panel window at launch.'
        : mode === 'popup'
        ? 'Opens the popup over the first page at launch; needs access to sites. Chrome pages (like the New Tab page) get the small window instead.'
        : `${BROWSER} doesn’t let extensions open the panel on their own, so a notification appears at launch; click it to open the panel.`}
      checked={settings.value.display.openOnLaunch}
      onchange={(on) => void setOpenOnLaunch(on)}
    />
    {#if mode !== 'sidebar'}
      <Toggle
        label="Close when clicking outside"
        hint="Off: the panel stays open while you use the page behind it."
        checked={settings.value.display.closeOnClickOutside}
        onchange={(on) =>
          settings.update((s) => ({ ...s, display: { ...s.display, closeOnClickOutside: on } }))}
      />
    {/if}
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
    font-size: calc(var(--font-size) - 1px);
  }
</style>
