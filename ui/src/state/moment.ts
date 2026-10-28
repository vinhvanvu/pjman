// The moment the page reads as of (decision read-at-a-moment/moment-is-an-event). The cursor lives in the URL
// (`at`, an event's sequence number or an instant) so it survives a reload and can be shared; every query carries it,
// so the whole page holds still at that moment while the stream keeps invalidating. What the server resolved it to
// (the event, its instant, its commit) is kept here per cursor from the as-of responses, so a cursor whose reads come
// from the cache still names its own moment.
import { useSearch } from '@tanstack/react-router';
import { create } from 'zustand';
import type { Moment } from '@/data/contract';

interface MomentState {
  /** What each `at=` sent resolved to, by the value sent. */
  byAt: Record<string, Moment>;
  setResolved: (at: string, m: Moment) => void;
}

export const useMoment = create<MomentState>()((set) => ({
  byAt: {},
  setResolved: (at, m) => set((s) => (s.byAt[at]?.seq === m.seq ? s : { byAt: { ...s.byAt, [at]: m } })),
}));

/** The cursor as the URL holds it (decision read-at-a-moment/time-with-event-selection): `at` the time the page reads
 *  as of, `event` the event selected, which pins the page to exactly that event. An old link's numeric `at` is read as
 *  the event. Absent both, the page reads now. */
export interface Cursor {
  at?: string;
  event?: number;
}

export function cursorOf(search: { at?: string | number; event?: number }): Cursor {
  const event = search.event ?? (typeof search.at === 'number' ? search.at : undefined);
  const at = typeof search.at === 'string' && search.at !== '' ? search.at : undefined;
  return event ? { event } : at ? { at } : {};
}

export function useCursor(): Cursor {
  return cursorOf(useSearch({ strict: false }) as { at?: string | number; event?: number });
}

/** What every query sends as `at=`: the selected event's number when there is one (exact), else the time; undefined
 *  is now. The server reads a number as an event and anything else as a time. */
export function atParam(c: Cursor): string | undefined {
  return c.event ? String(c.event) : c.at;
}

export function useAt(): string | undefined {
  return atParam(useCursor());
}

/** The moment the page's cursor resolved to, once a read at it has answered; undefined while live. */
export function useResolved(): Moment | undefined {
  const at = useAt();
  return useMoment((s) => (at ? s.byAt[at] : undefined));
}
