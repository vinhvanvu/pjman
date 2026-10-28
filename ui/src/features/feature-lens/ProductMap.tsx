// The product map: features only, opening collapsed every time (only the path to the selection is open), state as a
// dot, counts faint and right-aligned, connectors from parent to child. A click selects (the record pane shows it); the
// filter bar narrows the map and opens the matches.
import { Bug } from 'lucide-react';
import { useMemo } from 'react';
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import { plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, Label, StateDot } from '@/components/chips/Chip';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/button';
import { FilterBar } from './FilterBar';
import {
  allFeatureKeys,
  bugMark,
  filterTree,
  isFiltering,
  MAP_ROOT,
  matches,
  productMap,
  unassigned,
  type MapFilter,
} from './model';

export interface ProductMapProps {
  scope: Scope;
  expanded: string[];
  onExpandedChange: (ids: string[]) => void;
  selected?: string;
  onSelect: (key: string) => void;
  filter: MapFilter;
  onFilterChange: (f: MapFilter) => void;
  /** The scope's changes before narrowing: the milestones the picker lists. */
  changes: ChangeRow[];
  version: string | number;
}

export function ProductMap({
  scope,
  expanded,
  onExpandedChange,
  selected,
  onSelect,
  filter,
  onFilterChange,
  changes,
  version,
}: ProductMapProps) {
  const filtering = isFiltering(filter);
  const tree = useMemo(() => filterTree(scope.tree, filter), [scope.tree, filter]);
  const map = useMemo(() => productMap(tree), [tree]);
  const root = useMemo<ScopeNode>(
    () => ({
      key: MAP_ROOT,
      type: 'product',
      owners: [],
      open: 0,
      inFlight: 0,
      projects: [],
      childCount: 0,
      children: tree,
    }),
    [tree],
  );
  const left = unassigned(scope.tree);
  const all = allFeatureKeys(tree);
  // while filtering every match is visible: the whole narrowed tree is open
  const shownExpanded = filtering ? all : expanded;
  const allOpen = all.length > 0 && all.every((k) => shownExpanded.includes(k));
  const top = map.children.get(MAP_ROOT) ?? [];
  const matched = filtering ? [...map.items.values()].filter((n) => matches(n, filter)).length : undefined;

  return (
    <section aria-label="Product map" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-2">
        <h2 className="text-section font-semibold">Product map</h2>
        <span className="text-xs text-ink-muted">
          {plural(top.length, 'feature')}
          {scope.doneHidden ? ` · ${scope.doneHidden} done hidden` : ''}
        </span>
        <div className="flex-1" />
        {all.length > 0 && !filtering && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onExpandedChange(allOpen ? [] : all)}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        )}
      </div>
      <FilterBar filter={filter} onChange={onFilterChange} matched={matched} changes={changes} />
      <div className="flex-1 px-3 pb-4">
        {top.length === 0 && (
          <p className="px-2 py-3 text-xs text-ink-faint">
            {filtering
              ? filter.bugs && !filter.q && !filter.states?.length
                ? 'No open bugs beneath this node.'
                : 'No feature matches the filter.'
              : 'No features beneath this one. Its changes are in the record pane.'}
          </p>
        )}
        <Tree<ScopeNode>
          rootId={MAP_ROOT}
          getItem={(id) => (id === MAP_ROOT ? root : map.items.get(id)!)}
          getChildren={(id) => map.children.get(id) ?? []}
          isFolder={(n) => (map.children.get(n.key)?.length ?? 0) > 0}
          getName={(n) => n.name ?? n.title ?? n.key}
          expanded={shownExpanded}
          onExpandedChange={filtering ? () => undefined : onExpandedChange}
          selectedId={selected}
          onSelect={(n) => onSelect(n.key)}
          version={`${version}:${filtering ? JSON.stringify(filter) : ''}`}
          label="Product map"
          renderRow={({ data: n, level }) => (
            <FeatureRow
              node={n}
              top={level === 0}
              capabilities={map.children.get(n.key)?.length ?? 0}
              dim={filtering && !matches(n, filter)}
            />
          )}
        />
        {left && (!filtering || filter.milestone) && (
          <div className="mx-2 mt-3.5 flex items-center gap-2 border-t border-dashed border-line-strong pt-3">
            <span className="text-xs text-ink-muted">{left.title}</span>
            <Chip tone="quiet">
              {plural(left.children.length, 'change')}
              {filter.milestone ? ' in this milestone' : ''}
            </Chip>
            <div className="flex-1" />
            <span className="truncate text-xs text-ink-faint">
              {left.children.map((c) => short(c.key)).join(' · ')}
            </span>
          </div>
        )}
      </div>
      <footer className="mt-auto flex items-center gap-3.5 border-t border-line px-5 py-2.5 text-meta text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <StateDot state="live" /> live
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StateDot state="building" /> building
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StateDot state="planned" /> planned
        </span>
        <div className="flex-1" />
        {scope.retiredHidden > 0 && <span className="text-ink-faint">{scope.retiredHidden} retired hidden</span>}
      </footer>
    </section>
  );
}

function FeatureRow({
  node: n,
  top,
  capabilities,
  dim,
}: {
  node: ScopeNode;
  top: boolean;
  capabilities: number;
  dim?: boolean;
}) {
  const label = n.name ?? n.title ?? short(n.key);
  const bugs = bugMark(n);
  return (
    <div
      className={
        dim ? 'flex min-w-0 flex-1 items-center gap-2 pr-2 opacity-50' : 'flex min-w-0 flex-1 items-center gap-2 pr-2'
      }
      title={n.title}
    >
      <StateDot state={n.derived ?? n.status} title={n.derived ?? n.status} />
      <span className="min-w-0 truncate font-medium">{label}</span>
      {top && n.level && <Label>{n.level}</Label>}
      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-meta text-ink-faint">
        {bugs && (
          <span
            title={bugs.title}
            className={
              bugs.tone === 'loud'
                ? 'inline-flex items-center gap-1 font-medium text-status-blocked'
                : bugs.tone === 'warn'
                  ? 'inline-flex items-center gap-1 text-status-review'
                  : 'inline-flex items-center gap-1'
            }
          >
            <Bug className="size-3" aria-hidden="true" />
            {bugs.count}
          </span>
        )}
        {capabilities > 0 && <span>{plural(capabilities, 'capability', 'capabilities')}</span>}
        <span className="min-w-[48px] text-right">{n.open ? `${n.open} open` : '—'}</span>
      </span>
    </div>
  );
}
