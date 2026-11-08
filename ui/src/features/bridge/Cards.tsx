// The changes in motion as cards (decision bridge-rework/cards-and-transport): one grid, three across at desktop
// width and one across docked, the groups' headings spanning it, so a card that changes group slides there as one
// motion (change:motion-design). A card is what a person needs to pick the change up or follow it: its name, status
// and last touch, a steps bar with done of total, the step the work stands on with its note, the sessions on it as
// pills with the live one marked, and its feature path. The card opens the change; a pill opens its session; the
// hold button (decision hold-is-a-button) holds the transport on the change and lifts the card out of the grid
// (decision held-card-lifts), so a held card is drawn by the bridge above the grid, not here.
// Under the pointer a card lights its writes on the transport; a tick under the pointer lights its card. Under the
// pointer or keyboard focus the grid holds still (lib/hold); a card a live event touched washes in its colour.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronRight, Pin } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import type { BridgeMotion, BridgeSession, TimelineEvent } from '@/data/contract';
import { agoWords, plural } from '@/lib/format';
import { useHeldList, useHold } from '@/lib/hold';
import { restOf, short } from '@/lib/keys';
import { EXIT, liveItem, Wash } from '@/lib/motion';
import { Label, StatusChip } from '@/components/chips/Chip';
import { eventTone, SESSION, sessionDot, statusTone, TONE } from '@/lib/tones';
import { cardRows, groupsOf, lastArrival, pillWords, stepWords, unbound, type CardRow } from './model';

/** What the event the page is locked on touched: the change it wrote or decided on. */
export interface Touched {
  change?: string;
}

const NONE: readonly TimelineEvent[] = [];
const OUTLINE = 'ring-2 ring-primary ring-offset-2 ring-offset-ground';
/** How a grid card leaves: lifted into the held row, at once; otherwise the live list's fade. */
const LIFTED = { opacity: 0, transition: { duration: 0 } };
const GONE = { opacity: 0, scale: 0.97, transition: EXIT };

export interface CardsProps {
  changes: readonly BridgeMotion[];
  sessions: readonly BridgeSession[];
  /** Every session by key, the subagents too. */
  byKey: ReadonlyMap<string, BridgeSession>;
  /** The change each session is on, for the arrivals' wash. */
  onChange: ReadonlyMap<string, string>;
  /** The change under the pointer, on a card or on a tick. */
  hover?: string;
  onHover: (change: string | undefined) => void;
  /** The changes held: their cards are lifted out of the grid. */
  held: ReadonlySet<string>;
  /** Holds or releases one change. */
  onHold: (change: string) => void;
  touched?: Touched;
  arrivals?: readonly TimelineEvent[];
  /** What the page reads as of: a new one redraws the grid at once, unanimated. */
  moment?: string;
  now: number;
}

export function Cards({
  changes,
  sessions,
  byKey,
  onChange,
  hover,
  onHover,
  held,
  onHold,
  touched,
  arrivals = NONE,
  moment,
  now,
}: CardsProps) {
  // the held changes are out of the grid and out of its counts: they stand above it
  const live = cardRows(groupsOf({ changes: changes.filter((c) => !held.has(c.key)), sessions }));
  const grip = useHold();
  const { shown } = useHeldList(live, grip.held, rowKey, (k): CardRow | undefined => {
    const row = live.find((r) => r.key === k);
    if (row || !k.startsWith('c:')) return row;
    const change = changes.find((c) => c.key === k.slice(2));
    return change ? { key: k, kind: 'card', change } : undefined;
  });
  // a held card is lifted out whatever the grid holds still with: a hold that began before the lift still shows it
  const rows = shown.filter((r) => r.kind !== 'card' || !held.has(r.change.key));
  const free = unbound(sessions);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ol
        key={moment}
        aria-label="Changes in motion"
        className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3"
        {...grip.props}
      >
        <AnimatePresence initial={false} custom={held}>
          {rows.map((r) => (
            <m.li
              key={r.key}
              {...liveItem}
              layoutId={r.kind === 'card' ? `card:${r.change.key}` : undefined}
              // a card leaving for the held row goes at once, so the lifted copy alone carries the shared layout
              // motion up to its slot; anything else leaving fades where it stands
              variants={{
                gone: (h: ReadonlySet<string>) => (r.kind === 'card' && h.has(r.change.key) ? LIFTED : GONE),
              }}
              exit="gone"
              className={cn('min-w-0', r.kind === 'head' && 'col-span-full pt-2 first:pt-0')}
            >
              {r.kind === 'head' ? (
                <Heading row={r} />
              ) : (
                <MotionCard
                  change={r.change}
                  byKey={byKey}
                  hot={hover === r.change.key}
                  onHover={onHover}
                  onHold={() => onHold(r.change.key)}
                  outlined={touched?.change === r.change.key}
                  arrival={lastArrival(arrivals, r.change.key, onChange)}
                  now={now}
                />
              )}
            </m.li>
          ))}
        </AnimatePresence>
      </ol>
      {free.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 self-start text-left text-xs text-ink-muted hover:text-ink"
          >
            <ChevronRight aria-hidden="true" className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            {plural(free.length, 'session')} on no change yet
          </button>
          {open && (
            <ul className="flex flex-wrap gap-1.5 pl-5">
              {free.map((s) => (
                <li key={s.key}>
                  <SessionPill session={s} now={now} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const rowKey = (r: CardRow) => r.key;

function Heading({ row }: { row: Extract<CardRow, { kind: 'head' }> }) {
  const tone =
    row.count === 0
      ? undefined
      : row.state === 'working'
        ? TONE.live.text
        : row.state === 'review'
          ? TONE.waits.text
          : row.state === 'blocked'
            ? TONE.alarm.text
            : undefined;
  return (
    <div className="flex items-center gap-2">
      <Label className={tone}>{row.label}</Label>
      <span className="text-meta text-ink-faint">{row.words}</span>
    </div>
  );
}

/** One change's card. The name is the link and stretches over the card; the pills and the hold button stand above
 *  it, so no control is nested in a link. */
export function MotionCard({
  change: c,
  byKey,
  hot,
  held,
  onHover,
  onHold,
  outlined,
  arrival,
  now,
  className,
}: {
  change: BridgeMotion;
  byKey: ReadonlyMap<string, BridgeSession>;
  /** Under the pointer, here or on one of its ticks. */
  hot?: boolean;
  /** Lifted under the transport, the transport filtered to it. */
  held?: boolean;
  onHover?: (change: string | undefined) => void;
  onHold: () => void;
  /** The event the page is locked on touched it. */
  outlined?: boolean;
  arrival?: TimelineEvent;
  now: number;
  className?: string;
}) {
  const on = c.sessions.map((k) => byKey.get(k)).filter((s): s is BridgeSession => !!s);
  const working = on.find((s) => s.state === 'working');
  const words = stepWords(c);
  const tone = statusTone(c.status);
  return (
    <div
      onPointerEnter={onHover && (() => onHover(c.key))}
      onPointerLeave={onHover && (() => onHover(undefined))}
      className={cn(
        'relative flex h-full flex-col gap-1.5 overflow-hidden rounded-card border bg-surface px-3.5 py-3 transition-colors',
        hot || held ? 'border-primary bg-raised' : 'border-line hover:bg-raised',
        hot && !held && 'ring-2 ring-primary/25',
        outlined && OUTLINE,
        className,
      )}
    >
      {arrival && <Wash arrival={arrival.seq} className={eventTone(arrival).wash} />}
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            working ? cn(TONE.live.bg, 'shadow-[0_0_0_3px] shadow-live/25') : tone.bg,
          )}
        />
        <Link
          to="/change/$"
          params={{ _splat: restOf(c.key) }}
          search={{}}
          className="min-w-0 flex-1 truncate font-medium after:absolute after:inset-0 after:content-['']"
        >
          {c.name ?? c.gist ?? short(c.key)}
        </Link>
        <StatusChip status={c.status} className="shrink-0" />
        <span className="shrink-0 text-meta text-ink-faint tabular-nums">{agoWords(c.last, now)}</span>
        <button
          type="button"
          aria-pressed={!!held}
          aria-label={held ? 'Release the transport' : 'Hold the transport on this change'}
          title={held ? 'Release' : 'Hold the transport on this change'}
          onClick={onHold}
          className={cn(
            'relative z-[1] grid size-7 shrink-0 place-items-center rounded-row border transition-colors',
            held
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-transparent text-ink-faint hover:border-line hover:bg-surface hover:text-ink',
          )}
        >
          <Pin className="size-3.5" />
        </button>
      </div>
      {c.steps.total > 0 && <Steps done={c.steps.done} total={c.steps.total} active={c.step?.state === 'active'} />}
      <span className="line-clamp-2 text-xs">
        <Label className="mr-1.5">{words.lead}</Label>
        {words.text}
      </span>
      {c.step?.note && c.step.state !== 'open' && (
        <span className="line-clamp-1 text-xs text-ink-muted">{c.step.note}</span>
      )}
      <div className="relative z-[1] mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
        {on.length === 0 ? (
          <span className="text-meta text-ink-faint">no session yet</span>
        ) : (
          on.slice(0, 3).map((s) => <SessionPill key={s.key} session={s} now={now} />)
        )}
        {on.length > 3 && <span className="text-meta text-ink-faint">+{on.length - 3}</span>}
        {c.path.length > 0 && (
          <span
            className="ml-auto min-w-0 truncate text-meta text-ink-faint"
            title={c.path.map((f) => f.name).join(' › ')}
          >
            {c.path.map((f) => f.name).join(' › ')}
          </span>
        )}
      </div>
    </div>
  );
}

/** The plan as a bar: a segment per step that counts, done ones green, the active one the accent. A plan longer than
 *  the bar can show is drawn to scale: the done share in green, the active step the next segment. */
function Steps({ done, total, active }: { done: number; total: number; active: boolean }) {
  const segments = Math.min(total, 24);
  const doneSegments = total > segments ? Math.round((done / total) * segments) : done;
  const activeAt = active && done < total ? Math.min(doneSegments, segments - 1) : -1;
  return (
    <div className="flex items-center gap-1.5" aria-label={`${done} of ${total} steps done`}>
      <div className="flex min-w-0 flex-1 gap-[3px]">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'h-[3px] flex-1 rounded-full',
              i === activeAt ? 'bg-primary' : i < doneSegments ? TONE.done.bg : 'bg-line-strong',
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-[10.5px] text-ink-faint tabular-nums">
        {done} of {total}
      </span>
    </div>
  );
}

/** A session as a pill: its state's dot, who and what it is doing; it opens the session's page. */
export function SessionPill({ session: s, now }: { session: BridgeSession; now: number }) {
  return (
    <Link
      to="/session/$id"
      params={{ id: restOf(s.key) }}
      search={{}}
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1.5 rounded-chip border px-1.5 text-meta whitespace-nowrap hover:bg-raised',
        s.state === 'working' ? cn(TONE.live.line, 'text-ink') : 'border-line text-ink-muted',
      )}
      aria-label={`Open the session: ${pillWords(s, now)}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          sessionDot(s.state),
          s.state === 'working' && 'shadow-[0_0_0_2px] shadow-live/25',
        )}
      />
      <span className="truncate">{pillWords(s, now)}</span>
    </Link>
  );
}

export { SESSION };
