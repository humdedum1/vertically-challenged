import { RELAY_EVENTS, type RelayEvent, type RelayEventMessage } from '../shared/relay';

/** Forwards browser events to extension pages while a framed popup is open. */
export function createEventRelay(deps: {
  listen(event: RelayEvent, fn: (...args: unknown[]) => void): () => void;
  send(msg: unknown): Promise<unknown>;
}): { popupOpened(): void; popupClosed(): void } {
  let open = 0;
  let stops: Array<() => void> = [];
  return {
    popupOpened() {
      if (open++ > 0) return;
      stops = RELAY_EVENTS.map((event) =>
        deps.listen(event, (...args) => {
          const msg: RelayEventMessage = { type: 'relayEvent', event, args };
          // No receiver (the popup is closing) is normal; drop it.
          deps.send(msg).catch(() => {});
        }),
      );
    },
    popupClosed() {
      if (open === 0 || --open > 0) return;
      for (const stop of stops) stop();
      stops = [];
    },
  };
}
