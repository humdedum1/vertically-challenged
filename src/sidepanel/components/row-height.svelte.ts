/**
 * Tracks the `--row-height` token so virtualized lists use the same fixed height as the
 * tab list. The token changes with density and row layout, which applyAppearance writes
 * as attributes/inline style on <html>, so a MutationObserver on it is enough.
 */
const FALLBACK = 34;

function read(): number {
  const v = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--row-height'),
  );
  return Number.isFinite(v) && v > 0 ? v : FALLBACK;
}

export class RowHeight {
  value = $state(read());

  /** Use as `$effect(rowHeight.start)`. */
  start = (): (() => void) => {
    this.value = read();
    const obs = new MutationObserver(() => {
      const next = read();
      if (next !== this.value) this.value = next;
    });
    obs.observe(document.documentElement, { attributes: true });
    return () => obs.disconnect();
  };
}
