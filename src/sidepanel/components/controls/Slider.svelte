<script lang="ts">
interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onchange: (value: number) => void;
}

let { label, value, min, max, step = 1, unit = '', onchange }: Props = $props();

const uid = $props.id();
</script>

<div class="slider">
  <input
    id="{uid}-r"
    type="range"
    aria-label={label}
    {min}
    {max}
    {step}
    {value}
    style:--fill="{((value - min) / (max - min)) * 100}%"
    oninput={(e) => onchange(e.currentTarget.valueAsNumber)}
  />
  <output for="{uid}-r">{value}{unit}</output>
</div>

<style>
  .slider {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  output {
    flex: none;
    min-width: 40px;
    text-align: right;
    color: var(--mOnSurface);
    font-variant-numeric: tabular-nums;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 20px;
    margin: 0;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(
      to right,
      var(--mPrimary) var(--fill),
      var(--mOutline) var(--fill)
    );
  }

  input::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border: 2px solid var(--mPrimary);
    border-radius: 50%;
    background: var(--surface-0);
    transition: transform var(--dur) var(--ease);
  }

  input:hover::-webkit-slider-thumb {
    transform: scale(1.15);
  }

  input:focus-visible {
    outline-offset: 4px;
  }
</style>
