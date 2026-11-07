// The rail (change:activity-timeline, decision one-timeline-every-scope): one vertical timeline at any scope and at
// every width. Lanes are told apart by colour (model.ts), every dot drills to the unit on the other axis (a session
// from a tree node, a change from a session), and a row's words name its lane so colour is never alone. The dot says
// what the row is: a filled circle a write, a diamond a decision filled with its state (amber waiting, green decided)
// and ringed with its lane, a hollow circle a line, a square a file, a chevron a focus switch. The lane the mount
// lights stays whole and the other lanes dim to half; nothing is filtered out. Days before the window are a density
// band beneath the rows, each a bar for its count carrying what the day moved, and a day opens into its rows.
// Alive (change:motion-design): a row that arrives opens its space and fades in, washed in its lane's colour; the
// dim is a short fade; under reduced motion the fades stay and nothing slides.
// The flat list is the other rendering of the same rows: the same words in a plain list, without the rail.
import { cn } from 'cn';
import { ChevronUp, Link2, List, Rows3 } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import type { Lens, RailQuery } from '@/data/contract';
import { useRail } from '@/data/queries';
import { EmptyState } from '@/components/EmptyState';
import { Label } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { liveItem, Wash } from '@/lib/motion';
import { useFresh } from '@/state/arrivals';
import {
  bucketViews,
  dayWindow,
  laneViews,
  rowViews,
  windowLine,
  type BucketView,
  type LaneView,
  type RowView,
} from './model';

export type RailRendering = 'rail' | 'list';

/** The lane's colour, as the custom property the dots and words read. */
const laneStyle = (colour: string) => ({ '--lane': colour }) as React.CSSProperties;

export function Rail({
  scope,
  lens,
  days = 14,
  lit,
  className,
}: {
  /** The key the rail is drawn at: a change, a milestone, a feature, the product, a session. */
  scope: string;
  lens: Lens;
  days?: number;
  /** The lane kept whole while the rest dim: the change a session page shows. */
  lit?: string;
  className?: string;
}) {
  const q = useRail(scope, { days });
  const [rendering, setRendering] = useState<RailRendering>('rail');
  const rail = q.data;
  if (!rail)
    return <EmptyState title={q.isError ? 'The rail could not be read.' : 'Reading the rail…'} className={className} />;
  const lanes = laneViews(rail);
  const rows = rowViews(rail, lit);
  const buckets = bucketViews(rail.buckets);
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <Label>Timeline</Label>
          <span className="text-meta text-ink-faint">{windowLine(rail, days)}</span>
          <Toggle rendering={rendering} onChange={setRendering} />
        </div>
        {lanes.length > 0 && <LaneChips lanes={lanes} lit={lit} />}
      </div>
      {rows.length === 0 && buckets.length === 0 ? (
        <EmptyState title="Nothing has happened here yet." />
      ) : rendering === 'rail' ? (
        <Rows rows={rows} lens={lens} />
      ) : (
        <FlatList rows={rows} lens={lens} />
      )}
      {buckets.length > 0 && <Band scope={scope} lens={lens} buckets={buckets} lit={lit} rendering={rendering} />}
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
      className={cn('rounded-chip p-1 text-ink-faint hover:text-ink', rendering === r && 'bg-raised text-ink')}
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

/** The lanes as chips: a dot in the lane's colour and its name; the lit lane stands out, the rest are quiet. */
function LaneChips({ lanes, lit }: { lanes: LaneView[]; lit?: string }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {lanes.map((l) => (
        <li
          key={l.id}
          className={cn(
            'flex items-center gap-1.5 text-meta transition-opacity duration-200',
            lit !== undefined && l.id !== lit ? 'text-ink-faint' : 'text-ink-muted',
          )}
          style={laneStyle(l.colour)}
        >
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--lane)]" />
          <span className="truncate">{l.title}</span>
          <span className="text-ink-faint">{l.count}</span>
        </li>
      ))}
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

/** The rows on the rail, newest first, inside a live list. */
function Rows({ rows, lens }: { rows: RowView[]; lens: Lens }) {
  const fresh = useFresh();
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
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
          </m.li>
        ))}
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

/** The days before the window: a bar a day, newest first, carrying what the day moved; one opens into its rows. */
function Band({
  scope,
  lens,
  buckets,
  lit,
  rendering,
}: {
  scope: string;
  lens: Lens;
  buckets: BucketView[];
  lit?: string;
  rendering: RailRendering;
}) {
  const [open, setOpen] = useState<string>();
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Earlier</Label>
      <ul className="flex flex-col gap-1">
        {buckets.map((b) => (
          <li key={b.day} className="flex flex-col gap-1">
            <button
              type="button"
              aria-expanded={open === b.day}
              onClick={() => setOpen(open === b.day ? undefined : b.day)}
              className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-2 rounded-row py-0.5 text-left hover:bg-raised"
            >
              <span className="text-right text-meta text-ink-faint">{b.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 shrink-0 rounded-sm bg-ink-faint/40"
                  style={{ width: `${Math.max(4, Math.round(b.share * 120))}px` }}
                />
                <span className="truncate text-meta text-ink-muted">
                  {b.count} {b.count === 1 ? 'event' : 'events'}
                  {b.health.map((h) => (
                    <span key={h.text}>
                      {' · '}
                      <span className={h.tone.text}>{h.text}</span>
                    </span>
                  ))}
                </span>
              </span>
            </button>
            {open === b.day && <Day scope={scope} lens={lens} day={b.day} lit={lit} rendering={rendering} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A day opened: its rows, read for that window alone. */
function Day({
  scope,
  lens,
  day,
  lit,
  rendering,
}: {
  scope: string;
  lens: Lens;
  day: string;
  lit?: string;
  rendering: RailRendering;
}) {
  const q = useRail(scope, dayWindow(day) satisfies RailQuery);
  if (!q.data) return <div className="pl-[60px] text-meta text-ink-faint">Reading the day…</div>;
  const rows = rowViews(q.data, lit);
  return rendering === 'rail' ? <Rows rows={rows} lens={lens} /> : <FlatList rows={rows} lens={lens} />;
}
