import { describe, expect, it } from 'vitest';
import type { ChangeContext } from '@/data/contract';
import { changeBar, effectsOf, identityLabel, planFold, planView, shippedWords, sourcesView, workingOn } from './model';

describe('the plan and the children', () => {
  const step = (state: ChangeContext['plan'][number]['state'], text: string = state) => ({ text, state });
  it('heads the plan by the step the work is on, the dropped apart, a segment a step', () => {
    const v = planView([step('done'), step('active'), step('open'), step('dropped')]);
    expect(v.sum).toBe('step 2 of 3 · 1 dropped');
    expect(v.segments).toEqual(['done', 'on', 'open', 'dropped']);
    expect(v.row?.state).toBe('active');
  });
  it('draws the bar in order whatever order the steps were worked in', () => {
    expect(planView([step('done'), step('dropped'), step('open'), step('done'), step('active')]).segments).toEqual([
      'done',
      'done',
      'on',
      'open',
      'dropped',
    ]);
  });
  it('says when every step is done, or there are none', () => {
    expect(planView([step('done'), step('done')]).sum).toBe('all 2 steps done');
    expect(planView([]).sum).toBe('no steps yet');
    expect(planView([step('open', 'a'), step('open', 'b')]).row?.text).toBe('a');
  });
});

describe('the path and the sources', () => {
  it('reads feature effects as written', () => {
    expect(effectsOf(['adds feature:p/x', 'feature:p/y'])).toEqual([
      { effect: 'adds', key: 'feature:p/x' },
      { effect: 'changes', key: 'feature:p/y' },
    ]);
    expect(effectsOf(undefined)).toEqual([]);
  });
  it('sums the sources as the branch, the links and the files', () => {
    const src = (key: string) => ({ key, via: 'links' as const });
    const v = sourcesView({
      sources: [src('url:https://x'), src('file:a.ts'), src('file:b.ts')],
      branch: { name: 'detail-pages', worktree: 'detail-pages', observed: false },
    });
    expect(v.sum).toBe('branch detail-pages · 1 link · 2 files');
    expect(v.files).toHaveLength(2);
    expect(sourcesView({ sources: [] }).sum).toBe('no files yet');
  });
  it('labels the identity row by where the session is', () => {
    expect(identityLabel(false)).toBe('on now · change');
    expect(identityLabel(true, 'bug')).toBe('viewing · bug');
  });
});

describe('the wide plan folds what is behind the work', () => {
  const step = (state: ChangeContext['plan'][number]['state'], text: string = state) => ({ text, state });
  it('folds the done and dropped steps but the last done one, so the step the work is on leads', () => {
    const plan = [step('done', 'a'), step('dropped', 'b'), step('done', 'c'), step('done', 'd'), step('active', 'e')];
    const v = planFold(plan);
    expect(v.folded.map((s) => s.text)).toEqual(['a', 'b', 'c']);
    expect(v.shown.map((s) => s.text)).toEqual(['d', 'e']);
    expect(v.sum).toBe('2 done · 1 dropped');
  });
  it('folds nothing in a short plan, or with one step behind', () => {
    expect(planFold([step('done'), step('active'), step('open')]).folded).toEqual([]);
    expect(planFold([step('done'), step('active'), step('open'), step('open'), step('open')]).folded).toEqual([]);
  });
});

describe('the change bar', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const session = (key: string, first: string) => ({ key, first });
  it('says who is on it now, how many sessions over how long, when it was last touched, and what waits', () => {
    const v = changeBar(
      {
        sessions: [session('session:a', '2026-11-05T12:00:00Z'), session('session:b', '2026-11-08T10:00:00Z')],
        live: [{ key: 'session:b', agent: 'agent:claude-code', onBehalfOf: 'person:vinh' }],
        last: '2026-11-08T11:48:00Z',
        waits: 1,
      },
      now,
    );
    expect(v.parts).toEqual(['claude-code on it now, for vinh', '2 sessions over 2d 23h', 'last touched 12 min ago']);
    expect(v.waits).toBe('1 waits on you');
    expect(v.alarm).toBe(true);
    expect(v.live).toBe(true);
  });
  it('counts the live when several are on it, and says when no session has been on it', () => {
    expect(changeBar({ sessions: [], live: [], waits: 0 }, now)).toMatchObject({
      parts: ['no session yet'],
      live: false,
      waits: 'nothing waits on you',
      alarm: false,
    });
    const two = changeBar(
      { sessions: [session('session:a', '2026-11-08T10:00:00Z')], live: [{ key: 'a' }, { key: 'b' }], waits: 0 },
      now,
    );
    expect(two.parts).toEqual(['2 sessions on it now', '1 session']);
  });
});

describe('a session working the change', () => {
  const sessions = [
    { key: 'session:a', on: 'change:p/x', state: 'working' },
    { key: 'session:b', on: 'change:p/y', state: 'stopped' },
    { key: 'session:c', on: 'change:p/x/child', state: 'working' },
  ];
  it('is one of the live sessions on the change itself whose state is working', () => {
    expect(workingOn(sessions, 'change:p/x')).toBe(true);
  });
  it('is not a stopped session, nor a working one on a child beneath the change', () => {
    expect(workingOn(sessions, 'change:p/y')).toBe(false);
    expect(workingOn(sessions, 'change:p/z')).toBe(false);
    expect(workingOn([], 'change:p/x')).toBe(false);
  });
});

describe('shipped in', () => {
  const ctx = (status: string, versions: string[]) =>
    ({
      change: { status },
      releases: versions.map((version) => ({ key: `release:p/${version}`, version })),
    }) as unknown as Pick<ChangeContext, 'releases' | 'change'>;
  it('names the last release: in part while the change is open, in full once it is done', () => {
    expect(shippedWords(ctx('active', ['0.2.0']))).toBe('shipped in part in v0.2.0');
    expect(shippedWords(ctx('done', ['0.2.0', '0.3.0']))).toBe('shipped in v0.3.0');
    expect(shippedWords(ctx('active', []))).toBeUndefined();
  });
});
