<script lang="ts" module>
/**
 * Horizontal space the row takes from the list width before the tiles: the tree's padding
 * (4 + 4) plus this row's own (28 + 6). TabList subtracts it before working out how many
 * tiles fit, so chunks match what the row can hold.
 */
export const TILES_ROW_INSET = 8 + 28 + 6;
</script>

<script lang="ts">
import type { PinItem } from '../../shared/layout';
import type { TabInfo } from '../../shared/types';
import type { TintCache } from '../tint-cache.svelte';
import EssentialTile from './EssentialTile.svelte';

interface Props {
  rowKey: string;
  tiles: readonly { item: PinItem; tab: TabInfo | null }[];
  tints: TintCache;
  /** Owning window's name, for the row label. */
  windowName: string;
  level: number;
  pos: number;
  size: number;
  focused: boolean;
  onopen: (item: PinItem) => void;
  onclose: (item: PinItem) => void;
  oncontextmenu: (e: MouseEvent, item: PinItem | null) => void;
}

let {
  rowKey,
  tiles,
  tints,
  windowName,
  level,
  pos,
  size,
  focused,
  onopen,
  onclose,
  oncontextmenu,
}: Props = $props();

const titleOf = (t: { item: PinItem; tab: TabInfo | null }): string =>
  t.tab?.title || t.item.title || t.item.homeUrl;
// The tiles themselves are hidden from assistive tech; the row names them in order.
const label = $derived(`Staples of ${windowName}: ${tiles.map(titleOf).join(', ')}`);
</script>

<!-- Keys are handled on the owning tree via aria-activedescendant (Enter / menu key list the tiles). -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  id="vc-row-{rowKey}"
  class="row"
  class:focused
  role="treeitem"
  tabindex="-1"
  aria-level={level}
  aria-posinset={pos}
  aria-setsize={size}
  aria-selected="false"
  aria-label={label}
  oncontextmenu={(e) => oncontextmenu(e, null)}
>
  {#each tiles as t, i (t.item.id)}
    <EssentialTile
      item={t.item}
      tab={t.tab}
      tint={tints.get(t.item.lastUrl || t.item.homeUrl)}
      index={i}
      tabbable={false}
      mini
      onopen={() => onopen(t.item)}
      onclose={() => onclose(t.item)}
      onhome={() => {}}
      onmute={() => {}}
      oncontextmenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        oncontextmenu(e, t.item);
      }}
      onfocus={() => {}}
    />
  {/each}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--row-height);
    padding: 0 6px 0 28px;
    border-radius: var(--radius-row);
    user-select: none;
  }

  .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  :global([role='tree']:not(:focus-visible)) .row.focused {
    outline: none;
  }
</style>
