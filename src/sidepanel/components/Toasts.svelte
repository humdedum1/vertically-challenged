<script lang="ts" module>
export interface Toast {
  id: number;
  level: 'info' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}
</script>

<script lang="ts">
interface Props {
  toasts: readonly Toast[];
  ondismiss: (id: number) => void;
}

let { toasts, ondismiss }: Props = $props();

const infos = $derived(toasts.filter((t) => t.level === 'info'));
const errors = $derived(toasts.filter((t) => t.level === 'error'));
</script>

{#snippet item(t: Toast)}
  <div class="toast" class:error={t.level === 'error'}>
    <span class="text">{t.text}</span>
    {#if t.action}
      <button type="button" class="act" onclick={() => { t.action?.run(); ondismiss(t.id); }}>{t.action.label}</button>
    {/if}
    <button type="button" aria-label="Dismiss" onclick={() => ondismiss(t.id)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="m4 4 8 8m0-8-8 8" />
      </svg>
    </button>
  </div>
{/snippet}

<!-- Two persistent live regions: assistive tech announces content added to a region that
     already exists, which it does not for a freshly inserted role=alert element in all cases. -->
<div class="stack">
  <div role="status">
    {#each infos as t (t.id)}{@render item(t)}{/each}
  </div>
  <div role="alert">
    {#each errors as t (t.id)}{@render item(t)}{/each}
  </div>
</div>

<style>
  .stack {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: 10px;
    z-index: 80;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }

  .stack > div {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 6px 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--glass), var(--surface-3);
    color: var(--mOnSurface);
    box-shadow: var(--shadow-2);
    pointer-events: auto;
  }

  .toast.error {
    border-color: var(--mError);
  }

  @media (prefers-reduced-motion: no-preference) {
    .toast {
      animation: rise 160ms var(--ease);
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  button {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
  }

  button:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .act {
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--mPrimary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .act:hover {
    background: var(--state-hover);
  }
</style>
