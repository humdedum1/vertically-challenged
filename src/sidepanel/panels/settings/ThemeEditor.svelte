<script lang="ts">
import { onMount, untrack } from 'svelte';
import { contrastIssues } from '../../../themes/contrast';
import { type Palette, ROLES, type Role, type Theme } from '../../../themes/palette';
import { MAX_NAME } from '../../../themes/transfer';
import Button from '../../components/controls/Button.svelte';
import ColorField from '../../components/controls/ColorField.svelte';
import Field from '../../components/controls/Field.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import type { ThemeDraft } from '../../theme-draft.svelte';

interface Props {
  settings: SettingsState;
  initial: Theme;
  isNew: boolean;
  drafts: ThemeDraft;
  /** Resolves with an error message, or null when saved. */
  onsave: (theme: Theme) => Promise<string | null>;
  oncancel: () => void;
}

let { settings, initial, isNew, drafts, onsave, oncancel }: Props = $props();

let draft = $state.raw<Theme>(structuredClone($state.snapshot(untrack(() => initial))));
let editing = $state<'dark' | 'light'>('dark');
let saving = $state(false);
let error = $state('');
let heading: HTMLHeadingElement | undefined = $state();

// The app applies the draft, so every keystroke previews across the whole panel.
$effect(() => {
  drafts.theme = draft;
  drafts.mode = editing;
});
onMount(() => {
  heading?.focus();
  return () => {
    drafts.theme = null;
  };
});

// "Surface variant", "On surface variant": role names read as words.
export function humanize(role: Role): string {
  const words = role
    .slice(1)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const palette = $derived(draft[editing]);
const issues = $derived(contrastIssues(draft));
const hint = $derived(
  `The panel previews the ${editing} palette while you edit.${settings.value.appearance.accent ? ' An accent colour is set and replaces the primary colour.' : ''}`,
);

function setRole(role: Role, hex: string): void {
  const next: Palette = { ...draft[editing], [role]: hex };
  draft = { ...draft, [editing]: next };
}

const MODES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

async function save(): Promise<void> {
  if (saving) return;
  saving = true;
  error = '';
  const err = await onsave(draft);
  saving = false;
  if (err) error = err;
}

function onkeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault();
    oncancel();
  }
}

const level = (ratio: number): { text: string; large: boolean } =>
  ratio >= 3 ? { text: 'AA large text only', large: true } : { text: 'Fails AA', large: false };
</script>

<!-- Escape from anywhere inside the editor cancels, like a dialog. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" {onkeydown}>
  <SegmentCard title={isNew ? 'New theme' : 'Edit theme'}>
    {#snippet icon()}<Icon name="palette" size={12} />{/snippet}
    <div class="body">
      <h3 bind:this={heading} tabindex="-1">{draft.name}</h3>

      <Field label="Name" for="vc-theme-name">
        <TextInput
          id="vc-theme-name"
          label="Theme name"
          value={draft.name}
          maxlength={MAX_NAME}
          oninput={(name) => (draft = { ...draft, name })}
        />
      </Field>

      <Field label="Palette">
        <SegmentedControl label="Palette to edit" options={MODES} value={editing} onchange={(m) => (editing = m)} />
      </Field>
      <p class="hint">{hint}</p>

      <ul class="roles" aria-label="{editing} palette colours">
        {#each ROLES as role (role)}
          <li>
            <span class="role">{humanize(role)}</span>
            <ColorField label="{humanize(role)} ({editing})" value={palette[role]} onchange={(hex) => setRole(role, hex)} />
          </li>
        {/each}
      </ul>

      <section class="contrast" aria-labelledby="vc-contrast-h">
        <h4 id="vc-contrast-h">Text contrast</h4>
        <p class="summary" role="status">
          {issues.length === 0
            ? 'All text pairs meet WCAG AA (4.5:1) in both palettes.'
            : `${issues.length} text ${issues.length === 1 ? 'pair is' : 'pairs are'} below WCAG AA (4.5:1).`}
        </p>
        {#if issues.length > 0}
          <ul class="issues">
            {#each issues as i (`${i.mode}-${i.fg}-${i.bg}`)}
              {@const l = level(i.ratio)}
              <li>
                <span class="pair">{humanize(i.fg)} on {humanize(i.bg).toLowerCase()}<small>{i.mode}</small></span>
                <span class="ratio">{i.ratio.toFixed(1)}:1</span>
                <span class="aa" class:large={l.large}>{l.text}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <p class="error" role="alert">{error}</p>

      <div class="buttons">
        <Button variant="primary" disabled={saving || draft.name.trim() === ''} onclick={save}>Save theme</Button>
        <Button variant="text" onclick={oncancel}>Cancel</Button>
      </div>
    </div>
  </SegmentCard>
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  h3 {
    margin: 0;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3:focus-visible {
    outline-offset: 3px;
  }

  h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .hint {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
  }

  .roles {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .roles li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .role {
    color: var(--mOnSurface);
  }

  .contrast {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-row);
    background: var(--surface-0);
  }

  .summary {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }

  .issues {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
  }

  .issues li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pair {
    flex: 1;
    min-width: 0;
  }

  .pair small {
    margin-left: 6px;
    color: var(--mOnSurfaceVariant);
    font-size: 10.5px;
  }

  .ratio {
    font-variant-numeric: tabular-nums;
  }

  .aa {
    flex: none;
    padding: 1px 8px;
    border: 1px solid var(--mError);
    border-radius: 999px;
    color: var(--mError);
    font-size: 10.5px;
    font-weight: 600;
  }

  .aa.large {
    border-color: var(--mTertiary);
    color: var(--mOnSurface);
  }

  .error {
    margin: 0;
    color: var(--mError);
    font-size: 12px;
  }

  .error:empty {
    display: none;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }
</style>
