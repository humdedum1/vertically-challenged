<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
  title: string;
  icon?: Snippet;
  trailing?: Snippet;
  children: Snippet;
  /** Fill the available height (the tab list scrolls itself) instead of sizing to content. */
  fill?: boolean;
}

let { title, icon, trailing, children, fill = false }: Props = $props();
</script>

<section class="card" class:fill>
  <header>
    {#if icon}<span class="icon">{@render icon()}</span>{/if}
    <h2>{title}</h2>
    {#if trailing}<span class="trailing">{@render trailing()}</span>{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--glass), var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-1);
    overflow: hidden;
  }

  .card.fill {
    flex: 1;
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px var(--pad-card) 4px;
    color: var(--mOnSurfaceVariant);
  }

  .icon {
    display: grid;
    place-items: center;
  }

  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .trailing {
    display: flex;
    align-items: center;
  }

  .body {
    flex: 1;
    min-height: 0;
  }
</style>
