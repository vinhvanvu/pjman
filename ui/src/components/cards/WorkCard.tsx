// The work card: a change as the person approaches it, carrying its asks (decisions to make, a review, a block). Two
// modes. `peek` (inside the record pane) opens in place on click: next in full, the asks with each decision readable,
// every feature it names with its verb, and an explicit open that navigates. `select` (inside a structure pane) is a
// link that selects the change, with the asks listed beneath the meta so the queue reads what is needed.
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { Lens, WaitingDecision } from '@/data/contract';
import { ago, truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { asksOf } from '@/lib/work';
import { Chip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { ChangeMeta, type ChangeMetaProps } from './ChangeCard';
import { CopyKey } from '@/components/links/CopyKey';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { fromWaiting } from '@/components/decisions/model';
import { TONE } from '@/lib/tones';

export interface WorkCardProps extends Omit<ChangeMetaProps, 'className' | 'allFeatures'> {
  lens: Lens;
  mode: 'peek' | 'select';
  /** Decides one of its proposed decisions in place; Accept is drawn only when it is given. */
  onDecide?: (decision: string) => Promise<unknown>;
  /** The proposed decisions on this change. */
  decisions?: WaitingDecision[];
  selected?: boolean;
  className?: string;
}

export function WorkCard({ row, lens, mode, decisions = [], onDecide, selected, className, ...meta }: WorkCardProps) {
  const [open, setOpen] = useState(false);
  const asks = asksOf(row, decisions.length);
  const moved = row.moved ?? row.created;
  const head = (
    <>
      <div className="flex items-start gap-2">
        {mode === 'peek' && (
          <ChevronRight
            className={cn('mt-[3px] size-3.5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
        )}
        <span className={cn('min-w-0 flex-1 font-medium leading-[1.35]', !open && 'line-clamp-2')}>
          {row.gist ?? short(row.key)}
        </span>
        {asks.length > 0 && (
          <span className="flex shrink-0 gap-1">
            {asks.map((a) => (
              <Chip key={a} className={TONE.waits.text}>
                {a}
              </Chip>
            ))}
          </span>
        )}
      </div>
      <ChangeMeta row={row} {...meta} allFeatures={open} className={mode === 'peek' ? 'pl-[22px]' : undefined} />
      {!open && row.next && (
        <div className={cn('truncate text-xs text-ink-muted', mode === 'peek' && 'pl-[22px]')}>
          {truncate(row.next, 140)}
        </div>
      )}
    </>
  );
  const frame = cn(
    'flex flex-col rounded-card border border-line bg-surface text-ink transition-colors',
    selected && 'border-accent ring-1 ring-accent',
    className,
  );

  if (mode === 'select') {
    return (
      <div className={cn(frame, 'hover:border-line-strong')}>
        <NodeLink
          to={row.key}
          lens={lens}
          aria-current={selected ? 'true' : undefined}
          className="flex flex-col gap-2 px-3.5 py-3"
        >
          {head}
          <div className="flex items-center gap-2 text-meta text-ink-faint">
            <span className="font-mono">{short(row.key)}</span>
            {moved && <span className="ml-auto">{ago(moved)}</span>}
          </div>
        </NodeLink>
        {decisions.length > 0 && (
          <DecisionGroup
            decisions={decisions.map(fromWaiting)}
            lens={lens}
            where="session"
            onDecide={onDecide}
            className="px-3.5 pb-3"
          />
        )}
      </div>
    );
  }

  return (
    <div className={frame}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-col gap-2 px-3.5 py-3 text-left hover:bg-raised"
      >
        {head}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3.5 py-3 pl-[36px]">
          {row.next && (
            <p className="text-[13px] leading-relaxed text-ink-muted">
              <span className="label mr-1.5">Next</span>
              {row.next}
            </p>
          )}
          {decisions.length > 0 && (
            <DecisionGroup decisions={decisions.map(fromWaiting)} lens={lens} where="session" onDecide={onDecide} />
          )}
          {row.status === 'review' && (
            <p className="text-xs text-ink-muted">In review: the next line says what to look at.</p>
          )}
          {row.status === 'blocked' && <p className="text-xs text-ink-muted">Blocked: the next line says on what.</p>}
          <div className="flex flex-wrap items-center gap-3 text-meta text-ink-faint">
            <CopyKey refKey={row.key} />
            {moved && <span>moved {ago(moved)}</span>}
            <NodeLink to={row.key} lens={lens} className="ml-auto hover:text-ink">
              open →
            </NodeLink>
          </div>
        </div>
      )}
    </div>
  );
}
