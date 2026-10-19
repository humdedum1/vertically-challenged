<script lang="ts">
import type { PanelMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import TabRow from './TabRow.svelte';
import VirtualList from './VirtualList.svelte';

/** Must match --row-height in base.css; applied inline below so there is one source. */
const ROW_HEIGHT = 34;

interface Props {
  tabs: TabInfo[];
  send: (msg: PanelMessage) => void;
}

let { tabs, send }: Props = $props();

let list: ReturnType<typeof VirtualList<TabInfo>> | undefined = $state();
let focusedIndex = $state(0);
// Plain fields: only read inside the tabs effect, which must not re-run on them.
let focusedId: number | null = null;
let lastIndex = 0;
let activeId: number | null = null;

const focusedTab = $derived(tabs[focusedIndex]);

$effect(() => {
  if (tabs.length === 0) {
    focusedId = null;
    activeId = null;
    return;
  }
  const active = tabs.findIndex((t) => t.active);
  const nextActiveId = tabs[active]?.id ?? null;
  // Follow the active tab when it changes from outside (Ctrl+Tab, tab strip, first load),
  // so the highlight and scroll position track what the user is looking at.
  if (nextActiveId !== activeId) {
    activeId = nextActiveId;
    if (active !== -1) {
      setFocus(active);
      return;
    }
  }
  // Position can shift under us (moves, closes); follow the tab, or hold the index if it's gone.
  const i = tabs.findIndex((t) => t.id === focusedId);
  setFocus(i === -1 ? Math.min(lastIndex, tabs.length - 1) : i, false);
});

function setFocus(index: number, scroll = true): void {
  const i = Math.max(0, Math.min(index, tabs.length - 1));
  lastIndex = i;
  focusedIndex = i;
  focusedId = tabs[i]?.id ?? null;
  if (scroll) list?.reveal(i);
}

function onkeydown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tab = focusedTab;
  switch (e.key) {
    case 'ArrowDown':
      setFocus(focusedIndex + 1);
      break;
    case 'ArrowUp':
      setFocus(focusedIndex - 1);
      break;
    case 'Home':
      setFocus(0);
      break;
    case 'End':
      setFocus(tabs.length - 1);
      break;
    case 'Enter':
    case ' ':
      if (tab) send({ type: 'activate', tabId: tab.id });
      break;
    case 'Delete':
      if (tab) send({ type: 'close', tabIds: [tab.id] });
      break;
    default:
      return;
  }
  e.preventDefault();
}
</script>

<div class="wrap" style:--row-height="{ROW_HEIGHT}px">
  <VirtualList
    bind:this={list}
    items={tabs}
    rowHeight={ROW_HEIGHT}
    key={(t) => t.id}
    role="listbox"
    aria-label="Tabs in this window"
    tabindex={0}
    aria-activedescendant={focusedTab ? `vc-tab-${focusedTab.id}` : undefined}
    {onkeydown}
    onfocus={() => list?.reveal(focusedIndex)}
  >
    {#snippet row(tab, index)}
      <TabRow
        {tab}
        focused={index === focusedIndex}
        posinset={index + 1}
        setsize={tabs.length}
        onactivate={() => {
          setFocus(index, false);
          send({ type: 'activate', tabId: tab.id });
        }}
        onclose={() => send({ type: 'close', tabIds: [tab.id] })}
      />
    {/snippet}
  </VirtualList>
</div>

<style>
  .wrap {
    height: 100%;
    min-height: 0;
  }

  .wrap :global([role='listbox']) {
    padding: 4px;
    outline: none;
  }
</style>
