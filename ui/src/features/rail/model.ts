// The rail's view model (change:activity-timeline): the library's rail (lanes, rows, buckets) read into what the
// component draws. Lanes are told apart by colour, and the colour is categorical: five hues of the theme's own,
// never a state colour, so amber keeps meaning "waits on you" and green "decided" on the rail as everywhere else
// (decision lanes-have-their-own-hues). A lane's hue follows the lane, not its rank: the lanes take hues in the order
// of their ids, so a refetch that reorders them by last touch repaints nothing. The folded lane and the trunk take
// the ink. Every row carries its lane's name in words, so a hue is never the only thing telling two lanes apart.
// The rail is read in pages (change:rail-pages): the last few rows, the next page before them, the days before the
// pages a strip; the filter narrows to lanes and kinds and the model answers pages that pass it.
import type { Rail, RailBucket, RailLane, RailQuery, RailRow, RailRowKind } from '@/data/contract';
import type { RailPage } from '@/data/queries';
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
  /** On a file row: the paths, and how many rows folded into it. */
  files?: string[];
  folded?: number;
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
          return { ...base, who, what: 'touched', detail: r.files?.join(', '), files: r.files };
        case 'switch': {
          const to = laneTitle ?? (r.value ? short(r.value) : undefined);
          return { ...base, what: to ? `focus moved to ${to}` : 'focus moved' };
        }
        case 'bind': {
          const to = laneTitle ?? (r.value ? short(r.value) : undefined);
          return { ...base, what: to ? `bound to ${to}` : 'bound a change' };
        }
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
    .toReversed()
    .reduce(foldFiles, []);
}

/** A run of file rows in one lane within a few minutes reads as one row naming every file, at the newest's time. */
const FOLD_MS = 10 * 60_000;
function foldFiles(out: RowView[], row: RowView): RowView[] {
  const prev = out.at(-1);
  if (
    row.dot === 'file' &&
    prev?.dot === 'file' &&
    prev.lane === row.lane &&
    Date.parse(prev.at) - Date.parse(row.at) < FOLD_MS
  ) {
    const files = [...new Set([...(prev.files ?? []), ...(row.files ?? [])])];
    out[out.length - 1] = { ...prev, files, detail: files.join(', ') || undefined, folded: (prev.folded ?? 1) + 1 };
    return out;
  }
  out.push(row);
  return out;
}

export interface BucketView {
  day: string;
  label: string;
  count: number;
  /** The day's share of the busiest day, 0 to 1: the bar's height. */
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

/** The days before the page oldest first, each a bar proportional to its count. */
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
    .toSorted((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** The rows of every page as one list, oldest first, each row once. */
export function pageRows(pages: readonly Pick<Rail, 'rows'>[]): RailRow[] {
  const seen = new Set<number>();
  const out: RailRow[] = [];
  for (const page of pages.toReversed())
    for (const r of page.rows) {
      if (seen.has(r.seq)) continue;
      seen.add(r.seq);
      out.push(r);
    }
  return out;
}

/** The day's start, as the bound a page reaches down to. */
export const dayStart = (day: string): string => `${day}T00:00:00.000Z`;

/** Where the next page lies (decision rail-pages/pages-not-windows): before the last page's oldest row; the pages
 *  down to a day the person opened in the strip (`reaches`, each a day's start) come first and take no limit, then
 *  the next `limit` rows; nothing when no older row passes. */
export function nextPage(
  last: Pick<Rail, 'rows' | 'earlier' | 'from'>,
  pages: readonly Pick<Rail, 'from'>[],
  param: RailPage,
  limit: number | undefined,
  reaches: readonly string[],
): RailPage | undefined {
  if (last.earlier === 0) return undefined;
  const before = last.rows[0]?.seq ?? param.before;
  if (before === undefined) return undefined;
  // the oldest moment any page reaches; a day before it is still to load
  const reached = pages.map((p) => p.from).toSorted()[0] ?? last.from;
  const reach = reaches
    .filter((d) => d < reached)
    .toSorted()
    .at(-1);
  return reach ? { before, from: reach } : { before, limit };
}

/** The line beside the rail's head: how much of the rail is shown. */
export function shownLine(shown: number, total: number): string {
  const events = `${total} ${total === 1 ? 'event' : 'events'}`;
  return shown < total ? `${shown} of ${events}` : events;
}

/** The kinds as the filter offers them (decision rail-pages/filter-by-lane-and-kind): a focus move and a bind are
 *  one toggle, since both are the session moving. */
export const KIND_GROUPS: { id: string; label: string; kinds: RailRowKind[]; axis?: Rail['axis'] }[] = [
  { id: 'writes', label: 'writes', kinds: ['write'] },
  { id: 'decisions', label: 'decisions', kinds: ['decision'] },
  { id: 'lines', label: 'lines', kinds: ['line'], axis: 'session' },
  { id: 'files', label: 'files', kinds: ['file'], axis: 'session' },
  { id: 'moves', label: 'moves', kinds: ['switch', 'bind'], axis: 'session' },
];

/** Lanes kept apart when one lane is fixed: enough that the fixed one is never folded into more. */
export const UNFOLDED = 40;

/** The query a mount sends (change:rail-pages): the page's size and what the filter narrows to. A fixed lane (`only`:
 *  the session page's shown change, change:session-timeline-focus) stands in for the filter: the page holds that lane
 *  alone, every kind, and the lanes stay apart so the fixed one is never the folded lane. */
export function railQuery(o: {
  limit: number;
  axis: Rail['axis'];
  only?: string;
  lanesOn: readonly string[];
  kindsOff: readonly string[];
}): Pick<RailQuery, 'limit' | 'lanes' | 'kinds' | 'fold'> {
  if (o.only) return { limit: o.limit, lanes: [o.only], fold: UNFOLDED };
  return {
    limit: o.limit,
    lanes: o.lanesOn.length ? [...o.lanesOn] : undefined,
    kinds: kindsOn(o.kindsOff, o.axis),
  };
}

/** The kinds a page is narrowed to when these groups are off: nothing to send while every group is on. */
export function kindsOn(off: readonly string[], axis: Rail['axis']): RailRowKind[] | undefined {
  const groups = KIND_GROUPS.filter((g) => !g.axis || g.axis === axis);
  if (!off.some((id) => groups.some((g) => g.id === id))) return undefined;
  return groups.filter((g) => !off.includes(g.id)).flatMap((g) => g.kinds);
}
