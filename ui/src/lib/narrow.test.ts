import { describe, expect, it } from 'vitest';
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import { beneathMilestone, narrowToAspect, narrowToMilestone, pruneTree, worksOn } from './narrow';

const row = (key: string, extra: Partial<ChangeRow> = {}): ChangeRow => ({
  key: `change:${key}`,
  title: key,
  status: 'open',
  features: [],
  waiting: 0,
  decided: 0,
  live: false,
  children: 0,
  dependsOn: [],
  aspects: [],
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

describe('narrowing to an aspect', () => {
  const named = row('named', { parent: 'change:goal', aspects: ['aspect:p/text'], position: 1 });
  const placed = row('placed', { aspects: ['aspect:p/text/cart'], position: 2 });
  const other = row('other', { aspects: ['aspect:p/textual'], position: 0 });
  const plain = row('plain', { parent: 'change:goal', position: 1 });
  const parent = row('goal', { children: 2, position: 1 });
  const bug = row('bug', { kind: 'bug', aspects: ['aspect:p/text'] });
  const scope = {
    changes: [other, parent, named, plain, placed, bug],
    tree: [feature('f', [changeNode(named), changeNode(plain)])],
    waitingOn: [{ key: 'decision:plain/x', change: 'change:plain' }],
    bugs: [bug, row('other-bug', { kind: 'bug' })],
    roadmap: {
      product: 'product:p',
      sequence: ['change:other', 'change:goal', 'change:placed'],
      later: [],
      violations: [{ kind: 'overdue', change: 'change:other' }],
    },
  } as unknown as Scope;

  it('works on the aspect by naming it or one of its places, never an aspect that only shares the prefix', () => {
    expect(worksOn(named, 'aspect:p/text')).toBe(true);
    expect(worksOn(placed, 'aspect:p/text')).toBe(true);
    expect(worksOn(other, 'aspect:p/text')).toBe(false);
  });

  it('keeps the work and the milestones it sits in, the sequence and positions following', () => {
    const out = narrowToAspect(scope, 'aspect:p/text');
    expect(out.changes.map((r) => r.key)).toEqual(['change:goal', 'change:named', 'change:placed', 'change:bug']);
    expect(out.roadmap.sequence).toEqual(['change:goal', 'change:placed']);
    expect(out.changes.map((r) => r.position)).toEqual([0, 0, 1, undefined]);
    expect(out.roadmap.violations).toEqual([]);
    expect(out.waitingOn).toEqual([]);
    expect(out.bugs.map((r) => r.key)).toEqual(['change:bug']);
    expect(out.tree[0]!.children.map((n) => n.key)).toEqual(['change:named']);
  });
});
