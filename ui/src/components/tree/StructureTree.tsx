// A tree over scope nodes of any kind: projects and products as containers, changes nested by parent. The project
// and milestone lenses draw their tree view with it; the feature lens has its own product map. A click selects.
import { useMemo } from 'react';
import type { ScopeNode } from '@/data/contract';
import { short } from '@/lib/keys';
import { Chip, Label, StatusChip } from '@/components/chips/Chip';
import { Pulse } from '@/components/presence/Presence';
import { Tree } from './Tree';

export const ROOT = '__root__';

/** Index a scope tree for the generic Tree: items by key, children by key. */
export function indexNodes(nodes: ScopeNode[], keep: (n: ScopeNode) => boolean = () => true) {
  const items = new Map<string, ScopeNode>();
  const children = new Map<string, string[]>();
  const walk = (list: ScopeNode[], parent: string) => {
    const ids: string[] = [];
    for (const n of list) {
      if (!keep(n)) continue;
      items.set(n.key, n);
      ids.push(n.key);
      walk(n.children, n.key);
    }
    children.set(parent, ids);
  };
  walk(nodes, ROOT);
  return { items, children };
}

export function StructureTree({
  nodes,
  expanded,
  onExpandedChange,
  selected,
  onSelect,
  showProject,
  version,
}: {
  nodes: ScopeNode[];
  expanded: string[];
  onExpandedChange: (ids: string[]) => void;
  selected?: string;
  onSelect: (key: string) => void;
  showProject?: boolean;
  version: string | number;
}) {
  const ix = useMemo(() => indexNodes(nodes), [nodes]);
  const rootData = useMemo<ScopeNode>(
    () => ({
      key: ROOT,
      type: 'unassigned',
      owners: [],
      open: 0,
      inFlight: 0,
      projects: [],
      childCount: 0,
      children: nodes,
    }),
    [nodes],
  );
  const real = (n: ScopeNode) => n.type !== 'unassigned';
  return (
    <Tree<ScopeNode>
      rootId={ROOT}
      getItem={(id) => (id === ROOT ? rootData : ix.items.get(id)!)}
      getChildren={(id) => ix.children.get(id) ?? []}
      isFolder={(n) => n.children.length > 0}
      getName={(n) => n.name ?? n.title ?? n.key}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      selectedId={selected}
      onSelect={(n) => real(n) && onSelect(n.key)}
      version={version}
      label="Structure"
      renderRow={({ data: n }) => <StructureRow node={n} showProject={showProject} />}
    />
  );
}

function StructureRow({ node: n, showProject }: { node: ScopeNode; showProject?: boolean }) {
  if (n.type === 'change' && n.row) {
    const r = n.row;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-2" title={r.title}>
        {r.live && <Pulse className="size-[7px]" />}
        <span className="min-w-0 flex-1 truncate font-medium">{r.title ?? short(r.key)}</span>
        <StatusChip status={r.status} />
        {r.ticket && (
          <Chip tone="quiet" mono>
            {r.ticket.label}
          </Chip>
        )}
        {r.waiting > 0 && <Chip tone="quiet">○ {r.waiting}</Chip>}
        {r.progress && (
          <Chip tone="quiet">
            {r.progress.done} / {r.progress.total}
          </Chip>
        )}
        {showProject && r.project && <span className="text-meta text-ink-faint">{short(r.project)}</span>}
      </div>
    );
  }
  if (n.type === 'unassigned') {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
        <span className="truncate text-ink-muted">{n.title}</span>
        <Chip tone="quiet">{n.open} open</Chip>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 pr-2" title={n.title}>
      <span className="min-w-0 truncate font-medium">{n.name ?? n.title ?? short(n.key)}</span>
      <Label>{n.level}</Label>
      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-meta text-ink-faint">
        {n.progress && (
          <span>
            {n.progress.done} / {n.progress.total} done
          </span>
        )}
        <span>{n.open} open</span>
      </span>
    </div>
  );
}
