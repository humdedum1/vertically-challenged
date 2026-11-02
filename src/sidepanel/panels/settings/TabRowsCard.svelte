<script lang="ts">
import { normalizeNewTabUrl } from '../../../settings/migrate';
import type { ActionVisibility, TabRowSettings } from '../../../settings/schema';
import Button from '../../components/controls/Button.svelte';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

const ACTIONS: { value: ActionVisibility; label: string }[] = [
  { value: 'hover', label: 'On hover' },
  { value: 'always', label: 'Always' },
];

const t = $derived(settings.value.tabs);

let newTabUrl = $state('');
$effect(() => {
  newTabUrl = t.newTabUrl;
});
const normalizedUrl = $derived(normalizeNewTabUrl(newTabUrl));

function saveNewTabUrl(): void {
  if (normalizedUrl !== null) patch({ newTabUrl: normalizedUrl });
}

function patch(p: Partial<TabRowSettings>): void {
  settings.update((s) => ({ ...s, tabs: { ...s.tabs, ...p } }));
}
</script>

<SegmentCard title="Tabs">
  {#snippet icon()}<Icon name="list" size={12} />{/snippet}
  <div class="fields">
    <Field label="New tab URL" for="vc-new-tab-url">
      <TextInput
        id="vc-new-tab-url"
        label="New tab URL"
        value={newTabUrl}
        placeholder="Browser default"
        maxlength={2048}
        invalid={normalizedUrl === null}
        describedby="vc-new-tab-url-hint"
        oninput={(value) => { newTabUrl = value; }}
        onenter={saveNewTabUrl}
      />
      <p id="vc-new-tab-url-hint" class="hint">
        {#if normalizedUrl === null}
          Enter a full page URL, such as https://example.com.
        {:else}
          Leave blank to use your browser’s default. Applies to new tabs opened from this extension.
        {/if}
      </p>
      <div><Button disabled={normalizedUrl === null || normalizedUrl === t.newTabUrl} onclick={saveNewTabUrl}>Save URL</Button></div>
    </Field>
    <Toggle
      label="Child tabs"
      hint="Nest tabs opened from links under their parent tab."
      checked={t.childTabs}
      onchange={(childTabs) => patch({ childTabs })}
    />
    <Field label="Row buttons">
      <SegmentedControl
        label="Show row buttons"
        options={ACTIONS}
        value={t.actions}
        onchange={(actions) => patch({ actions })}
      />
    </Field>
    <Toggle label="Close button" checked={t.showClose} onchange={(showClose) => patch({ showClose })} />
    <Toggle label="Mute button" checked={t.showMute} onchange={(showMute) => patch({ showMute })} />
    <Toggle
      label="New tab button"
      checked={t.showNewTabButton}
      onchange={(showNewTabButton) => patch({ showNewTabButton })}
    />
    <Toggle label="Tab count" checked={t.showCount} onchange={(showCount) => patch({ showCount })} />
  </div>
</SegmentCard>

<style>
  .hint { margin: 0; color: var(--mOnSurfaceVariant); font-size: 12px; }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }
</style>
