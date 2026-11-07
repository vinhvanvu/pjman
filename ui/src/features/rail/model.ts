// The rail's view model (change:activity-timeline): the library's rail (lanes, rows, buckets) read into what the
// component draws. Lanes are told apart by colour, and the colour is categorical: five hues of the theme's own,
// never a state colour, so amber keeps meaning "waits on you" and green "decided" on the rail as everywhere else
// (decision lanes-have-their-own-hues). A lane's hue follows the lane, not its rank: the lanes take hues in the order
// of their ids, so a refetch that reorders them by last touch repaints nothing. The folded lane and the trunk take
// the ink. Every row carries its lane's name in words, so a hue is never the only thing telling two lanes apart.
import type { Rail, RailBucket, RailLane, RailRow } from '@/data/contract';
import { ago } from '@/lib/format';
import { short } from '@/lib/keys';
import { decisionTone, statusTone, TONE, type Tone } from '@/lib/tones';

export const LANE_HUES = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)', 'var(--lane-4)', 'var(--lane-5)'] as const;
/** The trunk: the scope's own rows, a session's own lines. */
export const TRUNK = 'var(--foreground)';
/** The folded lane. */
export const MORE = 'var(--muted-foreground)';

/** Each lane's hue, by the order of their ids; a sixth and beyond share the folded lane's ink. */
export function laneColours(lanes: readonly RailLane[]): Map<string, string> {
  const out = new Map<string, string>();
  const ids = lanes
    .filter((l) => l.kind !== 'more')
    .map((l) => l.id)
    .toSorted();
  ids.forEach((id, i) => out.set(id, LANE_HUES[i] ?? MORE));
  if (lanes.some((l) => l.kind === 'more')) out.set('more', MORE);
  return out;
}

export interface LaneView {
  id: string;
  title: string;
  colour: string;
  count: number;
  /** The lane's status tone, for a change lane; a decision lane's state. */
  tone?: Tone;
}

export function laneViews(rail: Pick<Rail, 'lanes'>, colours = laneColours(rail.lanes)): LaneView[] {
  return rail.lanes.map((l) => ({
    id: l.id,
    title: l.kind === 'more' ? `${l.folded} more` : (l.title ?? short(l.id)),
    colour: colours.get(l.id) ?? MORE,
    count: l.count,
    tone: l.kind === 'decision' ? decisionTone(l.status) : l.kind === 'change' ? statusTone(l.status) : undefined,
  }));
}

export interface RowView {
  seq: number;
  at: string;
  when: string;
  lane: string | null;
  colour: string;
  dot: RailRow['kind'];
  /** On a decision: the state its dot is filled with. */
  state?: Tone;
  /** The lane's name on a lane row; a trunk row names nobody, the scope being the page itself. */
  who?: string;
  /** What happened, as a verb phrase. */
  what: string;
  /** The rest: a decision's title, the files touched, a line's words. */
  detail?: string;
  /** What a move left: a status, with its colour. */
  value?: { text: string; tone: Tone };
  /** The key on the other axis. */
  drill?: string;
  key: string;
  /** Dimmed: a lane row that is not the lit lane. */
  dim: boolean;
}

/** The rows newest first, each read into words; `lit` dims every lane row but the lit lane's (the trunk never dims). */
export function rowViews(
  rail: Pick<Rail, 'axis' | 'lanes' | 'rows'>,
  lit?: string,
  now = Date.now(),
  colours = laneColours(rail.lanes),
): RowView[] {
  const titles = new Map(
    rail.lanes.map((l) => [l.id, l.kind === 'more' ? `${l.folded} more` : (l.title ?? short(l.id))]),
  );
  return rail.rows
    .map((r): RowView => {
      const laneTitle = r.lane ? titles.get(r.lane) : undefined;
      const colour = r.lane ? (colours.get(r.lane) ?? MORE) : TRUNK;
      const base = {
        seq: r.seq,
        at: r.at,
        when: ago(r.at, now),
        lane: r.lane,
        colour,
        dot: r.kind,
        key: r.key,
        drill: r.drill,
        dim: lit !== undefined && r.lane !== null && r.lane !== lit,
      };
      // the lane's name; a trunk row names nobody, since the scope is the page itself
      const who = laneTitle;
      switch (r.kind) {
        case 'line':
          return { ...base, who: laneTitle, what: r.text ?? 'line', detail: undefined };
        case 'file':
          return { ...base, who, what: 'touched', detail: r.files?.join(', ') };
        case 'switch':
          return { ...base, what: `focus moved to ${laneTitle ?? short(r.value ?? '')}` };
        case 'bind':
          return { ...base, what: `bound to ${laneTitle ?? short(r.value ?? '')}` };
        case 'decision': {
          const value = r.op === 'created' ? 'proposed' : r.value;
          const what =
            r.op === 'created'
              ? 'opened'
              : value === 'decided'
                ? 'decided'
                : value === 'superseded'
                  ? 'superseded'
                  : value === 'proposed'
                    ? 'reopened'
                    : 'moved';
          // the title is the detail unless the lane is the decision itself
          const detail = r.lane === r.key ? undefined : r.title;
          return { ...base, who, what, detail, state: decisionTone(value) };
        }
        default: {
          if (r.op === 'created') return { ...base, who, what: 'created' };
          if (r.fields?.includes('status') && r.value)
            return { ...base, who, what: 'status', value: { text: r.value, tone: statusTone(r.value) } };
          if (r.fields?.includes('decided_by') && r.value)
            return { ...base, who, what: 'decided by', detail: short(r.value) };
          return { ...base, who, what: r.fields?.length ? r.fields.join(', ') : r.op };
        }
      }
    })
    .toReversed();
}

export interface BucketView {
  day: string;
  label: string;
  count: number;
  /** The day's share of the busiest day, 0 to 1: the band's width. */
  share: number;
  /** The health that moved, in words, only what is not zero. */
  health: { text: string; tone: Tone }[];
}

const HEALTH: { key: keyof RailBucket['health']; word: string; tone: Tone }[] = [
  { key: 'moved', word: 'moved', tone: TONE.quiet },
  { key: 'created', word: 'created', tone: TONE.quiet },
  { key: 'done', word: 'done', tone: TONE.done },
  { key: 'waiting', word: 'opened', tone: TONE.waits },
  { key: 'blocked', word: 'blocked', tone: TONE.alarm },
];

const dayLabel = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The days before the window newest first, each a band proportional to its count. */
export function bucketViews(buckets: readonly RailBucket[]): BucketView[] {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return buckets
    .map((b) => ({
      day: b.day,
      label: dayLabel(b.day),
      count: b.count,
      share: b.count / max,
      health: HEALTH.filter((h) => b.health[h.key] > 0).map((h) => ({
        text: `${b.health[h.key]} ${h.word}`,
        tone: h.tone,
      })),
    }))
    .toReversed();
}

/** The day's window, for opening a bucket into its rows: `from` its start, `to` the next day's. */
export function dayWindow(day: string): { from: string; to: string } {
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** The line under the rail's head: what the window holds and what lies before it. */
export function windowLine(rail: Pick<Rail, 'rows' | 'total'>, days: number): string {
  const n = rail.rows.length;
  const earlier = rail.total - n;
  const inside = `${n} ${n === 1 ? 'event' : 'events'} in ${days} days`;
  return earlier > 0 ? `${inside} · ${earlier} earlier` : inside;
}
