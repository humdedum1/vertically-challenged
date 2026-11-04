<script lang="ts">
import { onMount } from 'svelte';
import { browser } from 'wxt/browser';
import Favicon from '../components/Favicon.svelte';
import Icon from '../components/Icon.svelte';
import SegmentCard from '../components/SegmentCard.svelte';
import type { TabState } from '../tab-state.svelte';

// The section is mounted by the Tabs panel; the prop keeps its contract with the other sections.
let { tabState }: { tabState: TabState } = $props();

const STORE_KEY = 'vc.recentlyClosed.collapsed';
const MAX = 10;

type Closed =
  | { kind: 'tab'; sessionId: string; title: string; url: string }
  | { kind: 'window'; sessionId: string; count: number; tabs: { title: string; url: string }[] };

let items = $state.raw<Closed[]>([]);
let loaded = $state(false);
let error = $state<string | null>(null);
let status = $state('');
let collapsed = $state(readCollapsed());
let open = $state.raw<ReadonlySet<string>>(new Set());

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

function toggleCollapsed(): void {
  collapsed = !collapsed;
  try {
    localStorage.setItem(STORE_KEY, collapsed ? '1' : '0');
  } catch {
    // Remembering is a convenience only.
  }
}

async function refresh(): Promise<void> {
  try {
    const own = browser.runtime.getURL('/');
    const list = await browser.sessions.getRecentlyClosed({ maxResults: MAX });
    const out: Closed[] = [];
    for (const s of list) {
      if (s.tab?.sessionId) {
        // Our own panel opened as a tab is noise in this list.
        if (s.tab.url?.startsWith(own)) continue;
        out.push({
          kind: 'tab',
          sessionId: s.tab.sessionId,
          title: s.tab.title ?? '',
          url: s.tab.url ?? '',
        });
      } else if (s.window?.sessionId) {
        const tabs = (s.window.tabs ?? []).map((t) => ({ title: t.title ?? '', url: t.url ?? '' }));
        out.push({ kind: 'window', sessionId: s.window.sessionId, count: tabs.length, tabs });
      }
    }
    items = out;
    error = null;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not read recently closed tabs.';
  } finally {
    loaded = true;
  }
}

onMount(() => {
  void refresh();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChanged = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 100);
  };
  try {
    browser.sessions.onChanged.addListener(onChanged);
  } catch {
    // refresh() reports the error state.
  }
  return () => {
    clearTimeout(timer);
    try {
      browser.sessions.onChanged.removeListener(onChanged);
    } catch {
      // Nothing was registered.
    }
  };
});

async function restore(sessionId: string, what: string): Promise<void> {
  try {
    await browser.sessions.restore(sessionId);
    status = `Restored ${what}.`;
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not restore that item.';
    void refresh();
  }
}

function toggleWindow(id: string): void {
  const next = new Set(open);
  if (!next.delete(id)) next.add(id);
  open = next;
}

const tabLabel = (t: { title: string; url: string }): string => t.title || t.url || 'New Tab';
</script>

<!-- Nothing to restore: drop the card so the tab list gets the height. -->
{#if !(loaded && !error && items.length === 0)}
<SegmentCard title="Recently closed">
  {#snippet icon()}<Icon name="history" size={12} />{/snippet}
  {#snippet trailing()}
    <button
      type="button"
      class="toggle"
      class:open={!collapsed}
      aria-expanded={!collapsed}
      aria-controls="vc-recently-closed"
      aria-label="Recently closed"
      title={collapsed ? 'Show recently closed' : 'Hide recently closed'}
      onclick={toggleCollapsed}
    >
      <Icon name="chevron" size={14} />
    </button>
  {/snippet}

  {#if !collapsed}
    <div class="scroll" id="vc-recently-closed">
      {#if !loaded}
        <p class="empty" role="status">Loading…</p>
      {:else if error}
        <div class="empty" role="alert">
          {error}
          <button type="button" class="retry" onclick={() => void refresh()}>Retry</button>
        </div>
      {:else}
        <ul>
          {#each items as c (c.sessionId)}
            <li>
              {#if c.kind === 'tab'}
                <button
                  type="button"
                  class="item"
                  title="{tabLabel(c)}{c.url ? `\n${c.url}` : ''}"
                  onclick={() => void restore(c.sessionId, 'tab')}
                >
                  <Favicon url={c.url} />
                  <span class="label">{tabLabel(c)}</span>
                </button>
              {:else}
                {@const isOpen = open.has(c.sessionId)}
                <div class="win">
                  <button
                    type="button"
                    class="exp"
                    class:open={isOpen}
                    aria-expanded={isOpen}
                    aria-label="Show tabs of closed window"
                    onclick={() => toggleWindow(c.sessionId)}
                  >
                    <Icon name="chevron" size={12} />
                  </button>
                  <button
                    type="button"
                    class="item"
                    onclick={() => void restore(c.sessionId, 'window')}
                  >
                    <Icon name="windows" size={16} />
                    <span class="label">Window · {c.count} {c.count === 1 ? 'tab' : 'tabs'}</span>
                  </button>
                </div>
                {#if isOpen}
                  <ul class="sub">
                    {#each c.tabs as t, i (i)}
                      <li class="subtab" title={t.url}>
                        <Favicon url={t.url} size={14} />
                        <span class="label">{tabLabel(t)}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  <p class="sr" role="status" aria-live="polite">{status}</p>
</SegmentCard>
{/if}

<style>
  .toggle,
  .exp {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
    transition:
      background-color var(--dur) var(--ease),
      transform var(--dur) var(--ease);
  }

  .toggle {
    width: 26px;
    height: 26px;
  }

  .exp {
    flex: none;
    width: 24px;
    height: 24px;
  }

  .toggle:hover,
  .exp:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .toggle.open,
  .exp.open {
    transform: rotate(90deg);
  }

  /* Capped so the card never pushes the tab list out of view; ~40% of the panel. */
  .scroll {
    max-height: calc(40vh - 36px);
    min-height: 0;
    overflow-y: auto;
    padding: 0 4px 6px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .win {
    display: flex;
    align-items: center;
  }

  .item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px 0 12px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  /* A tab row's button is not in a flex row, so flex: 1 alone wouldn't size it. */
  li > .item {
    width: 100%;
  }

  .win .item {
    padding-left: 4px;
  }

  .item:hover {
    background: var(--state-hover);
  }

  .item:active {
    background: var(--state-pressed);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .sub {
    margin-left: 26px;
  }

  .subtab {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 8px;
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
  }

  .empty {
    margin: 0;
    padding: 6px 12px 10px;
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
  }

  .retry {
    margin-left: 6px;
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--state-selected);
    cursor: pointer;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
