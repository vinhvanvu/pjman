// The header every node's overview shares, whatever the body beneath it: what kind of thing this is, its name and
// sentence, who owns it, and one line of health: a word, when it last moved, what is open, what got done, and what
// waits on a person. The same shape at a product, a feature and a capability, so the person always knows where they
// stand before the content changes.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import type { Health } from '@/data/contract';
import { plural, sinceDays } from '@/lib/format';
import { Label, StatusChip } from '@/components/chips/Chip';

export type HealthWord = 'active' | 'stale' | 'not started';

export interface NodeHeaderProps {
  /** The level label: product, feature, capability; store at the root. */
  level: string;
  /** A feature's derived state, when it has one. */
  state?: string;
  title: string;
  /** The one-line sentence beneath the name, when it says more than the name. */
  sentence?: string;
  owners: string[];
  /** Where the owners are inherited from, when not set here. */
  ownersFrom?: string;
  word: HealthWord;
  health: Health;
  /** Open changes beneath and how many of those are in flight. */
  open: number;
  inFlight: number;
  /** Decisions waiting on a person beneath; shown only when not zero. */
  waiting: number;
  /** Open bugs beneath and the worst of them; shown only when there are any. The link opens the map on this node with
   *  the bugs filter on. */
  bugs?: { count: number; worst?: string; node?: string };
  className?: string;
  children?: ReactNode;
}

const WORD_TONE: Record<HealthWord, string> = {
  active: 'text-state-live',
  stale: 'text-status-review',
  'not started': 'text-ink-faint',
};

const STATE_TONE: Record<string, string> = {
  live: 'text-state-live',
  building: 'text-state-building',
  planned: 'text-ink-faint',
  retired: 'text-state-retired',
};

export function NodeHeader({
  level,
  state,
  title,
  sentence,
  owners,
  ownersFrom,
  word,
  health: h,
  open,
  inFlight,
  waiting,
  bugs,
  className,
  children,
}: NodeHeaderProps) {
  const sep = <span className="text-ink-faint">·</span>;
  return (
    <header className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <Label>{level}</Label>
        {state && (
          <>
            {sep}
            <StatusChip status={state} className={STATE_TONE[state] ?? ''} />
          </>
        )}
      </div>
      <h1 className="text-heading font-semibold tracking-tight">{title}</h1>
      {sentence && <p className="text-[13.5px] text-ink-muted">{sentence}</p>}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted" aria-label="Health">
        <span className={cn('font-medium capitalize', WORD_TONE[word])}>{word}</span>
        {word !== 'not started' && (
          <>
            {sep}
            <span>moved {sinceDays(h.staleDays)}</span>
          </>
        )}
        {sep}
        <span>
          {open ? plural(open, 'open change') : 'nothing open'}
          {inFlight ? `, ${inFlight} in flight` : ''}
        </span>
        {h.done > 0 && (
          <>
            {sep}
            <Link
              to="."
              search={(prev: Record<string, unknown>) => ({ ...prev, tab: 'activity' as const })}
              replace
              className="hover:text-ink"
            >
              {h.done} done in {h.days} days
            </Link>
          </>
        )}
        {waiting > 0 && (
          <>
            {sep}
            <span className="font-medium text-status-review">{waiting} waiting on you</span>
          </>
        )}
        {bugs && bugs.count > 0 && (
          <>
            {sep}
            <Link
              to="/$lens/$"
              params={{ lens: 'feature', _splat: bugs.node ?? '' }}
              search={{ bugs: true }}
              className={cn(
                'hover:underline',
                bugs.worst === 'product' || bugs.worst === 'feature'
                  ? 'font-medium text-status-blocked'
                  : bugs.worst === 'capability'
                    ? 'text-status-review'
                    : '',
              )}
            >
              {plural(bugs.count, 'bug')}
              {bugs.worst &&
                (bugs.worst === 'nuisance' || bugs.worst === 'cosmetic'
                  ? `, worst ${bugs.worst}`
                  : `, ${bugs.worst} out`)}
            </Link>
          </>
        )}
      </p>
      <p className="text-xs text-ink-muted">
        <span className="text-ink-faint">Owner </span>
        {owners.length ? owners.join(', ') : <span className="text-ink-faint">nobody yet</span>}
        {ownersFrom && <span className="text-ink-faint"> · from {ownersFrom}</span>}
      </p>
      {children}
    </header>
  );
}
