<script lang="ts">
import { browser } from 'wxt/browser';
import { SHORTCUTS_HINT } from '../../shared/browser-urls';
import type { SettingsState } from '../settings-state.svelte';
import type { ThemeRegistry } from '../theme-registry.svelte';
import Button from './controls/Button.svelte';
import Field from './controls/Field.svelte';
import Select from './controls/Select.svelte';
import SegmentCard from './SegmentCard.svelte';

/** Set by the worker on a fresh install only, so existing users never see this. */
export const WELCOME_KEY = 'vc:welcome';

let { settings, themes }: { settings: SettingsState; themes: ThemeRegistry } = $props();

let show = $state(false);
$effect(() => {
  void browser.storage.local.get(WELCOME_KEY).then((s) => {
    show = s[WELCOME_KEY] === 'pending';
  });
});

function done(): void {
  show = false;
  void browser.storage.local.set({ [WELCOME_KEY]: 'done' });
}
</script>

{#if show}
  <SegmentCard title="Welcome">
    <div class="body">
      <p class="lead">Your tabs, in a fast vertical list. Three things worth knowing:</p>
      <Field label="Pick a theme" for="vc-welcome-theme">
        <Select
          id="vc-welcome-theme"
          value={settings.value.appearance.themeId}
          onchange={(id) => settings.update((s) => ({ ...s, appearance: { ...s.appearance, themeId: id } }))}
        >
          {#each themes.all as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </Select>
      </Field>
      <p>Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> to open or close this panel. You can change it at {SHORTCUTS_HINT}.</p>
      <p>Type <kbd>&gt;</kbd> in the search box to run commands. Right-click a tab for snooze, suspend and more.</p>
      <div class="row"><Button variant="primary" onclick={done}>Got it</Button></div>
    </div>
  </SegmentCard>
{/if}

<style>
  .body { display: flex; flex-direction: column; gap: var(--gap); padding: 4px var(--pad-card) var(--pad-card); }
  p { margin: 0; }
  .lead { font-weight: 500; }
  kbd {
    padding: 0 5px; border: 1px solid var(--border-strong); border-radius: 4px;
    background: var(--surface-0); font: inherit; font-size: calc(var(--font-size) - 1px);
  }
  .row { display: flex; }
</style>
