// The change at its row depth (decision feature-detail/change-at-three-depths): the card's first line, drawn inside a
// tree under the change's most specific node. Status dot (breathing while a session is on it), name, status word,
// an amber dot when a decision waits, the milestone it belongs to, the live session's pill, the last touch, and the
// hold button. Lit and dimmed by the hold (decision hold-lights-the-map): a held row wears a steady ring, and while
// anything is held the rows not on a held path dim.
import { cn } from 'cn';
import { agoWords } from '@/lib/format';
import { StatusChip } from '@/components/chips/Chip';
import { statusTone, TONE, workingDot } from '@/lib/tones';
import { isWorking, nameOf, type ChangeFacts } from './model';
import { HoldButton, MilestoneChip } from './MotionCard';
import { SessionPill } from './SessionPill';

export function ChangeLine({
  change: c,
  held,
  lit,
  dim,
  onHover,
  onHold,
  now,
  className,
}: {
  change: ChangeFacts;
  /** Held: the ring, the pressed pin. */
  held?: boolean;
  /** Lit by a hover or a hold elsewhere: the ring without the pressed pin. */
  lit?: boolean;
  /** Something else is held and this is not on its path. */
  dim?: boolean;
  onHover?: (change: string | undefined) => void;
  onHold?: () => void;
  now: number;
  className?: string;
}) {
  const working = isWorking(c);
  const live = c.sessions.find((s) => s.state === 'working');
  return (
    <div
      onPointerEnter={onHover && (() => onHover(c.key))}
      onPointerLeave={onHover && (() => onHover(undefined))}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-row pr-1 transition-opacity',
        (held || lit) && 'ring-1 ring-primary ring-inset',
        working && !held && !lit && TONE.live.soft,
        dim && 'opacity-45',
        className,
      )}
      title={c.title}
    >
      <span aria-hidden="true" className={cn('ml-1 size-2 shrink-0 rounded-full', working ? workingDot : statusTone(c.status).bg)} />
      <span className="min-w-0 truncate font-medium">{nameOf(c)}</span>
      <StatusChip status={c.status} className="shrink-0" />
      {c.waiting > 0 && (
        <span
          role="img"
          aria-label={`${c.waiting} waiting on you`}
          title={`${c.waiting} waiting on you`}
          className={cn('size-[7px] shrink-0 rounded-full', TONE.waits.bg)}
        />
      )}
      {c.parent && <MilestoneChip name={c.parent.name} className="hidden md:inline-flex" />}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {live && <SessionPill session={live} now={now} className="hidden lg:inline-flex" />}
        {c.last && <span className="text-meta text-ink-faint tabular-nums">{agoWords(c.last, now)}</span>}
        {onHold && <HoldButton held={!!held} onHold={onHold} className="size-6" />}
      </span>
    </div>
  );
}
