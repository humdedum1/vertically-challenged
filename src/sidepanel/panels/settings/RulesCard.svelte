<script lang="ts">
import { parseRuleTarget } from '../../../settings/migrate';
import { LIMITS, type RuleAction } from '../../../settings/schema';
import Button from '../../components/controls/Button.svelte';
import SegmentedControl from '../../components/controls/SegmentedControl.svelte';
import TextInput from '../../components/controls/TextInput.svelte';
import Icon from '../../components/Icon.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import type { SettingsState } from '../../settings-state.svelte';

let { settings }: { settings: SettingsState } = $props();

const rules = $derived(settings.value.rules);
const full = $derived(rules.length >= LIMITS.rules);
let host = $state('');
let group = $state('');
let action: RuleAction = $state('group');
let error = $state('');

const ACTIONS: { value: RuleAction; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'pin', label: 'Pin' },
  { value: 'mute', label: 'Mute' },
];

function add(): void {
  const t = parseRuleTarget(host);
  const g = action === 'group' ? group.trim() : '';
  if (t === null) error = 'Enter a site like example.com, *.example.com or example.com/path';
  else if (action === 'group' && g === '') error = 'Enter a group name';
  else if (rules.some((r) => r.host === t.host && r.path === t.path))
    error = `${t.host}${t.path} already has a rule`;
  else if (full) error = `The list is limited to ${LIMITS.rules} rules`;
  else {
    settings.update((s) => ({ ...s, rules: [...s.rules, { ...t, action, group: g }] }));
    host = group = error = '';
  }
}

function remove(i: number): void {
  settings.update((s) => ({ ...s, rules: s.rules.filter((_, j) => j !== i) }));
}

const describe = (r: { action: RuleAction; group: string }) =>
  r.action === 'group' ? r.group : r.action === 'pin' ? 'Pin' : 'Mute';
</script>

<SegmentCard title="Tab rules">
  {#snippet icon()}<Icon name="folder" size={12} />{/snippet}
  <div class="fields">
    <p class="muted">
      When a tab navigates to a matching site (optionally a path like github.com/myorg), it is
      put in the named tab group, pinned or muted. The first matching rule wins.
    </p>
    {#if rules.length > 0}
      <ul class="list" aria-label="Tab rules">
        {#each rules as r, i (r.host + r.path)}
          <li>
            <span class="host">{r.host}{r.path}</span>
            <span class="arrow" aria-hidden="true">→</span>
            <span class="sr">,{r.action === 'group' ? ' put in group' : ''}</span>
            <span class="group">{describe(r)}</span>
            <button type="button" class="x" aria-label="Remove the rule for {r.host}{r.path}" onclick={() => remove(i)}>
              <Icon name="close" size={12} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <SegmentedControl
      label="Rule action"
      options={ACTIONS}
      value={action}
      onchange={(v) => {
        action = v;
        error = '';
      }}
    />
    <div class="add">
      <TextInput
        id="vc-rule-host"
        label="Site"
        value={host}
        placeholder="github.com or github.com/myorg"
        invalid={error !== ''}
        describedby="vc-rule-err"
        oninput={(v) => {
          host = v;
          error = '';
        }}
        onenter={add}
      />
      {#if action === 'group'}
      <TextInput
        id="vc-rule-group"
        label="Group"
        value={group}
        placeholder="Code"
        describedby="vc-rule-err"
        oninput={(v) => {
          group = v.slice(0, LIMITS.ruleGroup);
          error = '';
        }}
        onenter={add}
      />
      {/if}
      <Button variant="tonal" disabled={host.trim() === '' || full} onclick={add}>Add</Button>
    </div>
    <p id="vc-rule-err" class="error" role="alert">{error}</p>
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
    font-size: 12px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 4px 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-row);
    background: var(--surface-0);
  }

  .host,
  .group {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group {
    flex: 1;
    font-weight: 600;
  }

  .arrow {
    color: var(--mOnSurfaceVariant);
  }

  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
  }

  .x:hover {
    background: var(--state-hover);
    color: var(--mError);
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .add > :global(*:not(button)) {
    flex: 1 1 110px;
    min-width: 0;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .error {
    margin: 0;
    color: var(--mError);
    font-size: 12px;
  }
</style>
