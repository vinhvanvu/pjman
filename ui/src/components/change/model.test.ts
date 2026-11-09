import { describe, expect, it } from 'vitest';
import type { BridgeMotion, BridgeSession, ChangeRow, LiveSession } from '@/data/contract';
import { factsOfMotion, factsOfRow, isWorking, nameOf, pillWords, stepWords } from './model';

const NOW = Date.parse('2026-11-08T12:00:00Z');

describe('one change at three depths', () => {
  it("reads the bridge's card as facts, its sessions resolved by key", () => {
    const s: BridgeSession = {
      key: 'session:a',
      agent: 'agent:claude-code',
      state: 'working',
      inReview: false,
      children: [],
      last: '2026-11-08T11:59:00Z',
    };
    const c: BridgeMotion = {
      key: 'change:p/x',
      name: 'X',
      status: 'active',
      path: [
        { key: 'feature:p/a', name: 'A' },
        { key: 'feature:p/b', name: 'B' },
      ],
      steps: { done: 1, total: 3, dropped: 0 },
      step: { n: 2, text: 'the step', state: 'active', note: 'where it stands' },
      last: '2026-11-08T11:59:00Z',
      sessions: ['session:a', 'session:gone'],
    };
    const f = factsOfMotion(c, new Map([[s.key, s]]));
    expect(f.sessions).toEqual([s]);
    expect(f.path).toEqual(['A', 'B']);
    expect(isWorking(f)).toBe(true);
    expect(nameOf(f)).toBe('X');
    expect(stepWords(f)).toEqual({ lead: 'step 2 of 3', text: 'the step' });
  });

  it("reads a scope's row as facts, the live sessions on it working, the names resolved", () => {
    const r = {
      key: 'change:p/x',
      gist: 'the gist',
      status: 'planning',
      features: [
        { effect: 'changes', key: 'feature:p/b', viaPlace: true },
        { effect: 'adds', key: 'feature:p/a' },
      ],
      waiting: 2,
      decided: 0,
      live: true,
      children: 0,
      dependsOn: [],
      aspects: [],
      needs: [],
      stale: false,
      parent: 'change:p/m',
      plan: { done: 0, total: 1 },
      step: { n: 1, text: 'first', state: 'open' },
      moved: '2026-11-08T11:00:00Z',
    } as ChangeRow;
    const live: LiveSession[] = [
      {
        key: 'session:a',
        agent: 'agent:claude-code',
        last: '2026-11-08T11:58:00Z',
        on: 'change:p/x',
        state: 'working',
      },
      { key: 'session:b', last: '2026-11-08T11:58:00Z', on: 'change:p/other', state: 'working' },
      { key: 'session:c', last: '2026-11-08T11:50:00Z', on: 'change:p/x', state: 'stopped' },
    ];
    const names = new Map([
      ['feature:p/a', 'A'],
      ['change:p/m', 'Milestone'],
    ]);
    const f = factsOfRow(r, live, names);
    // each live session on the change with its own state: the stopped one is on it but not working
    expect(f.sessions.map((s) => [s.key, s.state])).toEqual([
      ['session:a', 'working'],
      ['session:c', 'stopped'],
    ]);
    expect(f.path).toEqual(['A']);
    expect(f.parent).toEqual({ key: 'change:p/m', name: 'Milestone' });
    expect(f.waiting).toBe(2);
    expect(f.last).toBe('2026-11-08T11:00:00Z');
    expect(nameOf(f)).toBe('the gist');
    expect(stepWords(f)).toEqual({ lead: 'next', text: 'first' });
    expect(pillWords(f.sessions[0]!, NOW)).toBe('claude-code · working · 2 min ago');
  });

  it("reads a milestone's row by its children, not its own plan (change:bridge-card-reads-the-plan)", () => {
    const m = {
      key: 'change:p/m',
      name: 'Milestone',
      status: 'active',
      features: [],
      waiting: 0,
      decided: 0,
      live: false,
      kind: 'milestone',
      children: 17,
      progress: { done: 16, total: 17 },
      plan: { done: 0, total: 3 },
      needs: [],
      stale: false,
    } as unknown as ChangeRow;
    expect(factsOfRow(m, []).steps).toEqual({ done: 16, total: 17, dropped: 0 });
    // a leaf keeps its plan
    expect(factsOfRow({ ...m, kind: undefined, children: 0, progress: undefined }, []).steps).toEqual({ done: 0, total: 3, dropped: 0 });
  });

  it('says where the work stands: blocked on, done waiting for a look, no steps yet', () => {
    const base = { steps: { done: 0, total: 0, dropped: 0 } };
    expect(stepWords({ ...base, status: 'blocked', blockedOn: 'Public' })).toEqual({ lead: 'on', text: 'Public' });
    expect(stepWords({ ...base, status: 'review' })).toEqual({ lead: 'done', text: 'waits for a look' });
    expect(stepWords({ status: 'review', steps: { done: 2, total: 3, dropped: 0 } })).toEqual({
      lead: 'done',
      text: '2 of 3; waits for a look',
    });
    expect(stepWords({ ...base, status: 'open' })).toEqual({ lead: 'plan', text: 'no steps yet' });
    expect(stepWords({ status: 'active', steps: { done: 2, total: 2, dropped: 1 } })).toEqual({
      lead: 'plan',
      text: 'every step done',
    });
  });
});
