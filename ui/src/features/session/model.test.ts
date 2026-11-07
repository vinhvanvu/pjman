import { describe, expect, it } from 'vitest';
import type { ChangeContext, RailLane } from '@/data/contract';
import {
  childrenView,
  chipViews,
  effectsOf,
  identityLabel,
  planView,
  sessionBar,
  sessionTitle,
  shownOf,
  sourcesView,
  viewing,
  waitsLine,
} from './model';

const lane = (id: string, writes: number, o: Partial<RailLane> = {}): RailLane => ({
  id,
  kind: 'change',
  title: id.split('/').pop(),
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
  it('names the session for the crumb', () => {
    expect(sessionTitle({ key: 'session:abc', ...base })).toBe('claude-code · 2026-11-06, for vinhvanvu');
    expect(sessionTitle({ key: 'session:abcdefghijk' })).toBe('abcdefgh');
  });
});

describe('the plan and the children', () => {
  const step = (state: ChangeContext['plan'][number]['state'], text: string = state) => ({ text, state });
  it('heads the plan by the step the work is on, the dropped apart, a segment a step', () => {
    const v = planView([step('done'), step('active'), step('open'), step('dropped')]);
    expect(v.sum).toBe('step 2 of 3 · 1 dropped');
    expect(v.segments).toEqual(['done', 'on', 'open', 'dropped']);
    expect(v.row?.state).toBe('active');
  });
  it('says when every step is done, or there are none', () => {
    expect(planView([step('done'), step('done')]).sum).toBe('all 2 steps done');
    expect(planView([]).sum).toBe('no steps yet');
    expect(planView([step('open', 'a'), step('open', 'b')]).row?.text).toBe('a');
  });
  it('heads a milestone by its children', () => {
    const child = (key: string, status: string) => ({ key, status }) as ChangeContext['children'][number];
    const v = childrenView([child('a', 'done'), child('b', 'active'), child('c', 'open'), child('d', 'dropped')]);
    expect(v.sum).toBe('1 of 3 done · 1 in flight');
    expect(v.row?.key).toBe('b');
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
