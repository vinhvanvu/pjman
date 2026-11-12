// A milestone's children where a change has its plan (decision milestone-detail/children-in-order): in the
// milestone's order, what is behind the work (the done and the dropped) folded under one line at the top that opens
// in place, the child in work opened in place as its tree folded (its steps bar, the step the work stands on with its
// note, the decisions waiting on it as cards), the rest as rows with their status word, a blocked row carrying its
// reason, a child milestone its own small ring, the next child marked. Framed by a session (decision
// milestone-leads-the-dock) a tap on a row is a look at that child, the session page's pick; elsewhere a row links.
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ChangeContext, ChangeRow, Lens, LiveSession, WaitingDecision } from '@/data/contract';
import type { DecideAction } from '@/data/queries';
import { fromWaiting } from '@/components/decisions/model';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { Ring } from '@/components/stats/Ring';
import { Head, SegmentBar } from '@/features/change/ChangeTree';
import { agoWords } from '@/lib/format';
import { statusTone, TONE } from '@/lib/tones';
import { childrenFold, childrenHead, childrenInOrder, childSegments, stepSegments, type ChildView } from './model';

/** What the milestone's children are read against: the product's rows (the roadmap's scope with the done shown), the
 *  sessions beneath, the decisions waiting beneath, the child in work. */
export interface MilestoneFrame {
  rows: ReadonlyMap<string, ChangeRow>;
  sessions: readonly LiveSession[];
  waiting: readonly WaitingDecision[];
  /** The child in work, opened in place: the session's focus on the dock, the child a session is on elsewhere. */
  open?: string;
  /** Framed by a session: a tap on a row is a look at that child, without moving the session. */
  onPick?: (key: string) => void;
}

export function MilestoneChildren({
  ctx,
  lens,
  mode,
  wide,
  frame,
  working = false,
  decide,
  actor,
  linked,
  onLink,
  moment,
  held = false,
}: {
  ctx: ChangeContext;
  lens: Lens;
  mode: 'focus' | 'select';
  wide: boolean;
  frame: MilestoneFrame;
  /** The session framed by the milestone is working now: the open child's bar breathes. */
  working?: boolean;
  decide?: DecideAction;
  actor?: string;
  linked?: string;
  onLink?: (key: string | undefined) => void;
  moment?: string;
  held?: boolean;
}) {
  const [behindOpen, setBehindOpen] = useState(false);
  const list = childrenInOrder(ctx.children, frame.rows, frame.sessions, frame.waiting);
  const open = list.some((c) => c.key === frame.open && !c.behind) ? frame.open : undefined;
  const fold = childrenFold(list, open);
  return (
    <section className="flex flex-col gap-2.5">
      <Head label="Children" sum={childrenHead(list, open, fold.next)} />
      {list.length > 0 && (
        <SegmentBar segments={childSegments(list, open)} label={`Children: ${childrenHead(list)}`} working={working} />
      )}
      <div className="flex flex-col">
        {fold.sum && (
          <button
            type="button"
            aria-expanded={behindOpen}
            onClick={() => setBehindOpen((v) => !v)}
            className="flex items-center gap-2 py-1.5 text-left text-xs text-ink-faint hover:text-ink"
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform duration-200', behindOpen && 'rotate-90')}
              aria-hidden="true"
            />
            {behindOpen ? 'fold what is behind the work' : fold.sum}
          </button>
        )}
        {behindOpen &&
          fold.behind.map((c) => <ChildRow key={c.key} child={c} lens={lens} mode={mode} wide={wide} frame={frame} />)}
        {fold.shown.map((c) =>
          c.key === open ? (
            <OpenChild
              key={c.key}
              child={c}
              lens={lens}
              frame={frame}
              wide={wide}
              working={working}
              decide={decide}
              actor={actor}
              linked={linked}
              onLink={onLink}
              moment={moment}
              held={held}
            />
          ) : (
            <ChildRow
              key={c.key}
              child={c}
              lens={lens}
              mode={mode}
              wide={wide}
              frame={frame}
              next={c.key === fold.next}
            />
          ),
        )}
        {list.length === 0 && <span className="py-1.5 text-xs text-ink-faint">no children yet</span>}
      </div>
    </section>
  );
}

/** One child as a row (decision feature-detail/change-at-three-depths): the status dot, breathing when a session is
 *  on it; the name; the status word; an amber dot when a decision waits; a child milestone's ring; a blocked row's
 *  reason; the word next on the one to pick up; wide, the step the work stands on; when it last moved. */
function ChildRow({
  child: c,
  lens,
  mode,
  wide,
  frame,
  next = false,
}: {
  child: ChildView;
  lens: Lens;
  mode: 'focus' | 'select';
  wide: boolean;
  frame: MilestoneFrame;
  next?: boolean;
}) {
  const tone = statusTone(c.status);
  const name = <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>;
  return (
    <div
      className={cn(
        '-mx-2 flex min-h-[34px] items-center gap-2 rounded-row px-2 text-body hover:bg-raised',
        c.behind && 'text-ink-muted',
      )}
    >
      {c.live ? (
        <Pulse className="size-2" />
      ) : (
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', tone.bg)} />
      )}
      {frame.onPick ? (
        <button
          type="button"
          onClick={() => frame.onPick!(c.key)}
          className="flex min-w-0 flex-1 items-center text-left hover:text-primary"
          title={`Look at ${c.name}`}
        >
          {name}
        </button>
      ) : (
        <NodeLink to={c.key} lens={lens} mode={mode} className="flex min-w-0 flex-1 items-center hover:text-primary">
          {name}
        </NodeLink>
      )}
      {c.milestone ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-meta text-ink-faint">
          <Ring done={c.milestone.done} total={c.milestone.total} size={14} stroke={3} />
          {c.milestone.done} of {c.milestone.total}
        </span>
      ) : (
        <span className={cn('shrink-0 text-meta font-medium', tone.text)}>{c.status}</span>
      )}
      {c.waits > 0 && (
        <span aria-label="a decision waits on you" className={cn('size-1.5 shrink-0 rounded-full', TONE.waits.bg)} />
      )}
      {c.blockedOn && (
        <span className={cn('max-w-[40%] shrink truncate text-meta', TONE.alarm.text)} title={c.blockedOn}>
          waits on {c.blockedOn}
        </span>
      )}
      {next && (
        <span className={cn('shrink-0 text-[10.5px] font-semibold tracking-[.05em] uppercase', 'text-primary')}>
          next
        </span>
      )}
      {wide && c.plan?.total ? (
        <span className="hidden shrink-0 text-meta text-ink-faint md:inline">
          {c.plan.done} of {c.plan.total} steps
        </span>
      ) : null}
      {c.moved && <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{agoWords(c.moved)}</span>}
    </div>
  );
}

/** The child in work, opened in place: its row with the way to its page, its steps bar, the step the work stands on
 *  with its note, and the decisions waiting on it as cards. */
function OpenChild({
  child: c,
  lens,
  frame,
  wide,
  working,
  decide,
  actor,
  linked,
  onLink,
  moment,
  held,
}: {
  child: ChildView;
  lens: Lens;
  frame: MilestoneFrame;
  wide: boolean;
  working: boolean;
  decide?: DecideAction;
  actor?: string;
  linked?: string;
  onLink?: (key: string | undefined) => void;
  moment?: string;
  held: boolean;
}) {
  const segments = stepSegments(c);
  const waiting = frame.waiting.filter((d) => d.change === c.key).map(fromWaiting);
  return (
    <div className="-mx-2 my-1 flex flex-col gap-2 rounded-card bg-raised px-3 py-2.5">
      <div className="flex min-h-[28px] items-center gap-2 text-body">
        {c.live ? (
          <Pulse className="size-2" />
        ) : (
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', statusTone(c.status).bg)} />
        )}
        <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
        <span className={cn('shrink-0 text-meta', c.live ? cn('font-medium', TONE.live.text) : 'text-ink-faint')}>
          {c.live ? 'on now' : 'in work'}
        </span>
        <NodeLink
          to={c.key}
          lens={lens}
          mode="focus"
          className="inline-flex shrink-0 items-center gap-0.5 text-meta font-medium text-primary hover:underline"
        >
          Open the change
          <ChevronRight className="size-3" aria-hidden="true" />
        </NodeLink>
      </div>
      {segments.length > 0 && (
        <SegmentBar
          segments={segments}
          label={`Plan: ${c.plan!.done} of ${c.plan!.total} steps done`}
          working={working && c.live}
        />
      )}
      {c.step && (
        <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 size-3.5 rounded-full border-[1.5px] border-[var(--lane)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lane)_22%,transparent)]"
          />
          <div className="min-w-0">
            <div className="text-body leading-normal font-medium">{c.step.text}</div>
            {c.step.note && (
              <div className="mt-1 text-[12.5px] leading-normal text-ink-muted">
                {c.step.note}
                {c.moved && <span className="text-ink-faint"> · {agoWords(c.moved)}</span>}
              </div>
            )}
          </div>
        </div>
      )}
      {!c.step && !segments.length && <span className="text-xs text-ink-faint">no steps yet</span>}
      {waiting.length > 0 && (
        <DecisionGroup
          decisions={waiting}
          lens={lens}
          where="session"
          actor={actor}
          wide={wide}
          linked={linked}
          onLink={onLink}
          onDecide={decide}
          moment={moment}
          held={held}
        />
      )}
    </div>
  );
}
