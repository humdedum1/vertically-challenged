<script lang="ts">
import {
  type Ordered,
  type PanelId,
  type SectionId,
  UNHIDEABLE_PANELS,
} from '../../../settings/schema';
import Field from '../../components/controls/Field.svelte';
import ReorderList from '../../components/controls/ReorderList.svelte';
import type { ReorderItem } from '../../components/controls/reorder-types';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import {
  IMPLEMENTED_PANELS,
  IMPLEMENTED_SECTIONS,
  PANEL_LABELS,
  SECTION_LABELS,
} from '../../panel-defs';
import type { SettingsState } from '../../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

const panelItems = $derived(
  settings.value.layout.panels.map((p): ReorderItem<PanelId> => {
    const locked = UNHIDEABLE_PANELS.includes(p.id);
    const soon = !IMPLEMENTED_PANELS.has(p.id);
    return {
      id: p.id,
      label: PANEL_LABELS[p.id],
      visible: p.visible,
      toggleDisabled: locked || soon,
      hint: soon ? 'Coming soon' : locked ? 'Always on' : undefined,
    };
  }),
);

const sectionItems = $derived(
  settings.value.layout.sections.map((s): ReorderItem<SectionId> => {
    const soon = !IMPLEMENTED_SECTIONS.has(s.id);
    return {
      id: s.id,
      label: SECTION_LABELS[s.id],
      visible: s.visible,
      toggleDisabled: s.id === 'tabs' || soon,
      hint: soon ? 'Coming soon' : s.id === 'tabs' ? 'Always on' : undefined,
    };
  }),
);

const reorder = <T extends string>(list: Ordered<T>[], from: number, to: number): Ordered<T>[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item) next.splice(to, 0, item);
  return next;
};
const flip = <T extends string>(list: Ordered<T>[], id: T, visible: boolean): Ordered<T>[] =>
  list.map((x) => (x.id === id ? { ...x, visible } : x));
</script>

<SegmentCard title="Layout">
  {#snippet icon()}<Icon name="list" size={12} />{/snippet}
  <div class="fields">
    <Field label="Panels (top strip)">
      <ReorderList
        label="Panels"
        items={panelItems}
        onmove={(from, to) =>
          settings.update((s) => ({ ...s, layout: { ...s.layout, panels: reorder(s.layout.panels, from, to) } }))}
        ontoggle={(id, visible) =>
          settings.update((s) => ({ ...s, layout: { ...s.layout, panels: flip(s.layout.panels, id, visible) } }))}
      />
    </Field>
    <Field label="Tabs panel sections (top to bottom)">
      <ReorderList
        label="Sections"
        items={sectionItems}
        onmove={(from, to) =>
          settings.update((s) => ({ ...s, layout: { ...s.layout, sections: reorder(s.layout.sections, from, to) } }))}
        ontoggle={(id, visible) =>
          settings.update((s) => ({ ...s, layout: { ...s.layout, sections: flip(s.layout.sections, id, visible) } }))}
      />
    </Field>
  </div>
</SegmentCard>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: calc(var(--gap) + 4px);
    padding: 6px var(--pad-card) var(--pad-card);
  }
</style>
