import { describe, expect, it } from 'vitest';
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import {
  allFeatureKeys,
  allWork,
  bodyOf,
  bugMark,
  filterTree,
  isFiltering,
  matches,
  byMotion,
  changesBeneath,
  changesHere,
  effectOn,
  featuresBelow,
  featuresByState,
  inFlight,
  healthWord,
  pathTo,
  productMap,
  unassigned,
} from './model';

const change = (key: string): ScopeNode => ({
  key: `change:${key}`,
  type: 'change',
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: 0,
  row: {
    key: `change:${key}`,
    title: key,
    features: [],
    waiting: 0,
    decided: 0,
    live: false,
    children: 0,
    dependsOn: [],
  } as ChangeRow,
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

describe('the overview', () => {
  it('says one word for health', () => {
    expect(healthWord({ staleDays: null, days: 14 })).toBe('not started');
    expect(healthWord({ staleDays: 3, days: 14 })).toBe('active');
    expect(healthWord({ staleDays: 14, days: 14 })).toBe('active');
    expect(healthWord({ staleDays: 15, days: 14 })).toBe('stale');
  });

  it('picks the body by level, not by whether the node has children', () => {
    const crumbs = (...keys: string[]) => keys.map((key) => ({ key }));
    expect(bodyOf({ node: null, crumbs: [] })).toBe('product');
    expect(bodyOf({ node: { key: 'product:p', type: 'product' } as Scope['node'], crumbs: [] })).toBe('product');
    const f = { key: 'feature:f', type: 'feature' } as Scope['node'];
    expect(bodyOf({ node: f, crumbs: crumbs('product:p') })).toBe('feature');
    expect(bodyOf({ node: f, crumbs: crumbs('product:p', 'feature:above') })).toBe('capability');
    expect(bodyOf({ node: f, crumbs: crumbs('product:p', 'feature:a', 'feature:b') })).toBe('capability');
  });

  it('counts features by state and orders them by motion', () => {
    const live = { ...feature('live'), derived: 'live', health: { last: '2026-10-20' } as ScopeNode['health'] };
    const planned = { ...feature('planned'), health: { last: null } as ScopeNode['health'] };
    const building = {
      ...feature('building'),
      derived: 'building',
      health: { last: '2026-10-24' } as ScopeNode['health'],
    };
    expect(featuresByState([live, planned, building])).toEqual({ live: 1, planned: 1, building: 1 });
    expect(byMotion([live, planned, building]).map((f) => f.key)).toEqual([
      'feature:building',
      'feature:live',
      'feature:planned',
    ]);
    expect(featuresBelow(tree).map((f) => f.key)).toEqual(['feature:dashboard', 'feature:store']);
    expect(allWork({ tree: tree[0]!.children }).map((r) => r.key)).toEqual(['change:here', 'change:v2', 'change:auto']);
  });

  it('lists milestones in flight nearest to done first and the verb on a node', () => {
    const m = (key: string, done: number, total: number, status = 'active') => ({
      ...change(key).row!,
      status,
      progress: { done, total },
    });
    expect(
      inFlight([m('far', 1, 4), m('near', 3, 4), m('over', 4, 4, 'done'), change('plain').row!]).map((r) => r.key),
    ).toEqual(['change:near', 'change:far']);
    const row = { ...change('x').row!, features: [{ effect: 'adds' as const, key: 'feature:f' }] };
    expect(effectOn(row, 'feature:f')).toBe('adds');
    expect(effectOn(row, 'feature:g')).toBeUndefined();
  });

  it('marks a row with the bugs beneath it, toned by the worst, and nothing when there are none', () => {
    expect(bugMark({ bugs: undefined })).toBeUndefined();
    expect(bugMark({ bugs: { here: 0, beneath: 0 } })).toBeUndefined();
    expect(bugMark({ bugs: { here: 1, beneath: 3, worst: 'feature' } })).toEqual({
      count: 3,
      tone: 'loud',
      title: '3 open bugs beneath, worst feature',
    });
    expect(bugMark({ bugs: { here: 0, beneath: 1, worst: 'capability' } })?.tone).toBe('warn');
    expect(bugMark({ bugs: { here: 1, beneath: 1, worst: 'cosmetic' } })).toMatchObject({ tone: 'quiet', count: 1 });
  });

  it('filters the map to the nodes a bug is listed at, keeping the path to each', () => {
    const broken = { ...feature('cli'), bugs: { here: 1, beneath: 1, worst: 'nuisance' } };
    const io = { ...feature('io', [broken, feature('server')]), bugs: { here: 0, beneath: 1, worst: 'nuisance' } };
    const store = feature('store');
    const tree = [io, store];
    expect(isFiltering({ bugs: true })).toBe(true);
    expect(matches(broken, { bugs: true })).toBe(true);
    expect(matches(io, { bugs: true })).toBe(false);
    const narrowed = filterTree(tree, { bugs: true });
    expect(narrowed.map((n) => n.key)).toEqual(['feature:io']);
    expect(narrowed[0]!.children.map((n) => n.key)).toEqual(['feature:cli']);
    expect(filterTree(tree, { bugs: true, q: 'store' })).toEqual([]);
  });
});
