// What arrived live (decision motion-design/when-motion-plays): every event the stream delivers while the page is
// open, kept for a moment. Only these move the page. An event read on the first load, at a held moment or after a
// scrub never came through the stream, so it is never fresh, and nothing it brings animates. A surface asks whether an
// event it draws is fresh and plays its arrival once, when that event's element mounts; a surface that draws records
// rather than events (the dock) asks for the fresh events themselves.
import { useCallback } from 'react';
import { create } from 'zustand';
import type { StoreEvent } from '@/data/contract';

/** How long after it came an event stays fresh: long enough for the refetch that brings it to the page, short
 *  enough that a page opened later never replays it. */
export const FRESH_MS = 5000;

interface Arrivals {
  /** The fresh events by seq, oldest first; each leaves FRESH_MS after it came. */
  fresh: ReadonlyMap<number, StoreEvent>;
  arrive: (e: StoreEvent) => void;
}

export const useArrivals = create<Arrivals>()((set) => ({
  fresh: new Map(),
  arrive: (event) => {
    set((s) => ({ fresh: new Map(s.fresh).set(event.seq, event) }));
    setTimeout(
      () =>
        set((s) => {
          const fresh = new Map(s.fresh);
          fresh.delete(event.seq);
          return { fresh };
        }),
      FRESH_MS,
    );
  },
}));

/** Whether an event came through the stream a moment ago; re-renders the caller as arrivals come and go. */
export function useFresh(): (seq: number) => boolean {
  const fresh = useArrivals((s) => s.fresh);
  return useCallback((seq: number) => fresh.has(seq), [fresh]);
}

/** The events that came through the stream a moment ago, oldest first. */
export function useFreshEvents(): readonly StoreEvent[] {
  const fresh = useArrivals((s) => s.fresh);
  return [...fresh.values()];
}
