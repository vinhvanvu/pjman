// The roadmap lens with nothing selected: the order as a list, what comes later, the warnings, and the bugs that are
// loudest. The chart beside it is the picture; this is the same thing read top to bottom.
import { cn } from 'cn';
import { Link } from '@tanstack/react-router';
import { Bug, ChevronDown, TriangleAlert } from 'lucide-react';
import type { Lens, Scope } from '@/data/contract';
import { useOrder } from '@/data/queries';
import { useAt } from '@/state/moment';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { pct, plural, truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, Label, StatusChip } from '@/components/chips/Chip';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { Figures } from '@/components/stats/Figures';
import { columns, loud, SEVERITY_LABEL, violationText } from './model';
import { TONE } from '@/lib/tones';

/** Ordering a later entry without dragging (change:roadmap-order-affordances): first or last on the sequence, the same
 *  write as `pjman order`. Nothing on a page held at a past moment: the past is read, never written. */
function OrderMenu({ change }: { change: string }) {
  const order = useOrder();
  const at = useAt();
  if (at) return <span className="w-4 shrink-0" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="mx-2 inline-flex h-6 shrink-0 items-center gap-1 rounded-row border border-line-strong px-1.5 text-meta text-ink-muted hover:bg-ground hover:text-ink"
        title="Place it on the sequence"
      >
        Order
        <ChevronDown className="size-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuItem onSelect={() => order.mutate({ change, first: true })}>First</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => order.mutate({ change, last: true })}>Last</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RoadmapHome({ scope, lens }: { scope: Scope; lens: Lens }) {
  const cols = columns(scope);
  const inOrder = cols.filter((c) => c.kind !== 'later');
  const later = cols.find((c) => c.kind === 'later');
  const titles = new Map(scope.changes.map((r) => [r.key, r.gist]));
  const title = scope.node ? (scope.node.name ?? scope.node.title ?? short(scope.node.key)) : 'Everything';
  const worst = scope.bugs[0]?.severity;
  const loudBugs = loud(scope.bugs);
  return (
    <section aria-label="Roadmap" className="flex flex-col gap-5 p-5 md:px-6">
      <header className="flex flex-col gap-2">
        <Label>roadmap · {title}</Label>
        <h1 className="text-heading font-semibold tracking-tight">
          {inOrder.length ? `${plural(inOrder.length, 'entry', 'entries')} in order` : 'Nothing ordered yet'}
        </h1>
        <p className="text-[13.5px] text-ink-muted">
          The order is yours: drag a column, or <code className="font-mono text-xs">pjman order</code>. Dependencies and
          dates are checked against it and never move it.
        </p>
      </header>

      <Figures
        figures={[
          { value: inOrder.length, label: 'in order' },
          { value: later?.entries.length ?? 0, label: 'later' },
          {
            value: scope.roadmap.violations.length,
            label: scope.roadmap.violations.length === 1 ? 'warning' : 'warnings',
            tone: scope.roadmap.violations.length ? TONE.waits.text : undefined,
          },
          {
            value: scope.bugs.length,
            label: worst ? `open bugs, worst ${worst}` : 'open bugs',
            tone: loudBugs ? TONE.alarm.text : undefined,
          },
        ]}
      />

      {inOrder.length === 0 ? (
        <EmptyState
          title="Nothing is on the sequence."
          hint="Order an entry below, drag one from the chart's Later column, or: pjman order change:<slug> --first"
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Label>In order</Label>
          <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {inOrder.map((c, i) => {
              const r = c.row;
              const p = c.progress;
              return (
                <li key={c.key}>
                  <NodeLink to={c.key} lens={lens} className="flex flex-col gap-2 px-4 py-3 hover:bg-raised">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-meta text-ink-faint">{i + 1}</span>
                      {r?.live && <Pulse className="size-[7px]" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                      {r && <StatusChip status={r.status} />}
                      {c.target && <Chip tone="quiet">target {c.target}</Chip>}
                      {p && (
                        <span className="w-14 text-right text-meta text-ink-faint">
                          {p.done} / {p.total}
                        </span>
                      )}
                    </div>
                    {p && (
                      <div className="h-1 overflow-hidden rounded-full bg-raised">
                        <div
                          className={cn('h-full rounded-full', TONE.done.bg)}
                          style={{ width: `${pct(p.done, p.total)}%` }}
                        />
                      </div>
                    )}
                    {c.violations.map((v) => (
                      <p
                        key={`${v.kind}:${v.against ?? ''}`}
                        className={cn('flex items-center gap-1.5 text-xs', TONE.waits.text)}
                      >
                        <TriangleAlert className="size-3" aria-hidden="true" />
                        {violationText(v, titles)}
                      </p>
                    ))}
                    {c.kind === 'milestone' && c.entries.length > 0 && (
                      <p className="text-xs text-ink-muted">
                        {plural(c.entries.length, 'open change')} beneath
                        {r?.next ? ` · ${truncate(r.next, 120)}` : ''}
                      </p>
                    )}
                  </NodeLink>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {later && later.entries.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Later · {later.entries.length}</Label>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {later.entries.slice(0, 8).map((r) => (
              <li key={r.key} className="flex items-center hover:bg-raised">
                <NodeLink to={r.key} lens={lens} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
                  <span className="min-w-0 flex-1 truncate">{r.gist ?? short(r.key)}</span>
                  {r.parent && <Chip tone="quiet">↳ {short(r.parent)}</Chip>}
                  <StatusChip status={r.status} />
                </NodeLink>
                <OrderMenu change={r.key} />
              </li>
            ))}
            {later.entries.length > 8 && (
              <li className="px-4 py-2 text-xs text-ink-faint">and {later.entries.length - 8} more</li>
            )}
          </ul>
        </div>
      )}

      {scope.bugs.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Bugs</Label>
            <Link
              to="/$lens/$"
              params={{ lens: 'feature', _splat: scope.node?.key ?? '' }}
              search={{ bugs: true }}
              className="ml-auto inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
            >
              <Bug className="size-3.5" aria-hidden="true" />
              on the map →
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {scope.bugs.slice(0, 4).map((b) => (
              <li key={b.key}>
                <NodeLink to={b.key} lens={lens} className="flex items-center gap-2 px-4 py-2 hover:bg-raised">
                  <span className="min-w-0 flex-1 truncate">{b.gist ?? short(b.key)}</span>
                  {b.severity && (
                    <Chip
                      tone="quiet"
                      className={b.severity === 'product' || b.severity === 'feature' ? TONE.alarm.text : ''}
                    >
                      {SEVERITY_LABEL[b.severity] ?? b.severity}
                    </Chip>
                  )}
                </NodeLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
