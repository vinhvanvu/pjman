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

/** "as of #1842 · 14:02" once the server has said what the cursor resolved to; until then the cursor as typed. */
export function momentWords(
  at: string,
  resolved?: Moment,
  format: (iso: string) => string = (iso) => clock(iso),
): string {
  if (resolved) return `as of #${resolved.seq} · ${format(resolved.at)}`;
  return /^\d+$/.test(at) ? `as of #${at}` : `as of ${format(at)}`;
}
