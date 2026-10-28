// The bridge's transport (decision live-sessions/stage-strip-transport): pause and play, previous and next event, the
// day's events as ticks with decisions marked, and catch up. It only moves the URL's cursor (at= a time, event= a
// selection, decision read-at-a-moment/time-with-event-selection); every query on the page follows it, so paused,
// the whole page reads as of that moment. Dragging along the bar moves the time; a tick locks on its event. The
// timeline itself is read now, so a paused page still counts what arrived after it. Functional, no motion yet
// (change:motion-design).
import { useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import { Pause, Play, StepBack, StepForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineEvent } from '@/data/contract';
import { useTimeline } from '@/data/queries';
import { clock } from '@/features/moment';
import { ago, plural } from '@/lib/format';
import { useCursor, useResolved, type Cursor } from '@/state/moment';
import {
  arrivedSince,
  axisOf,
  dayOf,
  eventWords,
  headOf,
  hourMarks,
  instantAt,
  modeOf,
  place,
  stepFrom,
  ticksOf,
  whoWrote,
} from './model';

const agoWords = (a: string) => (a === 'just now' || !/^\d/.test(a) ? a : `${a} ago`);

/** The timeline of the day the head stands in. The page and the transport ask for the same day, so they share one
 *  read. */
function useDayTimeline(product: string | undefined, headMs: number) {
  const date = new Date(headMs).toDateString();
  const day = useMemo(() => dayOf(Date.parse(date)), [date]);
  return { day, timeline: useTimeline(product, day.from, day.to) };
}

/** The event the page is locked on, among the product's, when one is selected. */
export function useLockedEvent(product: string | undefined): TimelineEvent | undefined {
  const cursor = useCursor();
  const resolved = useResolved();
  const now = useNow(60_000);
  const { timeline } = useDayTimeline(product, headOf(cursor, resolved, now));
  return cursor.event ? timeline.data?.events.find((e) => e.seq === cursor.event) : undefined;
}

/** How long catch up holds on each event before stepping to the next. */
const STEP_MS = 600;

/** A clock that moves every few seconds, for the live head and the age of the last write. */
function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-row border border-line bg-surface text-ink-muted hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40';

export function Transport({ product }: { product: string }) {
  const cursor = useCursor();
  const resolved = useResolved();
  const mode = modeOf(cursor);
  const now = useNow(mode === 'live' ? 5_000 : 30_000);
  const navigate = useNavigate();
  const [catching, setCatching] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const headMs = headOf(cursor, resolved, now);
  const { day, timeline } = useDayTimeline(product, headMs);
  const events = timeline.data?.events ?? [];
  const axis = axisOf(events, day, now);

  const go = (next: Cursor, replace = false) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, at: next.at, event: next.event }),
      replace,
    });
  const toLive = () => go({});
  const step = (dir: -1 | 1, replace = false) => {
    const s = stepFrom(events, cursor, dir);
    if (s === 'live') toLive();
    else if (s) go({ event: s.event }, replace);
    return s;
  };

  // catch up: one event at a time through what arrived, then live
  useEffect(() => {
    if (!catching) return undefined;
    const t = setTimeout(() => {
      const s = step(1, true);
      if (!s || s === 'live') setCatching(false);
    }, STEP_MS);
    return () => clearTimeout(t);
  }); // every render: the next step reads the cursor this one moved to

  const stop = () => setCatching(false);
  const pause = () => {
    stop();
    // the latest write's instant, so the page holds exactly where it stood
    go({ at: timeline.data?.last?.at ?? new Date(now).toISOString() });
  };

  const selected: TimelineEvent | undefined = cursor.event ? events.find((e) => e.seq === cursor.event) : undefined;
  const heldSeq = mode === 'locked' ? cursor.event : undefined;
  const arrived = arrivedSince(events, cursor);
  const freshAfter = mode === 'live' ? undefined : (heldSeq ?? (arrived[0] ? arrived[0].seq - 1 : undefined));
  const ticks = ticksOf(events, axis, freshAfter);
  const headPct =
    drag ??
    (mode === 'live'
      ? 100
      : place(selected ? Date.parse(selected.at) : cursor.at ? Date.parse(cursor.at) : headMs, axis));
  const headLabel =
    drag !== null
      ? clock(new Date(instantAt(drag, axis)).toISOString(), now)
      : mode === 'live'
        ? 'now'
        : clock(selected?.at ?? cursor.at ?? resolved?.at ?? new Date(headMs).toISOString(), now);

  const pctAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  };
  const scrubTo = (pct: number) => go({ at: new Date(instantAt(pct, axis)).toISOString() }, true);

  const canPrev = stepFrom(events, cursor, -1) !== undefined;
  const canNext = stepFrom(events, cursor, 1) !== undefined;
  const lastWrite = events.at(-1)?.at;

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" aria-label="Transport" role="group">
        {mode === 'live' ? (
          <button type="button" className={cn(iconButton, 'text-ink')} aria-label="Pause" onClick={pause}>
            <Pause className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            className={cn(iconButton, 'border-primary/50 text-primary')}
            aria-label="Play"
            title="Back to now"
            onClick={() => {
              stop();
              toLive();
            }}
          >
            <Play className="size-4" />
          </button>
        )}
        <button
          type="button"
          className={iconButton}
          aria-label="Previous event"
          disabled={!canPrev}
          onClick={() => {
            stop();
            step(-1);
          }}
        >
          <StepBack className="size-4" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Next event"
          disabled={!canNext}
          onClick={() => {
            stop();
            step(1);
          }}
        >
          <StepForward className="size-4" />
        </button>

        <div className="relative h-10 min-w-[180px] flex-1 select-none">
          {hourMarks(axis).map((h) => (
            <span
              key={h.ms}
              className="absolute top-0 -translate-x-1/2 text-[10.5px] text-ink-faint tabular-nums"
              style={{ left: `${h.pct}%` }}
            >
              {clock(new Date(h.ms).toISOString(), now)}
            </span>
          ))}
          <div
            ref={bar}
            role="slider"
            tabIndex={0}
            aria-label="The day's events"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(headPct)}
            aria-valuetext={headLabel}
            className="absolute inset-x-0 top-4 h-6 cursor-pointer touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onPointerDown={(e) => {
              stop();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(Math.min(100, Math.max(0, pctAt(e.clientX))));
            }}
            onPointerMove={(e) => {
              if (drag !== null) setDrag(Math.min(100, Math.max(0, pctAt(e.clientX))));
            }}
            onPointerUp={() => {
              if (drag !== null) scrubTo(drag);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                stop();
                step(e.key === 'ArrowLeft' ? -1 : 1, true);
              }
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
            {ticks.map((t) => (
              <button
                key={`${t.seq}-${t.fresh}`}
                type="button"
                tabIndex={-1}
                title={`#${t.seq} · ${clock(t.at, now)}${t.count > 1 ? ` · ${plural(t.count, 'event')}` : ''}${t.decision ? ' · a decision' : ''}`}
                aria-label={`Lock on event #${t.seq}`}
                className="group absolute top-0 h-full w-2 -translate-x-1/2"
                style={{ left: `${t.pct}%` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  stop();
                  go({ event: t.seq });
                }}
              >
                <span
                  className={cn(
                    'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full group-hover:bg-ink',
                    t.decision ? 'h-4 w-[3px] bg-status-review' : 'h-2.5 w-px bg-ink-muted',
                    t.fresh && !t.decision && 'bg-primary',
                    t.seq === heldSeq && 'w-[3px] bg-primary',
                  )}
                />
              </button>
            ))}
            <div className="pointer-events-none absolute top-0 h-full" style={{ left: `${headPct}%` }}>
              <span className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-primary" />
            </div>
          </div>
          <span
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-sm bg-primary px-1 text-[10.5px] font-medium text-primary-foreground tabular-nums"
            style={{ left: `${Math.min(97, Math.max(3, headPct))}%` }}
          >
            {headLabel}
          </span>
        </div>

        {mode === 'live' ? (
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-chip bg-live/10 px-2 py-0.5 font-medium text-live">
              <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
              playing · live
            </span>
            {lastWrite && <span className="text-ink-faint">last write {agoWords(ago(lastWrite, now))}</span>}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-chip bg-status-review/10 px-2 py-0.5 font-medium text-status-review">
              <span className="size-1.5 rounded-full bg-status-review" aria-hidden="true" />
              {catching ? 'catching up' : 'paused'} ·{' '}
              {arrived.length ? `${arrived.length} new since` : 'nothing new since'}
            </span>
            <button
              type="button"
              className="h-7 rounded-row border border-line px-2.5 font-medium text-ink hover:bg-raised disabled:opacity-40"
              disabled={!catching && arrived.length === 0}
              onClick={() => setCatching((c) => !c)}
            >
              {catching ? 'Stop' : 'Catch up'}
            </button>
          </span>
        )}
      </div>

      {mode === 'locked' && (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-line px-4 py-2 text-xs">
          <span className="text-meta font-medium uppercase tracking-wide text-ink-faint">Locked on</span>
          <span className="font-mono text-ink-faint">#{cursor.event}</span>
          {selected ? (
            <span className="min-w-0 text-ink">
              {clock(selected.at, now)} · {whoWrote(selected) ? `${whoWrote(selected)} ` : ''}
              {eventWords(selected)}
            </span>
          ) : (
            <span className="text-ink-muted">
              {resolved && resolved.seq === cursor.event ? `${clock(resolved.at, now)} · ` : ''}a write outside this
              product
            </span>
          )}
        </div>
      )}
    </div>
  );
}
