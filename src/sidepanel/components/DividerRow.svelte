<script lang="ts">
interface Props {
  rowKey: string;
  /** Unpinned tabs Clear would close (all but the active one). */
  clearable: number;
  /** Clear is offered on the panel's own window only. */
  showClear: boolean;
  level: number;
  pos: number;
  size: number;
  focused: boolean;
  onclear: () => void;
  oncontextmenu: (e: MouseEvent) => void;
}

let { rowKey, clearable, showClear, level, pos, size, focused, onclear, oncontextmenu }: Props =
  $props();

const tabsWord = $derived(clearable === 1 ? 'tab' : 'tabs');
</script>

<!-- The Clear button keeps focus on the tree (mousedown default prevented), so it can
     disable itself after the click without dropping focus to the page. -->
<div
  id="vc-row-{rowKey}"
  class="row"
  class:focused
  class:nested={level > 1}
  role="treeitem"
  tabindex="-1"
  aria-level={level}
  aria-posinset={pos}
  aria-setsize={size}
  aria-selected="false"
  aria-label={showClear ? `End of pinned tabs, ${clearable} ${tabsWord} to clear` : 'End of pinned tabs'}
  {oncontextmenu}
>
  <span class="line" aria-hidden="true"></span>
  {#if showClear}
    <button
      class="clear"
      type="button"
      tabindex="-1"
      disabled={clearable === 0}
      title={clearable === 0 ? 'No tabs to clear' : `Close ${clearable} ${tabsWord} (all but the active one)`}
      onmousedown={(e) => e.preventDefault()}
      onclick={(e) => {
        e.stopPropagation();
        onclear();
      }}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v9M4 8.5 8 12.5l4-4" />
      </svg>
      Clear
    </button>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-height);
    padding: 0 6px 0 10px;
    border-radius: var(--radius-row);
    user-select: none;
  }

  .row.nested {
    padding-left: 26px;
  }

  .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  :global([role='tree']:not(:focus-visible)) .row.focused {
    outline: none;
  }

  .line {
    flex: 1;
    height: 1px;
    background: var(--border-strong);
  }

  .clear {
    flex: none;
    display: flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 8px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    font: inherit;
    font-size: var(--font-size-meta);
    cursor: pointer;
    transition:
      background-color var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }

  .clear:hover:not(:disabled) {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .clear:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
