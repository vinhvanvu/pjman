// The bugs view: the queue beneath the scope, worst first then oldest, grouped by what is lost. Each bug is listed
// once, at its home; the row says where that is. The listing the agent reads is the same order.
import type { Lens, Scope } from '@/data/contract';
import { ago, plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { ChangeCard } from '@/components/cards/ChangeCard';
import { Chip, Label } from '@/components/chips/Chip';
import { EmptyState } from '@/components/EmptyState';
import { bySeverity } from './model';

const TONE: Record<string, string> = {
  product: 'text-status-blocked',
  feature: 'text-status-blocked',
  capability: 'text-status-review',
};

export function BugsView({
  scope,
  lens,
  selected,
  showProject,
}: {
  scope: Scope;
  lens: Lens;
  selected?: string;
  showProject?: boolean;
}) {
  const groups = bySeverity(scope.bugs);
  const title = scope.node ? (scope.node.name ?? scope.node.title ?? short(scope.node.key)) : 'Everything';
  return (
    <section aria-label="Bugs" className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-5 pt-5 pb-3.5 md:px-6">
        <h1 className="truncate text-heading font-semibold tracking-tight">Bugs · {title}</h1>
        <div className="text-[12.5px] text-ink-muted">
          {scope.bugs.length
            ? `${plural(scope.bugs.length, 'open bug')}, worst first, then oldest`
            : 'Nothing reported'}
        </div>
      </header>
      <div className="flex flex-col gap-5 px-5 pb-6 md:px-6">
        {groups.length === 0 && (
          <EmptyState
            title="No open bugs beneath this node."
            hint="A bug is a change with --kind bug and a severity, naming the live node it breaks."
          />
        )}
        {groups.map((g) => (
          <div key={g.severity} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Label className={TONE[g.severity] ?? ''}>{g.label}</Label>
              <span className="text-meta text-ink-faint">{g.rows.length}</span>
            </div>
            <ol className="flex flex-col gap-1.5">
              {g.rows.map((r) => (
                <li key={r.key} className="flex flex-col gap-1">
                  <ChangeCard
                    row={r}
                    lens={lens}
                    selected={selected === r.key}
                    moved={ago(r.moved ?? r.created)}
                    showProject={showProject}
                    dense
                  />
                  {r.home && r.home !== r.features[0]?.key && (
                    <span className="flex items-center gap-1.5 px-1 text-meta text-ink-faint">
                      listed at <Chip tone="quiet">{short(r.home)}</Chip>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
