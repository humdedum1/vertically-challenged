/** A short message for the toast stack, optionally with one action (Undo). */
export interface Notice {
  level: 'info' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

let sink: ((n: Notice) => void) | null = null;

/** App registers where notices go; panels call notify() without needing it passed down. */
export function setNoticeSink(fn: ((n: Notice) => void) | null): void {
  sink = fn;
}

export function notify(n: Notice): void {
  sink?.(n);
}
