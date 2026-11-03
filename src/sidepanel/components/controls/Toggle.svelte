<script lang="ts">
interface Props {
  label: string;
  checked: boolean;
  onchange: (checked: boolean) => void;
  disabled?: boolean;
  /** Secondary line under the label; also the tooltip when the switch is disabled. */
  hint?: string;
}

let { label, checked, onchange, disabled = false, hint }: Props = $props();

const uid = $props.id();
</script>

<div class="toggle">
  <span class="text">
    <span id="{uid}-l" class="label">{label}</span>
    {#if hint}<span id="{uid}-h" class="hint">{hint}</span>{/if}
  </span>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby="{uid}-l"
    aria-describedby={hint ? `${uid}-h` : undefined}
    title={disabled ? hint : undefined}
    {disabled}
    onclick={() => onchange(!checked)}
  >
    <span class="knob"></span>
  </button>
</div>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .hint {
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
  }

  button {
    position: relative;
    flex: none;
    width: 38px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-0);
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  /* Invisible hit area: the 22px track alone is under the 24px WCAG 2.5.8 minimum. */
  button::after {
    content: '';
    position: absolute;
    inset: -4px 0;
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--mOnSurfaceVariant);
    transition:
      transform var(--dur) var(--ease),
      background-color var(--dur) var(--ease);
  }

  button[aria-checked='true'] {
    border-color: var(--mPrimary);
    background: var(--mPrimary);
  }

  button[aria-checked='true'] .knob {
    background: var(--mOnPrimary);
    transform: translateX(16px);
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  button:not(:disabled):hover {
    filter: brightness(1.08);
  }
</style>
