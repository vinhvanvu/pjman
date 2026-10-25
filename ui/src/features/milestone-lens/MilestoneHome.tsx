// The milestone lens with nothing selected: the goals across the whole scope. How many are in flight and reached, how
// far along they are together, what waits on a person, which ones are moving right now, and each one's next line.
import type { Lens, Scope } from '@/data/contract';
import { pct, plural, truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, Label, StatusChip } from '@/components/chips/Chip';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { Figures } from '@/components/stats/Figures';
import { summarise } from './model';

export function MilestoneHome({ scope, lens }: { scope: Scope; lens: Lens }) {
  const s = summarise(scope);
  const title = scope.node ? (scope.node.name ?? scope.node.title ?? short(scope.node.key)) : 'Everything';
  return (
    <section aria-label="Milestones" className="flex flex-col gap-5 p-5 md:px-6">
      <header className="flex flex-col gap-2">
        <Label>milestones · {title}</Label>
        <h1 className="text-heading font-semibold tracking-tight">
          {s.inFlight ? `${plural(s.inFlight, 'goal')} in flight` : 'No goals in flight'}
        </h1>
        <p className="text-[13.5px] text-ink-muted">
          A milestone is a change with children; its progress is its children done. Select one to see what leads to it.
        </p>
      </header>

      <Figures
        figures={[
          {
            value: s.progress.total ? `${pct(s.progress.done, s.progress.total)}%` : '—',
            label: s.progress.total ? `${s.progress.done} of ${s.progress.total} children done` : 'no children yet',
          },
          { value: s.reached, label: 'reached and done' },
          { value: s.waiting, label: 'decisions waiting', tone: s.waiting ? 'text-status-review' : undefined },
          {
            value: s.live,
            label: s.live === 1 ? 'session live' : 'sessions live',
            tone: s.live ? 'text-live' : undefined,
          },
        ]}
      />

      {s.list.length === 0 ? (
        <EmptyState
          title="Nothing here is a milestone yet."
          hint="Give a change children with --parent and it becomes one."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Label>Nearest to done first</Label>
          <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {s.list.map((m) => {
              const p = m.progress ?? { done: 0, total: 0 };
              return (
                <li key={m.key}>
                  <NodeLink to={m.key} lens={lens} className="flex flex-col gap-2 px-4 py-3 hover:bg-raised">
                    <div className="flex items-center gap-2">
                      {m.live && <Pulse className="size-[7px]" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{m.title ?? short(m.key)}</span>
                      <StatusChip status={m.status} />
                      {m.waiting > 0 && <Chip tone="quiet">○ {m.waiting} waiting</Chip>}
                      <span className="w-16 text-right text-meta text-ink-faint">
                        {p.done} / {p.total}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-status-done"
                        style={{ width: `${pct(p.done, p.total)}%` }}
                      />
                    </div>
                    {m.next && <p className="text-xs text-ink-muted">{truncate(m.next, 160)}</p>}
                  </NodeLink>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {s.loose > 0 && (
        <p className="text-xs text-ink-faint">
          {plural(s.loose, 'open change')} beneath this scope {s.loose === 1 ? 'belongs' : 'belong'} to no milestone.
        </p>
      )}
    </section>
  );
}
