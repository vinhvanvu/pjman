// The activity rail (change:activity-timeline, decision one-timeline-every-scope): one vertical timeline at any scope and at
// every width. Lanes are told apart by colour (model.ts), every dot drills to the unit on the other axis (a session
// from a tree node, a change from a session), and a row's words name its lane so colour is never alone. The dot says
// what the row is: a filled circle a write, a diamond a decision filled with its state (amber waiting, green decided)
// and ringed with its lane, a hollow circle a line, a square a file, a chevron a focus switch. The lane the mount
// lights stays whole and the other lanes dim to half.
// The rail is read in pages (change:rail-pages, decision pages-not-windows): it opens on the last few rows, the mount
// saying how many, and Older appends the next page; the days before the pages are one strip the height of a row, a
// bar a day with its count and what it moved under the pointer, and a day opens by loading the pages down to it.
// The filter (decision filter-by-lane-and-kind) is the lane chips, each a toggle, and a row of kinds; the model
// answers pages that pass it, so a page is always as long as it says. A mount with a filter of its own (the session
// page, whose row of chips picks the change) fixes the one lane instead (change:session-timeline-focus): the rail
// holds that lane alone, draws no filter and dims nothing. The hold keeps the live page still; a page the person
// asked for arrives at once.
// Alive (change:motion-design): a row that arrives opens its space and fades in, washed in its lane's colour; the
// dim is a short fade; under reduced motion the fades stay and nothing slides.
// On a change's page the rail runs by session (decision change-detail/rail-unfiltered): every row in its writer's
// hue and a head where the writer changes, naming the session with the way to its page, the live one breathing; one
// rail over every session, so the hand-offs read as its structure, and no filter of its own.
// The flat list is the other rendering of the same rows: the same words in a plain list, without the rail.
import { cn } from 'cn';
import { ChevronRight, ChevronUp, Link2, List, Rows3 } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import type { Lens, RailQuery } from '@/data/contract';
import { useRailPages } from '@/data/queries';
import { EmptyState } from '@/components/EmptyState';
import { Label } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { useHeldList } from '@/lib/hold';
import { liveItem, Wash } from '@/lib/motion';
import { useFresh } from '@/state/arrivals';
import {
  bucketViews,
  dayStart,
  KIND_GROUPS,
  laneViews,
  nextPage,
  pageRows,
  railQuery,
  rowViews,
  sessionColours,
  sessionRuns,
  shownLine,
  type BucketView,
  type LaneView,
  type RowView,
  type RunHead,
  type RunSession,
} from './model';

export type RailRendering = 'rail' | 'list';

/** The lane's colour, as the custom property the dots and words read. */
const laneStyle = (colour: string) => ({ '--lane': colour }) as React.CSSProperties;
const rowKey = (r: RowView) => String(r.seq);
const toggled = (list: readonly string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export function ActivityRail({
  scope,
  lens,
  limit = 20,
  lit,
  only,
  label = 'Timeline',
  note,
  held = false,
  sessions,
  className,
}: {
  /** The key the rail is drawn at: a change, a milestone, a feature, the product, a session. */
  scope: string;
  lens: Lens;
  /** The rows a page holds: what the rail opens on, and what Older adds. */
  limit?: number;
  /** The lane kept whole while the rest dim. */
  lit?: string;
  /** The lanes the rail holds (change:session-timeline-focus; decision feature-detail/hold-lights-the-map): the
   *  change the session page shows, or the changes held on the map. The mount's own filter stands in for the rail's,
   *  so the lane chips and the kind row are not drawn and nothing dims. */
  only?: string | readonly string[];
  /** The head's label, and what stands beside it (a session's liveness). */
  label?: string;
  note?: ReactNode;
  /** Held still (lib/hold): the live page keeps its places and new rows wait until the release. */
  held?: boolean;
  /** On a change's page: the rail runs by session, a head at each hand-off, with no filter of its own. */
  sessions?: readonly RunSession[];
  className?: string;
}) {
  const [rendering, setRendering] = useState<RailRendering>('rail');
  // the filter: lanes on (none means all), kind groups off (none means all); the axis follows the scope's kind
  const [lanesOn, setLanesOn] = useState<string[]>([]);
  const [kindsOff, setKindsOff] = useState<string[]>([]);
  const axis = scope.startsWith('session:') ? 'session' : 'tree';
  // the days opened in the strip: read by the pager, so a refetch places the same pages again
  const reaches = useRef<string[]>([]);
  const fixedLanes = typeof only === 'string' ? [only] : (only ?? []);
  const query: RailQuery = railQuery({ limit, axis, only: fixedLanes, lanesOn, kindsOff });
  const q = useRailPages(scope, query, (last, pages, param) => nextPage(last, pages, param, limit, reaches.current));
  const pages = q.data?.pages ?? [];
  const first = pages[0];
  if (!first)
    return <EmptyState title={q.isError ? 'The rail could not be read.' : 'Reading the rail…'} className={className} />;
  const last = pages.at(-1)!;
  const lanes = laneViews(first);
  const merged = pageRows(pages);
  const dimTo = fixedLanes.length ? undefined : lit;
  const live = rowViews({ axis: first.axis, lanes: first.lanes, rows: first.rows }, dimTo);
  const older = rowViews(
    { axis: first.axis, lanes: first.lanes, rows: merged.filter((r) => r.seq < (first.rows[0]?.seq ?? 0)) },
    dimTo,
  );
  const buckets = bucketViews(last.buckets);
  const fixed = fixedLanes.length > 0 || !!sessions;
  const filtered = !fixed && (lanesOn.length > 0 || kindsOff.length > 0);
  const groups = fixed ? [] : KIND_GROUPS.filter((g) => !g.axis || g.axis === axis);
  // by session: one hue per writer across every page, so an older page repaints nothing
  const colours = sessions
    ? sessionColours([
        ...sessions.map((x) => x.key),
        ...merged.flatMap((r) => ((r.session ?? r.writer) ? [(r.session ?? r.writer)!] : [])),
      ])
    : undefined;
  const runs = (rows: RowView[]) => (sessions ? sessionRuns(rows, sessions, colours) : { rows, heads: undefined });
  const liveRuns = runs(live);
  const olderRuns = runs(older);
  const open = (day: string) => {
    const start = dayStart(day);
    if (!reaches.current.includes(start)) reaches.current = [...reaches.current, start];
    void q.fetchNextPage();
  };
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <Label>{label}</Label>
          {note}
          <span className="text-meta text-ink-faint">{shownLine(merged.length, first.total)}</span>
          <Toggle rendering={rendering} onChange={setRendering} />
        </div>
        {!fixed && lanes.length > 0 && (
          <LaneChips lanes={lanes} lit={lit} on={lanesOn} onToggle={(id) => setLanesOn(toggled(lanesOn, id))} />
        )}
        {groups.length > 1 && (
          <KindRow groups={groups} off={kindsOff} onToggle={(id) => setKindsOff(toggled(kindsOff, id))} />
        )}
      </div>
      {merged.length === 0 && buckets.length === 0 ? (
        <EmptyState
          title={
            fixedLanes.length
              ? 'Nothing on this change from this session yet.'
              : filtered
                ? 'Nothing passes the filter.'
                : 'Nothing has happened here yet.'
          }
        />
      ) : rendering === 'rail' ? (
        <>
          {/* keyed on the fixed lane: a new lane is a new list, so the hold takes it as it stands and no row of the last
              lane stays on */}
          <Rows key={fixedLanes.length ? fixedLanes.join(',') : 'all'} rows={liveRuns.rows} heads={liveRuns.heads} lens={lens} held={held} />
          {older.length > 0 && <Rows rows={olderRuns.rows} heads={olderRuns.heads} lens={lens} />}
        </>
      ) : (
        <FlatList rows={[...liveRuns.rows, ...olderRuns.rows]} lens={lens} />
      )}
      {q.hasNextPage && (
        <button
          type="button"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
          className="self-start rounded-chip px-2 py-0.5 text-meta text-ink-muted hover:bg-raised hover:text-ink disabled:text-ink-faint"
        >
          {q.isFetchingNextPage ? 'Reading…' : `Older · ${last.earlier} more`}
        </button>
      )}
      {buckets.length > 0 && <Strip buckets={buckets} earlier={last.earlier} onOpen={open} />}
    </div>
  );
}

function Toggle({ rendering, onChange }: { rendering: RailRendering; onChange: (r: RailRendering) => void }) {
  const button = (r: RailRendering, Icon: typeof Rows3, title: string) => (
    <button
      type="button"
      aria-pressed={rendering === r}
      title={title}
      onClick={() => onChange(r)}
      className={cn('relative rounded-chip p-1 text-ink-faint hover:text-ink', rendering === r && 'bg-raised text-ink')}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{title}</span>
    </button>
  );
  return (
    <span className="ml-auto flex items-center gap-0.5">
      {button('rail', Rows3, 'As a rail')}
      {button('list', List, 'As a list')}
    </span>
  );
}

/** The lanes as chips, each a toggle: a dot in the lane's colour and its name; with none on every lane shows, with
 *  some on the rest step back; the lit lane stands out and the rest are quiet. */
function LaneChips({
  lanes,
  lit,
  on,
  onToggle,
}: {
  lanes: LaneView[];
  lit?: string;
  on: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-x-1 gap-y-1">
      {lanes.map((l) => {
        const pressed = on.includes(l.id);
        const quiet = (on.length > 0 && !pressed) || (lit !== undefined && l.id !== lit);
        return (
          <li key={l.id} style={laneStyle(l.colour)}>
            <button
              type="button"
              aria-pressed={pressed}
              title={pressed ? `Only ${l.title}: on` : `Only ${l.title}`}
              onClick={() => onToggle(l.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-chip px-1.5 py-0.5 text-meta transition-opacity duration-200 hover:bg-raised',
                quiet ? 'text-ink-faint' : 'text-ink-muted',
                pressed && 'bg-raised text-ink',
              )}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--lane)]" />
              <span className="truncate">{l.title}</span>
              <span className="text-ink-faint">{l.count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The kinds as toggles, every one on until turned off. */
function KindRow({
  groups,
  off,
  onToggle,
}: {
  groups: typeof KIND_GROUPS;
  off: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-x-1 gap-y-1">
      {groups.map((g) => {
        const on = !off.includes(g.id);
        return (
          <li key={g.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(g.id)}
              className={cn(
                'rounded-chip px-1.5 py-0.5 text-meta transition-opacity duration-200 hover:bg-raised',
                on ? 'text-ink-muted' : 'text-ink-faint line-through decoration-line-strong',
              )}
            >
              {g.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const DOT = 'absolute left-[4px] top-[9px] size-2.5 rounded-full bg-[var(--lane)] ring-2 ring-surface';

/** The dot: what the row is, in its lane's colour; a decision's is filled with its state. */
function Dot({ row }: { row: RowView }) {
  switch (row.dot) {
    case 'decision':
      return (
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-[3.5px] top-[8px] size-[11px] rotate-45 rounded-[2px] border-2 border-[var(--lane)] ring-2 ring-surface',
            row.state?.bg,
          )}
        />
      );
    case 'line':
      return (
        <span
          aria-hidden="true"
          className="absolute left-[4px] top-[9px] size-2.5 rounded-full border-2 border-[var(--lane)] bg-surface"
        />
      );
    case 'file':
      return (
        <span
          aria-hidden="true"
          className="absolute left-[5px] top-[10px] size-2 rounded-[2px] bg-[var(--lane)] ring-2 ring-surface"
        />
      );
    case 'switch':
      return (
        <ChevronUp
          aria-hidden="true"
          className="absolute left-[2px] top-[6px] size-3.5 bg-surface text-[var(--lane)]"
          strokeWidth={2.5}
        />
      );
    case 'bind':
      return (
        <Link2
          aria-hidden="true"
          className="absolute left-[2px] top-[6px] size-3.5 bg-surface text-[var(--lane)]"
          strokeWidth={2.5}
        />
      );
    default:
      return <span aria-hidden="true" className={DOT} />;
  }
}

/** The row's words: who (in the lane's colour), what, the detail, a status in its tone; the drill a link. */
function Words({ row, lens }: { row: RowView; lens: Lens }) {
  const switching = row.dot === 'switch' || row.dot === 'bind';
  const who = row.who && (
    <span className={cn('font-semibold text-[var(--lane)]', switching ? '' : 'text-meta')}>{row.who}</span>
  );
  const what = (
    <span className={cn(switching ? 'font-semibold text-[var(--lane)]' : 'text-ink-muted')}>{row.what}</span>
  );
  const body = (
    <>
      {who}
      {who && !switching && <span className="text-ink-muted"> · </span>}
      {what}
      {row.value && (
        <>
          <span className="text-ink-muted"> → </span>
          <span className={cn('font-medium', row.value.tone.text)}>{row.value.text}</span>
        </>
      )}
      {row.detail && <span className="text-ink"> {row.detail}</span>}
    </>
  );
  return row.drill ? (
    <NodeLink to={row.drill} lens={lens} className="hover:underline decoration-line-strong underline-offset-2">
      {body}
    </NodeLink>
  ) : (
    body
  );
}

/** A run's head: the session's name in its hue, the live one breathing, how many of the shown rows are its, and the
 *  way to its page. */
function Head({ head, lens }: { head: RunHead; lens: Lens }) {
  return (
    <m.li
      {...liveItem}
      style={laneStyle(head.colour)}
      className="relative grid grid-cols-[52px_18px_minmax(0,1fr)] items-start gap-x-2"
    >
      <span />
      <span className="relative min-h-[36px] self-stretch before:absolute before:bottom-0 before:left-[8px] before:top-0 before:w-0.5 before:bg-line">
        <ChevronUp
          aria-hidden="true"
          className="absolute left-[2px] top-[6px] size-3.5 bg-surface text-[var(--lane)]"
          strokeWidth={2.5}
        />
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 pt-1.5 pb-3 text-xs font-semibold text-[var(--lane)]">
        {head.live && <Pulse className="breathe size-[7px]" />}
        <span className="min-w-0 truncate">{head.title}</span>
        <span className="font-medium text-ink-faint">
          {head.live ? 'on it now' : `${head.count} ${head.count === 1 ? 'row' : 'rows'} here`}
        </span>
        {head.session && (
          <NodeLink
            to={head.session}
            lens={lens}
            className="ml-auto inline-flex items-center gap-0.5 text-meta font-medium text-primary hover:underline"
          >
            session
            <ChevronRight className="size-3" aria-hidden="true" />
          </NodeLink>
        )}
      </div>
    </m.li>
  );
}

/** The rows on the rail, newest first, inside a live list; by session, each run under its head. */
function Rows({
  rows: live,
  heads,
  lens,
  held = false,
}: {
  rows: RowView[];
  heads?: Map<number, RunHead>;
  lens: Lens;
  held?: boolean;
}) {
  const fresh = useFresh();
  // held still under the pointer or focus: the rows keep their places, a new one waits until the release
  const { shown: rows } = useHeldList(live, held, rowKey);
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false}>
        {rows.flatMap((row) => [
          ...(heads?.has(row.seq) ? [<Head key={`head-${row.seq}`} head={heads.get(row.seq)!} lens={lens} />] : []),
          <m.li
            key={row.seq}
            {...liveItem}
            style={laneStyle(row.colour)}
            className={cn(
              'relative grid grid-cols-[52px_18px_minmax(0,1fr)] items-start gap-x-2 transition-opacity duration-200',
              row.dim && 'opacity-50',
            )}
          >
            <Wash arrival={fresh(row.seq) ? row.seq : undefined} className="bg-[var(--lane)] opacity-20" />
            <span className="pt-1.5 text-right text-meta text-ink-faint">{row.when}</span>
            <span className="relative min-h-[42px] self-stretch before:absolute before:bottom-0 before:left-[8px] before:top-0 before:w-0.5 before:bg-line">
              <Dot row={row} />
            </span>
            <div className="min-w-0 pb-3.5 pt-1 text-body leading-normal">
              <Words row={row} lens={lens} />
            </div>
          </m.li>,
        ])}
      </AnimatePresence>
    </ol>
  );
}

/** The same rows as a plain list: when, who, what; the other rendering. */
function FlatList({ rows, lens }: { rows: RowView[]; lens: Lens }) {
  return (
    <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
      {rows.map((row) => (
        <li
          key={row.seq}
          style={laneStyle(row.colour)}
          className={cn(
            'grid grid-cols-[52px_minmax(0,1fr)] items-baseline gap-3 px-3.5 py-2 text-xs transition-opacity duration-200',
            row.dim && 'opacity-50',
          )}
        >
          <span className="text-ink-faint">{row.when}</span>
          <span className="min-w-0 truncate">
            <Words row={row} lens={lens} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The days before the pages, one strip the height of a row: a bar a day, oldest left, as tall as its share of the
 *  busiest day; the day's count and what it moved under the pointer; a day opens by loading the pages down to it. */
function Strip({
  buckets,
  earlier,
  onOpen,
}: {
  buckets: BucketView[];
  earlier: number;
  onOpen: (day: string) => void;
}) {
  const span = `${earlier} ${earlier === 1 ? 'event' : 'events'} in ${buckets.length} ${buckets.length === 1 ? 'day' : 'days'}`;
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-2">
      <Label className="text-right">Earlier</Label>
      <div className="flex min-w-0 items-end gap-2">
        <ul className="flex h-4 flex-wrap items-end gap-px" aria-label={span}>
          {buckets.map((b) => (
            <li key={b.day} className="flex h-4 items-end">
              <button
                type="button"
                title={[
                  `${b.label} · ${b.count} ${b.count === 1 ? 'event' : 'events'}`,
                  ...b.health.map((h) => h.text),
                ].join(' · ')}
                aria-label={`${b.label}: ${b.count} ${b.count === 1 ? 'event' : 'events'}; load down to it`}
                onClick={() => onOpen(b.day)}
                className="flex h-4 w-1.5 items-end rounded-sm hover:bg-raised"
              >
                <span
                  aria-hidden="true"
                  className="block w-full rounded-[1px] bg-ink-faint/50 transition-colors hover:bg-ink-muted"
                  style={{ height: `${Math.max(2, Math.round(b.share * 16))}px` }}
                />
              </button>
            </li>
          ))}
        </ul>
        <span className="truncate text-meta text-ink-faint">{span}</span>
      </div>
    </div>
  );
}
