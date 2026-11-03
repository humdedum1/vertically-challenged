<script lang="ts">
import type { PanelMessage } from '../../shared/protocol';
import { PARKED } from '../../shared/snooze';
import type { TabInfo } from '../../shared/types';
import { staleByHost } from '../model/tidy';
import Favicon from './Favicon.svelte';
import Modal from './Modal.svelte';

let {
  tabs,
  send,
  onclose,
}: { tabs: readonly TabInfo[]; send: (m: PanelMessage) => void; onclose: () => void } = $props();

let days = $state(30);
const groups = $derived(staleByHost(tabs, Date.now(), days));
const total = $derived(groups.reduce((n, g) => n + g.tabs.length, 0));
</script>

<Modal title="Tidy up tabs" {onclose}>
  <label class="age">
    Not used for
    <select value={String(days)} onchange={(e) => (days = Number(e.currentTarget.value))}>
      <option value="7">7 days</option>
      <option value="30">30 days</option>
      <option value="90">90 days</option>
    </select>
  </label>
  <p class="count" role="status">
    {total === 0 ? 'Nothing to tidy up.' : `${total} ${total === 1 ? 'tab' : 'tabs'} on ${groups.length} ${groups.length === 1 ? 'site' : 'sites'}.`}
  </p>
  <ul>
    {#each groups as g (g.host)}
      {@const ids = g.tabs.map((t) => t.id)}
      <li>
        <span class="host"><Favicon url={g.tabs[0]?.url ?? ''} size={14} /><span class="name">{g.host}</span><span class="n">{g.tabs.length}</span></span>
        <span class="acts">
          <button type="button" aria-label="Park {g.tabs.length} tabs from {g.host}" onclick={() => send({ type: 'snooze', tabIds: ids, wakeAt: PARKED })}>Park</button>
          <button type="button" class="danger" aria-label="Close {g.tabs.length} tabs from {g.host}" onclick={() => send({ type: 'close', tabIds: ids })}>Close</button>
        </span>
      </li>
    {/each}
  </ul>
  <p class="note">Park keeps them in Sessions → Put away. Closed tabs can be reopened from Recently closed. Pinned, current and audible tabs are never listed.</p>
</Modal>

<style>
  .age { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  select { padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: var(--surface-0); color: inherit; font: inherit; }
  .count { margin: 0 0 8px; color: var(--mOnSurfaceVariant); }
  ul { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .host { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { flex: none; color: var(--mOnSurfaceVariant); font-size: 12px; }
  .acts { display: flex; flex: none; gap: 4px; }
  button { padding: 3px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-control); background: transparent; color: inherit; font: inherit; cursor: pointer; }
  button:hover { background: var(--state-hover); }
  .danger { color: var(--mError); }
  .note { margin: 10px 0 0; color: var(--mOnSurfaceVariant); font-size: 12px; }
</style>
