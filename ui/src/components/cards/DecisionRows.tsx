// Proposed decisions as rows that open in place: the title collapsed; the whole decision, the why, a copy of the
// reference, Accept (change:decide-in-place) and a way to the change's decisions tab when open. Nothing navigates on the first click. Alive
// (change:motion-design): a decision that arrives slides in, one opened on the stream washes in waits amber, and one
// that stops waiting washes done green where it stands, fades, and only then gives up its space.
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import type { Lens, StoreEvent, WaitingDecision } from '@/data/contract';
import { truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { liveItem, Wash } from '@/lib/motion';
import { Chip } from '@/components/chips/Chip';
import { CopyKey } from '@/components/links/CopyKey';
import { DecideControl } from '@/components/decisions/DecideControl';
import { NodeLink } from '@/components/links/NodeLink';
import { TONE } from '@/lib/tones';

/** A decision that stops waiting: it holds, washed done green, then fades where it stands (decision
 *  space-follows-the-element); its children take the label, so the wash shows. */
const DECIDED = {
  decided: {
    opacity: [1, 1, 0],
    scale: [1, 1, 0.97],
    transition: { duration: 0.9, times: [0, 0.6, 1] },
  },
};
const DECIDED_MARK = {
  decided: { opacity: 1, transition: { duration: 0.15 } },
};

export function DecisionRows({
  items,
  lens,
  /** Name the change on each row; off inside the change's own card. */
  showChange = true,
  /** The decisions the live stream just opened, by key: each washes once. */
  opened,
  /** The moment the list is read at: a new one swaps the rows without motion, and what is open stays open. */
  moment,
  /** Decides a decision in place; Accept is drawn only when it is given. */
  onDecide,
  className,
}: {
  items: readonly WaitingDecision[];
  lens: Lens;
  showChange?: boolean;
  opened?: ReadonlyMap<string, StoreEvent>;
  moment?: string;
  onDecide?: (decision: string) => Promise<unknown>;
  className?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ol className={cn('flex flex-col empty:hidden', className)}>
      <AnimatePresence key={moment ?? 'now'} initial={false}>
        {items.map((d) => {
          const isOpen = open.has(d.key);
          return (
            <m.li key={d.key} {...liveItem} exit="decided" variants={DECIDED} className="pb-2 last:pb-0">
              <div className="relative flex flex-col overflow-hidden rounded-card border border-line bg-surface">
                <Wash arrival={opened?.get(d.key)?.seq} className={TONE.waits.wash} />
                {/* rests hidden by its own style: AnimatePresence's initial={false} skips an initial, so a list
                    mounted with its rows already there showed every row decided (change:dock-waits-turn-green) */}
                <m.span
                  aria-hidden="true"
                  style={{ opacity: 0 }}
                  variants={DECIDED_MARK}
                  className={cn('pointer-events-none absolute inset-0 z-10', TONE.done.wash)}
                />
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(d.key)}
                  className="flex w-full flex-col gap-1 px-3.5 py-3 text-left hover:bg-raised"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn('size-3.5 shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-90')}
                      aria-hidden="true"
                    />
                    <Chip className={TONE.waits.text}>
                      <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
                      decide
                    </Chip>
                    <span className={cn('min-w-0 flex-1 font-medium', !isOpen && 'truncate')}>
                      {d.title ?? short(d.key)}
                    </span>
                    {showChange && <span className="shrink-0 text-meta text-ink-faint">{short(d.change)}</span>}
                  </div>
                  {!isOpen && d.decision && (
                    <p className="truncate pl-[22px] text-xs text-ink-muted">{truncate(d.decision, 140)}</p>
                  )}
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2.5 border-t border-line px-3.5 py-3 pl-[36px]">
                    {d.decision && <p className="text-[13px] leading-relaxed text-ink-muted">{d.decision}</p>}
                    {d.why && (
                      <p className="text-xs leading-relaxed text-ink-faint">
                        <span className="label mr-1.5">Why</span>
                        {d.why}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-meta text-ink-faint">
                      <CopyKey refKey={d.key} />
                      {onDecide && <DecideControl decision={d.key} onConfirm={() => onDecide(d.key)} />}
                      <NodeLink to={d.key} lens={lens} className="ml-auto hover:text-ink">
                        open on {short(d.change)} →
                      </NodeLink>
                    </div>
                  </div>
                )}
              </div>
            </m.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
