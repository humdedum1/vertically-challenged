<script lang="ts">
import type { GroupInfo } from '../../shared/types';
import Icon from './Icon.svelte';
import RenameInput from './RenameInput.svelte';

interface Props {
  group: GroupInfo;
  count: number;
  pos: number;
  size: number;
  /** aria-level: 1, or 2 when nested under a window header. */
  level?: number;
  focused: boolean;
  renaming: boolean;
  onclick: (e: MouseEvent) => void;
  ondblclick: () => void;
  oncontextmenu: (e: MouseEvent) => void;
  /** `title` is null when the rename was cancelled. */
  onrenamed: (title: string | null) => void;
}

let {
  group,
  count,
  pos,
  size,
  level = 1,
  focused,
  renaming,
  onclick,
  ondblclick,
  oncontextmenu,
  onrenamed,
}: Props = $props();

const name = $derived(group.title || 'Unnamed group');
</script>

<!-- Keyboard operation is handled on the owning tree via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-row-g{group.id}"
  class="row"
  class:focused
  class:nested={level > 1}
  style:--gc="var(--g-{group.color})"
  role="treeitem"
  tabindex="-1"
  aria-level={level}
  aria-posinset={pos}
  aria-setsize={size}
  aria-expanded={!group.collapsed}
  aria-selected="false"
  aria-label="{name}, {group.color} group, {count} {count === 1 ? 'tab' : 'tabs'}"
  {onclick}
  {oncontextmenu}
>
  <span class="chevron" class:open={!group.collapsed}><Icon name="chevron" size={12} /></span>
  <span class="dot" aria-hidden="true"></span>
  {#if renaming}
    <RenameInput value={group.title} label="Group name" maxlength={200} {onrenamed} />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="title" class:empty={!group.title} {ondblclick}>{name}</span>
  {/if}
  <span class="count" aria-hidden="true">{count}</span>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--row-height);
    padding: 0 8px 0 4px;
    border-radius: var(--radius-row);
    cursor: default;
    user-select: none;
    transition: background-color var(--dur) var(--ease);
  }

  .row.nested {
    padding-left: 20px;
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

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    margin: 0 4px 0 0;
    border-radius: 50%;
    background: var(--gc);
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .title.empty {
    color: var(--mOnSurfaceVariant);
    font-style: italic;
    font-weight: 500;
  }

  .count {
    flex: none;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--gc) 22%, transparent);
    color: var(--mOnSurface);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
