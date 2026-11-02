// The need strip: what waits on the person first, at the grain of the decision (one card per change with a decision
// proposed, each proposed decision a block on it, and the session on that change folded into the card when one is in
// the window), then the sessions by state. A session card is its state, the change it is on and the feature path
// above it, its last line and when, the next it left; its subagents are a count on it, never rows. A card with a
// session opens that session's dock, which adopts the session for the tab; one without opens the change. At desktop
// the strip is the bridge's command panel beside the stage; until the stage exists it stands alone.
// It is alive (change:motion-design): the headings and cards are one list, so a card that changes group slides there;
// a card that arrives opens its space and fades in, one that leaves fades and then closes its space; a card a live
// event touched washes in that event's colour. Under the pointer or keyboard focus it holds still, every card in
// place while what it says keeps updating; leaving it, the strip settles. A new moment (a scrub, a step, another
// product) redraws it at once.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { AnimatePresence, m } from 'motion/react';
import type { ReactNode } from 'react';
import type { BridgeChange, BridgeSession, Lens, TimelineEvent, WaitingDecision } from '@/data/contract';
import { plural } from '@/lib/format';
import { useHeldList, useHold } from '@/lib/hold';
import { restOf, short } from '@/lib/keys';
import { liveItem, Wash } from '@/lib/motion';
import { Label, StatusChip } from '@/components/chips/Chip';
import { CopyKey } from '@/components/links/CopyKey';
import { DecideControl } from '@/components/decisions/DecideControl';
import { useDecideAction } from '@/data/queries';
import {
  cardWhen,
  lastArrival,
  proposedWhen,
  sessionRow,
  strip,
  stripRows,
  subagentWords,
  type StripRow,
  type WaitItem,
} from './model';
import { eventTone, SESSION, sessionDot, TONE } from '@/lib/tones';

/** What the event the page is locked on touched: the session that wrote it, the change it wrote or decided on. */
export interface Touched {
  session?: string;
  change?: string;
}

/** A card the locked event touched is outlined. */
const isTouched = (t: Touched | undefined, session?: BridgeSession, change?: BridgeChange): boolean =>
  !!t && ((!!t.session && t.session === session?.key) || (!!t.change && t.change === change?.key));

/** No arrivals: one array, so a card without any keeps a stable prop. */
const NONE: readonly TimelineEvent[] = [];

const OUTLINE = 'ring-2 ring-primary ring-offset-2 ring-offset-ground';

export function Strip({
  waitingOn,
  sessions,
  lens,
  touched,
  arrivals = NONE,
  moment,
  className,
}: {
  waitingOn: Parameters<typeof strip>[0]['waitingOn'];
  sessions: readonly BridgeSession[];
  lens: Lens;
  touched?: Touched;
  /** The events that arrived live a moment ago, oldest first; a card they touched washes in their colour. */
  arrivals?: readonly TimelineEvent[];
  /** What the page reads as of (the product and the cursor): a new one redraws the strip at once, unanimated. */
  moment?: string;
  className?: string;
}) {
  const live = stripRows(strip({ waitingOn, sessions }));
  const hold = useHold();
  // held, a card keeps its place but says what its session says now, wherever the session has moved to
  const { shown, pending } = useHeldList(live, hold.held, rowKey, (k) => {
    const row = live.find((r) => r.key === k);
    if (row || !k.startsWith('s:')) return row;
    const s = sessions.find((x) => x.key === k.slice(2));
    return s && sessionRow(s);
  });
  return (
    <div className={cn('relative', className)}>
      {hold.held && (
        <span
          className={cn(
            'absolute top-0 right-0 z-[1] rounded-chip px-2 py-0.5 text-meta font-medium',
            TONE.waits.soft,
            TONE.waits.text,
          )}
        >
          {pending ? `held · ${plural(pending, 'card')} to move` : 'held'}
        </span>
      )}
      <ol key={moment} aria-label="Sessions by need" className="flex flex-col" {...hold.props}>
        <AnimatePresence initial={false}>
          {shown.map((r) => (
            <m.li
              key={r.key}
              {...liveItem}
              className={cn('pb-2', r.kind === 'head' && r.key !== 'h:waiting' && 'pt-3')}
            >
              {r.kind === 'head' ? (
                <Heading row={r} />
              ) : r.kind === 'wait' ? (
                <WaitCard item={r.item} lens={lens} touched={touched} arrivals={arrivals} />
              ) : (
                <SessionCard session={r.session} lens={lens} touched={touched} arrivals={arrivals} />
              )}
            </m.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

const rowKey = (r: StripRow) => r.key;

function Heading({ row }: { row: Extract<StripRow, { kind: 'head' }> }) {
  const tone =
    row.count > 0 && row.state === 'waiting'
      ? TONE.waits.text
      : row.count > 0 && row.state === 'working'
        ? SESSION.working.text
        : undefined;
  return (
    <div className="flex items-center gap-2">
      <Label className={tone}>{row.label}</Label>
      <span className="text-meta text-ink-faint">{row.words}</span>
    </div>
  );
}

/** The frame every card shares: a link to the session's dock when there is a session, else to the change on the
 *  product map, on `tab` when one is named. The bridge has no record pane, so a change always opens on the map, never
 *  as a selection on the bridge. The last live event that touched the card washes over it. */
function CardFrame({
  session,
  change,
  tab,
  arrival,
  className,
  children,
}: {
  session?: BridgeSession;
  change?: BridgeChange;
  lens: Lens;
  tab?: 'decisions';
  arrival?: TimelineEvent;
  className?: string;
  children: ReactNode;
}) {
  const frame = cn(
    'relative flex flex-col gap-1.5 overflow-hidden rounded-card border bg-surface px-3.5 py-3 hover:bg-raised',
    className,
  );
  const wash = arrival && <Wash arrival={arrival.seq} className={eventTone(arrival).wash} />;
  if (session)
    return (
      <Link
        to="/session/$id"
        params={{ id: restOf(session.key) }}
        search={{}}
        className={frame}
        aria-label={`Open the session on ${change ? (change.title ?? short(change.key)) : 'no change yet'}`}
      >
        {wash}
        {children}
      </Link>
    );
  if (change)
    return (
      <Link to="/$lens/$" params={{ lens: 'feature', _splat: change.key }} search={{ tab }} className={frame}>
        {wash}
        {children}
      </Link>
    );
  return (
    <div className={frame}>
      {wash}
      {children}
    </div>
  );
}

/** The feature path above a change, then what the session last did, then its subagents. Plain words: the card
 *  around it is the link. */
function Meta({ change, session }: { change?: BridgeChange; session?: BridgeSession }) {
  const kids = session ? subagentWords(session.children) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-meta text-ink-faint">
      {change && change.path.length > 0 ? (
        <span className="truncate">{change.path.map((f) => f.name).join(' › ')}</span>
      ) : (
        <span className="truncate">{change ? 'no feature named' : 'binds a change when it names one'}</span>
      )}
      {session && (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{cardWhen(session)}</span>
        </>
      )}
      {kids && (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{kids}</span>
        </>
      )}
    </span>
  );
}

/** One proposed decision on a card: its name, its gist clamped, when it was proposed, Accept (when the thread
 *  recommends an option, or holds only one, so accepting from the card chooses nothing the person did not read). */
function DecideBlock({ decision: d }: { decision: WaitingDecision }) {
  const decide = useDecideAction('decide');
  const acceptable = !!d.recommended || d.options.length === 1;
  return (
    <span className={cn('flex flex-col gap-1 rounded-row px-2.5 py-2 text-xs', TONE.waits.soft)}>
      <span className="flex items-start gap-2">
        <Label className={cn('mt-px shrink-0', TONE.waits.text)}>decide</Label>
        <span className="line-clamp-2 min-w-0 font-medium text-ink">{d.name ?? d.title ?? short(d.key)}</span>
      </span>
      {d.name && d.title && <span className="line-clamp-2 text-ink-muted">{d.title}</span>}
      <span className="flex items-center gap-2 text-meta text-ink-faint">
        <span className="shrink-0">{proposedWhen(d.created)}</span>
        {decide && acceptable && <DecideControl decision={d.key} onConfirm={() => decide(d.key)} className="ml-auto" />}
        <CopyKey refKey={d.key} />
      </span>
    </span>
  );
}

/** A change with decisions proposed on it, doubling as the card of the session on it when one is in the window. */
export function WaitCard({
  item,
  lens,
  touched,
  arrivals = NONE,
}: {
  item: WaitItem;
  lens: Lens;
  touched?: Touched;
  arrivals?: readonly TimelineEvent[];
}) {
  const { change, proposed, session } = item;
  return (
    <CardFrame
      session={session}
      change={change}
      lens={lens}
      tab="decisions"
      arrival={lastArrival(arrivals, session, change)}
      className={cn(TONE.waits.line, isTouched(touched, session, change) && OUTLINE)}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', sessionDot(session ? session.state : 'waiting'))}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{change.name ?? change.title ?? short(change.key)}</span>
        {!session && change.status && <StatusChip status={change.status} />}
      </span>
      <Meta change={change} session={session} />
      {proposed.map((d) => (
        <DecideBlock key={d.key} decision={d} />
      ))}
      {session?.line && <span className="line-clamp-2 text-xs text-ink-muted">{session.line.text}</span>}
    </CardFrame>
  );
}

/** One session as the strip carries it. */
export function SessionCard({
  session: s,
  lens,
  touched,
  arrivals = NONE,
}: {
  session: BridgeSession;
  lens: Lens;
  touched?: Touched;
  arrivals?: readonly TimelineEvent[];
}) {
  const title = s.change ? (s.change.name ?? s.change.title ?? short(s.change.key)) : 'No change yet';
  return (
    <CardFrame
      session={s}
      change={s.change}
      lens={lens}
      arrival={lastArrival(arrivals, s, s.change)}
      className={cn('border-line', s.state === 'ended' && 'opacity-70', isTouched(touched, s, s.change) && OUTLINE)}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', sessionDot(s.state))} />
        <span className={cn('min-w-0 flex-1 truncate font-medium', !s.change && 'text-ink-muted')}>{title}</span>
        {s.change?.status && s.state === 'ended' && <StatusChip status={s.change.status} />}
      </span>
      <Meta change={s.change} session={s} />
      {s.line && <span className="line-clamp-2 text-xs text-ink-muted">{s.line.text}</span>}
      {s.state !== 'ended' && s.state !== 'working' && s.change?.next && (
        <span className="line-clamp-2 text-xs text-ink-muted">
          <Label className="mr-1.5">next</Label>
          {s.change.next}
        </span>
      )}
    </CardFrame>
  );
}
