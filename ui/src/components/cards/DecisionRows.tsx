// Proposed decisions as rows that open in place: the title collapsed; the whole decision, the why, a copy of the
// reference and a way to the change's decisions tab when open. Nothing navigates on the first click.
import { cn } from 'cn';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import type { Lens, WaitingDecision } from '@/data/contract';
import { truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';

export function DecisionRows({
  items,
  lens,
  /** Name the change on each row; off inside the change's own card. */
  showChange = true,
  className,
}: {
  items: WaitingDecision[];
  lens: Lens;
  showChange?: boolean;
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
    <ol className={cn('flex flex-col gap-2', className)}>
      {items.map((d) => {
        const isOpen = open.has(d.key);
        return (
          <li key={d.key} className="flex flex-col rounded-card border border-line bg-surface">
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
                <Chip className="text-status-review">
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
                  <span className="font-mono">{short(d.key)}</span>
                  <CopyRef text={d.key} />
                  <NodeLink to={d.key} lens={lens} className="ml-auto hover:text-ink">
                    open on {short(d.change)} →
                  </NodeLink>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Copies a reference for pasting into a session; says so for a moment. */
export function CopyRef({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className={cn('inline-flex items-center gap-1 hover:text-ink', className)}
      title="Copy the reference"
    >
      {done ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      {done ? 'copied' : 'copy'}
    </button>
  );
}
