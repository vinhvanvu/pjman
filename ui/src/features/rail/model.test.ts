import { describe, expect, it } from 'vitest';
import type { Rail, RailBucket, RailLane, RailRow } from '@/data/contract';
import { TONE } from '@/lib/tones';
import {
  bucketViews,
  dayWindow,
  laneColours,
  laneViews,
  LANE_HUES,
  MORE,
  rowViews,
  TRUNK,
  windowFor,
  windowLine,
} from './model';

const lane = (id: string, o: Partial<RailLane> = {}): RailLane => ({
  id,
  kind: 'change',
  title: id.split('/').at(-1),
  count: 1,
  ...o,
});
const row = (seq: number, o: Partial<RailRow> = {}): RailRow => ({
  seq,
  at: `2026-11-06T10:0${seq}:00.000Z`,
  lane: null,
  kind: 'write',
  op: 'set',
  key: 'change:p/auth',
  type: 'change',
  title: 'Auth',
  ...o,
});
const rail = (o: Partial<Rail> = {}): Rail => ({
  key: 'change:p/auth',
  axis: 'tree',
  from: '2026-10-23T00:00:00.000Z',
  to: '2026-11-06T12:00:00.000Z',
  lanes: [],
  rows: [],
  buckets: [],
  total: 0,
  ...o,
});
const NOW = Date.parse('2026-11-06T10:10:00.000Z');
const bucket = (day: string, count: number, health: Partial<RailBucket['health']> = {}): RailBucket => ({
  day,
  count,
  lanes: {},
  health: { moved: 0, done: 0, created: 0, blocked: 0, waiting: 0, ...health },
});

describe('laneColours', () => {
  it('gives each lane a hue by the order of its id, so a reorder by last touch repaints nothing', () => {
    const byTouch = [lane('change:p/billing'), lane('change:p/auth')];
    const byOther = [lane('change:p/auth'), lane('change:p/billing')];
    expect(laneColours(byTouch).get('change:p/auth')).toBe(LANE_HUES[0]);
    expect(laneColours(byTouch).get('change:p/billing')).toBe(LANE_HUES[1]);
    expect(laneColours(byOther)).toEqual(laneColours(byTouch));
  });

  it('gives the folded lane the ink, and never a state colour to any lane', () => {
    const colours = laneColours([lane('a'), lane('more', { kind: 'more', folded: 3 })]);
    expect(colours.get('more')).toBe(MORE);
    expect(LANE_HUES.every((h) => h.startsWith('var(--lane-'))).toBe(true);
  });
});

describe('laneViews', () => {
  it('names the folded lane by what it holds and gives a decision lane its state, a change lane its status', () => {
    const views = laneViews(
      rail({
        lanes: [
          lane('decision:p/auth/tokens', { kind: 'decision', title: 'Tokens', status: 'proposed' }),
          lane('change:p/child', { status: 'done', title: 'Child' }),
          lane('more', { kind: 'more', folded: 4, count: 9 }),
        ],
      }),
    );
    expect(views.map((v) => v.title)).toEqual(['Tokens', 'Child', '4 more']);
    expect(views[0]!.tone).toBe(TONE.waits);
    expect(views[1]!.tone).toBe(TONE.done);
    expect(views[2]!.tone).toBeUndefined();
  });
});

describe('rowViews', () => {
  const lanes = [
    lane('decision:p/auth/tokens', { kind: 'decision', title: 'Tokens' }),
    lane('change:p/billing', { title: 'Billing' }),
  ];

  it('reads newest first, a trunk row in the ink naming nobody, a lane row in its lane colour naming the lane', () => {
    const r = rail({
      lanes,
      rows: [
        row(1, { op: 'created' }),
        row(2, {
          lane: 'decision:p/auth/tokens',
          kind: 'decision',
          op: 'created',
          key: 'decision:p/auth/tokens',
          type: 'decision',
          title: 'Tokens',
        }),
      ],
    });
    const views = rowViews(r, undefined, NOW);
    expect(views.map((v) => v.seq)).toEqual([2, 1]);
    expect(views[1]).toMatchObject({ colour: TRUNK, who: undefined, what: 'created', dim: false });
    expect(views[0]).toMatchObject({
      colour: LANE_HUES[1],
      who: 'Tokens',
      what: 'opened',
      state: TONE.waits,
      detail: undefined,
    });
  });

  it('says what a move was: a status in its tone, a decision decided in green, superseded faint, reopened amber', () => {
    const r = rail({
      lanes,
      rows: [
        row(1, { fields: ['status'], value: 'active' }),
        row(2, {
          lane: 'decision:p/auth/tokens',
          kind: 'decision',
          key: 'decision:p/auth/tokens',
          type: 'decision',
          value: 'decided',
          fields: ['status'],
        }),
        row(3, {
          lane: 'decision:p/auth/tokens',
          kind: 'decision',
          key: 'decision:p/auth/tokens',
          type: 'decision',
          value: 'superseded',
        }),
        row(4, {
          lane: 'decision:p/auth/tokens',
          kind: 'decision',
          key: 'decision:p/auth/tokens',
          type: 'decision',
          value: 'proposed',
        }),
        row(5, { fields: ['plan'] }),
      ],
    });
    const [plan, reopened, superseded, decided, status] = rowViews(r, undefined, NOW);
    expect(status).toMatchObject({ what: 'status', value: { text: 'active', tone: TONE.active } });
    expect(decided).toMatchObject({ what: 'decided', state: TONE.done });
    expect(superseded).toMatchObject({ what: 'superseded', state: TONE.faint });
    expect(reopened).toMatchObject({ what: 'reopened', state: TONE.waits });
    expect(plan!.what).toBe('plan');
    expect(plan!.value).toBeUndefined();
  });

  it('on a session: a line in its own words on the trunk, a file naming its paths, a switch and a bind naming the change, every row drilling to its change', () => {
    const r = rail({
      key: 'session:me',
      axis: 'session',
      lanes: [lane('change:p/billing', { title: 'Billing' }), lane('change:p/auth', { title: 'Auth' })],
      rows: [
        row(1, {
          kind: 'bind',
          op: 'bind',
          key: 'session:me',
          type: 'session',
          lane: 'change:p/auth',
          value: 'change:p/auth',
          drill: 'change:p/auth',
        }),
        row(2, { kind: 'line', op: 'log', key: 'session:me', type: 'session', text: 'looked at billing' }),
        row(3, {
          kind: 'file',
          op: 'observe',
          key: 'session:me',
          type: 'session',
          lane: 'change:p/auth',
          files: ['ui/src/auth.ts'],
          drill: 'change:p/auth',
        }),
        row(4, {
          kind: 'switch',
          op: 'set',
          key: 'session:me',
          type: 'session',
          lane: 'change:p/billing',
          value: 'change:p/billing',
          fields: ['focus'],
          drill: 'change:p/billing',
        }),
        row(5, { lane: 'change:p/auth', fields: ['status'], value: 'review', drill: 'change:p/auth' }),
      ],
    });
    const [write, sw, file, line, bind] = rowViews(r, undefined, NOW);
    expect(bind).toMatchObject({ what: 'bound to Auth', drill: 'change:p/auth', colour: LANE_HUES[0] });
    expect(line).toMatchObject({ what: 'looked at billing', colour: TRUNK, who: undefined, drill: undefined });
    expect(file).toMatchObject({ who: 'Auth', what: 'touched', detail: 'ui/src/auth.ts' });
    expect(sw).toMatchObject({ what: 'focus moved to Billing', colour: LANE_HUES[1] });
    expect(write).toMatchObject({ who: 'Auth', what: 'status', value: { text: 'review', tone: TONE.waits } });
  });

  it('dims every lane row but the lit lane, never the trunk, and dims nothing when no lane is lit', () => {
    const r = rail({
      lanes,
      rows: [
        row(1),
        row(2, { lane: 'change:p/billing' }),
        row(3, { lane: 'decision:p/auth/tokens', kind: 'decision', op: 'created', type: 'decision' }),
      ],
    });
    expect(rowViews(r, undefined, NOW).map((v) => v.dim)).toEqual([false, false, false]);
    expect(rowViews(r, 'change:p/billing', NOW).map((v) => v.dim)).toEqual([true, false, false]);
  });
});

describe('bucketViews', () => {
  it('bands the days newest first, each by its share of the busiest day, carrying only the health that moved', () => {
    const views = bucketViews([
      bucket('2026-10-20', 2, { created: 1 }),
      bucket('2026-10-21', 8, { moved: 3, done: 1, waiting: 2 }),
    ]);
    expect(views.map((v) => v.day)).toEqual(['2026-10-21', '2026-10-20']);
    expect(views[0]!.share).toBe(1);
    expect(views[1]!.share).toBe(0.25);
    expect(views[0]!.health.map((h) => h.text)).toEqual(['3 moved', '1 done', '2 opened']);
    expect(views[0]!.health[1]!.tone).toBe(TONE.done);
    expect(views[0]!.health[2]!.tone).toBe(TONE.waits);
    expect(views[1]!.health.map((h) => h.text)).toEqual(['1 created']);
  });

  it('opens a day into the window from its start to the next day', () => {
    expect(dayWindow('2026-10-21')).toEqual({ from: '2026-10-21T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' });
  });
});

const session = (rows: RailRow[]): Rail =>
  rail({ key: 'session:me', axis: 'session', lanes: [lane('change:p/auth', { title: 'Auth' })], rows });
const file = (seq: number, files: string[], at = `2026-11-06T10:0${seq}:00.000Z`): RailRow =>
  row(seq, { kind: 'file', op: 'observe', key: 'session:me', type: 'session', lane: 'change:p/auth', files, at });

describe('rowViews folding', () => {
  it('folds a run of file rows in one lane within a few minutes into one row naming every file once', () => {
    const views = rowViews(session([file(1, ['a.ts']), file(2, ['b.ts']), file(3, ['a.ts', 'c.ts'])]), undefined, NOW);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ seq: 3, files: ['a.ts', 'c.ts', 'b.ts'], detail: 'a.ts, c.ts, b.ts', folded: 3 });
  });

  it('keeps file rows apart across a gap, another lane, or another kind between them', () => {
    const later = file(4, ['d.ts'], '2026-11-06T11:00:00.000Z');
    const views = rowViews(
      session([file(1, ['a.ts']), row(2, { lane: 'change:p/auth' }), file(3, ['b.ts']), later]),
      undefined,
      NOW,
    );
    expect(views.map((v) => v.seq)).toEqual([4, 3, 2, 1]);
  });

  it('a switch or a bind with no change named reads without a dangling preposition', () => {
    const views = rowViews(
      session([
        row(1, { kind: 'switch', op: 'set', key: 'session:me', type: 'session', fields: ['focus'] }),
        row(2, { kind: 'bind', op: 'bind', key: 'session:me', type: 'session' }),
      ]),
      undefined,
      NOW,
    );
    expect(views.map((v) => v.what)).toEqual(['bound a change', 'focus moved']);
  });
});

describe('windowLine', () => {
  it('counts the window and what lies before it', () => {
    expect(windowLine(rail({ rows: [row(1)], total: 1 }), 14)).toBe('1 event in 14 days');
    expect(windowLine(rail({ rows: [row(1), row(2)], total: 9 }), 7)).toBe('2 events in 7 days · 7 earlier');
  });
});

describe('windowFor', () => {
  it('follows the scope: two weeks on a change or a session, days on a feature, a day on the product', () => {
    expect(windowFor('change:p/auth')).toBe(14);
    expect(windowFor('session:me')).toBe(14);
    expect(windowFor('feature:p/dashboard')).toBe(3);
    expect(windowFor('product:p')).toBe(1);
  });
});
