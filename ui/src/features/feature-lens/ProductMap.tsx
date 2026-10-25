// The product map: features only, collapsed by default, state as a dot, counts faint and right-aligned, connectors from
// parent to child. A click selects (the record pane shows it); a double-click focuses (the map re-roots there).
import { useMemo } from 'react';
import type { Scope, ScopeNode } from '@/data/contract';
import { plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, Label, StateDot } from '@/components/chips/Chip';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/button';
import { allFeatureKeys, MAP_ROOT, productMap, unassigned } from './model';

export interface ProductMapProps {
  scope: Scope;
  expanded: string[];
  onExpandedChange: (ids: string[]) => void;
  selected?: string;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  version: string | number;
}

export function ProductMap({
  scope,
  expanded,
  onExpandedChange,
  selected,
  onSelect,
  onOpen,
  version,
}: ProductMapProps) {
  const map = useMemo(() => productMap(scope.tree), [scope.tree]);
  const root = useMemo<ScopeNode>(
    () => ({
      key: MAP_ROOT,
      type: 'product',
      owners: [],
      open: 0,
      inFlight: 0,
      projects: [],
      childCount: 0,
      children: scope.tree,
    }),
    [scope.tree],
  );
  const left = unassigned(scope.tree);
  const all = allFeatureKeys(scope.tree);
  const allOpen = all.length > 0 && all.every((k) => expanded.includes(k));
  const top = map.children.get(MAP_ROOT) ?? [];

  return (
    <section aria-label="Product map" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-2">
        <h2 className="text-section font-semibold">Product map</h2>
        <span className="text-xs text-ink-muted">
          {plural(top.length, 'feature')}
          {scope.doneHidden ? ` · ${scope.doneHidden} done hidden` : ''}
        </span>
        <div className="flex-1" />
        {all.length > 0 && (
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
      <div className="flex-1 px-3 pb-4">
        {top.length === 0 && (
          <p className="px-2 py-3 text-xs text-ink-faint">
            No features beneath this one. Its changes are in the record pane.
          </p>
        )}
        <Tree<ScopeNode>
          rootId={MAP_ROOT}
          getItem={(id) => (id === MAP_ROOT ? root : map.items.get(id)!)}
          getChildren={(id) => map.children.get(id) ?? []}
          isFolder={(n) => (map.children.get(n.key)?.length ?? 0) > 0}
          getName={(n) => n.name ?? n.title ?? n.key}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          selectedId={selected}
          onSelect={(n) => onSelect(n.key)}
          onOpen={(n) => onOpen(n.key)}
          version={version}
          label="Product map"
          renderRow={({ data: n, level }) => (
            <FeatureRow node={n} top={level === 0} capabilities={map.children.get(n.key)?.length ?? 0} />
          )}
        />
        {left && (
          <div className="mx-2 mt-3.5 flex items-center gap-2 border-t border-dashed border-line-strong pt-3">
            <span className="text-xs text-ink-muted">{left.title}</span>
            <Chip tone="quiet">{plural(left.open, 'change')}</Chip>
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
        <span className="text-ink-faint">click selects · double-click focuses</span>
        {scope.retiredHidden > 0 && <span className="text-ink-faint">· {scope.retiredHidden} retired hidden</span>}
      </footer>
    </section>
  );
}

function FeatureRow({ node: n, top, capabilities }: { node: ScopeNode; top: boolean; capabilities: number }) {
  const label = n.name ?? n.title ?? short(n.key);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 pr-2" title={n.title}>
      <StateDot state={n.derived ?? n.status} title={n.derived ?? n.status} />
      <span className="min-w-0 truncate font-medium">{label}</span>
      {top && n.level && <Label>{n.level}</Label>}
      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-meta text-ink-faint">
        {capabilities > 0 && <span>{plural(capabilities, 'capability', 'capabilities')}</span>}
        <span className="min-w-[48px] text-right">{n.open ? `${n.open} open` : '—'}</span>
      </span>
    </div>
  );
}
