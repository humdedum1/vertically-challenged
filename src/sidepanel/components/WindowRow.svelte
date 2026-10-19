<script lang="ts">
import Icon from './Icon.svelte';

interface Props {
  /** "This window" or "Window N". */
  name: string;
  count: number;
  collapsed: boolean;
  incognito: boolean;
  /** The browser window that currently has focus. */
  windowFocused: boolean;
  pos: number;
  size: number;
  focused: boolean;
  onclick: (e: MouseEvent) => void;
  oncontextmenu: (e: MouseEvent) => void;
}

let {
  name,
  count,
  collapsed,
  incognito,
  windowFocused,
  pos,
  size,
  focused,
  onclick,
  oncontextmenu,
}: Props = $props();
</script>

<!-- Keyboard operation is handled on the owning tree via aria-activedescendant. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
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
  <span class="glyph" aria-hidden="true"><Icon name="windows" size={13} /></span>
  <span class="title">{name}</span>
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
    background: var(--state-hover);
    cursor: default;
    user-select: none;
    transition: background-color var(--dur) var(--ease);
  }

  .row:hover {
    background: var(--state-pressed);
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
    font-size: 10.5px;
    line-height: 16px;
  }

  .count {
    flex: none;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--mOnSurface);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
