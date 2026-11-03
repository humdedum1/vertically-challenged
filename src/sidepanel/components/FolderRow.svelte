<script lang="ts">
import type { PinFolder } from '../../shared/layout';
import Icon from './Icon.svelte';
import RenameInput from './RenameInput.svelte';

interface Props {
  folder: PinFolder;
  /** Items in the folder subtree. */
  count: number;
  /** 1 at the pinned root, +1 per enclosing folder (drives the indent). */
  depth: number;
  /** Under another window's header. */
  nested: boolean;
  level: number;
  pos: number;
  size: number;
  focused: boolean;
  renaming: boolean;
  onclick: (e: MouseEvent) => void;
  ondblclick: () => void;
  oncontextmenu: (e: MouseEvent) => void;
  /** `name` is null when the rename was cancelled. */
  onrenamed: (name: string | null) => void;
}

let {
  folder,
  count,
  depth,
  nested,
  level,
  pos,
  size,
  focused,
  renaming,
  onclick,
  ondblclick,
  oncontextmenu,
  onrenamed,
}: Props = $props();

const indent = $derived(4 + (depth - 1) * 16 + (nested ? 16 : 0));
</script>

<!-- Keyboard operation is handled on the owning tree via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-row-f{folder.id}"
  class="row"
  class:focused
  style:padding-left="{indent}px"
  role="treeitem"
  tabindex="-1"
  aria-level={level}
  aria-posinset={pos}
  aria-setsize={size}
  aria-expanded={!folder.collapsed}
  aria-selected="false"
  aria-label="{folder.name}, folder, {count} {count === 1 ? 'tab' : 'tabs'}"
  {onclick}
  {oncontextmenu}
>
  <span class="chevron" class:open={!folder.collapsed}><Icon name="chevron" size={12} /></span>
  <span class="ficon" aria-hidden="true"><Icon name={folder.icon} size={15} /></span>
  {#if renaming}
    <RenameInput value={folder.name} label="Folder name" maxlength={100} {onrenamed} />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="title" {ondblclick}>{folder.name}</span>
  {/if}
  <span class="count" aria-hidden="true">{count}</span>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--row-height);
    padding-right: 8px;
    border-radius: var(--radius-row);
    cursor: default;
    user-select: none;
    transition: background-color var(--dur) var(--ease);
  }

  .row:hover {
    background: var(--state-hover);
  }

  .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  :global([role='tree']:not(:focus-visible)) .row.focused {
    outline: none;
  }

  .chevron {
    flex: none;
    display: grid;
    place-items: center;
    width: 14px;
    color: var(--mOnSurfaceVariant);
    transition: transform var(--dur) var(--ease);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /* Folders read as their own thing next to pinned tabs: the tertiary accent, as in the mockup. */
  .ficon {
    flex: none;
    display: grid;
    color: var(--mTertiary);
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .count {
    flex: none;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--mTertiary) 18%, transparent);
    color: var(--mOnSurface);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
