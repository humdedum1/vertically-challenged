<script lang="ts">
interface Props {
  id?: string;
  value: string;
  label: string;
  oninput: (value: string) => void;
  placeholder?: string;
  maxlength?: number;
  invalid?: boolean;
  describedby?: string;
  mono?: boolean;
  /** Masks the value (passphrases). */
  secret?: boolean;
  /** Called on Enter (e.g. to submit an add-field). */
  onenter?: () => void;
}

let {
  id,
  value,
  label,
  oninput,
  placeholder,
  maxlength,
  invalid = false,
  describedby,
  mono = false,
  secret = false,
  onenter,
}: Props = $props();
</script>

<input
  {id}
  type={secret ? "password" : "text"}
  class:mono
  aria-label={label}
  aria-invalid={invalid}
  aria-describedby={describedby}
  {placeholder}
  {maxlength}
  {value}
  spellcheck="false"
  autocomplete={secret ? "new-password" : "off"}
  oninput={(e) => oninput(e.currentTarget.value)}
  onkeydown={(e) => {
    if (e.key === 'Enter' && onenter) {
      e.preventDefault();
      onenter();
    }
  }}
/>

<style>
  input {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: inherit;
  }

  input.mono {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  }

  input[aria-invalid='true'] {
    border-color: var(--mError);
  }

  input::placeholder {
    color: var(--mOnSurfaceVariant);
  }
</style>
