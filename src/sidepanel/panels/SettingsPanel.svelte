<script lang="ts">
import type { ColorMode, Density } from '../../settings/schema';
import { BUILTIN_THEMES, findTheme } from '../../themes/builtin';
import Field from '../components/controls/Field.svelte';
import SegmentedControl from '../components/controls/SegmentedControl.svelte';
import Icon from '../components/Icon.svelte';
import SegmentCard from '../components/SegmentCard.svelte';
import type { SettingsState } from '../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

const MODES: { value: ColorMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const DENSITIES: { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
];

const a = $derived(settings.value.appearance);
const theme = $derived(findTheme(a.themeId));

// "system" resolves through the media query, which is also what the injected stylesheet uses.
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
let systemDark = $state(prefersDark.matches);
$effect(() => {
  const on = (e: MediaQueryListEvent) => {
    systemDark = e.matches;
  };
  prefersDark.addEventListener('change', on);
  return () => prefersDark.removeEventListener('change', on);
});

const effective = $derived(a.mode === 'system' ? (systemDark ? 'dark' : 'light') : a.mode);
const palette = $derived(theme[effective]);
const swatches = $derived([
  ['Primary', palette.mPrimary],
  ['Secondary', palette.mSecondary],
  ['Tertiary', palette.mTertiary],
  ['Surface variant', palette.mSurfaceVariant],
  ['On surface', palette.mOnSurface],
] as const);

function patch(p: Partial<typeof a>): void {
  settings.update((s) => ({ ...s, appearance: { ...s.appearance, ...p } }));
}
</script>

<div class="panel">
  <SegmentCard title="Appearance">
    {#snippet icon()}<Icon name="palette" size={12} />{/snippet}
    <div class="fields">
      <Field label="Colour mode">
        <SegmentedControl label="Colour mode" options={MODES} value={a.mode} onchange={(mode) => patch({ mode })} />
      </Field>

      <Field label="Theme" for="vc-theme-select">
        <div class="theme-row">
          <select id="vc-theme-select" value={a.themeId} onchange={(e) => patch({ themeId: e.currentTarget.value })}>
            {#each BUILTIN_THEMES as t (t.id)}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
          <ul class="swatches" aria-label="Theme preview">
            {#each swatches as [name, color] (name)}
              <li style:background={color} title={name}></li>
            {/each}
          </ul>
        </div>
      </Field>

      <Field label="Density">
        <SegmentedControl label="Density" options={DENSITIES} value={a.density} onchange={(density) => patch({ density })} />
      </Field>
    </div>
  </SegmentCard>
</div>

<style>
  .panel {
    padding-bottom: var(--pad-panel);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: calc(var(--gap) + 4px);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .theme-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  select {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    cursor: pointer;
  }

  select:hover {
    background: color-mix(in srgb, var(--surface-0) 92%, var(--mOnSurface));
  }

  .swatches {
    flex: none;
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .swatches li {
    width: 18px;
    height: 18px;
    margin-left: -5px;
    border-radius: 50%;
    border: 1.5px solid var(--surface-1);
    box-shadow: 0 0 0 1px var(--border);
  }

  .swatches li:first-child {
    margin-left: 0;
  }
</style>
