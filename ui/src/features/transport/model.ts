// The transport's arithmetic, pure (decisions live-sessions/stage-strip-transport and rolling-window): the window the
// bar shows, the span read for it, where an instant sits along it, where previous and next lead, what arrived after a paused
// moment, and the words for one event. The cursor is the URL's (at= a time, event= a selection); nothing here keeps
// state.
import type { TimelineEvent } from '@/data/contract';
import { changeOfDecision, short } from '@/lib/keys';
import type { Cursor } from '@/state/moment';

const HOUR = 60 * 60_000;

/** Live when the cursor is empty, paused at a time, locked on an event. */
export type Mode = 'live' | 'paused' | 'locked';

export const modeOf = (c: Cursor): Mode => (c.event ? 'locked' : c.at ? 'paused' : 'live');

/** The instant the head stands at: the selected event's (once the server has said when it was), the time, else now. */
export function headOf(c: Cursor, resolved: { seq: number; at: string } | undefined, now: number): number {
  if (c.event) return resolved?.seq === c.event ? Date.parse(resolved.at) : now;
  return c.at ? Date.parse(c.at) : now;
}

/** How much the bar shows (decision live-sessions/rolling-window). */
export const WINDOW_MS = 12 * HOUR;

/** What the bar shows: the last twelve hours ending now, rolling, while the head is inside them (live, or held at a
 *  moment not yet near the left edge); a head older than that is centred, and the bar stands still. */
export function viewOf(head: number, now: number): { start: number; end: number; rolling: boolean } {
  if (head >= now - WINDOW_MS * 0.95) return { start: now - WINDOW_MS, end: now, rolling: true };
  return { start: head - WINDOW_MS / 2, end: head + WINDOW_MS / 2, rolling: false };
}

/** The span the events are read for: from twelve hours and two before the view's end to the hour after it. It moves
 *  only when the hour turns, so the read is not asked again as the bar rolls. */
export function spanOf(viewEnd: number): { from: string; to: string } {
  const to = Math.ceil(viewEnd / HOUR) * HOUR + HOUR;
  return { from: new Date(to - WINDOW_MS - 2 * HOUR).toISOString(), to: new Date(to).toISOString() };
}

/** Where an instant sits along a window starting at `start`, in percent of the window; outside it is below 0 or
 *  above 100. */
export const along = (ms: number, start: number): number => ((ms - start) / WINDOW_MS) * 100;

/** The instant at a place along the window. */
export const instantAt = (pct: number, start: number): number => start + (pct / 100) * WINDOW_MS;

/** The hour marks between two instants, every two hours of the local clock. */
export function hourMarks(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) if (new Date(t).getHours() % 2 === 0) out.push(t);
  return out;
}

/** The event the page stands on, among the product's: the selected one; at a time, the last at or before it; live,
 *  the last of all. Undefined when none of the product's events comes before it. */
export function standingOn(events: readonly TimelineEvent[], c: Cursor): number | undefined {
  if (c.event) return c.event;
  if (!c.at) return events.at(-1)?.seq;
  const ms = Date.parse(c.at);
  let seq: number | undefined;
  for (const e of events) {
    if (Date.parse(e.at) > ms) break;
    seq = e.seq;
  }
  return seq;
}

/** Where previous and next lead: the product's event before or after the one the page stands on. Next past the last
 *  event is now; previous before the first has nowhere to go. */
export function stepFrom(
  events: readonly TimelineEvent[],
  c: Cursor,
  dir: -1 | 1,
): { event: number } | 'live' | undefined {
  if (events.length === 0) return undefined;
  const on = standingOn(events, c);
  if (dir === 1) {
    if (!c.event && !c.at) return undefined;
    const next = events.find((e) => on === undefined || e.seq > on);
    return next ? { event: next.seq } : 'live';
  }
  // a time between events stands on the one before it, so previous is that event itself
  const before = events.findLast((e) => on !== undefined && (c.event || !c.at ? e.seq < on : e.seq <= on));
  return before ? { event: before.seq } : undefined;
}

/** What arrived after the moment the page is held at: the product's events past it. */
export function arrivedSince(events: readonly TimelineEvent[], c: Cursor): TimelineEvent[] {
  if (c.event) return events.filter((e) => e.seq > c.event!);
  if (c.at) {
    const ms = Date.parse(c.at);
    return events.filter((e) => Date.parse(e.at) > ms);
  }
  return [];
}

const VERB: Partial<Record<TimelineEvent['op'], string>> = {
  created: 'opened',
  log: 'wrote a line on',
  bind: 'bound to',
  observe: 'observed',
  moved: 'renamed',
  removed: 'removed',
  applied: 'applied a batch to',
  reverted: 'reverted',
  migrated: 'migrated',
};

/** One event in words: what was done to which record, `set status, next on The store at a moment`. */
export function eventWords(e: TimelineEvent): string {
  const verb = e.op === 'set' ? `set ${e.fields?.join(', ') || 'fields'} on` : (VERB[e.op] ?? e.op);
  const what = e.label ?? short(e.key);
  const kind = e.type === 'session' ? 'the session on' : e.type;
  return `${verb} ${kind === 'store' ? 'the store' : `${kind} ${what}`}`;
}

/** Who wrote it: the session's short key when one is stamped, else the writer. */
export function whoWrote(e: TimelineEvent): string | undefined {
  const s = e.session ?? (e.type === 'session' ? e.key : undefined);
  if (s) return `session ${short(s).slice(0, 8)}`;
  return e.writer ? short(e.writer) : undefined;
}

/** What an event touched on the strip: the session that wrote it, the change it wrote or the change of the decision. */
export function touchedBy(e: TimelineEvent): { session?: string; change?: string } {
  const session = e.session ?? (e.type === 'session' ? e.key : undefined);
  const change = e.type === 'change' ? e.key : e.type === 'decision' ? changeOfDecision(e.key) : undefined;
  return { session, change };
}
