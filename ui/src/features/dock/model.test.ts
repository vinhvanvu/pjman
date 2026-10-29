import { describe, expect, it } from 'vitest';
import type { ChangeRow, ScopeNode } from '@/data/contract';
import { pickups, readiness } from './model';

const row = (key: string, o: Partial<ChangeRow> = {}): ChangeRow => ({
  key,
  title: o.title ?? key.slice(key.lastIndexOf('/') + 1),
  status: 'open',
  features: [],
  waiting: 0,
  decided: 0,
  live: false,
  children: 0,
  dependsOn: [],
  ...o,
});
const feature = (key: string, name: string, children: ScopeNode[] = []): ScopeNode => ({
  key,
  type: 'feature',
  name,
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: children.length,
  children,
});
const f = (key: string) => [{ effect: 'changes' as const, key }];

describe('pickups', () => {
  const tree = [
    feature('feature:p/store', 'Store'),
    feature('feature:p/dashboard', 'Dashboard', [feature('feature:p/dock', 'Dock')]),
  ];
  it('groups open changes by the first feature each names, the groups in the roadmap order', () => {
    const groups = pickups({
      tree,
      waitingOn: [],
      changes: [
        row('change:p/a', { features: f('feature:p/store'), position: 3 }),
        row('change:p/b', { features: f('feature:p/dock'), position: 1 }),
        row('change:p/gone', { features: f('feature:p/store'), status: 'done' }),
      ],
    });
    expect(groups.map((g) => [g.name, g.changes.map((p) => p.row.key)])).toEqual([
      ['Dock', ['change:p/b']],
      ['Store', ['change:p/a']],
    ]);
  });
  it('orders within a group by fewest proposed decisions, then the roadmap, then the title; names the proposed ones', () => {
    const [g] = pickups({
      tree,
      waitingOn: [
        { key: 'decision:p/c/why', change: 'change:p/c' },
        { key: 'decision:p/c/how', change: 'change:p/c' },
        { key: 'decision:p/d/where', change: 'change:p/d' },
      ],
      changes: [
        row('change:p/c', { features: f('feature:p/store'), waiting: 2, decided: 1, position: 0 }),
        row('change:p/d', { features: f('feature:p/store'), waiting: 1, position: 2 }),
        row('change:p/e', { features: f('feature:p/store'), decided: 3, position: 5, title: 'Later' }),
        row('change:p/f', { features: f('feature:p/store'), title: 'Also ready' }),
      ],
    });
    expect(g!.changes.map((p) => [p.row.key, p.proposed])).toEqual([
      ['change:p/e', []],
      ['change:p/f', []],
      ['change:p/d', ['where']],
      ['change:p/c', ['why', 'how']],
    ]);
  });
  it('puts groups with no ordered change after the ordered ones in map order, and changes naming no feature last', () => {
    const groups = pickups({
      tree,
      waitingOn: [],
      changes: [
        row('change:p/none'),
        row('change:p/dash', { features: f('feature:p/dashboard') }),
        row('change:p/st', { features: f('feature:p/store') }),
        row('change:p/dk', { features: f('feature:p/dock'), position: 0 }),
      ],
    });
    expect(groups.map((g) => g.name)).toEqual(['Dock', 'Store', 'Dashboard', 'no feature']);
  });
  it('names a feature the map does not list by its title, else its slug', () => {
    const groups = pickups({
      tree: [],
      waitingOn: [],
      changes: [
        row('change:p/x', { features: [{ effect: 'adds', key: 'feature:p/titled', title: 'A titled one' }] }),
        row('change:p/y', { features: f('feature:p/bare') }),
      ],
    });
    expect(groups.map((g) => g.name)).toEqual(['A titled one', 'bare']);
  });
});

describe('stacked', () => {
  const tree = [feature('feature:p/store', 'Store')];
  it('names the unfinished changes a change depends on and sorts it below the rest of its group', () => {
    const [g] = pickups({
      tree,
      waitingOn: [],
      changes: [
        row('change:p/msg', { features: f('feature:p/store'), decided: 1, position: 0, dependsOn: ['change:p/hyd'] }),
        row('change:p/hyd', { features: f('feature:p/other'), status: 'planning', position: 1 }),
        row('change:p/late', { features: f('feature:p/store'), waiting: 3, position: 5 }),
      ],
    });
    expect(g!.changes.map((p) => [p.row.key, p.stackedOn.map((d) => d.key)])).toEqual([
      ['change:p/late', []],
      ['change:p/msg', ['change:p/hyd']],
    ]);
  });
  it('does not stack on a finished, dropped or unknown change', () => {
    const [g] = pickups({
      tree,
      waitingOn: [],
      changes: [
        row('change:p/msg', {
          features: f('feature:p/store'),
          dependsOn: ['change:p/hyd', 'change:p/gone', 'change:q/elsewhere'],
        }),
        row('change:p/hyd', { status: 'done' }),
        row('change:p/gone', { status: 'dropped' }),
      ],
    });
    expect(g!.changes[0]!.stackedOn).toEqual([]);
  });
});

describe('readiness', () => {
  it('reads stacked over everything else while a dependency is unfinished', () => {
    expect(readiness({ waiting: 0, decided: 2 }, true)).toEqual({ text: 'stacked', state: 'stacked' });
  });
  it('reads ready when nothing is proposed, counts while something is, and says when none were opened', () => {
    expect(readiness({ waiting: 0, decided: 2 })).toEqual({ text: 'ready', state: 'ready' });
    expect(readiness({ waiting: 1, decided: 3 })).toEqual({ text: '3 of 4 decided', state: 'deciding' });
    expect(readiness({ waiting: 0, decided: 0 })).toEqual({ text: 'no decisions', state: 'undecided' });
  });
});
