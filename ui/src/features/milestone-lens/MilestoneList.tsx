// The milestone list: each goal with a small ring, its status and its progress. Short, because the page is the point.
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import type { Lens, Scope } from '@/data/contract';
import { plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, StatusChip } from '@/components/chips/Chip';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Ring } from './Ring';
import { milestones } from './model';

export function MilestoneList({ scope, lens, selected }: { scope: Scope; lens: Lens; selected?: string }) {
  const { list, left } = milestones(scope);
  return (
    <section aria-label="Milestones" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-2">
        <h2 className="text-section font-semibold">Milestones</h2>
        <span className="text-xs text-ink-muted">{plural(list.length, 'in flight', 'in flight')}</span>
      </div>
      <div className="flex flex-col gap-0.5 px-3">
        {list.length === 0 && (
          <EmptyState
            title="No milestones here."
            hint="A change with children is a milestone; its progress is its children done."
            className="mx-2"
          />
        )}
        {list.map((m) => {
          const r = m.row;
          const p = r?.progress;
          return (
            <NodeLink
              key={m.key}
              to={m.key}
              lens={lens}
              className={cn(
                'flex items-center gap-3 rounded-card border border-transparent px-3.5 py-3 hover:bg-raised',
                selected === m.key && 'border-accent/35 bg-selection',
              )}
            >
              <Ring done={p?.done ?? 0} total={p?.total ?? 0} size={28} stroke={3} />
              <span className="min-w-0 flex-1 truncate font-medium">{m.title ?? short(m.key)}</span>
              <StatusChip status={m.status} />
              {p && (
                <span className="shrink-0 text-meta text-ink-faint">
                  {p.done} / {p.total}
                </span>
              )}
            </NodeLink>
          );
        })}
      </div>
      {left && (
        <div className="mx-5 mt-2.5 flex items-center gap-2 border-t border-dashed border-line-strong pt-3">
          <span className="text-xs text-ink-muted">{left.title}</span>
          <Chip tone="quiet">{plural(left.open, 'change')}</Chip>
          <div className="flex-1" />
          <ChevronRight className="size-3.5 text-ink-faint" />
        </div>
      )}
      {scope.doneHidden > 0 && (
        <div className="mx-5 mt-2.5 flex items-center gap-2 text-xs text-ink-muted">
          <span>Reached and done</span>
          <Chip tone="quiet">{scope.doneHidden} hidden</Chip>
        </div>
      )}
    </section>
  );
}
