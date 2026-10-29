// The bridge's transport (decisions live-sessions/stage-strip-transport, rolling-window, play-returns-to-now): pause and
// play, previous and next event, and the last twelve hours of the product's events as ticks, decisions marked. It
// only moves the URL's cursor (at= a time, event= a selection); every query on the page follows it, so paused, the
// whole page reads as of that moment. Dragging along the bar moves the time; a tick locks on its event.
//
// The bar rolls: ticks, hour marks and a held head are placed once, at their instants, on a layer that slides left
// as the clock moves, so nothing on it is redrawn as time passes and only real arrivals and departures appear or
// leave. The timeline is read now, so a paused page still sees what arrived after it. No other motion yet
// (change:motion-design).
import { useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import { Pause, Play, StepBack, StepForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Moment, TimelineEvent } from '@/data/contract';
import { useTimeline } from '@/data/queries';
import { clock } from '@/features/moment';
import { ago } from '@/lib/format';
import { useCursor, useResolved, type Cursor } from '@/state/moment';
import {
  along,
  arrivedSince,
  eventWords,
  headOf,
  hourMarks,
  instantAt,
  modeOf,
  spanOf,
  stepFrom,
  viewOf,
  whoWrote,
  WINDOW_MS,
} from './model';

/** How often the bar's clock moves; the layer glides between readings. */
const ROLL_MS = 5_000;
const HOUR = 3_600_000;

/** A clock that moves every few seconds, for the rolling bar and the age of the last write. */
function useNow(everyMs = ROLL_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** The view the bar shows and the events read for it. The page and the transport ask for the same span, so they
 *  share one read. A view that stops short of now also asks how many events came after the held one, which its
 *  span cannot count. */
function useWindow(product: string | undefined, cursor: Cursor, resolved: Moment | undefined, now: number) {
  const view = viewOf(headOf(cursor, resolved, now), now);
  const hour = Math.ceil(view.end / HOUR);
  const span = useMemo(() => spanOf(hour * HOUR), [hour]);
  const after = view.rolling ? undefined : (cursor.event ?? resolved?.seq);
  return { view, span, timeline: useTimeline(product, span.from, span.to, after) };
}

/** The event the page is locked on, among the product's, when one is selected. */
export function useLockedEvent(product: string | undefined): TimelineEvent | undefined {
  const cursor = useCursor();
  const resolved = useResolved();
  const now = useNow();
  const { timeline } = useWindow(product, cursor, resolved, now);
  return cursor.event ? timeline.data?.events.find((e) => e.seq === cursor.event) : undefined;
}

const agoWords = (a: string) => (a === 'just now' || !/^\d/.test(a) ? a : `${a} ago`);

/** A label kept inside the bar: centred on its place, or held to the edge it would cross. */
const anchored = (pct: number) => (pct > 88 ? '-translate-x-full' : pct < 12 ? 'translate-x-0' : '-translate-x-1/2');

const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-row border border-line bg-surface text-ink-muted hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40';

export function Transport({ product }: { product: string }) {
  const cursor = useCursor();
  const resolved = useResolved();
  const mode = modeOf(cursor);
  const now = useNow();
  const navigate = useNavigate();
  const [drag, setDrag] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const head = headOf(cursor, resolved, now);
  const { view, span, timeline } = useWindow(product, cursor, resolved, now);
  const events = timeline.data?.events ?? [];
  // the layer's own frame: twelve hours ending at the span's end, fixed until the hour turns; it is shifted to the
  // view, and the shift is the only thing that changes as the clock moves
  const layerStart = Date.parse(span.to) - WINDOW_MS;
  const shift = along(layerStart, view.start);
  const layer = (rolling: boolean) => ({
    className: cn('absolute inset-0', rolling && 'transition-transform ease-linear'),
    style: { transform: `translateX(${shift}%)`, transitionDuration: `${ROLL_MS}ms` },
  });

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
  };
  // the latest write's instant, so the page holds exactly where it stood
  const pause = () => go({ at: timeline.data?.last?.at ?? new Date(now).toISOString() });

  const selected = cursor.event ? events.find((e) => e.seq === cursor.event) : undefined;
  const arrived = new Set(arrivedSince(events, cursor).map((e) => e.seq));
  const arrivedCount = timeline.data?.arrivedAfter ?? arrived.size;
  const heldAt = selected ? Date.parse(selected.at) : head;
  const headPct = drag ?? (mode === 'live' ? 100 : along(heldAt, view.start));
  const headLabel =
    drag !== null
      ? clock(new Date(instantAt(drag, view.start)).toISOString(), now)
      : mode === 'live'
        ? 'now'
        : clock(new Date(heldAt).toISOString(), now);

  const pctAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };
  // a drag to the right edge of a rolling bar is now; nothing lies beyond it
  const scrubTo = (pct: number) => {
    const t = instantAt(pct, view.start);
    if (view.rolling && t >= now - WINDOW_MS / 200) toLive();
    else go({ at: new Date(t).toISOString() }, true);
  };

  const canPrev = stepFrom(events, cursor, -1) !== undefined;
  const canNext = stepFrom(events, cursor, 1) !== undefined;
  const lastWrite = events.at(-1)?.at;

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex items-center gap-3 px-4 py-2.5" aria-label="Transport" role="group">
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
            onClick={toLive}
          >
            <Play className="size-4" />
          </button>
        )}
        <button
          type="button"
          className={iconButton}
          aria-label="Previous event"
          disabled={!canPrev}
          onClick={() => step(-1)}
        >
          <StepBack className="size-4" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Next event"
          disabled={!canNext}
          onClick={() => step(1)}
        >
          <StepForward className="size-4" />
        </button>

        <div
          className="relative h-10 min-w-0 flex-1 overflow-hidden select-none"
          style={{ maskImage: 'linear-gradient(to right, transparent 0, black 6%)' }}
        >
          <div key={span.to} aria-hidden="true" {...layer(view.rolling)}>
            {hourMarks(layerStart - WINDOW_MS, Date.parse(span.to)).map((t) => (
              <span
                key={t}
                className="absolute top-0 -translate-x-1/2 text-[10.5px] whitespace-nowrap text-ink-faint tabular-nums"
                style={{ left: `${along(t, layerStart)}%` }}
              >
                {clock(new Date(t).toISOString(), now)}
              </span>
            ))}
          </div>
          <div
            ref={bar}
            role="slider"
            tabIndex={0}
            aria-label="The last twelve hours of events"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(headPct)}
            aria-valuetext={headLabel}
            className="absolute inset-x-0 top-4 h-6 cursor-pointer touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(pctAt(e.clientX));
            }}
            onPointerMove={(e) => {
              if (drag !== null) setDrag(pctAt(e.clientX));
            }}
            onPointerUp={() => {
              if (drag !== null) scrubTo(drag);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                step(e.key === 'ArrowLeft' ? -1 : 1, true);
              }
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
            <div key={span.to} {...layer(view.rolling)}>
              {events.map((e) => (
                <Tick
                  key={e.seq}
                  event={e}
                  pct={along(Date.parse(e.at), layerStart)}
                  now={now}
                  held={e.seq === cursor.event}
                  fresh={mode !== 'live' && arrived.has(e.seq)}
                  onLock={() => go({ event: e.seq })}
                />
              ))}
              {mode !== 'live' && drag === null && (
                <span
                  className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 bg-primary"
                  style={{ left: `${along(heldAt, layerStart)}%` }}
                />
              )}
            </div>
            {(mode === 'live' || drag !== null) && (
              <span
                className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 bg-primary"
                style={{ left: `${headPct}%` }}
              />
            )}
            {mode !== 'live' && view.rolling && (
              <span className="pointer-events-none absolute top-0 right-0 h-full w-px bg-ink-faint" />
            )}
          </div>
          <span
            className={cn(
              'pointer-events-none absolute top-0 rounded-sm bg-primary px-1 text-[10.5px] font-medium whitespace-nowrap text-primary-foreground tabular-nums',
              anchored(headPct),
            )}
            style={{ left: `${Math.min(100, Math.max(0, headPct))}%` }}
          >
            {headLabel}
          </span>
        </div>

        <span className="flex w-52 shrink-0 items-center justify-end gap-2 text-xs whitespace-nowrap">
          {mode === 'live' ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-chip bg-live/10 px-2 py-0.5 font-medium text-live">
                <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
                live
              </span>
              {lastWrite && <span className="truncate text-ink-faint">last write {agoWords(ago(lastWrite, now))}</span>}
            </>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-chip bg-status-review/10 px-2 py-0.5 font-medium text-status-review">
              <span className="size-1.5 shrink-0 rounded-full bg-status-review" aria-hidden="true" />
              <span className="truncate">
                paused · {arrivedCount ? `${arrivedCount} new since` : 'nothing new since'}
              </span>
            </span>
          )}
        </span>
      </div>

      {mode === 'locked' && (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-line px-4 py-2 text-xs">
          <span className="text-meta font-medium tracking-wide text-ink-faint uppercase">Locked on</span>
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

/** One event on the bar: a tick, taller where a decision was opened or moved; a click locks on it. */
function Tick({
  event: e,
  pct,
  now,
  held,
  fresh,
  onLock,
}: {
  event: TimelineEvent;
  pct: number;
  now: number;
  held: boolean;
  fresh: boolean;
  onLock: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={`#${e.seq} · ${clock(e.at, now)} · ${eventWords(e)}`}
      aria-label={`Lock on event #${e.seq}`}
      className={cn('group absolute top-0 h-full w-1.5 -translate-x-1/2', e.decision && 'z-[1]')}
      style={{ left: `${pct}%` }}
      onPointerDown={(ev) => ev.stopPropagation()}
      onClick={onLock}
    >
      <span
        className={cn(
          'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full group-hover:bg-ink',
          e.decision ? 'h-4 w-[3px] bg-status-review' : 'h-2.5 w-px bg-ink-muted',
          fresh && !e.decision && 'bg-primary',
          held && 'h-5 w-[3px] bg-primary',
        )}
      />
    </button>
  );
}
