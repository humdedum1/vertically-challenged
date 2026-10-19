/** Tracks prefers-color-scheme so "system" colour mode can be resolved to dark or light. */
export class SystemDark {
  private mq = window.matchMedia('(prefers-color-scheme: dark)');
  dark = $state(this.mq.matches);

  /** Call from an $effect; returns the cleanup. */
  start = (): (() => void) => {
    const on = (e: MediaQueryListEvent) => {
      this.dark = e.matches;
    };
    this.mq.addEventListener('change', on);
    return () => this.mq.removeEventListener('change', on);
  };

  resolve(mode: 'system' | 'light' | 'dark'): 'light' | 'dark' {
    return mode === 'system' ? (this.dark ? 'dark' : 'light') : mode;
  }
}
