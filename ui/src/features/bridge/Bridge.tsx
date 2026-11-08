// The bridge's content (decision bridge-rework/cards-and-transport): under the transport, which the route draws and
// which is the bridge's one timeline, a line that says what the page holds, the held cards when any are held
// (decision held-card-lifts: lifted out of the grid into a row here, beside the words that name them and release
// them; several may be held at once and the transport shows the union of their writes), then the changes in motion
// as cards. Held at a moment, the line says which. Nothing here decides: the bridge orients and explores, deciding
// happens in the dock.
import { cn } from 'cn';
import { AnimatePresence, m } from 'motion/react';
import { useMemo } from 'react';
import type { Bridge as BridgeData, TimelineEvent } from '@/data/contract';
import { momentWords } from '@/features/moment';
import { plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { MOVE } from '@/lib/motion';
import { useFresh } from '@/state/arrivals';
import { useAt, useCursor, useResolved } from '@/state/moment';
import { TONE } from '@/lib/tones';
import { Cards, MotionCard, type Touched } from './Cards';
import { allSessions, lastArrival, sessionChanges } from './model';

export function Bridge({
  data,
  product,
  productName,
  events,
  now,
  hover,
  onHover,
  held,
  onHold,
  onRelease,
  touched,
}: {
  data: BridgeData;
  product: string;
  productName: string;
  /** The transport's events, for what arrived live. */
  events: readonly TimelineEvent[];
  now: number;
  hover?: string;
  onHover: (change: string | undefined) => void;
  /** The changes held, in the order held. */
  held: readonly string[];
  /** Holds or releases one change. */
  onHold: (change: string) => void;
  /** Releases every held change. */
  onRelease: () => void;
  touched?: Touched;
}) {
  const working = data.sessions.filter((s) => s.state === 'working').length;
  const cursor = useCursor();
  const resolved = useResolved();
  const at = cursor.at || cursor.event ? momentWords(cursor, resolved) : undefined;
  // what arrived live a moment ago, which a card washes; at a held moment nothing on the page is arriving
  const fresh = useFresh();
  const arrivals = at ? [] : events.filter((e) => fresh(e.seq));
  const moment = `${product}|${useAt() ?? 'now'}`;
  const byKey = useMemo(() => allSessions(data.sessions), [data.sessions]);
  const onChange = useMemo(() => sessionChanges(data.sessions), [data.sessions]);
  const heldSet = useMemo(() => new Set(held), [held]);
  const heldChanges = held.map((k) => data.changes.find((c) => c.key === k));
  const names = heldChanges.map((c, i) => (c ? (c.name ?? c.title ?? short(c.key)) : short(held[i]!)));
  return (
    <div className="flex flex-col gap-4 p-4 md:p-5" data-scroll-restoration-id="bridge">
      <h2 className="sr-only">Bridge</h2>
      <p className="text-meta text-ink-faint">
        {at && <span className={cn('font-medium', TONE.waits.text)}>{at[0]!.toUpperCase() + at.slice(1)} · </span>}
        {plural(data.changes.length, 'change')} in motion across {productName} in the last{' '}
        {data.days === 1 ? 'day' : plural(data.days, 'day')} · {plural(data.sessions.length, 'session')}
        {working ? ` · ${working} working` : ''}
        {hover && !heldSet.has(hover) ? ' · its writes are lit above' : ''}
      </p>
      {held.length > 0 && (
        <section aria-label="Held changes" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            <span className="text-meta font-medium tracking-wide text-primary uppercase">Held</span>
            <span className="text-ink-muted">
              the transport shows only the writes to{' '}
              {names.map((n, i) => (
                <span key={held[i]}>
                  {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
                  <span className="font-medium text-ink">{n}</span>
                </span>
              ))}
              {heldChanges.some((c) => !c) ? ' · nothing of one of them in the window' : ''}
            </span>
            <button
              type="button"
              onClick={onRelease}
              className="rounded-chip border border-line px-2 py-0.5 text-meta text-ink-muted hover:bg-raised hover:text-ink"
            >
              {held.length > 1 ? 'Release all' : 'Release'}
            </button>
          </div>
          <ol aria-label="Held cards" className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {heldChanges.map(
                (c) =>
                  c && (
                    <m.li
                      key={c.key}
                      layout="position"
                      layoutId={`card:${c.key}`}
                      // it arrives by the shared layout motion from its place in the grid, and leaves at once so the
                      // grid's returning copy alone is seen
                      initial={false}
                      exit={{ opacity: 0, transition: { duration: 0 } }}
                      transition={MOVE}
                      className="min-w-0"
                    >
                      <MotionCard
                        change={c}
                        byKey={byKey}
                        held
                        hot={hover === c.key}
                        onHover={onHover}
                        onHold={() => onHold(c.key)}
                        outlined={touched?.change === c.key}
                        arrival={lastArrival(arrivals, c.key, onChange)}
                        now={now}
                      />
                    </m.li>
                  ),
              )}
            </AnimatePresence>
          </ol>
        </section>
      )}
      <Cards
        changes={data.changes}
        sessions={data.sessions}
        byKey={byKey}
        onChange={onChange}
        hover={hover}
        onHover={onHover}
        held={heldSet}
        onHold={onHold}
        touched={touched}
        arrivals={arrivals}
        moment={moment}
        now={now}
      />
    </div>
  );
}
