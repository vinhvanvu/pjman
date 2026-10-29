// What arrived live (decision motion-design/when-motion-plays): every event the stream delivers while the page is
// open, by its sequence number and when it came. Only these move the page. An event read on the first load, at a held
// moment or after a scrub never came through the stream, so it is never fresh, and nothing it brings animates. A
// surface asks whether an event it draws is fresh and plays its arrival once, when that event's element mounts.
import { useCallback } from 'react';
import { create } from 'zustand';

/** How long after it came an event may still play its arrival: long enough for the refetch that brings it to the
 *  page, short enough that a page opened later never replays it. */
export const FRESH_MS = 5000;

interface Arrivals {
  /** seq → when it came through the stream. */
  came: ReadonlyMap<number, number>;
  arrive: (seq: number) => void;
}

export const useArrivals = create<Arrivals>()((set) => ({
  came: new Map(),
  arrive: (seq) =>
    set((s) => {
      const now = Date.now();
      const came = new Map([...s.came].filter(([, t]) => now - t < FRESH_MS * 4));
      came.set(seq, now);
      return { came };
    }),
}));

/** Whether an event came through the stream a moment ago; re-renders the caller as arrivals land. */
export function useFresh(): (seq: number) => boolean {
  const came = useArrivals((s) => s.came);
  return useCallback(
    (seq: number) => {
      const t = came.get(seq);
      return t !== undefined && Date.now() - t < FRESH_MS;
    },
    [came],
  );
}
