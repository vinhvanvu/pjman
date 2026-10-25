// Lanes: columns of cards. Empty lanes are not drawn. A milestone lane's header links to the milestone.
import { cn } from 'cn';
import type { Lens } from '@/data/contract';
import { ago } from '@/lib/format';
import { ChangeCard } from '@/components/cards/ChangeCard';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import type { Lane } from './model';

export function Lanes({
  lanes,
  lens,
  selected,
  showProject,
  showStatus,
  showMilestone,
  className,
}: {
  lanes: Lane[];
  lens: Lens;
  selected?: string;
  showProject?: boolean;
  showStatus?: boolean;
  showMilestone?: boolean;
  className?: string;
}) {
  if (lanes.length === 0) return <EmptyState title="Nothing open here." className="m-6" />;
  return (
    <div
      className={cn('grid min-h-0 flex-1 items-start gap-4 overflow-auto px-5 pb-6 md:px-6', className)}
      style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(220px, 1fr))` }}
    >
      {lanes.map((lane) => (
        <section key={lane.id} aria-label={lane.label} className="flex min-w-0 flex-col gap-2">
          <header className="flex h-7 items-center gap-2 px-1 text-[12.5px] font-semibold">
            <span className={cn('size-2 shrink-0 rounded-full', lane.tone)} aria-hidden="true" />
            {lane.key ? (
              <NodeLink to={lane.key} lens={lens} className="truncate hover:text-primary">
                {lane.label}
              </NodeLink>
            ) : (
              <span className="truncate">{lane.label}</span>
            )}
            <span className="font-normal text-ink-faint">{lane.rows.length}</span>
            {lane.progress && (
              <span className="ml-auto font-normal text-ink-faint">
                {lane.progress.done} / {lane.progress.total}
              </span>
            )}
          </header>
          {lane.rows.map((r) => (
            <ChangeCard
              key={r.key}
              row={r}
              lens={lens}
              selected={selected === r.key}
              showStatus={showStatus}
              showProject={showProject}
              showMilestone={showMilestone}
              moved={ago(r.created)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
