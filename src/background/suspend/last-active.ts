/**
 * Last time each tab was active (ms epoch). Kept in chrome.storage.session so it survives
 * the worker being suspended but not a browser restart, where tab ids change anyway.
 * The map is small (one number per tab) and written at most once per flush.
 */
export class LastActive {
  private map = new Map<number, number>();
  private dirty = false;

  constructor(
    private readonly read: () => Promise<Record<string, number> | undefined>,
    private readonly write: (v: Record<string, number>) => Promise<void>,
  ) {}

  async load(): Promise<void> {
    const raw = (await this.read()) ?? {};
    for (const [k, v] of Object.entries(raw)) {
      const id = Number(k);
      if (/^\d+$/.test(k) && typeof v === 'number' && Number.isFinite(v)) {
        // Keep anything observed while this worker was already running.
        if (!this.map.has(id)) this.map.set(id, v);
      }
    }
  }

  get(tabId: number): number | undefined {
    return this.map.get(tabId);
  }

  touch(tabId: number, now: number): void {
    this.map.set(tabId, now);
    this.dirty = true;
  }

  /** First sighting starts the clock; existing ages are left alone. */
  seen(tabId: number, now: number): void {
    if (!this.map.has(tabId)) this.touch(tabId, now);
  }

  forget(tabId: number): void {
    if (this.map.delete(tabId)) this.dirty = true;
  }

  /** Drops entries for tabs that no longer exist. */
  retain(live: ReadonlySet<number>): void {
    for (const id of this.map.keys()) if (!live.has(id)) this.forget(id);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.write(Object.fromEntries([...this.map].map(([k, v]) => [String(k), v])));
  }
}
