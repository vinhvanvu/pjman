// The change at its card depth (decision feature-detail/change-at-three-depths), as the bridge draws it (decision
// bridge-rework/cards-and-transport): its name, status and last touch; a steps bar with done of total; the step the
// work stands on with its note; the sessions on it as pills, the live one marked; its feature path. The card opens
// the change; a pill opens its session; the hold button (decision hold-is-a-button) holds the timeline beside it on
// the change and lifts the card. Under the pointer the card lights its writes and its row on the map; a live change
// breathes (decision alive-on-the-map) and a held one wears a steady ring. `children` is a slot beneath the card's
// facts: the panel puts the decisions waiting on the change there.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { Flag, Pin } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TimelineEvent } from '@/data/contract';
import { agoWords } from '@/lib/format';
import { restOf } from '@/lib/keys';
import { Wash } from '@/lib/motion';
import { Label, StatusChip } from '@/components/chips/Chip';
import { eventTone, statusTone, TONE, workingDot } from '@/lib/tones';
import { isWorking, nameOf, stepWords, type ChangeFacts } from './model';
import { SessionPill } from './SessionPill';

const OUTLINE = 'ring-2 ring-primary ring-offset-2 ring-offset-ground';

export function MotionCard({
  change: c,
  hot,
  held,
  onHover,
  onHold,
  outlined,
  arrival,
  now,
  children,
  className,
}: {
  change: ChangeFacts;
  /** Under the pointer, here or on one of its ticks or its row. */
  hot?: boolean;
  /** Lifted, the timeline beside it filtered to it. */
  held?: boolean;
  onHover?: (change: string | undefined) => void;
  onHold?: () => void;
  /** The event the page is locked on touched it. */
  outlined?: boolean;
  arrival?: TimelineEvent;
  now: number;
  children?: ReactNode;
  className?: string;
}) {
  const working = isWorking(c);
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
        held && 'ring-1 ring-primary',
        working && !held && !hot && TONE.live.soft,
        outlined && OUTLINE,
        className,
      )}
    >
      {arrival && <Wash arrival={arrival.seq} className={eventTone(arrival).wash} />}
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', working ? workingDot : tone.bg)} />
        <Link
          to="/change/$"
          params={{ _splat: restOf(c.key) }}
          search={{}}
          className="min-w-0 flex-1 truncate font-medium after:absolute after:inset-0 after:content-['']"
        >
          {nameOf(c)}
        </Link>
        <StatusChip status={c.status} className="shrink-0" />
        {c.waiting > 0 && (
          <span
            aria-label={`${c.waiting} waiting on you`}
            title={`${c.waiting} waiting on you`}
            className={cn('size-[7px] shrink-0 rounded-full', TONE.waits.bg)}
          />
        )}
        {c.last && <span className="shrink-0 text-meta text-ink-faint tabular-nums">{agoWords(c.last, now)}</span>}
        {onHold && <HoldButton held={!!held} onHold={onHold} />}
      </div>
      {c.steps.total > 0 && (
        <Steps done={c.steps.done} total={c.steps.total} active={c.step?.state === 'active'} working={working} />
      )}
      <span className="line-clamp-2 text-xs">
        <Label className="mr-1.5">{words.lead}</Label>
        {words.text}
      </span>
      {c.step?.note && c.step.state !== 'open' && (
        <span className="line-clamp-1 text-xs text-ink-muted">{c.step.note}</span>
      )}
      <div className="relative z-[1] mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
        {c.sessions.length === 0 ? (
          <span className="text-meta text-ink-faint">no session yet</span>
        ) : (
          c.sessions.slice(0, 3).map((s) => <SessionPill key={s.key} session={s} now={now} />)
        )}
        {c.sessions.length > 3 && <span className="text-meta text-ink-faint">+{c.sessions.length - 3}</span>}
        {c.parent && <MilestoneChip name={c.parent.name} />}
        {c.path.length > 0 && (
          <span className="ml-auto min-w-0 truncate text-meta text-ink-faint" title={c.path.join(' › ')}>
            {c.path.join(' › ')}
          </span>
        )}
      </div>
      {children && <div className="relative z-[1] mt-1 flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}

/** The hold button: a faint pin, always visible so it works by touch; pressed, it fills with the primary. Above
 *  whatever link stretches under it, so a press never follows the link. */
export function HoldButton({ held, onHold, className }: { held: boolean; onHold: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={held}
      aria-label={held ? 'Release' : 'Hold on this change'}
      title={held ? 'Release' : 'Hold on this change'}
      onClick={(e) => {
        e.stopPropagation();
        onHold();
      }}
      className={cn(
        'relative z-[1] grid size-7 shrink-0 place-items-center rounded-row border transition-colors',
        held
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-transparent text-ink-faint hover:border-line hover:bg-surface hover:text-ink',
        className,
      )}
    >
      <Pin className="size-3.5" />
    </button>
  );
}

/** The milestone a change belongs to, as a chip with a flag. */
export function MilestoneChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex max-w-[180px] items-center gap-1 text-meta text-ink-faint', className)}
      title={`In the milestone ${name}`}
    >
      <Flag className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The plan as a bar: a segment per step that counts, done ones green, the active one the accent, breathing in the live
 *  colour while a session works the change (change:alive-step-bars, decision the-motion). A plan longer than the bar
 *  can show is drawn to scale: the done share in green, the active step the next segment. */
export function Steps({
  done,
  total,
  active,
  working = false,
}: {
  done: number;
  total: number;
  active: boolean;
  /** A session is working the change now. */
  working?: boolean;
}) {
  const segments = Math.min(total, 24);
  const doneSegments = total > segments ? Math.round((done / total) * segments) : done;
  const activeAt = active && done < total ? Math.min(doneSegments, segments - 1) : -1;
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`${done} of ${total} steps done${working && activeAt >= 0 ? ', a session working now' : ''}`}
    >
      <div className="flex min-w-0 flex-1 gap-[3px]">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'h-[3px] flex-1 rounded-full',
              i === activeAt
                ? working
                  ? 'working-segment'
                  : 'bg-primary'
                : i < doneSegments
                  ? TONE.done.bg
                  : 'bg-line-strong',
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
