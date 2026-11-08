// The roadmap: lanes on one horizontal axis. Rows are the features of the map, nested and collapsible as there. Left
// of now, the past by time: a change is a bar from when it began to when it was done, in flight reaching the seam.
// Right of now, the future by sequence: a column per entry of the product's order, a milestone holding its children,
// later closing the list. Dependencies draw when an entry is focused; a warning sits where the order contradicts one or
// a date. Dragging a column header, or a loose entry onto one, writes the order through the same function the command
// uses: the dashboard's first write.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { Bug, ChevronRight, Diamond, GripVertical, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeRow, Scope } from '@/data/contract';
import { useOrder } from '@/data/queries';
import { plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { Label, StateDot } from '@/components/chips/Chip';
import { Pulse } from '@/components/presence/Presence';
import { Ring } from '@/components/stats/Ring';
import {
  aspectNames,
  bars,
  type Column,
  columns as columnsOf,
  edgeShape,
  type EdgeShape,
  featureParents,
  FOUNDATIONS,
  laneOf,
  lanes as lanesOf,
  type Mark,
  type MarksOf,
  pastSpan,
  ticks,
  violationText,
} from './model';
import { statusTone, TONE } from '@/lib/tones';

const LABEL_W = 216;
const PAST_W = 320;
const COL_W = 184;
/** The slot after the sequence that opens while an entry is dragged: dropped there, the entry is ordered last. */
const SLOT_W = 132;
const SLOT = '__slot__' as const;
const ROW_MIN = 40;
const MARK_H = 22;
const BAR_H = 8;
const DAY_MS = 86_400_000;
/** The length of an edge head's wings. */
const HEAD = 6;

export interface RoadmapChartProps {
  scope: Scope;
  expanded: string[];
  onExpandedChange: (ids: string[]) => void;
  selected?: string;
  onSelect: (key: string) => void;
  /** The instant drawn as now; the test passes one. */
  now?: number;
}

export function RoadmapChart({
  scope,
  expanded,
  onExpandedChange,
  selected,
  onSelect,
  now: nowProp,
}: RoadmapChartProps) {
  // now is fixed at mount; the stream's invalidations remount nothing, and a minute of drift is invisible here
  const [mounted] = useState(() => Date.now());
  const now = nowProp ?? mounted;
  const rows = scope.changes;
  const exp = useMemo(() => new Set(expanded), [expanded]);
  const parents = useMemo(() => featureParents(scope.tree), [scope.tree]);
  const needsFoundations = rows.some((r) => r.features.length === 0 && r.kind !== 'bug');
  const lanes = useMemo(() => lanesOf(scope.tree, exp, needsFoundations), [scope.tree, exp, needsFoundations]);
  const shown = useMemo(() => new Set(lanes.map((l) => l.key)), [lanes]);
  const laneFor = useCallback((r: ChangeRow) => laneOf(r, shown, parents), [shown, parents]);
  const cols = useMemo(() => columnsOf(scope), [scope]);
  const span = useMemo(() => pastSpan(rows, now), [rows, now]);
  const tickList = useMemo(() => ticks(span.from, span.to), [span]);
  const allBars = useMemo(() => bars(rows, now), [rows, now]);
  const x = (t: number) => ((Math.max(t, span.from) - span.from) / (span.to - span.from)) * PAST_W;
  const titles = useMemo(() => new Map(rows.map((r) => [r.key, r.gist])), [rows]);
  // an entry that works on an aspect carries a diamond, the aspects named on hover
  const worksOn = useMemo(
    () => new Map(rows.map((r) => [r.key, aspectNames(r, scope.aspects).join(', ')])),
    [rows, scope.aspects],
  );

  // per lane: the bars in its past cell and the entries in each column cell
  const cells = useMemo(() => {
    const m = new Map<string, { bars: typeof allBars; cols: Map<string, ChangeRow[]> }>();
    for (const l of lanes) m.set(l.key, { bars: [], cols: new Map() });
    const put = (lane: string) => m.get(lane) ?? m.get(FOUNDATIONS) ?? m.get(lanes[0]?.key ?? '');
    for (const b of allBars) put(laneFor(b.row))?.bars.push(b);
    for (const c of cols) {
      for (const e of c.entries) {
        const cell = put(laneFor(e));
        if (!cell) continue;
        cell.cols.set(c.key, [...(cell.cols.get(c.key) ?? []), e]);
      }
    }
    return m;
  }, [lanes, allBars, cols, laneFor]);

  const [hover, setHover] = useState<string | undefined>();
  const focus = hover ?? selected;

  // every dependency edge, drawn always (decision dependency-edges-visible/edges-always-drawn): from the dependency to
  // what needs it, shaped by edgeShape; focus lights the focused entry's edges and dims the rest
  const marks = useRef({ past: new Map<string, HTMLElement>(), next: new Map<string, HTMLElement>() });
  const container = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<(EdgeShape & { from: string; to: string; bad: boolean })[]>([]);
  const register = useCallback(
    (key: string, side: 'past' | 'next') => (el: HTMLElement | null) => {
      if (el) marks.current[side].set(key, el);
      else marks.current[side].delete(key);
    },
    [],
  );
  const violationKeys = useMemo(
    () => new Set(scope.roadmap.violations.filter((v) => v.kind === 'order').map((v) => `${v.change}>${v.against}`)),
    [scope.roadmap.violations],
  );
  // the container resizing moves the marks without `cells` changing
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const el = container.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setResized((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!container.current) {
      setEdges([]);
      return;
    }
    const pairs = rows.flatMap((r) => r.dependsOn.map((d): [string, string] => [d, r.key]));
    const box = container.current.getBoundingClientRect();
    const sl = container.current.scrollLeft;
    const st = container.current.scrollTop;
    const rect = (el: HTMLElement | undefined): Mark | undefined => {
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return { x1: r.left - box.left + sl, x2: r.right - box.left + sl, y: r.top - box.top + st + r.height / 2 };
    };
    const at = (k: string): MarksOf => ({
      past: rect(marks.current.past.get(k)),
      next: rect(marks.current.next.get(k)),
    });
    setEdges(
      pairs
        .map(([from, to]) => {
          const shape = edgeShape(
            at(from),
            at(to),
            LABEL_W + PAST_W,
            BAR_H / 2,
            (DAY_MS / (span.to - span.from)) * PAST_W,
          );
          return shape && { ...shape, from, to, bad: shape.late || violationKeys.has(`${to}>${from}`) };
        })
        .filter((e): e is NonNullable<typeof e> => !!e),
    );
    // `cells` is the signal that the layout changed and the marks moved
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [rows, violationKeys, cells, resized, span]);

  // drag to reorder (change:roadmap-order-affordances): a column header, or a loose entry, dropped anywhere on a
  // column, its header or its cells; the half under the cursor says before or after, and the column lights with a line
  // where the entry lands. While dragging, a slot opens after the sequence: dropped there, the entry is ordered last
  const order = useOrder();
  const [dragging, setDragging] = useState<string | undefined>();
  const [over, setOver] = useState<{ key: string; side: 'before' | 'after' } | undefined>();
  const sequenced = useMemo(() => new Set(scope.roadmap.sequence), [scope.roadmap.sequence]);
  // the slot opening moves the columns, and changing the layout inside dragstart cancels the drag: it waits a tick
  const startDrag = (key: string) => void setTimeout(() => setDragging(key));
  const endDrag = () => {
    setDragging(undefined);
    setOver(undefined);
  };
  const dropOn = (col: Column) => {
    const change = dragging;
    const side = over?.side ?? 'after';
    endDrag();
    if (!change || change === col.key) return;
    if (col.kind === 'later') {
      if (sequenced.has(change)) order.mutate({ change, later: true });
      return;
    }
    order.mutate({ change, [side]: col.key });
  };
  const dropLast = () => {
    const change = dragging;
    endDrag();
    if (change && scope.roadmap.sequence.at(-1) !== change) order.mutate({ change, last: true });
  };
  // a column takes the drop: any column of the sequence, and later only an entry already on the sequence
  const takes = (c: Column) => !!dragging && (c.kind !== 'later' || sequenced.has(dragging));
  const markOf = (c: Column) => (over?.key === c.key ? (c.kind === 'later' ? 'into' : over.side) : undefined);
  const dragOver = (c: Column) => (e: React.DragEvent<HTMLElement>) => {
    if (!takes(c)) return;
    e.preventDefault();
    setOver({ key: c.key, side: sideOf(c, e) });
  };
  const slotOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver({ key: SLOT, side: 'after' });
  };
  const slotDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    dropLast();
  };
  const ordered = cols.filter((c) => c.kind !== 'later');
  const later = cols.find((c) => c.kind === 'later');
  const track: (Column | typeof SLOT)[] = [...ordered, ...(dragging ? [SLOT] : []), ...(later ? [later] : [])];
  const repair = (col: Column) => {
    const v = col.violations.find((w) => w.kind === 'order');
    if (!v?.against) return;
    if (sequenced.has(v.against)) order.mutate({ change: col.key, after: v.against });
    else order.mutate({ change: col.key, later: true });
  };

  const gridCols = `${LABEL_W}px ${PAST_W}px ${track.map((c) => `${c === SLOT ? SLOT_W : COL_W}px`).join(' ')}`;
  const bugsLink = (key: string, n: number, worst?: string) => (
    <Link
      to="/$lens/$"
      params={{ lens: 'feature', _splat: key }}
      search={{ bugs: true }}
      title={`${plural(n, 'open bug')}${worst ? `, worst ${worst}` : ''} · on the map`}
      className={cn(
        'ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-chip px-1.5 text-meta font-medium hover:bg-raised',
        worst === 'product' || worst === 'feature' ? TONE.alarm.text : 'text-ink-faint',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <Bug className="size-3" aria-hidden="true" />
      {n}
    </Link>
  );

  return (
    <section aria-label="Roadmap" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 pt-3.5 pb-2">
        <h2 className="text-section font-semibold">Roadmap</h2>
        <span className="text-xs text-ink-muted">
          {plural(scope.roadmap.sequence.length, 'entry', 'entries')} in order
          {scope.roadmap.later.length ? ` · ${scope.roadmap.later.length} later` : ''}
          {scope.roadmap.violations.length ? (
            <span className={TONE.waits.text}> · {plural(scope.roadmap.violations.length, 'warning')}</span>
          ) : null}
        </span>
        <span className="ml-auto flex items-center gap-3 text-meta text-ink-faint" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-2 w-6 rounded-[4px]', TONE.done.bg)} aria-hidden="true" />
            done, by the day
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-2 w-6 rounded-r-[4px]', TONE.active.bg)} aria-hidden="true" />
            in flight, to now
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-6 rounded-chip border border-line-strong" aria-hidden="true" />
            next, by order
          </span>
        </span>
      </div>

      <div ref={container} className="relative min-h-0 flex-1 overflow-auto" data-scroll-restoration-id="roadmap">
        <div className="grid w-max" style={{ gridTemplateColumns: gridCols }}>
          {/* the header row */}
          <div className="sticky top-0 left-0 z-30 flex h-10 items-end border-b border-line bg-ground px-3 pb-1.5">
            <Label>{plural(lanes.filter((l) => l.key !== FOUNDATIONS).length, 'feature')}</Label>
          </div>
          <div className="sticky top-0 z-20 h-10 border-r border-primary border-b border-b-line bg-ground">
            <div className="relative h-full">
              {tickList
                .filter((t) => x(t.t) < PAST_W - 28)
                .map((t) => (
                  <span
                    key={t.t}
                    className={cn(
                      'absolute bottom-1.5 text-meta',
                      x(t.t) < 20 ? '' : '-translate-x-1/2',
                      t.month ? 'text-ink-muted' : 'text-ink-faint',
                    )}
                    style={{ left: x(t.t) }}
                  >
                    {t.label}
                  </span>
                ))}
              <span className="absolute right-0 bottom-1.5 translate-x-1/2 rounded-chip bg-ground px-1 text-meta font-semibold text-primary">
                now
              </span>
            </div>
          </div>
          {track.map((c, i) =>
            c === SLOT ? (
              <div
                key={SLOT}
                className={cn(
                  'sticky top-0 z-20 flex h-10 items-center justify-center border-r border-b border-dashed border-line-strong bg-ground px-2 text-center text-meta',
                  over?.key === SLOT ? 'bg-selection text-ink' : 'text-ink-muted',
                )}
                onDragOver={slotOver}
                onDragLeave={() => setOver((o) => (o?.key === SLOT ? undefined : o))}
                onDrop={slotDrop}
              >
                {ordered.length ? 'Drop to order last' : 'Drop to order'}
              </div>
            ) : (
              <ColumnHeader
                key={c.key}
                col={c}
                index={i}
                titles={titles}
                draggable={c.kind !== 'later'}
                dragging={dragging === c.key}
                over={markOf(c)}
                onDragStart={() => startDrag(c.key)}
                onDragOver={dragOver(c)}
                onDragLeave={() => setOver((o) => (o?.key === c.key ? undefined : o))}
                onDragEnd={endDrag}
                onDrop={() => dropOn(c)}
                onRepair={c.violations.some((w) => w.kind === 'order') ? () => repair(c) : undefined}
                onSelect={c.row ? () => onSelect(c.key) : undefined}
                selected={selected === c.key}
              />
            ),
          )}

          {/* the lanes */}
          {lanes.map((l) => {
            const cell = cells.get(l.key);
            const deepest = Math.max(cell?.bars.length ?? 0, ...cols.map((c) => cell?.cols.get(c.key)?.length ?? 0));
            const h = Math.max(ROW_MIN, deepest * MARK_H + 10);
            const onToggle = () =>
              onExpandedChange(l.expanded ? expanded.filter((k) => k !== l.key) : [...expanded, l.key]);
            return [
              <div
                key={`${l.key}:label`}
                className="sticky left-0 z-10 flex items-center gap-1 border-b border-line bg-ground pr-2"
                style={{ height: h, paddingLeft: 8 + l.depth * 16 }}
              >
                {l.children > 0 ? (
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-label={l.expanded ? 'Collapse' : 'Expand'}
                    aria-expanded={l.expanded}
                    className="grid size-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-raised hover:text-ink"
                  >
                    <ChevronRight className={cn('size-3.5 transition-transform', l.expanded && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="size-5 shrink-0" />
                )}
                {l.key === FOUNDATIONS ? (
                  <span className="truncate text-xs text-ink-muted" title="Work that names no feature">
                    Foundations
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(l.key)}
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 truncate text-left text-xs hover:text-ink',
                      selected === l.key ? 'font-medium text-ink' : 'text-ink-muted',
                    )}
                    title={l.level}
                  >
                    <StateDot state={l.state} />
                    <span className="truncate">{l.label}</span>
                  </button>
                )}
                {l.bugs && l.bugs.beneath > 0 && bugsLink(l.key, l.bugs.beneath, l.bugs.worst)}
              </div>,
              <div
                key={`${l.key}:past`}
                className="relative border-r border-primary border-b border-b-line"
                style={{ height: h }}
              >
                {tickList.map((t) => (
                  <span
                    key={t.t}
                    className="absolute inset-y-0 border-l border-line"
                    style={{ left: x(t.t) }}
                    aria-hidden="true"
                  />
                ))}
                {cell?.bars.map((b, i) => {
                  const left = x(b.from);
                  const width = Math.max(BAR_H, x(b.to) - left);
                  const on = focus === b.row.key;
                  return (
                    <button
                      key={b.row.key}
                      type="button"
                      ref={register(b.row.key, 'past')}
                      onClick={() => onSelect(b.row.key)}
                      onMouseEnter={() => setHover(b.row.key)}
                      onMouseLeave={() => setHover(undefined)}
                      onFocus={() => setHover(b.row.key)}
                      onBlur={() => setHover(undefined)}
                      title={`${b.row.gist ?? short(b.row.key)} · ${b.row.status ?? 'open'} · ${day(b.from)} → ${b.done ? day(b.to) : 'now'}`}
                      aria-label={`${b.row.gist ?? short(b.row.key)}, ${b.row.status ?? 'open'}`}
                      aria-current={selected === b.row.key ? 'true' : undefined}
                      className="absolute flex items-center py-[7px] outline-none"
                      style={{ left, width: Math.min(width, PAST_W - left), top: 5 + i * MARK_H, height: MARK_H }}
                    >
                      <span
                        className={cn(
                          'block h-full w-full rounded-l-[4px]',
                          b.done ? 'rounded-r-[4px]' : '',
                          statusTone(b.row.status).bg,
                          on ? 'opacity-100 ring-2 ring-ground' : 'opacity-80',
                          selected === b.row.key && 'ring-2 ring-accent',
                        )}
                        style={{ height: BAR_H }}
                      />
                    </button>
                  );
                })}
              </div>,
              ...track.map((c) =>
                c === SLOT ? (
                  <div
                    key={`${l.key}:${SLOT}`}
                    className={cn(
                      'border-r border-b border-dashed border-line-strong',
                      over?.key === SLOT && 'bg-selection/60',
                    )}
                    style={{ height: h }}
                    onDragOver={slotOver}
                    onDrop={slotDrop}
                  />
                ) : (
                  <div
                    key={`${l.key}:${c.key}`}
                    className={cn(
                      'flex flex-col gap-0.5 border-r border-line border-b px-1.5 py-[5px]',
                      c.kind === 'later' && 'bg-raised/40',
                      dropMark(markOf(c)),
                    )}
                    style={{ height: h }}
                    onDragOver={dragOver(c)}
                    onDrop={(e) => {
                      if (!takes(c)) return;
                      e.preventDefault();
                      dropOn(c);
                    }}
                  >
                    {cell?.cols.get(c.key)?.map((e) => {
                      const v = scope.roadmap.violations.filter((w) => w.change === e.key);
                      const loose = c.kind === 'later';
                      return (
                        <button
                          key={e.key}
                          type="button"
                          ref={register(e.key, 'next')}
                          draggable={loose}
                          onDragStart={
                            loose
                              ? (ev) => {
                                  ev.dataTransfer.setData('text/plain', e.key);
                                  ev.dataTransfer.effectAllowed = 'move';
                                  startDrag(e.key);
                                }
                              : undefined
                          }
                          onDragEnd={endDrag}
                          onClick={() => onSelect(e.key)}
                          onMouseEnter={() => setHover(e.key)}
                          onMouseLeave={() => setHover(undefined)}
                          onFocus={() => setHover(e.key)}
                          onBlur={() => setHover(undefined)}
                          title={`${e.gist ?? short(e.key)} · ${e.status ?? 'open'}${e.parent && c.kind === 'later' ? ` · under ${short(e.parent)}` : ''}${v.length ? ` · ${v.map((w) => violationText(w, titles)).join('; ')}` : ''}`}
                          aria-current={selected === e.key ? 'true' : undefined}
                          className={cn(
                            'flex h-5 min-w-0 items-center gap-1.5 rounded-chip border px-1.5 text-left text-meta outline-none',
                            selected === e.key
                              ? 'border-accent bg-selection text-ink ring-1 ring-accent'
                              : focus === e.key
                                ? 'border-line-strong bg-raised text-ink'
                                : 'border-line-strong text-ink-muted hover:bg-raised hover:text-ink',
                            loose && 'cursor-grab active:cursor-grabbing',
                            dragging === e.key && 'opacity-40',
                          )}
                        >
                          {loose && (
                            <GripVertical className="-ml-1 size-3 shrink-0 text-ink-faint" aria-hidden="true" />
                          )}
                          <span
                            className={cn('size-[7px] shrink-0 rounded-full', statusTone(e.status).bg)}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate">{e.gist ?? short(e.key)}</span>
                          {e.live && <Pulse className="size-[6px]" />}
                          {worksOn.get(e.key) && (
                            <span className="shrink-0" title={`works on ${worksOn.get(e.key)}`}>
                              <Diamond
                                className="size-3 text-ink-faint"
                                aria-label={`works on ${worksOn.get(e.key)}`}
                              />
                            </span>
                          )}
                          {v.length > 0 && (
                            <TriangleAlert className={cn('size-3 shrink-0', TONE.waits.text)} aria-label="warning" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ),
              ),
            ];
          })}
          {lanes.length === 0 && (
            <div className="col-span-full p-5 text-xs text-ink-faint">
              No features on the map yet, and nothing in flight. A feature is created when someone names a capability.
            </div>
          )}
        </div>

        {/* the edges, always; the focused entry's lit */}
        {edges.length > 0 && (
          <svg
            className="pointer-events-none absolute top-0 left-0 z-20 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            {edges.map((e) => {
              const lit = !!focus && (e.from === focus || e.to === focus);
              const w = lit ? 2 : 1.25;
              // an open chevron, its wings swept back from the tip along the arriving direction
              const wing = (turn: number) =>
                `${e.end.x - HEAD * Math.cos(e.angle + turn)} ${e.end.y - HEAD * Math.sin(e.angle + turn)}`;
              return (
                <g
                  key={`${e.from}>${e.to}`}
                  className={e.bad ? TONE.alarm.text : 'text-primary'}
                  stroke="currentColor"
                  strokeWidth={w}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={lit ? 0.9 : focus ? 0.12 : e.bad ? 0.7 : 0.35}
                >
                  <path d={e.d} />
                  <path d={`M ${wing(-0.55)} L ${e.end.x} ${e.end.y} L ${wing(0.55)}`} />
                  <circle cx={e.start.x} cy={e.start.y} r={w + 0.75} fill="currentColor" stroke="none" />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </section>
  );
}

/** The side of a column a drag lands on: the half under the cursor; later has no sides. */
const sideOf = (c: Column, e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
  if (c.kind === 'later') return 'after';
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX - r.left < r.width / 2 ? 'before' : 'after';
};

/** Where a drag would land on a column:lit, with a line on the side the entry lands; later is lit whole. */
const dropMark = (mark?: 'before' | 'after' | 'into') =>
  cn(
    mark && 'bg-selection/60',
    mark === 'before' && 'shadow-[inset_3px_0_0_var(--primary)]',
    mark === 'after' && 'shadow-[inset_-3px_0_0_var(--primary)]',
  );

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function ColumnHeader({
  col,
  index,
  titles,
  draggable,
  dragging,
  over,
  selected,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  onDrop,
  onRepair,
  onSelect,
}: {
  col: Column;
  index: number;
  titles: Map<string, string | undefined>;
  draggable: boolean;
  dragging: boolean;
  over?: 'before' | 'after' | 'into';
  selected: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRepair?: () => void;
  onSelect?: () => void;
}) {
  const warn = col.violations.map((v) => violationText(v, titles)).join('; ');
  const p = col.progress;
  return (
    <div
      className={cn(
        'sticky top-0 z-20 flex h-10 items-center gap-1.5 border-r border-line border-b bg-ground px-2',
        col.kind === 'later' && 'bg-raised/60',
        dropMark(over),
        dragging && 'opacity-40',
      )}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData('text/plain', col.key);
              e.dataTransfer.effectAllowed = 'move';
              onDragStart();
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {draggable && <GripVertical className="size-3.5 shrink-0 cursor-grab text-ink-faint" aria-hidden="true" />}
      {col.kind === 'milestone' && p && <Ring done={p.done} total={p.total} size={16} stroke={2.5} />}
      {col.kind === 'later' ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xs font-medium text-ink-muted">Later</span>
          <span className="text-meta text-ink-faint">{col.entries.length}</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-xs font-medium hover:text-ink',
            selected ? 'text-ink' : 'text-ink-muted',
          )}
          title={`${index + 1}. ${col.title}${col.target ? ` · target ${col.target}` : ''}`}
        >
          {col.title}
        </button>
      )}
      {col.target && (
        <span className="shrink-0 text-meta text-ink-faint" title={`target ${col.target}`}>
          {col.target.slice(5).replace('-', '/')}
        </span>
      )}
      {warn && (
        <span className="group relative shrink-0">
          <TriangleAlert className={cn('size-3.5', TONE.waits.text)} aria-label={warn} />
          <span className="pointer-events-none absolute top-full right-0 z-30 mt-1 hidden w-[240px] flex-col gap-1.5 rounded-card border border-line bg-popover p-2.5 text-left text-meta text-ink shadow-lg group-hover:flex group-focus-within:flex">
            <span>{warn}</span>
            {onRepair && (
              <button
                type="button"
                onClick={onRepair}
                className="pointer-events-auto w-fit rounded-row border border-line-strong px-1.5 py-0.5 text-meta text-ink-muted hover:bg-raised hover:text-ink"
              >
                move it after
              </button>
            )}
          </span>
        </span>
      )}
    </div>
  );
}
