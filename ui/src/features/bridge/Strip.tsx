// The need strip: what waits on the person first, at the grain of the decision (one card per change with a decision
// proposed, each proposed decision a block on it, and the session on that change folded into the card when one is in
// the window), then the sessions by state. A session card is its state, the change it is on and the feature path
// above it, its last line and when, the next it left; its subagents are a count on it, never rows. A card with a
// session opens that session's dock, which adopts the session for the tab; one without opens the change. At desktop
// the strip is the bridge's command panel beside the stage; until the stage exists it stands alone.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import type { BridgeChange, BridgeSession, Lens, SessionState, WaitingChange, WaitingDecision } from '@/data/contract';
import { plural } from '@/lib/format';
import { restOf, short } from '@/lib/keys';
import { Label, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { cardWhen, proposedWhen, strip, subagentWords, type WaitItem } from './model';

const DOT: Record<SessionState, string> = {
  working: 'bg-live shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_25%,transparent)]',
  waiting: 'bg-status-review',
  stopped: 'bg-ink-muted',
  ended: 'bg-ink-faint',
};

const EMPTY: Record<SessionState, string> = {
  waiting: 'Nothing waits on you.',
  stopped: 'No session stopped with a next set.',
  working: 'No session is working now.',
  ended: 'No session ended today with its work in review.',
};

/** What the event the page is locked on touched: the session that wrote it, the change it wrote or decided on. */
export interface Touched {
  session?: string;
  change?: string;
}

/** A card the locked event touched is outlined. */
const isTouched = (t: Touched | undefined, session?: BridgeSession, change?: BridgeChange): boolean =>
  !!t && ((!!t.session && t.session === session?.key) || (!!t.change && t.change === change?.key));

const OUTLINE = 'ring-2 ring-primary ring-offset-2 ring-offset-ground';

export function Strip({
  waitingOn,
  sessions,
  lens,
  touched,
  className,
}: {
  waitingOn: readonly WaitingChange[];
  sessions: readonly BridgeSession[];
  lens: Lens;
  touched?: Touched;
  className?: string;
}) {
  const { waits, groups } = strip({ waitingOn, sessions });
  const decisions = waits.reduce((n, w) => n + w.proposed.length, 0);
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <Section
        label="Waits on you"
        tone={waits.length > 0 ? 'text-status-review' : undefined}
        words={
          waits.length > 0
            ? `${plural(decisions, 'decision')} on ${plural(waits.length, 'change')} · newest first`
            : 'none'
        }
        empty={EMPTY.waiting}
        items={waits.map((w) => (
          <WaitCard key={w.change.key} item={w} lens={lens} touched={touched} />
        ))}
      />
      {groups.map((g) => (
        <Section
          key={g.state}
          label={g.label}
          tone={g.sessions.length > 0 && g.state === 'working' ? 'text-live' : undefined}
          words={
            g.sessions.length > 0
              ? `${plural(g.sessions.length, 'session')}${g.sessions.length > 1 ? ' · by last write' : ''}`
              : 'none'
          }
          empty={EMPTY[g.state]}
          items={g.sessions.map((s) => (
            <SessionCard key={s.key} session={s} lens={lens} touched={touched} />
          ))}
        />
      ))}
    </div>
  );
}

function Section({
  label,
  tone,
  words,
  empty,
  items,
}: {
  label: string;
  tone?: string;
  words: string;
  empty: string;
  items: ReactNode[];
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <div className="flex items-center gap-2">
        <Label className={tone}>{label}</Label>
        <span className="text-meta text-ink-faint">{words}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-ink-faint">{empty}</div>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The frame every card shares: a link to the session's dock when there is a session, else to the change. */
function CardFrame({
  session,
  change,
  lens,
  className,
  children,
}: {
  session?: BridgeSession;
  change?: BridgeChange;
  lens: Lens;
  className?: string;
  children: ReactNode;
}) {
  const frame = cn('flex flex-col gap-1.5 rounded-card border bg-surface px-3.5 py-3 hover:bg-raised', className);
  if (session)
    return (
      <Link
        to="/session/$id"
        params={{ id: restOf(session.key) }}
        search={{}}
        className={frame}
        aria-label={`Open the session on ${change ? (change.title ?? short(change.key)) : 'no change yet'}`}
      >
        {children}
      </Link>
    );
  if (change)
    return (
      <NodeLink to={change.key} lens={lens} className={frame}>
        {children}
      </NodeLink>
    );
  return <div className={frame}>{children}</div>;
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

/** One proposed decision on a card: its title, its recommendation clamped, when it was proposed. */
function DecideBlock({ decision: d }: { decision: WaitingDecision }) {
  return (
    <span className="flex flex-col gap-1 rounded-row bg-status-review/10 px-2.5 py-2 text-xs">
      <span className="flex items-start gap-2">
        <Label className="mt-px shrink-0 text-status-review">decide</Label>
        <span className="line-clamp-2 min-w-0 font-medium text-ink">{d.title ?? short(d.key)}</span>
      </span>
      {d.decision && <span className="line-clamp-2 text-ink-muted">{d.decision}</span>}
      <span className="text-meta text-ink-faint">{proposedWhen(d.created)}</span>
    </span>
  );
}

/** A change with decisions proposed on it, doubling as the card of the session on it when one is in the window. */
export function WaitCard({ item, lens, touched }: { item: WaitItem; lens: Lens; touched?: Touched }) {
  const { change, proposed, session } = item;
  return (
    <CardFrame
      session={session}
      change={change}
      lens={lens}
      className={cn('border-status-review/60', isTouched(touched, session, change) && OUTLINE)}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', session ? DOT[session.state] : DOT.waiting)}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{change.title ?? short(change.key)}</span>
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
export function SessionCard({ session: s, lens, touched }: { session: BridgeSession; lens: Lens; touched?: Touched }) {
  const title = s.change ? (s.change.title ?? short(s.change.key)) : 'No change yet';
  return (
    <CardFrame
      session={s}
      change={s.change}
      lens={lens}
      className={cn('border-line', s.state === 'ended' && 'opacity-70', isTouched(touched, s, s.change) && OUTLINE)}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[s.state])} />
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
