// Formatting: how times, counts and progress read. Pure functions; the tests cover them.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m", "3h", "2d", "3w": the short form rows use. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const d = now - Date.parse(iso);
  if (!Number.isFinite(d) || d < MINUTE) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 60 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "just now", "6 min ago", "3 h ago", "2 d ago", else the date: the words a bar or a card's meta line uses. */
export function agoWords(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const d = now - Date.parse(iso);
  if (!Number.isFinite(d) || d < MINUTE) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MINUTE)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "3h 12m", "38m", "2d 3h": how long something has run. Empty without a start. */
export function durationWords(from: string | undefined, to = Date.now()): string {
  if (!from) return '';
  const d = to - Date.parse(from);
  if (!Number.isFinite(d) || d < MINUTE) return 'under a minute';
  const days = Math.floor(d / DAY);
  const hours = Math.floor((d % DAY) / HOUR);
  const minutes = Math.floor((d % HOUR) / MINUTE);
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** "today", "yesterday", "3 days ago", "never": the long form a panel uses. */
export function sinceDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const pct = (done: number, total: number): number => (total ? Math.round((done / total) * 100) : 0);

/** A sentence shortened on a word boundary with an ellipsis. */
export function truncate(s: string | undefined, max: number): string {
  if (!s || s.length <= max) return s ?? '';
  const cut = s.slice(0, max);
  const i = cut.lastIndexOf(' ');
  return `${(i > max * 0.6 ? cut.slice(0, i) : cut).trimEnd()}…`;
}
