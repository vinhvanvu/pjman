import { describe, expect, it } from 'vitest';
import type { BridgeSession, TimelineEvent } from '@/data/contract';
import { lanesOf, sessionOf } from './model';

const session = (key: string, children: BridgeSession[] = []): BridgeSession => ({
  key,
  state: 'working',
  children,
  inReview: false,
});
const ev = (seq: number, over: Partial<TimelineEvent>): TimelineEvent => ({
  seq,
  at: `2026-10-28T10:${String(seq).padStart(2, '0')}:00Z`,
  op: 'set',
  key: 'change:pjman/x',
  type: 'change',
  decision: false,
  ...over,
});

describe('lanesOf', () => {
  const kid = session('session:kid');
  const idle = { ...session('session:idle'), state: 'ended' as const };
  const on = (s: BridgeSession): BridgeSession => ({ ...s, change: { key: 'change:pjman/x', path: [] } });
  const fresh = session('session:fresh');
  const sessions = [
    on(session('session:a', [kid])),
    on(session('session:b')),
    fresh,
    on(session('session:quiet')),
    idle,
  ];
  const events = [
    ev(1, { op: 'log', type: 'session', key: 'session:a' }),
    ev(2, { session: 'session:a' }),
    ev(3, { op: 'created', type: 'decision', key: 'decision:pjman/x/y', session: 'session:a', decision: true }),
    ev(4, { op: 'log', type: 'session', key: 'session:kid' }),
    ev(5, { op: 'log', type: 'session', key: 'session:b' }),
    ev(6, { op: 'log', type: 'session', key: 'session:stranger' }),
    ev(7, { writer: 'person:vinh' }),
    ev(8, { op: 'log', type: 'session', key: 'session:idle' }),
    ev(9, { op: 'log', type: 'session', key: 'session:fresh' }),
  ];
  const { lanes, unbound } = lanesOf(sessions, events);
  it("keeps the bridge's order, leaving out a session with nothing in the window, one that ended on no change and events of no row", () => {
    expect(lanes.map((l) => l.session.key)).toEqual(['session:a', 'session:b']);
  });
  it('folds a session on no change apart, and gives it its row with its earlier beats once it binds', () => {
    expect(unbound.map((l) => l.session.key)).toEqual(['session:fresh']);
    const bound = lanesOf([on(fresh)], events);
    expect(bound.unbound).toEqual([]);
    expect(bound.lanes.map((l) => l.beats.map((e) => e.seq))).toEqual([[9]]);
  });
  it("draws its lines as beats and the decisions it opened as flags, its subagent's lines on its row", () => {
    const a = lanes[0]!;
    expect(a.beats.map((e) => e.seq)).toEqual([1, 4]);
    expect(a.flags.map((e) => e.seq)).toEqual([3]);
    expect([a.first, a.last]).toEqual([events[0]!.at, events[3]!.at]);
  });
  it('reads the session from the stamp or from the record written', () => {
    expect(sessionOf(ev(1, { session: 'session:s' }))).toBe('session:s');
    expect(sessionOf(ev(1, { type: 'session', key: 'session:t' }))).toBe('session:t');
    expect(sessionOf(ev(1, {}))).toBeUndefined();
  });
});
