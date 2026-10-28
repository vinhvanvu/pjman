import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@/data/contract';
import {
  arrivedSince,
  axisOf,
  dayOf,
  eventWords,
  hourMarks,
  instantAt,
  modeOf,
  place,
  standingOn,
  stepFrom,
  ticksOf,
  touchedBy,
} from './model';

const ev = (seq: number, at: string, over: Partial<TimelineEvent> = {}): TimelineEvent => ({
  seq,
  at,
  op: 'set',
  key: 'change:pjman/roadmap',
  type: 'change',
  fields: ['next'],
  decision: false,
  ...over,
});

// three of the product's events; 11 and 12 were the store's, another product's
const events = [ev(10, '2026-10-28T10:00:00Z'), ev(13, '2026-10-28T11:00:00Z'), ev(14, '2026-10-28T11:00:00Z')];

describe('modeOf', () => {
  it('reads live, paused at a time, locked on an event', () => {
    expect(modeOf({})).toBe('live');
    expect(modeOf({ at: '2026-10-28T10:30:00Z' })).toBe('paused');
    expect(modeOf({ event: 13 })).toBe('locked');
  });
});

describe('the axis', () => {
  it('asks for the local day an instant falls in', () => {
    const d = dayOf(Date.parse('2026-10-28T10:00:00Z'));
    expect(Date.parse(d.to) - Date.parse(d.from)).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(Date.parse(d.from)).toBeLessThanOrEqual(Date.parse('2026-10-28T10:00:00Z'));
  });
  it('runs from the hour of the first event to now today, to the hour after the last on a past day', () => {
    const day = { from: '2026-10-28T00:00:00Z', to: '2026-10-29T00:00:00Z' };
    const now = Date.parse('2026-10-28T12:30:00Z');
    expect(axisOf(events, day, now)).toEqual({ start: Date.parse('2026-10-28T10:00:00Z'), end: now });
    const later = Date.parse('2026-10-30T00:00:00Z');
    expect(axisOf(events, day, later).end).toBe(Date.parse('2026-10-28T12:00:00Z'));
  });
  it('places an instant and finds it again', () => {
    const axis = { start: 0, end: 1000 };
    expect(place(250, axis)).toBe(25);
    expect(place(-5, axis)).toBe(0);
    expect(instantAt(25, axis)).toBe(250);
  });
  it('draws no more than seven hour marks', () => {
    const start = Date.parse('2026-10-28T06:00:00Z');
    expect(hourMarks({ start, end: start + 3 * 3600_000 })).toHaveLength(4);
    expect(hourMarks({ start, end: start + 17 * 3600_000 }).length).toBeLessThanOrEqual(7);
  });
});

describe('ticksOf', () => {
  it('folds events at the same place into one tick that locks on the last, keeping a decision mark', () => {
    const t = ticksOf([...events.slice(0, 2), ev(14, '2026-10-28T11:00:00Z', { decision: true })], {
      start: Date.parse('2026-10-28T10:00:00Z'),
      end: Date.parse('2026-10-28T12:00:00Z'),
    });
    expect(t).toHaveLength(2);
    expect(t[1]).toMatchObject({ pct: 50, seq: 14, count: 2, decision: true, fresh: false });
  });
  it('keeps what arrived after the paused moment apart', () => {
    const t = ticksOf(
      events,
      { start: Date.parse('2026-10-28T10:00:00Z'), end: Date.parse('2026-10-28T12:00:00Z') },
      13,
    );
    expect(t.map((x) => [x.seq, x.fresh])).toEqual([
      [10, false],
      [13, false],
      [14, true],
    ]);
  });
});

describe('stepping', () => {
  it('stands on the selected event, the last at or before a time, the last of all when live', () => {
    expect(standingOn(events, { event: 13 })).toBe(13);
    expect(standingOn(events, { at: '2026-10-28T10:30:00Z' })).toBe(10);
    expect(standingOn(events, { at: '2026-10-28T09:00:00Z' })).toBeUndefined();
    expect(standingOn(events, {})).toBe(14);
  });
  it("moves between the product's events; next past the last is now; previous before the first goes nowhere", () => {
    expect(stepFrom(events, { event: 13 }, -1)).toEqual({ event: 10 });
    expect(stepFrom(events, { event: 13 }, 1)).toEqual({ event: 14 });
    expect(stepFrom(events, { event: 14 }, 1)).toBe('live');
    expect(stepFrom(events, { event: 10 }, -1)).toBeUndefined();
  });
  it('from a time, previous locks on the event it stands on and next on the one after', () => {
    expect(stepFrom(events, { at: '2026-10-28T10:30:00Z' }, -1)).toEqual({ event: 10 });
    expect(stepFrom(events, { at: '2026-10-28T10:30:00Z' }, 1)).toEqual({ event: 13 });
    expect(stepFrom(events, { at: '2026-10-28T09:00:00Z' }, 1)).toEqual({ event: 10 });
  });
  it('live has no next, and previous steps back from the last', () => {
    expect(stepFrom(events, {}, 1)).toBeUndefined();
    expect(stepFrom(events, {}, -1)).toEqual({ event: 13 });
    expect(stepFrom([], {}, -1)).toBeUndefined();
  });
});

describe('arrivedSince', () => {
  it("counts the product's events past the moment held", () => {
    expect(arrivedSince(events, { event: 10 }).map((e) => e.seq)).toEqual([13, 14]);
    expect(arrivedSince(events, { at: '2026-10-28T10:30:00Z' })).toHaveLength(2);
    expect(arrivedSince(events, {})).toEqual([]);
  });
});

describe('words', () => {
  it('names what was done to which record', () => {
    expect(eventWords(ev(1, 'x', { title: 'The roadmap', fields: ['status', 'next'] }))).toBe(
      'set status, next on change The roadmap',
    );
    expect(eventWords(ev(1, 'x', { op: 'created', type: 'decision', key: 'decision:pjman/roadmap/two-views' }))).toBe(
      'opened decision roadmap/two-views',
    );
    expect(eventWords(ev(1, 'x', { op: 'log', type: 'session', key: 'session:abc', title: 'The roadmap' }))).toBe(
      'wrote a line on the session on The roadmap',
    );
  });
  it('finds what an event touched on the strip', () => {
    expect(touchedBy(ev(1, 'x', { type: 'decision', key: 'decision:pjman/roadmap/x', session: 'session:s' }))).toEqual({
      session: 'session:s',
      change: 'change:pjman/roadmap',
    });
    expect(touchedBy(ev(1, 'x', { type: 'session', key: 'session:s', op: 'log' }))).toEqual({ session: 'session:s' });
  });
});
