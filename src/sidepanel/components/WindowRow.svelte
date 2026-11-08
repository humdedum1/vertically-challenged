<script lang="ts">
import type { FolderIcon } from '../../shared/layout';
import Icon from './Icon.svelte';
import RenameInput from './RenameInput.svelte';

interface Props {
  windowId: number;
  /** Layout name, else the window's active tab title, else "Window N". */
  name: string;
  icon?: FolderIcon | null;
  count: number;
  collapsed: boolean;
  incognito: boolean;
  /** The browser window that currently has focus. */
  windowFocused: boolean;
  pos: number;
  size: number;
  focused: boolean;
  renaming: boolean;
  onclick: (e: MouseEvent) => void;
  ondblclick: () => void;
  oncontextmenu: (e: MouseEvent) => void;
  /** `name` is null when the rename was cancelled; an empty string resets to the default. */
  onrenamed: (name: string | null) => void;
}

let {
  windowId,
  name,
  icon = null,
  count,
  collapsed,
  incognito,
  windowFocused,
  pos,
  size,
  focused,
  renaming,
  onclick,
  ondblclick,
  oncontextmenu,
  onrenamed,
}: Props = $props();
</script>

<!-- Keyboard operation is handled on the owning tree via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-row-w{windowId}"
  class="row"
  class:focused
  role="treeitem"
  tabindex="-1"
  aria-level="1"
  aria-posinset={pos}
  aria-setsize={size}
  aria-expanded={!collapsed}
  aria-selected="false"
  aria-label="{name}{incognito ? ', private' : ''}{windowFocused ? ', focused' : ''}, {count} {count === 1 ? 'tab' : 'tabs'}"
  {onclick}
  {oncontextmenu}
>
  <span class="chevron" class:open={!collapsed}><Icon name="chevron" size={12} /></span>
  <span class="glyph" aria-hidden="true"><Icon name={icon ?? 'windows'} size={13} /></span>
  {#if renaming}
    <RenameInput
      value={name}
      label="Window name"
      placeholder="Active tab title"
      maxlength={100}
      {onrenamed}
    />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="title" {ondblclick}>{name}</span>
  {/if}
  {#if windowFocused}<span class="focus-dot" title="Focused window" aria-hidden="true"></span>{/if}
  {#if incognito}<span class="badge" aria-hidden="true">Private</span>{/if}
  <span class="count" aria-hidden="true">{count}</span>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--row-height);
    padding: 0 8px 0 4px;
    border-radius: var(--radius-row);
    /* A section header, not a control: no resting fill (it read as a button), same as group rows. */
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

  .glyph {
    flex: none;
    display: grid;
    color: var(--mOnSurfaceVariant);
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .focus-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--mPrimary);
  }

  .badge {
    flex: none;
    padding: 0 7px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    line-height: 16px;
  }

  .count {
    flex: none;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--mOnSurface);
    font-size: var(--font-size-meta);
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
