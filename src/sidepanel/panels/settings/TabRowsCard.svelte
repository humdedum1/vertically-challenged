<script lang="ts">
import type { ActionVisibility, TabRowSettings } from '../../../settings/schema';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
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

function patch(p: Partial<TabRowSettings>): void {
  settings.update((s) => ({ ...s, tabs: { ...s.tabs, ...p } }));
}
</script>

<SegmentCard title="Tab rows">
  {#snippet icon()}<Icon name="list" size={12} />{/snippet}
  <div class="fields">
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
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }
</style>
