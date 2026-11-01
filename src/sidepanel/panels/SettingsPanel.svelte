<script lang="ts">
import { tick } from 'svelte';
import type { Theme } from '../../themes/palette';
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
import ShortcutsCard from './settings/ShortcutsCard.svelte';
import SuspendCard from './settings/SuspendCard.svelte';
import SyncCard from './settings/SyncCard.svelte';
import TabRowsCard from './settings/TabRowsCard.svelte';
import ThemeEditor from './settings/ThemeEditor.svelte';
import ThemesCard from './settings/ThemesCard.svelte';

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
    <div class="cards">
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
        <summary><span><strong>Panel &amp; tabs</strong><small>Display, layout, tab rows and suspension</small></span><Icon name="chevron" size={16} /></summary>
        <div class="category-content">
          <DisplayCard {settings} />
          <LayoutCard {settings} />
          <TabRowsCard {settings} />
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
