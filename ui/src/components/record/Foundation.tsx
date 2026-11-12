// The foundation as the record pane and the dock draw it (change:foundation-views; decision record-foundation/
// the-ladder): the plan as steps with their state and note, the sections in order of depth, and what a record still
// needs or whose rungs are stale, marked rather than hidden. Data in, nothing fetched.
import { cn } from 'cn';
import { Check, Minus, Play } from 'lucide-react';
import type { ChangeContext } from '@/data/contract';
import { Chip, Label } from '@/components/chips/Chip';
import { TONE } from '@/lib/tones';

type Step = ChangeContext['plan'][number];

/** What the record still needs before it is worked, that its rungs are stale, or that it was migrated and not yet
 *  reviewed: chips in the waits tone, so a person sees a record is not yet whole instead of reading text that is. */
export function Readiness({
  needs,
  stale,
  migrated,
  what = 'change',
  className,
}: {
  needs: string[];
  stale: boolean;
  migrated?: string;
  what?: 'change' | 'decision';
  className?: string;
}) {
  if (!needs.length && !stale && !migrated) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {needs.length > 0 && (
        <Chip className={TONE.waits.text} title={`written before the ${what} is worked`}>
          needs {needs.join(', ')}
        </Chip>
      )}
      {stale && (
        <Chip
          className={TONE.waits.text}
          title="the name and gist were written from an earlier foundation; the next write rewrites them"
        >
          name and gist stale
        </Chip>
      )}
      {migrated && (
        <Chip tone="quiet" title={`mapped from the old shape on ${migrated}, not written through the tool since`}>
          migrated {migrated}
        </Chip>
      )}
    </div>
  );
}

const MARK: Record<Step['state'], { icon: typeof Check; cls: string; label: string }> = {
  done: { icon: Check, cls: cn('text-primary-foreground', TONE.done.bg), label: 'done' },
  active: { icon: Play, cls: cn('text-primary-foreground', TONE.active.bg), label: 'in progress' },
  dropped: { icon: Minus, cls: 'border border-line-strong text-ink-faint', label: 'dropped' },
  open: { icon: Minus, cls: 'border-[1.5px] border-line-strong text-transparent', label: 'open' },
};

/** The plan: each step with its state and the note of where the work stands on it. */
export function Plan({
  plan,
  progress,
  className,
}: {
  plan: Step[];
  progress?: { done: number; total: number };
  className?: string;
}) {
  if (!plan.length) return null;
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <Label>Plan</Label>
        {progress && (
          <Chip tone="quiet">
            {progress.done} / {progress.total}
          </Chip>
        )}
      </div>
      <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {plan.map((s, i) => {
          const m = MARK[s.state];
          const Icon = m.icon;
          return (
            <li key={i} className="flex items-start gap-3 px-3.5 py-2">
              <span className="w-4 shrink-0 pt-[3px] text-right font-mono text-meta text-ink-faint">{i + 1}</span>
              <span
                role="img"
                aria-label={m.label}
                title={m.label}
                className={cn('mt-[3px] grid size-4 shrink-0 place-items-center rounded-full', m.cls)}
              >
                <Icon className="size-2.5" strokeWidth={3} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    'text-[13px] leading-relaxed',
                    s.state === 'dropped' && 'text-ink-faint line-through',
                    s.state === 'done' && 'text-ink-muted',
                  )}
                >
                  {s.text}
                </span>
                {s.note && <span className="text-xs leading-relaxed text-ink-muted">{s.note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
