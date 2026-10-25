import { describe, expect, it } from 'vitest';
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import { allFeatureKeys, changesBeneath, changesHere, pathTo, productMap, unassigned } from './model';

const change = (key: string): ScopeNode => ({
  key: `change:${key}`,
  type: 'change',
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: 0,
  row: { key: `change:${key}`, title: key, features: [], waiting: 0, live: false, children: 0 } as ChangeRow,
  children: [],
});
const feature = (key: string, children: ScopeNode[] = []): ScopeNode => ({
  key: `feature:${key}`,
  type: 'feature',
  name: key,
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: children.filter((c) => c.type === 'feature').length,
  children,
});

const tree: ScopeNode[] = [
  feature('dashboard', [
    feature('board'),
    feature('navigation', [feature('auto-navigation', [change('auto')]), change('v2')]),
    change('here'),
  ]),
  feature('store'),
  {
    key: 'unassigned',
    type: 'unassigned',
    title: 'No feature named',
    owners: [],
    open: 1,
    inFlight: 0,
    projects: [],
    childCount: 0,
    children: [change('loose')],
  },
];

describe('the product map', () => {
  it('is features only, indexed by parent', () => {
    const map = productMap(tree);
    expect([...map.items.keys()]).toEqual([
      'feature:dashboard',
      'feature:board',
      'feature:navigation',
      'feature:auto-navigation',
      'feature:store',
    ]);
    expect(map.children.get('feature:navigation')).toEqual(['feature:auto-navigation']);
    expect(allFeatureKeys(tree)).toHaveLength(5);
    expect(unassigned(tree)?.children.map((c) => c.key)).toEqual(['change:loose']);
  });

  it('knows the path to a selection', () => {
    expect(pathTo(tree, 'feature:auto-navigation')).toEqual(['feature:dashboard', 'feature:navigation']);
    expect(pathTo(tree, 'feature:store')).toEqual([]);
  });
});

describe('changes at a node', () => {
  it('separates what sits here from what is filed beneath', () => {
    const at = tree[0]!.children; // standing on feature:dashboard: its tree is its children
    expect(changesHere(at).map((r) => r.key)).toEqual(['change:here']);
    const beneath = changesBeneath({ tree: at } as Scope);
    expect(beneath.map((g) => [g.feature.key, g.rows.map((r) => r.key)])).toEqual([
      ['feature:navigation', ['change:v2']],
      ['feature:auto-navigation', ['change:auto']],
    ]);
  });
});
