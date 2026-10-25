// The inbox: what only a person can move. Decisions with the agent's recommendation first, then changes in review,
// then blocked ones. It empties as the person decides; today deciding happens in the terminal.
import type { Lens } from '@/data/contract';
import { ago, truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { ChangeCard } from '@/components/cards/ChangeCard';
import { Chip, Label } from '@/components/chips/Chip';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import type { InboxData } from './model';

export function Inbox({ data, lens, selected }: { data: InboxData; lens: Lens; selected?: string }) {
  if (data.total === 0) {
    return (
      <EmptyState
        title="Nothing waits on you here."
        hint="Proposed decisions, changes in review and blocked changes land in this view."
        className="m-6"
      />
    );
  }
  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      {data.decisions.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Label>Decisions waiting</Label>
            <Chip tone="quiet">{data.decisions.length}</Chip>
          </div>
          <ul className="flex flex-col gap-2.5">
            {data.decisions.map((d) => (
              <li key={d.key} className="flex flex-col gap-2 rounded-card border border-line bg-surface px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <span className="mt-[3px] size-[7px] shrink-0 rounded-full bg-status-review" aria-hidden="true" />
                  <NodeLink to={d.key} lens={lens} className="font-medium leading-[1.35] hover:text-primary">
                    {d.title ?? short(d.key)}
                  </NodeLink>
                  <span className="ml-auto shrink-0 text-meta text-ink-faint">{ago(d.created)}</span>
                </div>
                {d.decision && <p className="text-xs leading-relaxed text-ink-muted">{truncate(d.decision, 260)}</p>}
                <div className="flex items-center gap-2 text-meta text-ink-faint">
                  <span>on</span>
                  <NodeLink to={d.change} lens={lens} className="font-mono text-ink-muted hover:text-primary">
                    {short(d.change)}
                  </NodeLink>
                  <span className="ml-auto font-mono">pjman set {short(d.key)} status=decided</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.reviews.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Label>In review</Label>
            <Chip tone="quiet">{data.reviews.length}</Chip>
          </div>
          {data.reviews.map((r) => (
            <ChangeCard key={r.key} row={r} lens={lens} selected={selected === r.key} />
          ))}
        </section>
      )}
      {data.blocked.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Label>Blocked</Label>
            <Chip tone="quiet">{data.blocked.length}</Chip>
          </div>
          {data.blocked.map((r) => (
            <ChangeCard key={r.key} row={r} lens={lens} selected={selected === r.key} />
          ))}
        </section>
      )}
    </div>
  );
}
