import { describe, expect, it } from 'vitest';
import type { ChangeContext, RailRow } from '@/data/contract';
import { bandOf, planRead, sourcePlace, sourcesRead, writeWords } from './calm';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
type Step = ChangeContext['plan'][number];
const step = (text: string, state: Step['state']): Step => ({ text, state });
type Source = ChangeContext['sources'][number];
const src = (key: string, url?: string): Source => ({ key, via: 'links', url });

describe('bandOf', () => {
  it('reads done as the one solid band, with the release it shipped in', () => {
    const b = bandOf(
      {
        status: 'done',
        waiting: 0,
        working: false,
        shipped: 'shipped in v0.4.0',
      },
      NOW,
    );
    expect(b).toMatchObject({
      word: 'Done',
      aside: 'shipped in v0.4.0',
      tone: 'done',
      mark: 'check',
      solid: true,
    });
  });
  it('puts what waits on the person ahead of the status', () => {
    const b = bandOf({ status: 'active', waiting: 1, working: false, last: minsAgo(2) }, NOW);
    expect(b).toMatchObject({
      word: 'Waiting on you',
      aside: '1 decision · stopped 2 min ago',
      tone: 'waits',
    });
    expect(b.solid).toBe(false);
  });
  it('says a working session is working, for how long, with the live pulse', () => {
    const b = bandOf({ status: 'active', waiting: 0, working: true, started: minsAgo(38) }, NOW);
    expect(b).toMatchObject({
      word: 'Active',
      aside: 'working now · 38m',
      tone: 'active',
      mark: 'pulse',
    });
  });
  it('names what a blocked change is blocked on, first line only', () => {
    const b = bandOf(
      {
        status: 'blocked',
        waiting: 0,
        working: false,
        blockedOn: 'change:rex-adapter\nmore',
      },
      NOW,
    );
    expect(b).toMatchObject({
      word: 'Blocked',
      aside: 'change:rex-adapter',
      tone: 'alarm',
      mark: 'alert',
    });
  });
  it('reads review in the waiting colour and an unknown status by its own word', () => {
    expect(bandOf({ status: 'review', waiting: 0, working: false }, NOW)).toMatchObject({
      word: 'In review',
      tone: 'waits',
    });
    expect(bandOf({ status: 'parked', waiting: 0, working: false }, NOW)).toMatchObject({
      word: 'Parked',
      tone: 'open',
    });
  });
  it('does not let a waiting decision hide that the change is done', () => {
    expect(bandOf({ status: 'done', waiting: 2, working: false }, NOW).word).toBe('Done');
  });
});

describe('planRead', () => {
  it('counts done of the steps not dropped, the dropped apart', () => {
    const r = planRead([
      step('a', 'done'),
      step('b', 'dropped'),
      step('c', 'active'),
      step('d', 'open'),
      step('e', 'open'),
    ]);
    expect(r.sum).toBe('1 of 4 done · 1 dropped');
    expect(r.step?.text).toBe('c');
    expect(r.next?.text).toBe('d');
  });
  it('takes the first open step when none is active, and nothing when all are done', () => {
    expect(planRead([step('a', 'done'), step('b', 'open')]).step?.text).toBe('b');
    const all = planRead([step('a', 'done'), step('b', 'done')]);
    expect(all).toMatchObject({
      sum: '2 of 2 done',
      step: undefined,
      next: undefined,
    });
  });
  it('says so when there is no plan', () => {
    expect(planRead([]).sum).toBe('no steps yet');
  });
});

describe('sourcesRead', () => {
  it('puts links before files and holds the rest behind a count', () => {
    const r = sourcesRead([src('file:a'), src('url:x'), src('file:b'), src('file:c'), src('github-pr:o/r#1')], 3);
    expect(r.sum).toBe('2 links · 3 files');
    expect(r.shown.map((s) => s.key)).toEqual(['url:x', 'github-pr:o/r#1', 'file:a']);
    expect(r.rest.map((s) => s.key)).toEqual(['file:b', 'file:c']);
  });
  it('says none yet when there are none', () => {
    expect(sourcesRead([]).sum).toBe('none yet');
  });
});

describe('writeWords', () => {
  const row = (o: Partial<RailRow>): RailRow => ({
    seq: 1,
    at: '',
    lane: null,
    kind: 'write',
    op: 'set',
    key: 'change:p/x',
    type: 'change',
    ...o,
  });
  it('names a decision by what happened to it', () => {
    expect(writeWords(row({ kind: 'decision', op: 'created', label: 'Agent signal' }))).toEqual({
      verb: 'Proposed',
      object: 'Agent signal',
    });
    expect(writeWords(row({ kind: 'decision', value: 'decided', label: 'Calm dock' }))).toEqual({
      verb: 'Decided',
      object: 'Calm dock',
    });
  });
  it('names the first file linked and counts the rest', () => {
    expect(writeWords(row({ kind: 'file', files: ['src/a.ts', 'src/b.ts'] }))).toEqual({
      verb: 'Linked',
      object: 'src/a.ts and 1 more',
    });
  });
  it('reads a status by where it went and a plan write by what the step did', () => {
    expect(writeWords(row({ fields: ['status'], value: 'done' }))).toEqual({ verb: 'Status', object: '→ done' });
    expect(writeWords(row({ fields: ['plan', 'step done', '3 steps'] })).verb).toBe('Finished a step');
    expect(writeWords(row({ fields: ['plan', 'step note'] })).verb).toBe('Noted a step');
    expect(writeWords(row({ fields: ['notes'] })).verb).toBe('Left a note');
    expect(writeWords(row({ op: 'created' })).verb).toBe('Filed the change');
    expect(writeWords(row({ fields: ['owners'] }))).toEqual({ verb: 'Set', object: 'owners' });
  });
  it('names the step a step write touched, with its text from the plan', () => {
    const plan = [{ text: 'Find the cause' }, { text: 'Fix the line' }];
    expect(writeWords(row({ fields: ['plan', 'step done'], value: '1' }), plan)).toEqual({
      verb: 'Finished step 1',
      object: 'Find the cause',
    });
    expect(writeWords(row({ fields: ['plan', 'step note'], value: '2' }), plan)).toEqual({
      verb: 'Noted on step 2',
      object: 'Fix the line',
    });
    expect(writeWords(row({ fields: ['plan', 'step add', '2 steps'], value: '3,4' }), plan)).toEqual({
      verb: 'Added steps',
      object: '3, 4',
    });
  });
});

describe('sourcePlace', () => {
  it('names a link by its host, else by the kind in its key', () => {
    expect(sourcePlace({ key: 'url:x', url: 'https://www.code.claude.com/docs' })).toBe('code.claude.com');
    expect(sourcePlace({ key: 'linear:ABC-1234' })).toBe('linear');
  });
});
