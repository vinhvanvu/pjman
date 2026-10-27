import { describe, expect, it } from 'vitest';
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import { bars, bySeverity, columns, featureParents, FOUNDATIONS, laneOf, lanes, LATER, pastSpan, ticks } from './model';

const row = (key: string, r: Partial<ChangeRow> = {}): ChangeRow => ({
  key: `change:${key}`,
  features: [],
  waiting: 0,
  live: false,
  children: 0,
  dependsOn: [],
  ...r,
});
const feature = (key: string, children: ScopeNode[] = [], extra: Partial<ScopeNode> = {}): ScopeNode => ({
  key: `feature:${key}`,
  type: 'feature',
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: children.length,
  children,
  ...extra,
});

const tree: ScopeNode[] = [
  {
    key: 'product:shop',
    type: 'product',
    owners: [],
    open: 0,
    inFlight: 0,
    projects: [],
    childCount: 2,
    children: [feature('checkout', [feature('cards')], { name: 'Checkout' }), feature('search')],
  },
];

describe('lanes', () => {
  it('flattens features by the expansion and closes with the foundations', () => {
    expect(lanes(tree, new Set(), true).map((l) => [l.key, l.depth])).toEqual([
      ['feature:checkout', 0],
      ['feature:search', 0],
      [FOUNDATIONS, 0],
    ]);
    expect(lanes(tree, new Set(['feature:checkout']), false).map((l) => l.key)).toEqual([
      'feature:checkout',
      'feature:cards',
      'feature:search',
    ]);
    expect(lanes(tree, new Set(), false)[0]?.label).toBe('Checkout');
  });
  it('places a change in its first feature, else the nearest shown ancestor, else the foundations', () => {
    const parents = featureParents(tree);
    const shown = new Set(['feature:checkout', 'feature:search']);
    expect(laneOf(row('a', { features: [{ effect: 'adds', key: 'feature:cards' }] }), shown, parents)).toBe(
      'feature:checkout',
    );
    expect(laneOf(row('b', { features: [{ effect: 'changes', key: 'feature:search' }] }), shown, parents)).toBe(
      'feature:search',
    );
    expect(laneOf(row('c'), shown, parents)).toBe(FOUNDATIONS);
  });
});

describe('columns', () => {
  const scope = {
    changes: [
      row('m1', { children: 2, progress: { done: 1, total: 2 }, position: 0, target: '2026-12-01' }),
      row('kid', { parent: 'change:m1', position: 0, status: 'active' }),
      row('done-kid', { parent: 'change:m1', position: 0, status: 'done' }),
      row('solo', { position: 1 }),
      row('loose', {}),
      row('loose-parent', { children: 1 }),
      row('loose-kid', { parent: 'change:loose-parent' }),
      row('bug', { kind: 'bug' }),
    ],
    roadmap: {
      product: 'product:shop',
      sequence: ['change:m1', 'change:solo'],
      later: [],
      violations: [{ kind: 'overdue', change: 'change:solo' }],
    },
  } as unknown as Scope;
  it('a milestone holds its open descendants, a loose change itself, later holds the unsequenced leaves', () => {
    const c = columns(scope);
    expect(c.map((x) => [x.kind, x.key, x.entries.map((e) => e.key)])).toEqual([
      ['milestone', 'change:m1', ['change:kid']],
      ['single', 'change:solo', ['change:solo']],
      ['later', LATER, ['change:loose', 'change:loose-kid']],
    ]);
    expect(c[1]?.violations).toEqual([{ kind: 'overdue', change: 'change:solo' }]);
    expect(c[0]?.target).toBe('2026-12-01');
  });
});

describe('the past', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  it('spans back to the earliest start, no less than two weeks, no more than the cap', () => {
    expect(pastSpan([], now).from).toBe(now - 14 * 86_400_000);
    expect(pastSpan([row('a', { began: '2026-09-01T00:00:00Z' })], now).from).toBe(Date.parse('2026-09-01T00:00:00Z'));
    expect(pastSpan([row('a', { began: '2025-01-01T00:00:00Z' })], now).from).toBe(now - 120 * 86_400_000);
  });
  it('draws bars for what began or finished, in flight reaching now', () => {
    const b = bars(
      [
        row('flight', { status: 'active', began: '2026-10-20T00:00:00Z' }),
        row('done', { status: 'done', began: '2026-10-01T00:00:00Z', finished: '2026-10-10T00:00:00Z' }),
        row('planned', { status: 'open' }),
        row('dropped', { status: 'dropped', began: '2026-10-01T00:00:00Z' }),
      ],
      now,
    );
    expect(b.map((x) => [x.row.key, x.done, x.to === now])).toEqual([
      ['change:flight', false, true],
      ['change:done', true, false],
    ]);
  });
  it('ticks fall on Mondays', () => {
    const t = ticks(Date.parse('2026-10-01T00:00:00'), Date.parse('2026-10-26T00:00:00'));
    expect(t.length).toBe(3);
    expect(new Date(t[0]!.t).getDay()).toBe(1);
    expect(t[0]?.month).toBe(true);
  });
});

describe('bugs', () => {
  it('groups by severity, worst first, unset last', () => {
    const g = bySeverity([
      row('a', { kind: 'bug', severity: 'cosmetic' }),
      row('b', { kind: 'bug', severity: 'product' }),
      row('c', { kind: 'bug' }),
    ]);
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([
      ['Product out', 1],
      ['Cosmetic', 1],
      ['No severity yet', 1],
    ]);
  });
});
