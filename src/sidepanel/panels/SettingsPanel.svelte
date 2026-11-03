<script lang="ts">
import { tick } from 'svelte';
import type { Theme } from '../../themes/palette';
import TextInput from '../components/controls/TextInput.svelte';
import Icon from '../components/Icon.svelte';
import type { SettingsState } from '../settings-state.svelte';
import type { TabState } from '../tab-state.svelte';
import type { ThemeDraft } from '../theme-draft.svelte';
import type { ThemeRegistry } from '../theme-registry.svelte';
import AppearanceCard from './settings/AppearanceCard.svelte';
import BackupCard from './settings/BackupCard.svelte';
import DisplayCard from './settings/DisplayCard.svelte';
import LayoutCard from './settings/LayoutCard.svelte';
import PreviewCard from './settings/PreviewCard.svelte';
import RulesCard from './settings/RulesCard.svelte';
import ShortcutsCard from './settings/ShortcutsCard.svelte';
import SuspendCard from './settings/SuspendCard.svelte';
import SyncCard from './settings/SyncCard.svelte';
import TabRowsCard from './settings/TabRowsCard.svelte';
import ThemeEditor from './settings/ThemeEditor.svelte';
import ThemesCard from './settings/ThemesCard.svelte';
import { applySettingsFilter } from './settings-filter';

interface Props {
  settings: SettingsState;
  themes: ThemeRegistry;
  tabState: TabState;
  /** Where the editor publishes its working copy so the whole panel previews it. */
  draft: ThemeDraft;
}

let { settings, themes, tabState, draft }: Props = $props();

interface Editing {
  theme: Theme;
  isNew: boolean;
  origin: { id: string; action: 'edit' | 'duplicate' };
}
let editing = $state.raw<Editing | null>(null);
let saved = $state('');

function focusAction(id: string, action: string): void {
  void tick().then(() => {
    const el = document.querySelector<HTMLElement>(
      `[data-theme-id="${id}"] [data-action="${action}"]`,
    );
    (el ?? document.getElementById('vc-themes-anchor'))?.focus();
  });
}

function open(theme: Theme, origin: Editing['origin']): void {
  saved = '';
  editing = { theme, isNew: origin.action === 'duplicate', origin };
}

function close(focus: { id: string; action: string }): void {
  editing = null;
  focusAction(focus.id, focus.action);
}

async function save(theme: Theme): Promise<string | null> {
  try {
    await themes.save(theme);
  } catch (err) {
    return err instanceof Error ? err.message : 'Couldn’t save the theme';
  }
  settings.update((s) => ({ ...s, appearance: { ...s.appearance, themeId: theme.id } }));
  saved = `Saved “${theme.name}” and switched to it.`;
  close({ id: theme.id, action: 'edit' });
  return null;
}

// Leaving the panel mid-edit discards the draft; the editor's own teardown also clears it.
$effect(() => () => {
  draft.theme = null;
});

let query = $state('');
let cardsEl: HTMLElement | undefined = $state();
let matches = $state(0);
/** The accordions the user had open, restored when the search is cleared. */
let openBefore: boolean[] | null = null;

$effect(() => {
  const q = query;
  const root = cardsEl;
  if (!root) return;
  const details = [...root.querySelectorAll('details')];
  if (q.trim() && !openBefore) openBefore = details.map((d) => d.open);
  matches = applySettingsFilter(root, q);
  if (!q.trim() && openBefore) {
    details.forEach((d, i) => {
      d.open = openBefore?.[i] ?? d.open;
    });
    openBefore = null;
  }
});
</script>

<div class="settings">
  <PreviewCard settings={settings.value} />

  {#if editing}
    {#key editing.theme.id}
      <ThemeEditor
        {settings}
        drafts={draft}
        initial={editing.theme}
        isNew={editing.isNew}
        onsave={save}
        oncancel={() => editing && close(editing.origin)}
      />
    {/key}
  {:else}
    <div class="find">
      <TextInput
        label="Search settings"
        placeholder="Search settings"
        value={query}
        oninput={(v) => (query = v)}
      />
      {#if query.trim()}
        <p class="hint" role="status">
          {matches === 0 ? `No settings match “${query.trim()}”.` : `${matches} ${matches === 1 ? 'setting' : 'settings'} found.`}
        </p>
      {/if}
    </div>
    <div class="cards" bind:this={cardsEl}>
      <details open>
        <summary><span><strong>Appearance</strong><small>Colors, density and themes</small></span><Icon name="chevron" size={16} /></summary>
        <div class="category-content">
          <AppearanceCard {settings} {themes} />
          <!-- Focus fallback when the theme a flow started from no longer has a button. -->
          <span id="vc-themes-anchor" tabindex="-1"></span>
          <ThemesCard {settings} {themes} onedit={open} />
        </div>
      </details>
      <details>
        <summary><span><strong>Panel &amp; tabs</strong><small>Display, layout and tab rows</small></span><Icon name="chevron" size={16} /></summary>
        <div class="category-content">
          <DisplayCard {settings} />
          <LayoutCard {settings} />
          <TabRowsCard {settings} />
        </div>
      </details>
      <details>
        <summary><span><strong>Rules &amp; suspending</strong><small>Site rules, auto-suspend and archiving</small></span><Icon name="chevron" size={16} /></summary>
        <div class="category-content">
          <RulesCard {settings} />
          <SuspendCard {settings} {tabState} />
        </div>
      </details>
      <details>
        <summary><span><strong>Shortcuts</strong><small>Keyboard controls</small></span><Icon name="chevron" size={16} /></summary>
        <div class="category-content"><ShortcutsCard {settings} /></div>
      </details>
      <details>
        <summary><span><strong>Data</strong><small>Sync, backups and restore</small></span><Icon name="chevron" size={16} /></summary>
        <div class="category-content">
          <SyncCard {settings} {tabState} />
          <BackupCard {settings} {themes} />
        </div>
      </details>
    </div>
    <p class="saved" role="status">{saved}</p>
  {/if}
</div>

<style>
  .settings {
    padding-bottom: var(--pad-panel);
  }

  /* Author display rules (flex, grid) would otherwise beat the hidden attribute. */
  :global([data-sf]) {
    display: none !important;
  }

  .find {
    display: grid;
    gap: 6px;
    margin-bottom: var(--gap);
  }

  .hint {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  details {
    border-bottom: 1px solid var(--border);
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap);
    padding: 12px var(--pad-card);
    cursor: pointer;
    list-style: none;
    border-radius: var(--radius-card);
  }

  summary::-webkit-details-marker { display: none; }
  summary:hover { background: var(--surface-1); }
  summary:focus-visible { outline: 2px solid var(--mPrimary); outline-offset: -2px; }
  summary span { display: grid; gap: 4px; min-width: 0; }
  summary strong { font-size: 13px; font-weight: 600; }
  summary small { color: var(--mOnSurfaceVariant); font-size: 12px; }
  details[open] > summary :global(svg) { transform: rotate(90deg); }
  .category-content { display: grid; gap: var(--gap); padding-bottom: var(--gap); }

  .saved {
    margin: var(--gap) 0 0;
    color: var(--mOnSurfaceVariant);
    font-size: 12px;
  }

  .saved:empty {
    display: none;
  }

  #vc-themes-anchor {
    height: 0;
    outline: none;
  }
</style>
