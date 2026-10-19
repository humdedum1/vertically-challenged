/**
 * Coalesces bursts of tab events (page loads fire onUpdated many times per tab) into a
 * single async flush. Service workers have no requestAnimationFrame, so a short timer is
 * used. Flushes never overlap: events arriving mid-flush schedule exactly one follow-up.
 */
export function createBatcher(flush: () => Promise<void>, delayMs = 16) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;

  const run = async () => {
    timer = null;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await flush();
    } catch (err) {
      console.error('[vc] flush failed', err);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };

  function schedule(): void {
    if (timer === null) timer = setTimeout(run, delayMs);
  }

  return { schedule };
}
