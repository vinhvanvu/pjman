// The Milestones destination (decision milestone-detail/milestones-on-the-rail): the product's milestones in flight,
// nearest to done first, each a card with its ring, name and status, gist, the figures line (children done, who is on
// it now, the target; what waits and what is blocked in their colours) and the child in work or the next one; the done
// milestones folded under one line at the foot, latest first. A card opens the milestone's page. Every card in a row
// stands the same height: each fills its cell and draws the same lines, a gist and a next line, even when empty. A
// milestone beneath another is a stage of it (decision nested-milestones/index-layout): never a card of its own, drawn
// inside its parent's card, which spans the row, as a line each (ring, name, status, what waits, the next child), the
// done stages folded under one line.
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { Lens, Scope } from '@/data/contract';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { Ring } from '@/components/stats/Ring';
import { agoWords, plural } from '@/lib/format';
import { statusTone, TONE } from '@/lib/tones';
import { indexLine, milestonesIndex, stagesFold, type MilestoneIndexRow } from './model';

export function MilestonesIndex({ scope, lens, className }: { scope: Scope; lens: Lens; className?: string }) {
  const { inFlight, done } = milestonesIndex(scope);
  const [doneOpen, setDoneOpen] = useState(false);
  if (inFlight.length === 0 && done.length === 0)
    return (
      <EmptyState
        title="No milestones yet."
        hint="A change with children is a milestone; file one with a parent and it appears here."
        className={cn('m-6', className)}
      />
    );
  return (
    <div className={cn('flex flex-col gap-4 px-7 py-5', className)}>
      <p className="text-xs text-ink-faint">
        {plural(inFlight.length, 'milestone')} in flight, nearest to done first
        {done.length ? ` · ${done.length} done` : ''}
      </p>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(400px,1fr))]">
        {inFlight.map((m) => (
          <li key={m.key} className={cn('flex', m.stages.length > 0 && 'col-span-full')}>
            <MilestoneCard m={m} lens={lens} />
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((v) => !v)}
            className="flex items-center gap-2 py-1 text-left text-xs text-ink-faint hover:text-ink"
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform duration-200', doneOpen && 'rotate-90')}
              aria-hidden="true"
            />
            {doneOpen
              ? 'fold the done'
              : `${done.length} done · ${done
                  .slice(0, 5)
                  .map((m) => m.name)
                  .join(', ')}${done.length > 5 ? ` and ${done.length - 5} more` : ''}`}
          </button>
          {doneOpen && (
            <ul className="flex flex-col">
              {done.map((m) => (
                <li key={m.key} className="flex items-center gap-2 py-1.5 text-body text-ink-muted">
                  <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', TONE.done.bg)} />
                  <NodeLink to={m.key} lens={lens} mode="focus" className="min-w-0 truncate hover:text-primary">
                    {m.name}
                  </NodeLink>
                  <span className="text-meta text-ink-faint">
                    {m.progress.done} of {m.progress.total}
                  </span>
                  {m.moved && <span className="ml-auto text-[11px] text-ink-faint">{agoWords(m.moved)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** One milestone in flight: the ring, the name with its status and when it last moved, the gist, the figures, and
 *  the child in work or the next one; its stages beneath, when it has any. */
function MilestoneCard({ m, lens }: { m: MilestoneIndexRow; lens: Lens }) {
  const line = indexLine(m);
  const tone = statusTone(m.status);
  return (
    <div className="flex flex-1 flex-col rounded-card border border-line bg-surface hover:border-line-strong">
      <NodeLink
        to={m.key}
        lens={lens}
        mode="focus"
        className="grid flex-1 grid-cols-[56px_minmax(0,1fr)] gap-x-4 px-4 py-4"
      >
        <Ring done={m.progress.done} total={m.progress.total} size={56} stroke={4}>
          <span className="text-[12px] font-semibold tabular-nums">
            {m.progress.total ? Math.round((m.progress.done / m.progress.total) * 100) : 0}%
          </span>
        </Ring>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            {m.live > 0 && <Pulse className="size-[7px]" />}
            <span className="min-w-0 truncate text-[15px] font-semibold">{m.name}</span>
            <span className={cn('shrink-0 text-meta font-medium', tone.text)}>{m.status}</span>
            {m.moved && <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{agoWords(m.moved)}</span>}
          </div>
          <p className="line-clamp-1 min-h-[1.5em] text-body text-ink-muted">
            {m.gist && m.gist !== m.name ? m.gist : ''}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-muted">
            {line.parts.map((p, i) => (
              <span key={i}>
                {i > 0 && <span className="text-ink-faint">· </span>}
                {p}
              </span>
            ))}
            {line.waits && (
              <span className={cn('font-semibold', TONE.waits.text)}>
                <span className="font-normal text-ink-faint">· </span>
                {line.waits}
              </span>
            )}
            {line.blocked && (
              <span className={TONE.alarm.text}>
                <span className="text-ink-faint">· </span>
                {line.blocked}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[12.5px]">
            {m.next ? (
              <>
                <span className="text-ink-faint">{m.next.live ? 'working now · ' : 'next · '}</span>
                {m.next.name}
              </>
            ) : (
              <span className="text-ink-faint">every child done</span>
            )}
          </p>
        </div>
      </NodeLink>
      {m.stages.length > 0 && <Stages stages={m.stages} lens={lens} />}
    </div>
  );
}

/** A milestone's stages inside its card: a line each for the ones not done, in its order, the done folded under one
 *  line that opens in place. */
function Stages({ stages, lens }: { stages: MilestoneIndexRow[]; lens: Lens }) {
  const { shown, done } = stagesFold(stages);
  const [doneOpen, setDoneOpen] = useState(false);
  return (
    <div className="flex flex-col border-t border-line px-4 py-2">
      <p className="py-1 text-xs text-ink-faint">
        {plural(stages.length, 'stage')} · {shown.length} in flight
      </p>
      {done.length > 0 && (
        <button
          type="button"
          aria-expanded={doneOpen}
          onClick={() => setDoneOpen((v) => !v)}
          className="flex items-center gap-2 py-1 text-left text-xs text-ink-faint hover:text-ink"
        >
          <ChevronRight
            className={cn('size-3.5 shrink-0 transition-transform duration-200', doneOpen && 'rotate-90')}
            aria-hidden="true"
          />
          {doneOpen ? 'fold the done' : `${done.length} done · ${done.map((d) => d.name).join(', ')}`}
        </button>
      )}
      <ul className="flex flex-col">
        {[...(doneOpen ? done : []), ...shown].map((st) => (
          <li key={st.key}>
            <StageLine st={st} lens={lens} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One stage: its ring, its name and status, what waits and what is blocked beneath it, the child in work or the next. */
function StageLine({ st, lens }: { st: MilestoneIndexRow; lens: Lens }) {
  const line = indexLine(st);
  return (
    <NodeLink
      to={st.key}
      lens={lens}
      mode="focus"
      className="grid grid-cols-[16px_minmax(0,14rem)_auto_minmax(0,1fr)] items-center gap-x-2.5 rounded py-1.5 text-body hover:text-primary"
    >
      <Ring done={st.progress.done} total={st.progress.total} size={16} stroke={2.5} />
      <span className="flex min-w-0 items-center gap-1.5">
        {st.live > 0 && <Pulse className="size-[6px]" />}
        <span className="truncate">{st.name}</span>
      </span>
      <span className="flex items-center gap-2 text-meta">
        <span className={cn('font-medium', statusTone(st.status).text)}>{st.status}</span>
        {st.progress.total > 0 && (
          <span className="tabular-nums text-ink-faint">
            {st.progress.done} of {st.progress.total}
          </span>
        )}
        {line.waits && <span className={cn('font-semibold', TONE.waits.text)}>{line.waits}</span>}
        {line.blocked && <span className={TONE.alarm.text}>{line.blocked}</span>}
      </span>
      <span className="truncate text-[12.5px] text-ink-faint">
        {st.next ? `${st.next.live ? 'working now' : 'next'} · ${st.next.name}` : ''}
      </span>
    </NodeLink>
  );
}
