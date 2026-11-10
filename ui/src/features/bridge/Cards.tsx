// The changes in motion as cards (decision bridge-rework/cards-and-transport): one grid, three across at desktop
// width and one across docked, the groups' headings spanning it, so a card that changes group slides there as one
// motion (change:motion-design). The card itself is the change component at its card depth (components/change,
// decision feature-detail/change-at-three-depths), the same card the map's panel draws. The card opens the change; a
// pill opens its session; the hold button (decision hold-is-a-button) holds the transport on the change and lifts the
// card out of the grid (decision held-card-lifts), so a held card is drawn by the bridge above the grid, not here.
// Under the pointer a card lights its writes on the transport; a tick under the pointer lights its card. Under the
// pointer or keyboard focus the grid holds still (lib/hold); a card a live event touched washes in its colour.
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import type { BridgeMotion, BridgeSession, TimelineEvent } from '@/data/contract';
import { plural } from '@/lib/format';
import { useHeldList, useHold } from '@/lib/hold';
import { EXIT, liveItem } from '@/lib/motion';
import { Label } from '@/components/chips/Chip';
import { factsOfMotion } from '@/components/change/model';
import { MotionCard } from '@/components/change/MotionCard';
import { SessionPill } from '@/components/change/SessionPill';
import { SESSION, TONE } from '@/lib/tones';
import { cardRows, groupsOf, lastArrival, namedUnbound, unbound, type CardRow } from './model';

/** What the event the page is locked on touched: the change it wrote or decided on. */
export interface Touched {
  change?: string;
}

const NONE: readonly TimelineEvent[] = [];
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
  // a session named on no change (a review, a backlog pass) has its own row, titled with its name; the unnamed stay
  // folded, since a fresh session binds soon (change:unbound-sessions)
  const named = namedUnbound(sessions);
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
                  change={factsOfMotion(r.change, byKey)}
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
      {named.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label="Sessions on no change, named">
          <div className="flex items-center gap-2">
            <Label>On no change</Label>
            <span className="text-meta text-ink-faint">
              {plural(named.length, 'named session')}: a review, a backlog pass, a chat
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {named.map((s) => (
              <li key={s.key} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2">
                <span className="min-w-0 truncate text-xs font-medium">{s.name}</span>
                {s.kind && <Label className="shrink-0">{s.kind}</Label>}
                <SessionPill session={s} now={now} className="ml-auto" />
              </li>
            ))}
          </ul>
        </section>
      )}
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

export { MotionCard, SessionPill, SESSION };
