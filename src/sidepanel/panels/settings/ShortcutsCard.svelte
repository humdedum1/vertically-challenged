<script lang="ts">
import { browser } from 'wxt/browser';
import { chromeUse, comboFromEvent, findConflicts, formatCombo } from '../../../lib/keymap';
import {
  DEFAULT_SETTINGS,
  MAX_BINDINGS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
} from '../../../settings/schema';
import { FIREFOX } from '../../../shared/browser-urls';
import Button from '../../components/controls/Button.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';
import { SHORTCUT_LABELS as LABELS } from './shortcut-labels';

let { settings }: { settings: SettingsState } = $props();

const keymap = $derived(settings.value.shortcuts);
const conflicts = $derived(findConflicts(keymap));

function set(action: ShortcutAction, combos: string[]): void {
  settings.update((s) => ({ ...s, shortcuts: { ...s.shortcuts, [action]: combos } }));
}

/** Other actions sharing any of this action's combos, for the inline warning. */
function clashes(action: ShortcutAction): string[] {
  const out: string[] = [];
  for (const combo of keymap[action]) {
    const others = (conflicts.get(combo) ?? []).filter((a) => a !== action);
    for (const o of others) out.push(`${formatCombo(combo)} is also bound to ${LABELS[o]}`);
    const chrome = chromeUse(combo);
    if (chrome)
      out.push(`Chrome uses ${formatCombo(combo)} to ${chrome}; it may never reach the panel`);
  }
  return out;
}

// --- Key capture -----------------------------------------------------------------------

interface Capture {
  action: ShortcutAction;
  /** Index being replaced, or -1 when adding. */
  slot: number;
}
let capture = $state<Capture | null>(null);
let warning = $state('');

// A single printable character (optionally with Shift) and no Ctrl/Alt/Meta.
const isBare = (combo: string): boolean => /^(Shift\+)?[^+]$/.test(combo) || combo === '+';

function focusCapture(node: HTMLButtonElement): void {
  node.focus();
}

function commit(c: Capture, combo: string): void {
  const list = [...keymap[c.action]];
  if (c.slot >= 0) list[c.slot] = combo;
  else list.push(combo);
  set(c.action, [...new Set(list)].slice(0, MAX_BINDINGS));
  warning = isBare(combo)
    ? `${formatCombo(combo)} has no modifier, so it also fires whenever the tab list has focus.`
    : '';
}

function onCaptureKey(e: KeyboardEvent): void {
  const c = capture;
  if (!c) return;
  // Tab must keep moving focus; a trapped keyboard user could never leave the field.
  if (e.key === 'Tab') return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    capture = null;
    return;
  }
  if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    if (c.slot >= 0)
      set(
        c.action,
        keymap[c.action].filter((_, i) => i !== c.slot),
      );
    capture = null;
    warning = '';
    return;
  }
  const combo = comboFromEvent(e);
  if (combo === null) return; // a lone modifier: keep waiting for the real key
  commit(c, combo);
  capture = null;
}

function reset(): void {
  settings.update((s) => ({
    ...s,
    shortcuts: Object.fromEntries(
      SHORTCUT_ACTIONS.map((a) => [a, [...DEFAULT_SETTINGS.shortcuts[a]]]),
    ) as typeof s.shortcuts,
  }));
  capture = null;
  warning = '';
}

// --- Chrome-level shortcuts ------------------------------------------------------------

interface BrowserCommand {
  name: string;
  description: string;
  shortcut: string;
}
let commands = $state<BrowserCommand[] | null>(null);

$effect(() => {
  let alive = true;
  browser.commands
    .getAll()
    .then((all) => {
      if (!alive) return;
      commands = all
        .filter((c) => c.name && c.description)
        .map((c) => ({
          name: c.name as string,
          description: c.description as string,
          shortcut: c.shortcut ?? '',
        }));
    })
    .catch(() => {
      if (alive) commands = [];
    });
  return () => {
    alive = false;
  };
});

function openChromeShortcuts(): void {
  // Firefox refuses tabs.create to about: pages but has a call for this one.
  if (FIREFOX)
    void (
      browser.commands as unknown as { openShortcutSettings(): Promise<void> }
    ).openShortcutSettings();
  else void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
</script>

<SegmentCard title="Key bindings">
  {#snippet icon()}<Icon name="settings" size={12} />{/snippet}
  <div class="fields">
    <p class="muted">
      Used while the tab list is focused. Navigation keys (arrows, Home, End, Enter, Space, Escape) are fixed.
    </p>

    <ul class="actions">
      {#each SHORTCUT_ACTIONS as action (action)}
        {@const combos = keymap[action]}
        {@const clash = clashes(action)}
        <li>
          <span class="name" id="vc-sc-{action}">{LABELS[action]}</span>
          <span class="keys" role="group" aria-labelledby="vc-sc-{action}">
            {#each combos as combo, i (combo)}
              {#if capture?.action === action && capture.slot === i}
                <button
                  type="button"
                  class="capture"
                  use:focusCapture
                  aria-label="Press the new keys for {LABELS[action]}. Escape cancels, Backspace removes."
                  onkeydown={onCaptureKey}
                  onblur={() => (capture = null)}
                >Press keys…</button>
              {:else}
                <span class="chip" class:bad={(conflicts.get(combo)?.length ?? 0) > 1}>
                  <button
                    type="button"
                    class="kbd"
                    title="Change"
                    aria-label="Change {formatCombo(combo)} for {LABELS[action]}"
                    onclick={() => (capture = { action, slot: i })}
                  >{formatCombo(combo)}</button>
                  <button
                    type="button"
                    class="x"
                    aria-label="Remove {formatCombo(combo)} from {LABELS[action]}"
                    onclick={() => set(action, combos.filter((_, j) => j !== i))}
                  ><Icon name="close" size={10} /></button>
                </span>
              {/if}
            {/each}
            {#if capture?.action === action && capture.slot === -1}
              <button
                type="button"
                class="capture"
                use:focusCapture
                aria-label="Press the keys to add for {LABELS[action]}. Escape cancels."
                onkeydown={onCaptureKey}
                onblur={() => (capture = null)}
              >Press keys…</button>
            {:else if combos.length < MAX_BINDINGS}
              <button
                type="button"
                class="add"
                aria-label="Add shortcut for {LABELS[action]}"
                onclick={() => (capture = { action, slot: -1 })}
              >{combos.length === 0 ? 'Add' : '+'}</button>
            {/if}
          </span>
          {#each clash as msg (msg)}<span class="clash" role="note">{msg}</span>{/each}
        </li>
      {/each}
    </ul>

    <p class="warn" role="status">{warning}</p>

    <div class="row">
      <Button variant="text" onclick={reset}>Reset shortcuts to defaults</Button>
    </div>

    <h3>Browser shortcuts</h3>
    <p class="muted">
      These work anywhere in Chrome and are set by Chrome itself, not here: toggle the panel, focus search, suspend the current tab, suspend other tabs.
    </p>
    {#if commands && commands.length > 0}
      <ul class="cmds">
        {#each commands as c (c.name)}
          <li>
            <span class="name">{c.description}</span>
            {#if c.shortcut}
              <kbd>{c.shortcut}</kbd>
            {:else}
              <span class="muted">Not set</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="row">
      <Button variant="tonal" onclick={openChromeShortcuts}>Open Chrome shortcut settings</Button>
    </div>
  </div>
</SegmentCard>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 6px var(--pad-card) var(--pad-card);
  }

  .muted {
    margin: 0;
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* One grouped list: rows divided by hairlines, not a box per row inside the card. */
  .actions {
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-row);
    background: var(--surface-0);
    overflow: hidden;
  }

  .actions li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-height: 40px;
    padding: 4px 8px 4px 12px;
  }

  .actions li + li {
    border-top: 1px solid var(--border);
  }

  .name {
    flex: 1 1 120px;
    min-width: 0;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-2);
  }

  .chip.bad {
    border-color: var(--mError);
  }

  .kbd,
  kbd {
    font: inherit;
    font-size: calc(var(--font-size) - 1px);
    font-variant-numeric: tabular-nums;
  }

  .kbd {
    padding: 2px 4px 2px 10px;
    border: 0;
    border-radius: 999px 0 0 999px;
    background: transparent;
    color: var(--mOnSurface);
    cursor: pointer;
  }

  .x {
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

  .kbd:hover,
  .x:hover {
    background: var(--state-hover);
  }

  .x:hover {
    color: var(--mError);
  }

  .add,
  .capture {
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font: inherit;
    font-size: calc(var(--font-size) - 1px);
    cursor: pointer;
  }

  .add {
    min-width: 26px;
    border: 1px dashed var(--border-strong);
    background: transparent;
    color: var(--mOnSurfaceVariant);
  }

  .add:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .capture {
    border: 2px solid var(--mPrimary);
    background: var(--state-selected);
    color: var(--mOnSurface);
  }

  .clash {
    flex-basis: 100%;
    color: var(--mError);
    font-size: calc(var(--font-size) - 1px);
  }

  .warn {
    margin: 0;
    color: var(--mTertiary);
    font-size: calc(var(--font-size) - 1px);
  }

  .warn:empty {
    display: none;
  }

  h3 {
    margin: 6px 0 0;
    font-size: calc(var(--font-size) - 1px);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--mOnSurfaceVariant);
  }

  .cmds li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }

  kbd {
    padding: 1px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface-2);
  }

  .row {
    display: flex;
    gap: 8px;
  }
</style>
