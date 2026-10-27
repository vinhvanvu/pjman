import { describe, expect, it } from 'vitest';
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import { beneathMilestone, narrowToMilestone, pruneTree } from './narrow';

const row = (key: string, extra: Partial<ChangeRow> = {}): ChangeRow => ({
  key: `change:${key}`,
  title: key,
  status: 'open',
  features: [],
  waiting: 0,
  live: false,
  children: 0,
  ...extra,
});
const changeNode = (r: ChangeRow): ScopeNode => ({
  key: r.key,
  type: 'change',
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: 0,
  row: r,
  children: [],
});
const feature = (key: string, children: ScopeNode[]): ScopeNode => ({
  key: `feature:${key}`,
  type: 'feature',
  name: key,
  owners: [],
  open: 99,
  inFlight: 99,
  projects: [],
  childCount: children.filter((c) => c.type === 'feature').length,
  children,
});

const goal = row('goal', { children: 2, progress: { done: 0, total: 2 } });
const a = row('a', { parent: 'change:goal', status: 'active' });
const b = row('b', { parent: 'change:goal' });
const sub = row('sub', { parent: 'change:b' });
const loose = row('loose');
const changes = [goal, a, b, sub, loose];

describe('narrowing to a milestone', () => {
  it('finds everything beneath, transitively, and never the milestone itself', () => {
    expect([...beneathMilestone(changes, 'change:goal')].toSorted()).toEqual(['change:a', 'change:b', 'change:sub']);
    expect(beneathMilestone(changes, 'change:loose').size).toBe(0);
  });

  it('prunes the tree to the features touched, keeps ancestors, recounts', () => {
    const tree = [
      feature('top', [feature('cap', [changeNode(a)]), feature('other', [changeNode(loose)]), changeNode(b)]),
      feature('untouched', [changeNode(loose)]),
    ];
    const out = pruneTree(tree, beneathMilestone(changes, 'change:goal'));
    expect(out.map((n) => n.key)).toEqual(['feature:top']);
    expect(out[0]!.children.map((n) => n.key)).toEqual(['feature:cap', 'change:b']);
    expect(out[0]!.open).toBe(2);
    expect(out[0]!.inFlight).toBe(1);
    expect(out[0]!.childCount).toBe(1);
  });

  it('narrows the changes and the waiting decisions, leaves health alone', () => {
    const scope = {
      changes,
      tree: [],
      waitingOn: [
        { key: 'decision:a/x', change: 'change:a' },
        { key: 'decision:loose/y', change: 'change:loose' },
      ],
      health: { days: 14, last: null, staleDays: null, moved: 7, done: 0, created: 0, blocked: 0, waiting: 2 },
    } as unknown as Scope;
    const out = narrowToMilestone(scope, 'change:goal');
    expect(out.changes.map((r) => r.key)).toEqual(['change:a', 'change:b', 'change:sub']);
    expect(out.waitingOn.map((d) => d.key)).toEqual(['decision:a/x']);
    expect(out.health).toBe(scope.health);
  });
});
