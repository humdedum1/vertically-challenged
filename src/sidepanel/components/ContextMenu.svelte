<script lang="ts">
import { tick } from 'svelte';
import ColorPicker from './ColorPicker.svelte';
import Icon from './Icon.svelte';
import type { MenuItem } from './menu-types';

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  label: string;
  onclose: () => void;
}

let { x, y, items, label, onclose }: Props = $props();

interface View {
  title: string;
  items?: MenuItem[];
  colors?: Extract<MenuItem, { type: 'colors' }>;
}

// Submenus replace the list in place (with a Back row) instead of flying out sideways,
// which keeps the menu inside the narrow side panel and keyboard flow linear.
let stack = $state.raw<View[]>([]);
const view = $derived(stack[stack.length - 1]);
const list: MenuItem[] = $derived(
  view
    ? (view.items ?? [])
    : [
        ...items,
        { type: 'separator' },
        { type: 'item', label: 'Reload panel', onselect: () => window.location.reload() },
      ],
);

let el: HTMLDivElement | undefined = $state();
let width = $state(0);
let height = $state(0);
const left = $derived(Math.max(4, Math.min(x, window.innerWidth - width - 4)));
const top = $derived(Math.max(4, Math.min(y, window.innerHeight - height - 4)));

function navItems(): HTMLElement[] {
  if (!el) return [];
  return [...el.querySelectorAll<HTMLElement>('[data-nav]')].filter(
    (n) => n.getAttribute('aria-disabled') !== 'true',
  );
}

async function focusFirst(): Promise<void> {
  await tick();
  navItems()[view?.colors ? 1 : 0]?.focus();
}

$effect(() => {
  void stack;
  void focusFirst();
});

$effect(() => {
  const down = (e: PointerEvent) => {
    if (el && !el.contains(e.target as Node)) onclose();
  };
  const close = () => onclose();
  // Wheel inside the menu scrolls a long menu; only wheel outside closes it.
  const wheel = (e: WheelEvent) => {
    if (el && !el.contains(e.target as Node)) onclose();
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  window.addEventListener('wheel', wheel, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    window.removeEventListener('wheel', wheel);
  };
});

function pop(): void {
  stack = stack.slice(0, -1);
}

function choose(item: MenuItem): void {
  if (item.type === 'item') {
    if (item.disabled) return;
    onclose();
    item.onselect();
  } else if (item.type === 'submenu') {
    stack = [...stack, { title: item.label, items: item.items }];
  } else if (item.type === 'colors') {
    stack = [...stack, { title: item.label, colors: item }];
  }
}

function onkeydown(e: KeyboardEvent): void {
  e.stopPropagation();
  const nav = navItems();
  const at = nav.indexOf(document.activeElement as HTMLElement);
  let next: HTMLElement | undefined;
  switch (e.key) {
    case 'ArrowDown':
      next = nav[(at + 1) % nav.length];
      break;
    case 'ArrowUp':
      next = nav[(at - 1 + nav.length) % nav.length];
      break;
    case 'Home':
      next = nav[0];
      break;
    case 'End':
      next = nav[nav.length - 1];
      break;
    case 'ArrowRight': {
      const cur = nav[at];
      if (cur?.dataset.sub === '') cur.click();
      else return;
      break;
    }
    case 'ArrowLeft':
    case 'Backspace':
      if (stack.length === 0) return;
      pop();
      break;
    case 'Escape':
      onclose();
      break;
    case 'Tab':
      onclose();
      break;
    default: {
      // Typeahead: jump to the next entry starting with the typed letter.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const ch = e.key.toLowerCase();
      const ordered = [...nav.slice(at + 1), ...nav.slice(0, at + 1)];
      next = ordered.find((n) => n.textContent?.trim().toLowerCase().startsWith(ch));
    }
  }
  e.preventDefault();
  next?.focus();
}
</script>

<div
  class="menu"
  role="menu"
  aria-label={label}
  bind:this={el}
  bind:clientWidth={width}
  bind:clientHeight={height}
  style:left="{left}px"
  style:top="{top}px"
  style:visibility={width ? 'visible' : 'hidden'}
  tabindex="-1"
  {onkeydown}
>
  {#if view}
    <button type="button" role="menuitem" class="entry back" data-nav tabindex="-1" onclick={pop}>
      <span class="chev flip"><Icon name="chevron" size={12} /></span>
      <span class="text">{view.title}</span>
    </button>
    <div class="sep" role="separator"></div>
  {/if}

  {#if view?.colors}
    {@const colors = view.colors}
    <ColorPicker
      value={colors.value}
      onpick={(c) => {
        onclose();
        colors.onpick(c);
      }}
    />
  {:else}
    {#each list as item, i (i)}
      {#if item.type === 'separator'}
        <div class="sep" role="separator"></div>
      {:else}
        <button
          type="button"
          role={item.type === 'item' && item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
          aria-checked={item.type === 'item' && item.checked !== undefined ? item.checked : undefined}
          class="entry"
          class:danger={item.type === 'item' && item.danger}
          data-nav
          data-sub={item.type === 'item' ? undefined : ''}
          aria-haspopup={item.type === 'item' ? undefined : 'menu'}
          aria-disabled={item.type === 'item' && item.disabled ? 'true' : undefined}
          tabindex="-1"
          onclick={() => choose(item)}
        >
          {#if item.type === 'item' && item.dot}
            <span class="dot" style:background={item.dot}></span>
          {/if}
          {#if item.type === 'item' && item.icon}
            <span class="glyph"><Icon name={item.icon} size={14} /></span>
          {/if}
          <span class="text">{item.label}</span>
          {#if item.type === 'item' && item.checked}
            <span class="check" aria-hidden="true">✓</span>
          {/if}
          {#if item.type !== 'item'}
            <span class="chev"><Icon name="chevron" size={12} /></span>
          {/if}
        </button>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .check {
    margin-left: auto;
    color: var(--mPrimaryText);
  }

  .menu {
    position: fixed;
    z-index: 100;
    min-width: 190px;
    max-width: calc(100vw - 8px);
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    padding: 4px;
    background: var(--glass), var(--surface-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-2);
    outline: none;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .entry:hover,
  .entry:focus {
    background: var(--state-hover);
  }

  .entry:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .entry[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }

  .entry.danger {
    color: var(--mError);
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .chev {
    display: grid;
    color: var(--mOnSurfaceVariant);
  }

  .flip {
    transform: scaleX(-1);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .glyph {
    flex: none;
    display: grid;
    color: var(--mTertiary);
  }

  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
</style>
