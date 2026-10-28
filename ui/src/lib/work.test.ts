import { describe, expect, it } from 'vitest';
import type { ChangeRow, WaitingDecision } from '@/data/contract';
import { asksOf, byIntent, byMoved, decisionsByChange, intentOf, strayDecisions } from './work';

const row = (key: string, status: string, extra: Partial<ChangeRow> = {}): ChangeRow => ({
  key: `change:${key}`,
  title: key,
  status,
  features: [],
  waiting: 0,
  decided: 0,
  live: false,
  children: 0,
  dependsOn: [],
  ...extra,
});

describe('work by intent', () => {
  it('puts anything that needs a person first, whatever its status', () => {
    expect(intentOf(row('a', 'active'))).toBe('progress');
    expect(intentOf(row('b', 'active', { waiting: 1 }))).toBe('waiting');
    expect(intentOf(row('c', 'review'))).toBe('waiting');
    expect(intentOf(row('d', 'blocked'))).toBe('waiting');
    expect(intentOf(row('e', 'planning'))).toBe('progress');
    expect(intentOf(row('f', 'open'))).toBe('upcoming');
    expect(intentOf(row('g', 'done', { waiting: 1 }))).toBe('done');
    expect(intentOf(row('h', undefined as unknown as string))).toBe('upcoming');
  });

  it('groups in order and orders each group by motion', () => {
    const groups = byIntent([
      row('old', 'active', { moved: '2026-10-01T00:00:00Z' }),
      row('new', 'active', { moved: '2026-10-20T00:00:00Z' }),
      row('never', 'active', { created: '2026-09-01' }),
      row('ask', 'planning', { waiting: 2 }),
      row('soon', 'open'),
    ]);
    expect(groups.map((g) => [g.intent, g.rows.map((r) => r.key)])).toEqual([
      ['waiting', ['change:ask']],
      ['progress', ['change:new', 'change:old', 'change:never']],
      ['upcoming', ['change:soon']],
    ]);
    expect(byIntent([])).toEqual([]);
  });

  it('attaches decisions to their change and keeps strays visible', () => {
    const d = (key: string, change: string): WaitingDecision => ({
      key: `decision:${change}/${key}`,
      change: `change:${change}`,
    });
    const waiting = [d('x', 'a'), d('y', 'a'), d('z', 'gone')];
    const by = decisionsByChange(waiting);
    expect(by.get('change:a')?.map((w) => w.key)).toEqual(['decision:a/x', 'decision:a/y']);
    expect(strayDecisions(waiting, [row('a', 'active')]).map((w) => w.key)).toEqual(['decision:gone/z']);
  });

  it('says the asks in short words', () => {
    expect(asksOf(row('a', 'review'), 2)).toEqual(['decide 2', 'review']);
    expect(asksOf(row('b', 'blocked'), 0)).toEqual(['unblock']);
    expect(asksOf(row('c', 'active'), 0)).toEqual([]);
    expect(
      byMoved([row('b', 'open', { moved: '2026-01-02' }), row('a', 'open', { moved: '2026-01-03' })]).map((r) => r.key),
    ).toEqual(['change:a', 'change:b']);
  });
});
