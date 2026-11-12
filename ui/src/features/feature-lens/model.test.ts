import { describe, expect, it } from 'vitest';
import type { ChangeRow, Scope, ScopeAspect, ScopeNode } from '@/data/contract';
import {
  allFeatureKeys,
  allWork,
  changeId,
  litBy,
  liveBeneath,
  namesIn,
  UNASSIGNED,
  aspectOutline,
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
  placesAt,
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
    gist: key,
    features: [],
    waiting: 0,
    decided: 0,
    live: false,
    children: 0,
    dependsOn: [],
    aspects: [],
    needs: [],
    stale: false,
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
  it('is the features with the changes at their leaves, the unassigned ones one group at the foot', () => {
    const map = productMap(tree);
    expect(allFeatureKeys(tree)).toEqual([
      'feature:dashboard',
      'feature:board',
      'feature:navigation',
      'feature:auto-navigation',
      'feature:store',
    ]);
    // the capabilities first, then the changes at the node
    expect(map.children.get('feature:navigation')).toEqual([
      'feature:auto-navigation',
      changeId('feature:navigation', 'change:v2'),
    ]);
    expect(map.children.get('feature:dashboard')).toEqual([
      'feature:board',
      'feature:navigation',
      changeId('feature:dashboard', 'change:here'),
    ]);
    expect(map.children.get(UNASSIGNED)).toEqual([changeId(UNASSIGNED, 'change:loose')]);
    expect(map.children.get('__map__')).toEqual(['feature:dashboard', 'feature:store', UNASSIGNED]);
    expect(map.items.get(changeId('feature:navigation', 'change:v2'))?.row?.key).toBe('change:v2');
    expect(map.idsOf.get('change:v2')).toEqual([changeId('feature:navigation', 'change:v2')]);
    expect(unassigned(tree)?.children.map((c) => c.key)).toEqual(['change:loose']);
  });

  it("draws a change naming two features under each, and a milestone's children as leaves beside it", () => {
    const twice = change('twice');
    const milestone = { ...change('m'), children: [change('kid')] };
    const t = [feature('a', [twice, milestone]), feature('b', [twice])];
    const map = productMap(t);
    expect(map.idsOf.get('change:twice')).toEqual([
      changeId('feature:a', 'change:twice'),
      changeId('feature:b', 'change:twice'),
    ]);
    expect(map.children.get('feature:a')).toEqual([
      changeId('feature:a', 'change:twice'),
      changeId('feature:a', 'change:m'),
      changeId('feature:a', 'change:kid'),
    ]);
    expect(pathTo(t, 'change:kid')).toEqual(['feature:a']);
  });

  it("knows the path to a selection, a change's included", () => {
    expect(pathTo(tree, 'feature:auto-navigation')).toEqual(['feature:dashboard', 'feature:navigation']);
    expect(pathTo(tree, 'feature:store')).toEqual([]);
    expect(pathTo(tree, 'change:v2')).toEqual(['feature:dashboard', 'feature:navigation']);
    expect(pathTo(tree, 'change:loose')).toEqual([UNASSIGNED]);
  });

  it('names what it draws', () => {
    const names = namesIn(tree);
    expect(names.get('feature:navigation')).toBe('navigation');
    expect(names.get('change:v2')).toBe('v2');
  });

  it('rolls a live change up to every node above it, and lights the path to a held one', () => {
    const live = { ...change('live'), row: { ...change('live').row!, live: true } };
    const t = [feature('top', [feature('mid', [live]), feature('other')]), feature('store')];
    expect([...liveBeneath(t)]).toEqual(['feature:top', 'feature:mid']);
    expect(liveBeneath(tree).size).toBe(0);
    expect([...litBy(t, ['change:live'])].sort()).toEqual(['change:live', 'feature:mid', 'feature:top']);
    expect([...litBy(tree, ['change:loose'])].sort()).toEqual(['change:loose', UNASSIGNED]);
    expect(litBy(t, []).size).toBe(0);
  });

  it("keeps a node's changes when it is kept, and a change the text names where the node is not", () => {
    const kept = filterTree(tree, { q: 'navigation' });
    expect(kept.map((n) => n.key)).toEqual(['feature:dashboard']);
    const nav = kept[0]!.children.find((n) => n.key === 'feature:navigation')!;
    expect(nav.children.map((n) => n.key)).toEqual(['feature:auto-navigation', 'change:v2']);
    // the text names the change alone: its node is kept for it, the other changes left out
    const byChange = filterTree(tree, { q: 'v2' });
    expect(byChange[0]!.children.find((n) => n.key === 'feature:navigation')!.children.map((n) => n.key)).toEqual([
      'change:v2',
    ]);
    expect(byChange[0]!.children.filter((n) => n.type === 'change')).toEqual([]);
    // a state filter keeps the changes with the node it keeps
    const live = { ...feature('live', [change('on-live')]), derived: 'live' };
    expect(filterTree([live, feature('planned')], { states: ['live'] })[0]!.children.map((n) => n.key)).toEqual([
      'change:on-live',
    ]);
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
      kind: 'milestone',
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

  it('narrows the map to an aspect: each place a leaf, the path to it kept, intersecting the other filters', () => {
    const aspect = (key: string, places: string[], parent?: string): ScopeAspect => ({
      aspect: `aspect:p/${key}`,
      title: key,
      base: '',
      parent: parent && `aspect:p/${parent}`,
      places: places.map((f) => ({ place: `aspect:p/${key}/${f}`, feature: `feature:${f}`, forked: f === 'dock' })),
    });
    const tree = [feature('app', [feature('dock', [feature('header')]), feature('map')]), feature('cli')];
    const aspects = [aspect('text', ['dock', 'cli']), aspect('motion', ['map'])];
    const places = placesAt(aspects, 'aspect:p/text');
    const f = { aspect: 'aspect:p/text' };
    expect(isFiltering(f)).toBe(true);
    const narrowed = filterTree(tree, f, places);
    expect(narrowed.map((n) => n.key)).toEqual(['feature:app', 'feature:cli']);
    // the place at dock is a leaf: what is beneath it is covered, not drawn
    expect(narrowed[0]!.children.map((n) => n.key)).toEqual(['feature:dock']);
    expect(narrowed[0]!.children[0]!.children).toEqual([]);
    // the ancestor is kept to lead there, but does not match (it is drawn faint)
    expect(matches(narrowed[0]!, f, places)).toBe(false);
    expect(places.get('feature:dock')?.forked).toBe(true);
    // with a text too, the two intersect
    expect(filterTree(tree, { ...f, q: 'cli' }, places).map((n) => n.key)).toEqual(['feature:cli']);
    // a place beneath a place is still drawn: the broad place does not hide the forks under it
    const nested = filterTree(
      tree,
      { aspect: 'aspect:p/wide' },
      placesAt([aspect('wide', ['app', 'map'])], 'aspect:p/wide'),
    );
    expect(nested[0]!.key).toBe('feature:app');
    expect(nested[0]!.children.map((n) => n.key)).toEqual(['feature:map']);
    // an unknown aspect keeps nothing
    expect(filterTree(tree, { aspect: 'aspect:p/none' }, placesAt(aspects, 'aspect:p/none'))).toEqual([]);
  });

  it('outlines the aspects by parent, siblings by name', () => {
    const a = (key: string, parent?: string): ScopeAspect => ({
      aspect: `aspect:p/${key}`,
      title: key,
      base: '',
      places: [],
      parent: parent && `aspect:p/${parent}`,
    });
    const out = aspectOutline([a('text'), a('markdown', 'text'), a('motion'), a('orphan', 'elsewhere')]);
    expect(out.map((o) => [o.aspect.aspect.split('/').pop(), o.depth])).toEqual([
      ['motion', 0],
      ['orphan', 0],
      ['text', 0],
      ['markdown', 1],
    ]);
  });
});
