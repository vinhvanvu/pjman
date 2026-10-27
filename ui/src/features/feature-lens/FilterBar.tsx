// The filter bar above the product map: a text, the states, and a milestone that narrows the whole lens to the work
// beneath one goal. All of it is URL state, so a filtered map is a link, and a saved view later is one of these links
// with a name.
import { cn } from 'cn';
import { ChevronDown, Flag, Search, X } from 'lucide-react';
import type { ChangeRow } from '@/data/contract';
import { pct } from '@/lib/format';
import { short } from '@/lib/keys';
import { StateDot } from '@/components/chips/Chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MapFilter } from './model';
import { goals as goalsOf, isFiltering } from './model';

const STATES = ['live', 'building', 'planned', 'retired'] as const;

export interface FilterBarProps {
  filter: MapFilter;
  onChange: (f: MapFilter) => void;
  /** How many features match, when filtering. */
  matched?: number;
  /** The scope's changes before narrowing; the milestones among them are what the picker lists. */
  goals: ChangeRow[];
  className?: string;
}

export function FilterBar({ filter, onChange, matched, goals, className }: FilterBarProps) {
  const milestones = goalsOf(goals);
  const chosen = filter.milestone ? goals.find((r) => r.key === filter.milestone) : undefined;
  const toggle = (list: string[] | undefined, v: string) =>
    list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];
  const active = isFiltering(filter);
  return (
    <div className={cn('flex flex-wrap items-center gap-2 px-5 pb-2', className)}>
      <label className="relative flex h-7 min-w-[180px] flex-1 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-ink-faint" aria-hidden="true" />
        <input
          type="search"
          value={filter.q ?? ''}
          onChange={(e) => onChange({ ...filter, q: e.target.value || undefined })}
          placeholder="Filter features by name or key"
          aria-label="Filter features"
          className="h-7 w-full rounded-row border border-line-strong bg-transparent pr-2 pl-7 text-xs text-ink placeholder:text-ink-faint focus:border-ring focus:outline-none"
        />
      </label>
      <div className="flex items-center gap-1" role="group" aria-label="State">
        {STATES.map((s) => {
          const on = filter.states?.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...filter, states: toggle(filter.states, s) })}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-row border px-2 text-xs',
                on
                  ? 'border-primary/50 bg-selection text-ink'
                  : 'border-line-strong text-ink-muted hover:bg-raised hover:text-ink',
              )}
            >
              <StateDot state={s} />
              {s}
            </button>
          );
        })}
      </div>
      {filter.milestone ? (
        <button
          type="button"
          onClick={() => onChange({ ...filter, milestone: undefined })}
          title="Showing only the work beneath this milestone · click to clear"
          className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-row border border-primary/50 bg-selection px-2 text-xs text-ink"
        >
          <Flag className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="min-w-0 truncate">{chosen?.title ?? short(filter.milestone)}</span>
          {chosen?.progress && (
            <span className="shrink-0 text-ink-faint">
              {chosen.progress.done}/{chosen.progress.total}
            </span>
          )}
          <X className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
        </button>
      ) : (
        milestones.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-7 items-center gap-1.5 rounded-row border border-line-strong px-2 text-xs text-ink-muted hover:bg-raised hover:text-ink"
              title="Narrow the lens to the work beneath one milestone"
            >
              <Flag className="size-3.5" aria-hidden="true" />
              milestone
              <ChevronDown className="size-3" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px]">
              <DropdownMenuLabel className="text-meta text-ink-faint">
                Goals in flight · nearest to done first
              </DropdownMenuLabel>
              {milestones.map((m) => (
                <DropdownMenuItem
                  key={m.key}
                  onSelect={() => onChange({ ...filter, milestone: m.key })}
                  className="gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">{m.title ?? short(m.key)}</span>
                  {m.progress && (
                    <span className="shrink-0 text-meta text-ink-faint">{pct(m.progress.done, m.progress.total)}%</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      )}
      {active && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="inline-flex h-7 items-center gap-1 rounded-row px-2 text-xs text-ink-muted hover:bg-raised hover:text-ink"
        >
          <X className="size-3.5" />
          {matched !== undefined ? `${matched} match · clear` : 'clear'}
        </button>
      )}
    </div>
  );
}
