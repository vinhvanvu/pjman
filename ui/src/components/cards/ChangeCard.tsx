// The change card: title, meaning, what is next. The unit the project lens and every detail panel is built from.
// Data in, nothing fetched; the card is a link to the change in the lens it is seen in. The meta row (status, ticket,
// what waits, progress, milestone, feature, project, presence) is its own piece so the work card can share it.
import { cn } from 'cn';
import type { ChangeRow, Lens } from '@/data/contract';
import { short } from '@/lib/keys';
import { ago, truncate } from '@/lib/format';
import { Chip, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';

export interface ChangeMetaProps {
  row: ChangeRow;
  /** Show the status chip; off inside a lane that already says it. */
  showStatus?: boolean;
  /** Show the project chip; on when the list spans several projects. */
  showProject?: boolean;
  /** Show the milestone chip; off when grouped by milestone. */
  showMilestone?: boolean;
  /** The node the card is seen at: when the change names it, the chip is the verb on it alone (adds, changes, removes). */
  at?: string;
  /** Every feature the change names, not just the first; the work card opened. */
  allFeatures?: boolean;
  className?: string;
}

export function ChangeMeta({
  row,
  showStatus = true,
  showProject,
  showMilestone = true,
  at,
  allFeatures,
  className,
}: ChangeMetaProps) {
  const here = at ? row.features.find((f) => f.key === at) : undefined;
  const first = here ?? row.features[0];
  const shown = allFeatures ? row.features : first ? [first] : [];
  const others = allFeatures ? 0 : row.features.length - shown.length;
  const name = (f: ChangeRow['features'][number]) => (f.title && f.title.length <= 24 ? f.title : short(f.key));
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {showStatus && <StatusChip status={row.status} />}
      {row.ticket && (
        <Chip tone="quiet" mono title={row.ticket.key}>
          {row.ticket.label}
        </Chip>
      )}
      {row.waiting > 0 && <Chip tone="quiet">○ {row.waiting} waiting</Chip>}
      {row.progress && (
        <Chip tone="quiet">
          {row.progress.done} / {row.progress.total}
        </Chip>
      )}
      {showMilestone && row.parent && <Chip tone="quiet">↳ {short(row.parent)}</Chip>}
      {shown.map((f) => (
        <Chip key={f.key} tone="quiet" title={`${f.effect} ${f.key}`}>
          {f.key === at ? `${f.effect} this` : `${f.effect !== 'changes' ? `${f.effect} ` : ''}${name(f)}`}
          {others > 0 && f === first ? ` +${others}` : ''}
        </Chip>
      ))}
      {showProject && row.project && <Chip tone="quiet">{short(row.project)}</Chip>}
      {row.live && <Pulse className="ml-auto size-[7px]" />}
    </div>
  );
}

export interface ChangeCardProps extends Omit<ChangeMetaProps, 'className' | 'allFeatures'> {
  lens: Lens;
  selected?: boolean;
  /** How the card's last-moved reads; passed in so a list computes it once. */
  moved?: string;
  dense?: boolean;
  className?: string;
}

export function ChangeCard({ row, lens, selected, moved, dense, className, ...meta }: ChangeCardProps) {
  return (
    <NodeLink
      to={row.key}
      lens={lens}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-card border border-line bg-surface text-ink transition-colors hover:border-line-strong',
        dense ? 'px-3 py-2.5' : 'px-3.5 py-3',
        selected && 'border-accent ring-1 ring-accent',
        className,
      )}
    >
      <div className={cn('font-medium leading-[1.35]', dense ? 'line-clamp-1' : 'line-clamp-2')}>
        {row.title ?? short(row.key)}
      </div>
      <ChangeMeta row={row} {...meta} />
      {!dense && row.next && <div className="truncate text-xs text-ink-muted">{truncate(row.next, 140)}</div>}
      {(moved || dense) && (
        <div className="flex items-center gap-2 text-meta text-ink-faint">
          <span className="font-mono">{short(row.key)}</span>
          {moved && <span className="ml-auto">{moved}</span>}
          {!moved && row.created && <span className="ml-auto">{ago(row.created)}</span>}
        </div>
      )}
    </NodeLink>
  );
}
