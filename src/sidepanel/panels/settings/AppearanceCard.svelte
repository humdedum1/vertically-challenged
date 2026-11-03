<script lang="ts">
import { migrateSettings } from '../../../settings/migrate';
import {
  type Appearance,
  type ColorMode,
  type Density,
  FONT_PRESETS,
  LIMITS,
  type RowLayout,
} from '../../../settings/schema';
import { BUILTIN_THEMES } from '../../../themes/builtin';
import { contrastRatio } from '../../../themes/contrast';
import ColorField from '../../components/controls/ColorField.svelte';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import Select from '../../components/controls/Select.svelte';
import Slider from '../../components/controls/Slider.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Toggle from '../../components/controls/Toggle.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import { customCss, MAX_CUSTOM_CSS } from '../../custom-css.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import type { ThemeRegistry } from '../../theme-registry.svelte';
import { SystemDark } from './system-dark.svelte';

let { settings, themes }: { settings: SettingsState; themes: ThemeRegistry } = $props();

const MODES: { value: ColorMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const DENSITIES: { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
];
const LAYOUTS: { value: RowLayout; label: string }[] = [
  { value: 'single', label: 'Single line' },
  { value: 'double', label: 'Title + URL' },
];
const CUSTOM_FONT = '__custom';

const a = $derived(settings.value.appearance);
const system = new SystemDark();
$effect(system.start);

const palette = $derived(themes.resolve(a.themeId)[system.resolve(a.mode)]);
const swatches = $derived([
  ['Primary', palette.mPrimary],
  ['Secondary', palette.mSecondary],
  ['Tertiary', palette.mTertiary],
  ['Surface variant', palette.mSurfaceVariant],
  ['On surface', palette.mOnSurface],
] as const);

function patch(p: Partial<Appearance>): void {
  settings.update((s) => ({ ...s, appearance: { ...s.appearance, ...p } }));
}

// --- Font ------------------------------------------------------------------------------
const isPreset = (f: string): boolean => FONT_PRESETS.some((p) => p.value === f);
let customFont = $state(false);
let fontText = $state('');
let fontError = $state<string | null>(null);

// Follows outside changes too (reset, backup import, another window).
$effect(() => {
  const f = a.fontFamily;
  customFont = !isPreset(f);
  fontText = f;
  fontError = null;
});

function onFontSelect(v: string): void {
  if (v === CUSTOM_FONT) {
    customFont = true;
    return;
  }
  customFont = false;
  fontError = null;
  patch({ fontFamily: v });
}

// Validation lives in migrate; a rejected font would silently become the default, so the
// candidate is sanitised first and applied only if it survives unchanged.
function onFontText(v: string): void {
  fontText = v;
  const ok =
    migrateSettings({ ...settings.value, appearance: { ...a, fontFamily: v } }).appearance
      .fontFamily === v;
  if (ok) {
    fontError = null;
    patch({ fontFamily: v });
  } else {
    fontError =
      'Use letters, digits, spaces, commas, quotes and hyphens only (up to 200 characters).';
  }
}

// --- Accent ----------------------------------------------------------------------------
const accentRatio = $derived(a.accent ? contrastRatio(a.accent, palette.mSurface) : null);
</script>

<SegmentCard title="Appearance">
  {#snippet icon()}<Icon name="palette" size={12} />{/snippet}
  <div class="fields">
    <Field label="Colour mode">
      <SegmentedControl label="Colour mode" options={MODES} value={a.mode} onchange={(mode) => patch({ mode })} />
    </Field>

    <Field label="Theme" for="vc-theme-select">
      <div class="theme-row">
        <Select id="vc-theme-select" value={a.themeId} onchange={(themeId) => patch({ themeId })}>
          <optgroup label="Built-in">
            {#each BUILTIN_THEMES as t (t.id)}
              <option value={t.id}>{t.name}</option>
            {/each}
          </optgroup>
          {#if themes.custom.length > 0}
            <optgroup label="Custom">
              {#each themes.custom as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
            </optgroup>
          {/if}
        </Select>
        <ul class="swatches" aria-label="Theme colours">
          {#each swatches as [name, color] (name)}
            <li style:background={color} title={name}></li>
          {/each}
        </ul>
      </div>
    </Field>

    <Field label="Density">
      <SegmentedControl label="Density" options={DENSITIES} value={a.density} onchange={(density) => patch({ density })} />
    </Field>

    <Field label="Row layout">
      <SegmentedControl
        label="Row layout"
        options={LAYOUTS}
        value={settings.value.tabs.layout}
        onchange={(layout) => settings.update((s) => ({ ...s, tabs: { ...s.tabs, layout } }))}
      />
    </Field>

    <Field label="Corner radius">
      <Slider
        label="Corner radius"
        value={a.radius}
        min={LIMITS.radius.min}
        max={LIMITS.radius.max}
        unit="px"
        onchange={(radius) => patch({ radius })}
      />
    </Field>

    <Field label="Font size">
      <Slider
        label="Font size"
        value={a.fontSize}
        min={LIMITS.fontSize.min}
        max={LIMITS.fontSize.max}
        unit="px"
        onchange={(fontSize) => patch({ fontSize })}
      />
    </Field>

    <Field label="Font" for="vc-font-select">
      <Select id="vc-font-select" value={customFont ? CUSTOM_FONT : a.fontFamily} onchange={onFontSelect}>
        {#each FONT_PRESETS as f (f.value)}
          <option value={f.value}>{f.label}</option>
        {/each}
        <option value={CUSTOM_FONT}>Custom…</option>
      </Select>
      {#if customFont}
        <TextInput
          id="vc-font-custom"
          label="Custom font family"
          value={fontText}
          oninput={onFontText}
          maxlength={200}
          placeholder={'"Fira Sans", sans-serif'}
          invalid={fontError !== null}
          describedby="vc-font-error"
          mono
        />
      {/if}
      <p id="vc-font-error" class="error" role="alert">{fontError ?? ''}</p>
      <p class="hint">Only fonts installed on this computer are used.</p>
    </Field>

    <Field label="Accent colour">
      <Toggle
        label="Use theme colour"
        checked={a.accent === null}
        onchange={(on) => patch({ accent: on ? null : palette.mPrimary })}
      />
      {#if a.accent}
        <ColorField label="Accent colour" value={a.accent} onchange={(accent) => patch({ accent })} />
        <p class="hint" class:warn={accentRatio !== null && accentRatio < 3} role="status">
          {#if accentRatio !== null}
            Contrast against the surface: {accentRatio.toFixed(1)}:1{accentRatio < 3
              ? '. Below 3:1, so the accent may be hard to see.'
              : '.'}
          {/if}
        </p>
      {/if}
    </Field>

    <Field label="Animations">
      <SegmentedControl
        label="Animations"
        options={[
          { value: 'system', label: 'Follow system' },
          { value: 'reduce', label: 'Reduced' },
          { value: 'full', label: 'On' },
        ]}
        value={a.motion}
        onchange={(motion) => patch({ motion })}
      />
    </Field>

    <Field label="Custom CSS" for="vc-custom-css-input">
      <textarea
        id="vc-custom-css-input"
        class="css"
        spellcheck="false"
        maxlength={MAX_CUSTOM_CSS}
        placeholder={'[role="treeitem"] { font-weight: 500; }'}
        value={customCss.value}
        oninput={(e) => customCss.set(e.currentTarget.value)}
      ></textarea>
      <p class="hint">
        Applied after the theme, in this browser only (not synced). Theme colours are CSS
        variables such as <code>var(--mPrimary)</code>.
      </p>
    </Field>
  </div>
</SegmentCard>

<style>
  .css {
    box-sizing: border-box;
    width: 100%;
    min-height: 96px;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: 12px/1.4 var(--font-mono, ui-monospace, monospace);
    resize: vertical;
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

  .hint,
  .error {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .error {
    color: var(--mError);
  }

  .error:empty {
    display: none;
  }

  .warn {
    color: var(--mError);
  }
</style>
