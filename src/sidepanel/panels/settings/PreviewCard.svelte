<script lang="ts">
import type { Settings } from '../../../settings/schema';
import type { GroupInfo, TabInfo } from '../../../shared/types';
import GroupRow from '../../components/GroupRow.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import TabRow from '../../components/TabRow.svelte';

let { settings }: { settings: Settings } = $props();

// Negative ids can't collide with real tabs or groups in the document.
const tab = (id: number, title: string, url: string, over: Partial<TabInfo> = {}): TabInfo => ({
  id,
  windowId: -1,
  title,
  url,
  pinned: false,
  active: false,
  audible: false,
  muted: false,
  discarded: false,
  loading: false,
  groupId: -1,
  incognito: false,
  ...over,
});

const group: GroupInfo = {
  id: -10,
  windowId: -1,
  title: 'Research',
  color: 'blue',
  collapsed: false,
};
const pinned = tab(-1, 'Mail', 'https://mail.example.com/inbox', { pinned: true });
const children = [
  tab(-2, 'Design notes', 'https://docs.example.com/notes', { groupId: -10 }),
  tab(-3, 'Reference', 'https://wiki.example.com/reference', { groupId: -10 }),
];
const loose = [
  tab(-4, 'Music', 'https://music.example.com/live', { audible: true }),
  tab(-5, 'Current page', 'https://example.com/article', { active: true }),
];

const double = $derived(settings.tabs.layout === 'double');
const noop = (): void => {};

// Collapsed by default: the preview is ~250px, a third of a short panel.
let open = $state(false);
</script>

<div class="sticky">
  <SegmentCard title="Preview">
    {#snippet icon()}<Icon name="list" size={12} />{/snippet}
    {#snippet trailing()}
      <button
        type="button"
        class="toggle"
        aria-expanded={open}
        aria-controls="vc-preview-body"
        onclick={() => (open = !open)}
      >
        {open ? 'Hide' : 'Show'}
      </button>
    {/snippet}

    {#if open}
      <!-- Purely visual: the same row components and tokens as the real list. -->
      <div id="vc-preview-body" class="mock" inert aria-hidden="true">
        {#snippet row(t: TabInfo, level: 1 | 2, pinnedEnd = false)}
          <TabRow
            tab={t}
            {level}
            grouped={level === 2}
            nested={false}
            pos={1}
            size={1}
            focused={false}
            selected={false}
            selectedLook={false}
            {pinnedEnd}
            groupColor={level === 2 ? 'var(--g-blue)' : undefined}
            showUrl={double}
            showClose={settings.tabs.showClose}
            showMute={settings.tabs.showMute}
            onclick={noop}
            oncontextmenu={noop}
            onclose={noop}
            onmute={noop}
          />
        {/snippet}
        {@render row(pinned, 1, true)}
        <GroupRow
          {group}
          count={children.length}
          pos={1}
          size={1}
          focused={false}
          renaming={false}
          onclick={noop}
          ondblclick={noop}
          oncontextmenu={noop}
          onrenamed={noop}
        />
        {#each children as c (c.id)}{@render row(c, 2)}{/each}
        {#each loose as l (l.id)}{@render row(l, 1)}{/each}
      </div>
    {/if}
  </SegmentCard>
</div>

<style>
  /* Opaque backdrop so scrolled settings don't show through the gap around the card. */
  .sticky {
    position: sticky;
    top: 0;
    z-index: 5;
    padding-bottom: var(--gap);
    background: var(--mSurface);
  }

  .mock {
    padding: 2px 4px 6px;
  }

  .toggle {
    padding: 2px 8px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
    cursor: pointer;
  }

  .toggle:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }
</style>
