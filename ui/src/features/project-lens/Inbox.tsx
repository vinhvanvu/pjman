// The inbox: what only a person can move, indexed by change. Each card is a change carrying its asks (decisions to
// make, a review, a block), most recently moved first; a click selects it and the record opens beside. It empties as
// the person decides; today deciding happens in the terminal.
import type { Lens } from '@/data/contract';
import { plural } from '@/lib/format';
import { DecisionRows } from '@/components/cards/DecisionRows';
import { WorkCard } from '@/components/cards/WorkCard';
import { Label } from '@/components/chips/Chip';
import { EmptyState } from '@/components/EmptyState';
import type { InboxData } from './model';

export function Inbox({
  data,
  lens,
  selected,
  showProject,
}: {
  data: InboxData;
  lens: Lens;
  selected?: string;
  showProject?: boolean;
}) {
  if (data.total === 0) {
    return (
      <EmptyState
        title="Nothing waits on you here."
        hint="Changes with a decision proposed, in review or blocked land in this view."
        className="m-6"
      />
    );
  }
  return (
    <div className="flex flex-col gap-5 p-5 md:p-6">
      <div className="flex items-center gap-2.5">
        <Label>Needs you</Label>
        <span className="text-meta text-ink-faint">
          {plural(data.items.length, 'change')} · {plural(data.total, 'ask')}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {data.items.map((i) => (
          <WorkCard
            key={i.row.key}
            row={i.row}
            lens={lens}
            mode="select"
            decisions={i.decisions}
            selected={selected === i.row.key}
            showProject={showProject}
          />
        ))}
      </div>
      {data.stray.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <Label>Decisions on changes not listed</Label>
            <span className="text-meta text-ink-faint">{data.stray.length}</span>
          </div>
          <DecisionRows items={data.stray} lens={lens} />
        </div>
      )}
    </div>
  );
}
