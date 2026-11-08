import { describe, expect, it } from 'vitest';
import type { BridgeMotion, BridgeSession, TimelineEvent } from '@/data/contract';
import {
  cardRows,
  changeOfEvent,
  groupsOf,
  lastArrival,
  motionOf,
  pillWords,
  sessionChanges,
  stepWords,
  ticksOf,
  unbound,
} from './model';

const s = (key: string, o: Partial<BridgeSession> = {}): BridgeSession => ({
  key: `session:${key}`,
  state: 'working',
  inReview: false,
  children: [],
  ...o,
});
const on = (key: string) => ({ key: `change:p/${key}`, title: key, path: [] });
const c = (key: string, o: Partial<BridgeMotion> = {}): BridgeMotion => ({
  key: `change:p/${key}`,
  name: key,
  status: 'active',
  path: [],
  steps: { done: 0, total: 0, dropped: 0 },
  last: '2026-11-08T10:00:00Z',
  sessions: [],
  ...o,
});
const ev = (seq: number, o: Partial<TimelineEvent>): TimelineEvent => ({
  seq,
  at: '2026-11-08T10:00:00Z',
  op: 'set',
  key: 'change:p/a',
  type: 'change',
  decision: false,
  ...o,
});

describe('motionOf and groupsOf', () => {
  it('reads blocked and review from the status, working from a working session on it, else stopped', () => {
    const sessions = new Map([
      ['session:w', s('w', { state: 'working' })],
      ['session:k', s('k', { state: 'stopped' })],
    ]);
    expect(motionOf(c('a', { status: 'blocked', sessions: ['session:w'] }), sessions)).toBe('blocked');
    expect(motionOf(c('a', { status: 'review', sessions: ['session:w'] }), sessions)).toBe('review');
    expect(motionOf(c('a', { sessions: ['session:w'] }), sessions)).toBe('working');
    expect(motionOf(c('a', { sessions: ['session:k'] }), sessions)).toBe('stopped');
    expect(motionOf(c('a', { status: 'planning' }), sessions)).toBe('stopped');
  });

  it('lists every group in order, empty or not, each the most recently touched first; a subagent working counts', () => {
    const groups = groupsOf({
      sessions: [
        s('p', {
          state: 'stopped',
          children: [s('kid', { state: 'working' })],
        }),
      ],
      changes: [
        c('old', { last: '2026-11-08T08:00:00Z' }),
        c('new', { last: '2026-11-08T09:00:00Z' }),
        c('kid', { sessions: ['session:kid'] }),
        c('rev', { status: 'review' }),
      ],
    });
    expect(groups.map((g) => [g.state, g.changes.map((x) => x.key)])).toEqual([
      ['working', ['change:p/kid']],
      ['stopped', ['change:p/new', 'change:p/old']],
      ['review', ['change:p/rev']],
      ['blocked', []],
    ]);
  });

  it('lays the groups out as one list of headings and cards', () => {
    const rows = cardRows(
      groupsOf({
        sessions: [],
        changes: [c('a'), c('b', { status: 'blocked' })],
      }),
    );
    expect(rows.map((r) => r.key)).toEqual([
      'h:working',
      'h:stopped',
      'c:change:p/a',
      'h:review',
      'h:blocked',
      'c:change:p/b',
    ]);
    expect(rows.filter((r) => r.kind === 'head').map((r) => (r.kind === 'head' ? r.words : ''))).toEqual([
      'none',
      '1 change',
      'none',
      '1 change',
    ]);
  });
});

describe('stepWords', () => {
  it('says what blocks, that review waits for a look, the active step of the total, or the next', () => {
    expect(stepWords(c('a', { status: 'blocked', blockedOn: 'a key from the vendor' }))).toEqual({
      lead: 'on',
      text: 'a key from the vendor',
    });
    expect(stepWords(c('a', { status: 'review', steps: { done: 5, total: 5, dropped: 0 } }))).toEqual({
      lead: 'done',
      text: '5 of 5; waits for a look',
    });
    expect(
      stepWords(
        c('a', {
          status: 'review',
          step: { n: 6, text: 'Look.', state: 'open' },
          steps: { done: 5, total: 6, dropped: 0 },
        }),
      ),
    ).toEqual({ lead: 'next', text: 'Look.' });
    expect(
      stepWords(
        c('a', {
          step: { n: 2, text: 'Build it.', state: 'active' },
          steps: { done: 1, total: 6, dropped: 0 },
        }),
      ),
    ).toEqual({ lead: 'step 2 of 6', text: 'Build it.' });
    expect(
      stepWords(
        c('a', {
          step: { n: 1, text: 'Start.', state: 'open' },
          steps: { done: 0, total: 3, dropped: 0 },
        }),
      ),
    ).toEqual({ lead: 'next', text: 'Start.' });
    expect(stepWords(c('a'))).toEqual({ lead: 'plan', text: 'no steps yet' });
    expect(stepWords(c('a', { steps: { done: 2, total: 2, dropped: 0 } }))).toEqual({
      lead: 'plan',
      text: 'every step done',
    });
    expect(stepWords(c('a', { steps: { done: 0, total: 0, dropped: 3 } }))).toEqual({
      lead: 'plan',
      text: 'every step dropped',
    });
  });
});

describe('pillWords', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('names who, what it is doing and since when', () => {
    expect(
      pillWords(
        {
          agent: 'agent:claude-code',
          state: 'working',
          last: '2026-11-08T11:59:50Z',
        },
        now,
      ),
    ).toBe('claude-code · working · just now');
    expect(
      pillWords(
        {
          agent: 'agent:claude-code',
          state: 'ended',
          last: '2026-11-08T11:00:00Z',
        },
        now,
      ),
    ).toBe('claude-code · ended · 1 h ago');
    expect(pillWords({ state: 'stopped' }, now)).toBe('session · stopped');
    expect(pillWords({ agent: 'agent:x', state: 'waiting', last: '2026-11-08T10:00:00Z' }, now)).toBe(
      'x · waiting · 2 h ago',
    );
  });
});

describe('the tie to the transport', () => {
  const sessions = [s('a', { change: on('a'), children: [s('kid')] }), s('b', { change: on('b') }), s('free')];
  const onChange = sessionChanges(sessions);
  const events = [
    ev(1, { key: 'change:p/a' }),
    ev(2, { key: 'decision:p/a/why', type: 'decision', decision: true }),
    ev(3, { key: 'session:a', type: 'session', op: 'log' }),
    ev(4, { key: 'session:kid', type: 'session', op: 'log' }),
    ev(5, { key: 'change:p/b' }),
    ev(6, { key: 'session:free', type: 'session', op: 'log' }),
    ev(7, { key: 'feature:p/f', type: 'feature', session: 'session:b' }),
  ];

  it("maps each session to its change, a subagent to its own else its parent's", () => {
    expect([...onChange]).toEqual([
      ['session:a', 'change:p/a'],
      ['session:kid', 'change:p/a'],
      ['session:b', 'change:p/b'],
    ]);
  });

  it("reads the change of an event: the change, the decision's change, or the writing session's change", () => {
    expect(events.map((e) => changeOfEvent(e, onChange))).toEqual([
      'change:p/a',
      'change:p/a',
      'change:p/a',
      'change:p/a',
      'change:p/b',
      undefined,
      'change:p/b',
    ]);
  });

  it("collects the ticks that are a change's writes", () => {
    expect([...ticksOf('change:p/a', events, onChange)]).toEqual([1, 2, 3, 4]);
    expect([...ticksOf('change:p/b', events, onChange)]).toEqual([5, 7]);
    expect([...ticksOf('change:p/none', events, onChange)]).toEqual([]);
  });

  it('finds the last live arrival that touched a change', () => {
    expect(lastArrival(events, 'change:p/a', onChange)?.seq).toBe(4);
    expect(lastArrival(events, 'change:p/none', onChange)).toBeUndefined();
  });

  it('counts the sessions on no change that are not over', () => {
    expect(unbound([...sessions, s('gone', { state: 'ended' })]).map((x) => x.key)).toEqual(['session:free']);
  });
});
