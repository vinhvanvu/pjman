// The moment the page reads as of (decision read-at-a-moment/moment-is-an-event). The cursor lives in the URL
// (`at`, an event's sequence number or an instant) so it survives a reload and can be shared; every query carries it,
// so the whole page holds still at that moment while the stream keeps invalidating. What the server resolved it to
// (the event, its instant, its commit) is kept here from the last as-of response, for the chip.
import { useSearch } from '@tanstack/react-router';
import { create } from 'zustand';
import type { Moment } from '@/data/contract';

interface MomentState {
  /** The moment the last as-of response resolved to. */
  resolved?: Moment;
  setResolved: (m?: Moment) => void;
}

export const useMoment = create<MomentState>()((set) => ({
  resolved: undefined,
  setResolved: (resolved) => set({ resolved }),
}));

/** The cursor from the URL: what every query reads as of; undefined is now. */
export function useAt(): string | undefined {
  const search = useSearch({ strict: false }) as { at?: string };
  return search.at || undefined;
}
