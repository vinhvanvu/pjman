import { describe, expect, it } from 'vitest';
import type { ChangeRow } from '@/data/contract';
import { byActor, byMilestone, byStatus, inbox } from './model';

const row = (key: string, over: Partial<ChangeRow> = {}): ChangeRow => ({
  key: `change:${key}`,
  title: key,
  status: 'open',
  features: [],
  waiting: 0,
  live: false,
  children: 0,
  ...over,
});

const rows = [
  row('goal', { status: 'planning', children: 2, progress: { done: 1, total: 2 } }),
  row('a', { status: 'active', parent: 'change:goal', live: true }),
  row('b', { status: 'review', parent: 'change:goal', waiting: 2 }),
  row('c', { status: 'blocked' }),
  row('d', { status: 'open', parent: 'change:elsewhere' }),
];

describe('lanes', () => {
  it('by status keeps the order active, blocked, review, planning, open and drops empty lanes', () => {
    expect(byStatus(rows).map((l) => [l.id, l.rows.map((r) => r.key)])).toEqual([
      ['active', ['change:a']],
      ['blocked', ['change:c']],
      ['review', ['change:b']],
      ['planning', ['change:goal']],
      ['open', ['change:d']],
    ]);
  });

  it('by milestone groups under the top-most parent in the list; the rest have no milestone', () => {
    const lanes = byMilestone(rows);
    expect(lanes.map((l) => [l.id, l.rows.map((r) => r.key)])).toEqual([
      ['change:goal', ['change:a', 'change:b']],
      ['none', ['change:c', 'change:d']],
    ]);
    expect(lanes[0]?.progress).toEqual({ done: 1, total: 2 });
    expect(lanes[0]?.key).toBe('change:goal');
  });

  it('by actor: an agent is on it, a person has to move it, or it waits', () => {
    expect(byActor(rows).map((l) => [l.id, l.rows.map((r) => r.key)])).toEqual([
      ['agent', ['change:a']],
      ['person', ['change:b', 'change:c']],
      ['queued', ['change:goal', 'change:d']],
    ]);
  });
});

describe('inbox', () => {
  it('is what only a person can move', () => {
    const data = inbox({ waitingOn: [{ key: 'decision:b/why', change: 'change:b' }], changes: rows });
    expect(data.decisions).toHaveLength(1);
    expect(data.reviews.map((r) => r.key)).toEqual(['change:b']);
    expect(data.blocked.map((r) => r.key)).toEqual(['change:c']);
    expect(data.total).toBe(3);
  });
});
