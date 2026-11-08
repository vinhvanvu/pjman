// The header every node's record shares, whatever is beneath it (decision one-rollup-shape; decision
// feature-detail/one-node-record): what kind of thing this is, its name and sentence, who owns it, then the same
// figures at every node of the tree: when it last moved and how much, what is open and in flight, what got done in
// the window, what waits on a person, and how many sessions are live beneath it. The same shape at a product, a
// feature and a capability, so the person always knows where they stand before the content changes.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import type { Health } from '@/data/contract';
import { plural, sinceDays } from '@/lib/format';
import { Label, StatusChip } from '@/components/chips/Chip';
import { Pulse } from '@/components/presence/Presence';
import { Figures } from '@/components/stats/Figures';
import { TONE } from '@/lib/tones';

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
  /** Decisions waiting on a person beneath. */
  waiting: number;
  /** Sessions live beneath. */
  live: number;
  /** Open bugs beneath and the worst of them; shown only when there are any. The link opens the map on this node with
   *  the bugs filter on. */
  bugs?: { count: number; worst?: string; node?: string };
  className?: string;
  children?: ReactNode;
}

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
  live,
  bugs,
  className,
  children,
}: NodeHeaderProps) {
  const sep = <span className="text-ink-faint">·</span>;
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2">
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
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span>
            <span className="text-ink-faint">Owner </span>
            {owners.length ? owners.join(', ') : <span className="text-ink-faint">nobody yet</span>}
            {ownersFrom && <span className="text-ink-faint"> · from {ownersFrom}</span>}
          </span>
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
                    ? cn('font-medium', TONE.alarm.text)
                    : bugs.worst === 'capability'
                      ? TONE.waits.text
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
      </div>
      <Figures
        dense
        aria-label="The roll-up: the same figures at every node"
        className="rounded-card border border-line bg-surface px-3.5 py-2.5"
        figures={[
          {
            value: word === 'not started' ? 'never' : sinceDays(h.staleDays),
            label: h.moved ? `moved · ${plural(h.moved, 'event')} in ${h.days} d` : 'moved',
            tone: word === 'stale' ? TONE.waits.text : undefined,
          },
          { value: open, label: inFlight ? `open · ${inFlight} in flight` : 'open' },
          { value: h.done, label: `done in ${h.days} d`, tone: h.done ? TONE.done.text : undefined },
          { value: waiting, label: 'wait on you', tone: waiting ? TONE.waits.text : undefined },
          {
            value: (
              <span className="inline-flex items-center gap-1.5">
                {live > 0 && <Pulse className="size-[7px]" />}
                {live}
              </span>
            ),
            label: live === 1 ? 'live session' : 'live sessions',
            tone: live ? TONE.live.text : undefined,
          },
        ]}
      />
      {children}
    </header>
  );
}
