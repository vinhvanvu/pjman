import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@/data/contract';
import {
  along,
  arrivedSince,
  eventWords,
  headOf,
  hourMarks,
  instantAt,
  modeOf,
  spanOf,
  standingOn,
  stepFrom,
  touchedBy,
  viewOf,
  WINDOW_MS,
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

describe('the window', () => {
  const now = Date.parse('2026-10-28T23:17:30Z');
  const H = 3_600_000;
  it('rolls the last twelve hours ending now while the head is inside them', () => {
    expect(viewOf(now, now)).toEqual({ start: now - WINDOW_MS, end: now, rolling: true });
    expect(viewOf(now - 6 * H, now).rolling).toBe(true);
  });
  it('centres an older head and stands still', () => {
    const head = now - 30 * H;
    expect(viewOf(head, now)).toEqual({ start: head - 6 * H, end: head + 6 * H, rolling: false });
  });
  it('reads a span that covers the view and moves only when the hour turns', () => {
    const a = spanOf(now);
    expect(a).toEqual(spanOf(now - 10 * 60_000));
    expect(Date.parse(a.from)).toBeLessThanOrEqual(now - WINDOW_MS);
    expect(Date.parse(a.to)).toBeGreaterThan(now + 30 * 60_000);
  });
  it('places an instant along the window and finds it again', () => {
    expect(along(now, now - WINDOW_MS)).toBe(100);
    expect(along(now - 6 * H, now - WINDOW_MS)).toBe(50);
    expect(instantAt(50, now - WINDOW_MS)).toBe(now - 6 * H);
  });
  it('marks every second hour of the local clock', () => {
    const marks = hourMarks(now - WINDOW_MS, now);
    expect(marks).toHaveLength(6);
    expect(marks.every((t) => new Date(t).getHours() % 2 === 0)).toBe(true);
  });
  it('stands the head on the selected event once the server has said when it was', () => {
    expect(headOf({ event: 7 }, { seq: 7, at: '2026-10-28T10:00:00Z' }, now)).toBe(Date.parse('2026-10-28T10:00:00Z'));
    expect(headOf({ event: 7 }, { seq: 6, at: '2026-10-28T10:00:00Z' }, now)).toBe(now);
    expect(headOf({}, undefined, now)).toBe(now);
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
    expect(eventWords(ev(1, 'x', { label: 'The roadmap', fields: ['status', 'next'] }))).toBe(
      'set status, next on change The roadmap',
    );
    expect(eventWords(ev(1, 'x', { op: 'created', type: 'decision', key: 'decision:pjman/roadmap/two-views' }))).toBe(
      'opened decision roadmap/two-views',
    );
    expect(eventWords(ev(1, 'x', { op: 'log', type: 'session', key: 'session:abc', label: 'The roadmap' }))).toBe(
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
