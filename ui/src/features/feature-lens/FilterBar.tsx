// The filter bar above the product map: a text, the states, bugs only, a milestone that narrows the whole lens to
// the work beneath one milestone, and an aspect that narrows the map to where it applies (a searchable picker, so it
// holds an org's many aspects; decision aspects-dashboard/aspect-is-a-map-lens). All of it is URL state, so a filtered map is a link, and a saved view later is one of these links
// with a name.
import { cn } from 'cn';
import { Bug, ChevronDown, Diamond, Flag, Search, X } from 'lucide-react';
import { useState } from 'react';
import type { ChangeRow, ScopeAspect } from '@/data/contract';
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
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { MapFilter } from './model';
import { aspectOutline, inFlight, isFiltering, nameOf } from './model';

const STATES = ['live', 'building', 'planned', 'retired'] as const;

export interface FilterBarProps {
  filter: MapFilter;
  onChange: (f: MapFilter) => void;
  /** How many features match, when filtering. */
  matched?: number;
  /** The scope's changes before narrowing; the milestones in flight among them are what the picker lists. */
  changes: ChangeRow[];
  /** The product's aspects: what the aspect picker lists. */
  aspects: ScopeAspect[];
  className?: string;
}

export function FilterBar({ filter, onChange, matched, changes, aspects, className }: FilterBarProps) {
  const milestones = inFlight(changes);
  const chosen = filter.milestone ? changes.find((r) => r.key === filter.milestone) : undefined;
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
      <button
        type="button"
        aria-pressed={!!filter.bugs}
        onClick={() => onChange({ ...filter, bugs: filter.bugs ? undefined : true })}
        title="Only the nodes a bug is listed at"
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-row border px-2 text-xs',
          filter.bugs
            ? 'border-primary/50 bg-selection text-ink'
            : 'border-line-strong text-ink-muted hover:bg-raised hover:text-ink',
        )}
      >
        <Bug className="size-3.5" aria-hidden="true" />
        bugs
      </button>
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
                Milestones in flight · nearest to done first
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
      <AspectPicker aspects={aspects} chosen={filter.aspect} onChoose={(aspect) => onChange({ ...filter, aspect })} />
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

/** The aspect control: the chosen aspect with its clear, else a searchable list of the product's aspects, nested by
 *  parent, each with how many places it has. Nothing when the product has none. */
export function AspectPicker({
  aspects,
  chosen,
  onChoose,
  narrows = 'map',
}: {
  aspects: ScopeAspect[];
  chosen?: string;
  onChoose: (aspect: string | undefined) => void;
  /** What picking narrows: the map to where the aspect applies, the roadmap to the work on it. */
  narrows?: 'map' | 'roadmap';
}) {
  const [open, setOpen] = useState(false);
  const picked = chosen ? aspects.find((a) => a.aspect === chosen) : undefined;
  if (chosen) {
    return (
      <button
        type="button"
        onClick={() => onChoose(undefined)}
        title={`${narrows === 'map' ? 'Showing only where this aspect applies' : 'Showing only the work on this aspect'} · click to clear`}
        className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-row border border-primary/50 bg-selection px-2 text-xs text-ink"
      >
        <Diamond className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="min-w-0 truncate">{picked ? nameOf(picked) : short(chosen)}</span>
        {picked && <span className="shrink-0 text-ink-faint">{picked.places.length}</span>}
        <X className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
    );
  }
  if (aspects.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex h-7 items-center gap-1.5 rounded-row border border-line-strong px-2 text-xs text-ink-muted hover:bg-raised hover:text-ink"
        title={
          narrows === 'map'
            ? 'Narrow the map to where one aspect applies'
            : 'Narrow the roadmap to the work on one aspect'
        }
      >
        <Diamond className="size-3.5" aria-hidden="true" />
        aspect
        <ChevronDown className="size-3" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <Command loop>
          <CommandInput placeholder="Search aspects…" />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>No aspect by that name.</CommandEmpty>
            {aspectOutline(aspects).map(({ aspect: a, depth }) => (
              <CommandItem
                key={a.aspect}
                value={`${a.aspect} ${a.name ?? ''} ${a.title}`}
                onSelect={() => {
                  setOpen(false);
                  onChoose(a.aspect);
                }}
                className="gap-2"
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                <span className="min-w-0 flex-1 truncate" title={a.title}>
                  {nameOf(a)}
                </span>
                <span className="shrink-0 text-meta text-ink-faint">
                  {a.places.length} {a.places.length === 1 ? 'place' : 'places'}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
