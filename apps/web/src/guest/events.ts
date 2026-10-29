import type { RealtimeEvent } from '@smartnest/shared';

type Listener = (e: RealtimeEvent) => void;
const listeners = new Set<Listener>();

/**
 * In guest mode there is no WebSocket; the in-browser mock server publishes
 * the same real-time events here and useRealtime folds them into the store.
 */
export function subscribeGuestEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitGuestEvent(e: RealtimeEvent): void {
  for (const fn of listeners) fn(e);
}
