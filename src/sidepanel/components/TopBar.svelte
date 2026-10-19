<script lang="ts">
import type { ColorMode } from '../../settings/schema';
import Icon, { type IconName } from './Icon.svelte';

interface Props {
  title: string;
  showBack: boolean;
  mode: ColorMode;
  onback: () => void;
  onmode: (next: ColorMode) => void;
}

let { title, showBack, mode, onback, onmode }: Props = $props();

const ORDER: ColorMode[] = ['system', 'light', 'dark'];
const MODE_ICON: Record<ColorMode, IconName> = { system: 'system', light: 'sun', dark: 'moon' };
const next = $derived(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] as ColorMode);
</script>

<header>
  {#if showBack}
    <button type="button" class="round" aria-label="Back" onclick={onback}><Icon name="back" /></button>
  {/if}
  <h1>{title}</h1>
  <button
    type="button"
    class="round"
    aria-label="Colour mode: {mode}. Switch to {next}"
    title="Colour mode: {mode}"
    onclick={() => onmode(next)}
  >
    <Icon name={MODE_ICON[mode]} />
  </button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 2px;
  }

  h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-left: 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 15px;
    font-weight: 600;
  }

  .round {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurface);
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  .round:hover {
    background: var(--state-hover);
  }

  .round:active {
    background: var(--state-pressed);
  }
</style>
