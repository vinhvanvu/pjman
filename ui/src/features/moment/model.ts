// The words on the chip that says the page is read as of a moment, pure.
import type { Moment } from '@/data/contract';

/** A clock reading for an instant: the time of day, with the date when it is not today. */
export function clock(iso: string, now = Date.now(), locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = d.toDateString() === new Date(now).toDateString();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** The chip's words: "as of 14:02" for a time, "event #1842 · 14:02" for a selected event; until the server answers,
 *  the cursor as given. */
export function momentWords(
  cursor: { at?: string; event?: number },
  resolved?: Moment,
  format: (iso: string) => string = (iso) => clock(iso),
): string {
  if (cursor.event) return resolved ? `event #${resolved.seq} · ${format(resolved.at)}` : `event #${cursor.event}`;
  if (resolved) return `as of ${format(resolved.at)}`;
  return cursor.at ? `as of ${format(cursor.at)}` : 'now';
}
