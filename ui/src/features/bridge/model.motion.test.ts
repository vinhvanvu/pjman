import { describe, expect, it } from 'vitest';
import type { BridgeSession, TimelineEvent } from '@/data/contract';
import { lastArrival, strip, stripRows } from './model';

const session = (key: string, over: Partial<BridgeSession> = {}): BridgeSession => ({
  key,
  state: 'working',
  children: [],
  inReview: false,
  ...over,
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

describe('stripRows', () => {
  it('lays every heading and card in one list in the order of need, each group headed even when empty', () => {
    const rows = stripRows(
      strip({
        waitingOn: [],
        sessions: [session('session:a', { last: '2026-10-28T10:00:00Z' }), session('session:b', { state: 'stopped' })],
      }),
    );
    expect(rows.map((r) => r.key)).toEqual([
      'h:waiting',
      'h:stopped',
      's:session:b',
      'h:working',
      's:session:a',
      'h:ended',
    ]);
    expect(rows[0]).toMatchObject({ kind: 'head', words: 'none' });
  });
});

describe('lastArrival', () => {
  const arrivals = [
    ev(1, { type: 'session', op: 'log', key: 'session:a' }),
    ev(2, { session: 'session:b', key: 'change:pjman/y' }),
    ev(3, { type: 'decision', op: 'created', key: 'decision:pjman/x/pick', decision: true }),
  ];
  it('takes the newest event its session wrote or that touched its change or a decision on it', () => {
    expect(lastArrival(arrivals, { key: 'session:a' }, { key: 'change:pjman/x' })?.seq).toBe(3);
    expect(lastArrival(arrivals, { key: 'session:a' })?.seq).toBe(1);
    expect(lastArrival(arrivals, { key: 'session:b' })?.seq).toBe(2);
  });
  it('finds nothing for a card no arrival touched', () => {
    expect(lastArrival(arrivals, { key: 'session:z' }, { key: 'change:pjman/z' })).toBeUndefined();
  });
});
