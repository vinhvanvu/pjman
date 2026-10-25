// The filter bar above the product map: a text and the states. All of it is URL state, so a filtered map is
// a link, and a saved view later is one of these links with a name.
import { cn } from 'cn';
import { Search, X } from 'lucide-react';
import { StateDot } from '@/components/chips/Chip';
import type { MapFilter } from './model';
import { isFiltering } from './model';

const STATES = ['live', 'building', 'planned', 'retired'] as const;

export interface FilterBarProps {
  filter: MapFilter;
  onChange: (f: MapFilter) => void;
  /** How many features match, when filtering. */
  matched?: number;
  className?: string;
}

export function FilterBar({ filter, onChange, matched, className }: FilterBarProps) {
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
