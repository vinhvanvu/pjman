import { describe, expect, it } from 'vitest';
import type { ChangeContext, ChangeRow } from '@/data/contract';
import {
  beneathOf,
  childrenFold,
  childrenHead,
  childrenInOrder,
  childSegments,
  figuresOf,
  frameOf,
  indexLine,
  milestoneBar,
  milestonesIndex,
  stepSegments,
} from './model';

type Child = ChangeContext['children'][number];
const child = (key: string, status: string, created = '2026-11-01'): Child =>
  ({ key: `change:p/${key}`, name: key, status, created, data: {} }) as unknown as Child;
const row = (key: string, o: Partial<ChangeRow> = {}): ChangeRow =>
  ({
    key: `change:p/${key}`,
    name: key,
    status: 'open',
    features: [],
    waiting: 0,
    decided: 0,
    live: false,
    children: 0,
    needs: [],
    stale: false,
    ...o,
  }) as ChangeRow;
const rowsOf = (...rows: ChangeRow[]) => new Map(rows.map((r) => [r.key, r]));

describe('the children as the plan', () => {
  const children = [child('b', 'active'), child('a', 'done', '2026-10-30'), child('c', 'open'), child('d', 'dropped')];
  const rows = rowsOf(
    row('a', { status: 'done', position: 1, moved: '2026-11-07T00:00:00Z' }),
    row('b', {
      status: 'active',
      position: 3,
      plan: { done: 1, total: 4 },
      step: { n: 2, text: 'draw', state: 'active' },
    }),
    row('c', { status: 'open', position: 2, blockedOn: 'Public' }),
  );
  it("orders the children by the roadmap, then by creation, and reads each with the product's row", () => {
    const list = childrenInOrder(children, rows, [{ on: 'change:p/b' }], [{ change: 'change:p/c' }]);
    expect(list.map((c) => c.key.split('/')[1])).toEqual(['a', 'c', 'b', 'd']);
    const b = list.find((c) => c.key.endsWith('/b'))!;
    expect(b.live).toBe(true);
    expect(b.step?.text).toBe('draw');
    expect(list.find((c) => c.key.endsWith('/c'))!.waits).toBe(1);
    expect(list.find((c) => c.key.endsWith('/c'))!.blockedOn).toBe('Public');
  });
  it('folds what is behind the work under one line and marks the next child after the open one', () => {
    const list = childrenInOrder(children, rows);
    const fold = childrenFold(list, 'change:p/b', Date.parse('2026-11-08T00:00:00Z'));
    expect(fold.behind.map((c) => c.status)).toEqual(['done', 'dropped']);
    expect(fold.shown.map((c) => c.key.split('/')[1])).toEqual(['c', 'b']);
    expect(fold.sum).toBe('1 done · 1 dropped · last a, 1 d ago');
    // nothing follows b, so the next wraps to the first not behind
    expect(fold.next).toBe('change:p/c');
    expect(childrenFold(list).next).toBe('change:p/c');
    expect(childrenFold(list, 'change:p/c').next).toBe('change:p/b');
  });
  it('heads the list and draws a segment a child, the open one on', () => {
    const list = childrenInOrder(children, rows);
    expect(childrenHead(list, 'change:p/b', 'change:p/c')).toBe('1 of 3 done · the one in work open · next: c');
    expect(childSegments(list, 'change:p/b')).toEqual(['done', 'open', 'on', 'dropped']);
    expect(childrenHead(childrenInOrder([child('a', 'done')], new Map()))).toBe('1 of 1 done · every child done');
  });
  it("draws the open child's steps from its row", () => {
    expect(stepSegments({ plan: { done: 1, total: 4 }, step: { n: 2, text: '', state: 'active' } })).toEqual([
      'done',
      'on',
      'open',
      'open',
    ]);
    // step 2 dropped, step 3 active: the step's number counts the dropped one, the bar does not
    expect(stepSegments({ plan: { done: 1, total: 3 }, step: { n: 3, text: '', state: 'active' } })).toEqual([
      'done',
      'on',
      'open',
    ]);
    // steps 1 and 3 done, step 2 active: the one on still shows
    expect(stepSegments({ plan: { done: 2, total: 3 }, step: { n: 2, text: '', state: 'active' } })).toEqual([
      'done',
      'done',
      'on',
    ]);
    expect(stepSegments({ plan: { done: 1, total: 3 }, step: { n: 2, text: '', state: 'open' } })).toEqual([
      'done',
      'open',
      'open',
    ]);
    expect(stepSegments({ plan: { done: 2, total: 2 } })).toEqual(['done', 'done']);
    expect(stepSegments({})).toEqual([]);
  });
});

describe('what is beneath a milestone', () => {
  const rows = rowsOf(
    row('m', { kind: 'milestone', children: 2, progress: { done: 1, total: 2 }, moved: '2026-11-06T00:00:00Z', target: '2026-12-01' }),
    row('a', { parent: 'change:p/m', status: 'done', moved: '2026-11-07T00:00:00Z' }),
    row('n', { parent: 'change:p/m', kind: 'milestone', children: 1, status: 'blocked', moved: '2026-11-05T00:00:00Z' }),
    row('g', { parent: 'change:p/n', status: 'active', moved: '2026-11-08T00:00:00Z' }),
    row('x', { status: 'active' }),
  );
  it('walks the children all the way down', () => {
    expect([...beneathOf('change:p/m', rows.values())].toSorted()).toEqual(['change:p/a', 'change:p/g', 'change:p/n']);
    expect(beneathOf('change:p/x', rows.values()).size).toBe(0);
  });
  it('reads the figures over everything beneath', () => {
    const f = figuresOf(
      'change:p/m',
      rows,
      [{ on: 'change:p/g' }, { on: 'change:p/x' }],
      [{ change: 'change:p/n' }, { change: 'change:p/x' }],
    );
    expect(f).toEqual({
      progress: { done: 1, total: 2 },
      live: 1,
      waits: 1,
      blocked: 1,
      moved: '2026-11-08T00:00:00Z',
      target: '2026-12-01',
    });
    const bar = milestoneBar(f, Date.parse('2026-11-08T01:00:00Z'));
    expect(bar.parts).toEqual([
      '1 session on it beneath now',
      '1 blocked beneath',
      'last touched 1 h ago',
      'target 2026-12-01',
    ]);
    expect(bar.waits).toBe('1 waits on you');
    expect(bar.alarm).toBe(true);
    expect(milestoneBar({ progress: { done: 0, total: 0 }, live: 0, waits: 0, blocked: 0 }).parts).toEqual([
      'nobody on it now',
    ]);
  });
  it('frames a session by the last milestone it bound that stands over the shown change', () => {
    expect(frameOf(['change:p/m'], 'change:p/g', rows)).toBe('change:p/m');
    expect(frameOf(['change:p/m', 'change:p/n'], 'change:p/g', rows)).toBe('change:p/n');
    expect(frameOf(['change:p/m'], 'change:p/m', rows)).toBe('change:p/m');
    expect(frameOf(['change:p/m'], 'change:p/x', rows)).toBeUndefined();
    expect(frameOf(['change:p/a'], 'change:p/a', rows)).toBeUndefined();
    expect(frameOf([], 'change:p/g', rows)).toBeUndefined();
  });
});

describe('the index', () => {
  const changes = [
    row('m', { kind: 'milestone', children: 2, status: 'open', progress: { done: 1, total: 2 }, moved: '2026-11-06T00:00:00Z' }),
    row('a', { parent: 'change:p/m', status: 'done' }),
    row('b', { parent: 'change:p/m', status: 'active', position: 1, live: true }),
    row('k', { kind: 'milestone', children: 1, status: 'active', progress: { done: 0, total: 1 }, moved: '2026-11-08T00:00:00Z' }),
    row('c', { parent: 'change:p/k', status: 'planning' }),
    row('old', { kind: 'milestone', children: 1, status: 'done', progress: { done: 1, total: 1 }, moved: '2026-11-01T00:00:00Z' }),
    row('o', { parent: 'change:p/old', status: 'done' }),
    row('leaf', { status: 'active' }),
  ];
  it('lists the milestones in flight nearest to done first, the done apart, with the next thing on each', () => {
    const ix = milestonesIndex({ changes, sessions: [], waitingOn: [{ change: 'change:p/c' }] });
    expect(ix.inFlight.map((m) => m.name)).toEqual(['m', 'k']);
    expect(ix.done.map((m) => m.name)).toEqual(['old']);
    expect(ix.inFlight[0]!.next).toEqual({ key: 'change:p/b', name: 'b', live: true });
    expect(ix.inFlight[1]!.next).toEqual({ key: 'change:p/c', name: 'c', live: false });
    expect(ix.inFlight[1]!.waits).toBe(1);
    expect(indexLine(ix.inFlight[1]!)).toEqual({ parts: ['0 of 1 done'], waits: '1 waits on you', blocked: undefined });
  });
});
