<script lang="ts">
import { browser } from 'wxt/browser';
import { PARKED, parseSnoozed, SNOOZE_KEY, type Snoozed } from '../../../shared/snooze';
import Button from '../../components/controls/Button.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { TabState } from '../../tab-state.svelte';

let { tabState }: { tabState: TabState } = $props();

let list = $state<Snoozed[]>([]);

$effect(() => {
  const read = async () => {
    list = parseSnoozed((await browser.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY]).sort(
      (a, b) => a.wakeAt - b.wakeAt,
    );
  };
  void read();
  const on = (c: Record<string, unknown>, area: string) => {
    if (area === 'local' && SNOOZE_KEY in c) void read();
  };
  browser.storage.onChanged.addListener(on);
  return () => browser.storage.onChanged.removeListener(on);
});

const when = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });
</script>

{#if list.length > 0}
  <SegmentCard title="Put away">
    {#snippet icon()}<Icon name="history" size={12} />{/snippet}
    {#snippet trailing()}<span class="count" role="img" aria-label="{list.length} tabs put away">{list.length}</span>{/snippet}
    <ul class="list" aria-label="Tabs put away">
      {#each list as s (s.id)}
        <li>
          <div class="meta">
            <span class="title">{s.title || s.url}</span>
            <span class="when">{s.wakeAt === PARKED ? 'Parked, no reminder' : `Back ${when(s.wakeAt)}`}</span>
          </div>
          <div class="actions">
            <Button aria-label="{s.wakeAt === PARKED ? 'Open' : 'Wake'} {s.title || s.url} now" onclick={() => tabState.send({ type: 'wakeSnoozed', id: s.id })}>{s.wakeAt === PARKED ? 'Open now' : 'Wake now'}</Button>
            <Button variant="text" aria-label="Remove {s.title || s.url} from snoozed" onclick={() => tabState.send({ type: 'deleteSnoozed', id: s.id })}>Remove</Button>
          </div>
        </li>
      {/each}
    </ul>
  </SegmentCard>
{/if}

<style>
  .list { margin: 0; padding: 0 var(--pad-card) var(--pad-card); list-style: none; display: flex; flex-direction: column; gap: 8px; }
  li { display: flex; flex-direction: column; gap: 4px; }
  .meta { display: flex; flex-direction: column; min-width: 0; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .when { color: var(--mOnSurfaceVariant); font-size: calc(var(--font-size) - 1px); }
  .actions { display: flex; gap: 6px; }
  .count {
    padding: 1px 7px; border-radius: 999px; background: var(--surface-2);
    border: 1px solid var(--border); color: var(--mOnSurfaceVariant); font-size: var(--font-size-meta);
  }
</style>
