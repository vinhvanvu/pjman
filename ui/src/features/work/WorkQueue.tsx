// The work queue: the project's header (open count, progress) and its lanes in the chosen grouping.
import { Link } from '@tanstack/react-router';
import type { Grouping, Lens, Scope } from '@/data/contract';
import { pct, plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Lanes } from './Lanes';
import { lanesFor } from './model';

export interface WorkQueueProps {
  scope: Scope;
  lens: Lens;
  grouping: Grouping;
  onGroupingChange: (g: Grouping) => void;
  selected?: string;
  showDone: boolean;
}

export function WorkQueue({ scope, lens, grouping, onGroupingChange, selected, showDone }: WorkQueueProps) {
  const lanes = lanesFor(grouping, scope.changes);
  const progress = scope.node?.progress;
  const open = scope.changes.filter((r) => r.status !== 'done' && r.status !== 'dropped').length;
  const title = scope.node ? (scope.node.name ?? scope.node.title ?? short(scope.node.key)) : 'Work queue';
  return (
    <section aria-label="Work queue" className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3 px-5 pt-5 pb-3.5 md:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-heading font-semibold tracking-tight">{title}</h1>
          <div className="text-[12.5px] text-ink-muted">
            {plural(open, 'open change')}
            {scope.projects.length > 1 ? ` across ${plural(scope.projects.length, 'project')}` : ''}
          </div>
        </div>
        {progress && (
          <div className="flex w-[220px] flex-col gap-1.5">
            <div className="flex justify-between text-meta">
              <span className="text-ink-muted">
                {progress.done} of {progress.total} done
              </span>
              <span className="text-ink-faint">{pct(progress.done, progress.total)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-status-done"
                style={{ width: `${pct(progress.done, progress.total)}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          value={grouping}
          onValueChange={(v) => v && onGroupingChange(v as Grouping)}
          variant="outline"
          size="sm"
          aria-label="Group by"
        >
          <ToggleGroupItem value="status" className="text-xs">
            Status
          </ToggleGroupItem>
          <ToggleGroupItem value="milestone" className="text-xs">
            Milestone
          </ToggleGroupItem>
          <ToggleGroupItem value="actor" className="text-xs">
            Who&apos;s next
          </ToggleGroupItem>
        </ToggleGroup>
        <Link
          to="."
          search={(prev: Record<string, unknown>) => ({ ...prev, done: showDone ? undefined : true })}
          replace
          className="inline-flex h-7 items-center rounded-row border border-line-strong px-2.5 text-xs text-ink-muted hover:bg-raised hover:text-ink"
        >
          {showDone ? 'Hide done' : `${scope.doneHidden} done · show`}
        </Link>
      </header>
      <Lanes
        lanes={lanes}
        lens={lens}
        selected={selected}
        showProject={scope.projects.length > 1}
        showStatus={grouping !== 'status'}
        showMilestone={grouping !== 'milestone'}
      />
    </section>
  );
}
