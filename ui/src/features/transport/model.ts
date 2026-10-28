// The transport's arithmetic, pure (decision live-sessions/stage-strip-transport): the day the head stands in, the
// axis the ticks are placed on, the ticks themselves, where previous and next lead, what arrived after a paused
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

/** The local calendar day an instant falls in, as the window the timeline is asked for. */
export function dayOf(ms: number): { from: string; to: string } {
  const start = new Date(ms);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** The span the ticks are drawn over: from the hour before the day's first event to now on today, to the hour after
 *  the last event on a past day. An empty day spans its waking hours up to now. */
export function axisOf(
  events: readonly { at: string }[],
  day: { from: string; to: string },
  now: number,
): { start: number; end: number } {
  const dayStart = Date.parse(day.from);
  const dayEnd = Date.parse(day.to);
  const first = events[0] ? Date.parse(events[0].at) : Math.min(now, dayEnd) - HOUR;
  const last = events.at(-1) ? Date.parse(events.at(-1)!.at) : first;
  const start = Math.max(dayStart, Math.floor(first / HOUR) * HOUR);
  const end = now < dayEnd ? Math.max(now, last) : Math.min(dayEnd, Math.ceil((last + 1) / HOUR) * HOUR);
  return { start, end: Math.max(end, start + HOUR) };
}

/** Where an instant sits on the axis, 0 to 100. */
export const place = (ms: number, axis: { start: number; end: number }): number =>
  Math.min(100, Math.max(0, ((ms - axis.start) / (axis.end - axis.start)) * 100));

/** The instant at a place on the axis. */
export const instantAt = (pct: number, axis: { start: number; end: number }): number =>
  axis.start + (Math.min(100, Math.max(0, pct)) / 100) * (axis.end - axis.start);

/** The hour marks: every one, two, three or four hours, so no more than seven are drawn. */
export function hourMarks(axis: { start: number; end: number }): { pct: number; ms: number }[] {
  const hours = (axis.end - axis.start) / HOUR;
  const every = [1, 2, 3, 4, 6].find((n) => hours / n <= 7) ?? 6;
  const out: { pct: number; ms: number }[] = [];
  const first = new Date(Math.ceil(axis.start / HOUR) * HOUR);
  for (let t = first.getTime(); t <= axis.end; t += HOUR) {
    if (new Date(t).getHours() % every === 0) out.push({ pct: place(t, axis), ms: t });
  }
  return out;
}

export interface Tick {
  pct: number;
  /** The last event at this place: what a click locks on. */
  seq: number;
  at: string;
  count: number;
  /** A decision was opened or moved here. */
  decision: boolean;
  /** It arrived after the paused moment. */
  fresh: boolean;
}

/** The events as ticks, those that would land on the same place (a 0.25% step) folded into one. */
export function ticksOf(
  events: readonly TimelineEvent[],
  axis: { start: number; end: number },
  freshAfter?: number,
): Tick[] {
  const out: Tick[] = [];
  for (const e of events) {
    const pct = Math.round(place(Date.parse(e.at), axis) * 4) / 4;
    const fresh = freshAfter !== undefined && e.seq > freshAfter;
    const prev = out.at(-1);
    if (prev && prev.pct === pct && prev.fresh === fresh) {
      prev.seq = e.seq;
      prev.at = e.at;
      prev.count += 1;
      prev.decision ||= e.decision;
    } else out.push({ pct, seq: e.seq, at: e.at, count: 1, decision: e.decision, fresh });
  }
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
  const before = [...events].reverse().find((e) => on !== undefined && (c.event || !c.at ? e.seq < on : e.seq <= on));
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
  const what = e.title ?? short(e.key);
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
