<script lang="ts">
import TabList from './components/TabList.svelte';
import { TabState } from './tab-state.svelte';

let tabState = $state.raw(new TabState());

// Retry swaps in a fresh TabState; the effect cleanup disposes the old one.
$effect(() => {
  const s = tabState;
  void s.start();
  return () => s.dispose();
});

const count = $derived(tabState.tabs.length);
</script>

<main>
  <header class="bar">
    <img src="/icon/32.png" width="18" height="18" alt="" />
    <h1>Tabs</h1>
    {#if tabState.status === 'ready'}
      <span class="count" aria-label="{count} tabs">{count}</span>
    {/if}
  </header>

  <section class="card">
    <h2 class="section">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <path d="M2 6.5h12" />
      </svg>
      Open tabs
    </h2>

    <div class="body">
      <!-- The worker is suspended when idle and the port reconnects; keep showing the last
           known list meanwhile instead of unmounting it and losing scroll position. -->
      {#if tabState.status === 'connecting' && count === 0}
        <div class="skeleton" role="status" aria-live="polite">
          <span class="sr">Connecting…</span>
          {#each { length: 8 } as _, i (i)}
            <div class="sk-row" aria-hidden="true"><span class="sk-icon"></span><span class="sk-text" style:width="{45 + ((i * 17) % 40)}%"></span></div>
          {/each}
        </div>
      {:else if tabState.status === 'error'}
        <div class="message" role="alert">
          <p>{tabState.error ?? 'Could not connect to the extension.'}</p>
          <button type="button" onclick={() => (tabState = new TabState())}>Retry</button>
        </div>
      {:else if count === 0}
        <p class="message empty">No tabs in this window</p>
      {:else}
        <TabList tabs={tabState.tabs} send={(m) => tabState.send(m)} />
      {/if}
    </div>
  </section>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px;
    gap: 8px;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px;
  }

  h1 {
    margin: 0;
    flex: 1;
    font-size: 14px;
    font-weight: 600;
  }

  .count {
    min-width: 22px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--mSurfaceVariant);
    border: 1px solid var(--mOutline);
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .card {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: linear-gradient(
      to bottom,
      var(--mSurfaceVariant),
      color-mix(in srgb, var(--mSurfaceVariant) 92%, var(--mSurface))
    );
    border: 1px solid var(--mOutline);
    border-radius: var(--radius-card);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--mShadow) 25%, transparent);
    overflow: hidden;
  }

  .section {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 10px 14px 4px;
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  .message {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    color: var(--mOnSurfaceVariant);
  }

  .message button {
    margin-top: 8px;
    padding: 6px 14px;
    border: 0;
    border-radius: var(--radius-row);
    background: var(--mPrimary);
    color: var(--mOnPrimary);
    font-weight: 600;
    cursor: pointer;
  }

  .skeleton {
    padding: 4px;
  }

  .sk-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-height);
    padding: 0 12px;
  }

  .sk-icon,
  .sk-text {
    background: var(--mOutline);
    border-radius: 4px;
    opacity: 0.5;
  }

  .sk-icon {
    width: 16px;
    height: 16px;
  }

  .sk-text {
    height: 10px;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
