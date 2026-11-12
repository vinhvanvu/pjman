import { describe, expect, it } from 'vitest';
import type { RailLane } from '@/data/contract';
import { absence, chipViews, sessionBar, sessionTitle, shownOf, viewing, waitsLine } from './model';

const lane = (id: string, writes: number, o: Partial<RailLane> = {}): RailLane => ({
  id,
  kind: 'change',
  label: id.split('/').pop(),
  count: writes + 1,
  writes,
  ...o,
});

describe('the chips', () => {
  const lanes = [lane('change:p/detail-pages', 6), lane('change:p/activity-timeline', 1), lane('change:p/record', 0)];
  it('are the change lanes in their order, with their writes or the word read, the focus marked', () => {
    const chips = chipViews(lanes, 'change:p/detail-pages', [{ change: 'change:p/detail-pages' }]);
    expect(chips.map((c) => c.title)).toEqual(['detail-pages', 'activity-timeline', 'record']);
    expect(chips.map((c) => c.count)).toEqual(['6 writes', '1 write', 'read']);
    expect(chips.map((c) => c.isFocus)).toEqual([true, false, false]);
    expect(chips.map((c) => c.waits)).toEqual([1, 0, 0]);
  });
  it('leave out the folded lane and a decision lane, and keep the rail hue of each change', () => {
    const chips = chipViews(
      [...lanes, lane('more', 0, { kind: 'more', folded: 2 }), lane('decision:p/c/x', 1, { kind: 'decision' })],
      undefined,
    );
    expect(chips).toHaveLength(3);
    expect(new Set(chips.map((c) => c.colour)).size).toBe(3);
  });
});

describe('the shown change', () => {
  it('is the pick while held, else the focus; viewing is a pick away from the focus', () => {
    expect(shownOf(undefined, 'change:a')).toBe('change:a');
    expect(shownOf('change:b', 'change:a')).toBe('change:b');
    expect(viewing(undefined, 'change:a')).toBe(false);
    expect(viewing('change:a', 'change:a')).toBe(false);
    expect(viewing('change:b', 'change:a')).toBe(true);
  });
});

describe('the session bar', () => {
  const now = Date.parse('2026-11-06T15:12:00Z');
  const base = { agent: 'agent:claude-code', onBehalfOf: 'person:vinhvanvu', started: '2026-11-06T12:00:00Z' };
  it('reads who, working for how long, the last act, and what waits', () => {
    const bar = sessionBar({ ...base, state: 'live', last: '2026-11-06T15:10:00Z' }, 2, now);
    expect(bar.parts).toEqual(['claude-code for vinhvanvu', 'working 3h 12m', 'last acted 2 min ago']);
    expect(bar.waits).toBe('2 wait on you');
    expect(bar.alarm).toBe(true);
  });
  it('says quiet or ended since when, and that nothing waits', () => {
    expect(sessionBar({ ...base, state: 'quiet', last: '2026-11-06T14:00:00Z' }, 0, now).parts[1]).toBe(
      'quiet since 1 h ago',
    );
    const ended = sessionBar({ ...base, state: 'ended', last: '2026-11-06T14:00:00Z' }, 0, now);
    expect(ended.parts).toEqual(['claude-code for vinhvanvu', 'ended 1 h ago']);
    expect(ended.waits).toBe('nothing waits on you');
    expect(waitsLine(1)).toBe('1 waits on you');
  });
  it('says where the session runs when a host holds it, and that the version is unvalidated when it is', () => {
    const inRex = sessionBar(
      {
        ...base,
        state: 'live',
        last: '2026-11-06T15:10:00Z',
        host: { name: 'rex', version: '0.3.1', validated: true },
      },
      0,
      now,
    );
    expect(inRex.parts[0]).toBe('claude-code for vinhvanvu in rex 0.3.1');
    expect(
      sessionBar({ ...base, state: 'live', host: { name: 'rex', version: '1.4.0', validated: false } }, 0, now)
        .parts[0],
    ).toBe('claude-code for vinhvanvu in rex 1.4.0 (unvalidated)');
    expect(sessionBar({ ...base, state: 'live', host: { name: 'cmux' } }, 0, now).parts[0]).toBe(
      'claude-code for vinhvanvu in cmux',
    );
  });
  it('says what the program is blocked on when the host says so, in place of working', () => {
    const host = (kind?: 'question' | 'permission' | 'auth') => ({
      name: 'rex',
      status: { state: 'blocked' as const, kind, at: '2026-11-06T15:11:00Z' },
    });
    expect(
      sessionBar({ ...base, state: 'live', last: '2026-11-06T15:10:00Z', host: host('question') }, 0, now).parts,
    ).toEqual(['claude-code for vinhvanvu in rex', 'asks you a question', 'last acted 2 min ago']);
    expect(sessionBar({ ...base, state: 'live', host: host('permission') }, 0, now).parts[1]).toBe(
      'asks your permission',
    );
    expect(sessionBar({ ...base, state: 'live', host: host('auth') }, 0, now).parts[1]).toBe('needs you to sign in');
    expect(sessionBar({ ...base, state: 'live', host: host() }, 0, now).parts[1]).toBe('blocked, needs you');
    // a working program reads as before
    expect(
      sessionBar(
        { ...base, state: 'live', host: { name: 'rex', status: { state: 'working', at: '2026-11-06T15:11:00Z' } } },
        0,
        now,
      ).parts[1],
    ).toBe('working 3h 12m');
  });
  it('names the session for the crumb', () => {
    expect(sessionTitle({ key: 'session:abc', ...base })).toBe('claude-code · 2026-11-06, for vinhvanvu');
    expect(sessionTitle({ key: 'session:abcdefghijk' })).toBe('abcdefgh');
  });
});

describe('absence', () => {
  it('takes a session the store has not got as starting, until the window has passed', () => {
    expect(absence(404, false)).toBe('starting');
    expect(absence(404, true)).toBe('none');
  });
  it("says any other failure as the server's, whether or not the window has passed", () => {
    expect(absence(500, false)).toBe('failed');
    expect(absence(undefined, true)).toBe('failed');
  });
});
