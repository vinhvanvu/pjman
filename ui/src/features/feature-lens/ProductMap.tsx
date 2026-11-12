// The product map: the features, opening collapsed every time (only the path to the selection is open), state as a
// dot, counts faint and right-aligned, connectors from parent to child; at each node's leaves the changes on it, each
// the change component at its row depth (decision feature-detail/change-at-three-depths), the unassigned ones one
// group at the foot. A click selects (the record pane shows it); the filter bar narrows the map and opens the
// matches. Under an aspect, each place is a leaf marked as forked or as the base as it is (decision
// aspects-dashboard/aspect-is-a-map-lens). A feature with a session working beneath it breathes (decision
// alive-on-the-map). A hold lights a change's row and the path down to it and dims the rest (decision
// hold-lights-the-map); a hover lights the same without the dimming.
import { cn } from 'cn';
import { Bug } from 'lucide-react';
import { useMemo } from 'react';
import type { ChangeRow, LiveSession, Scope, ScopeNode } from '@/data/contract';
import { plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, Label, StateDot } from '@/components/chips/Chip';
import { ChangeLine } from '@/components/change/ChangeLine';
import { factsOfRow } from '@/components/change/model';
import { Pulse } from '@/components/presence/Presence';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/button';
import { FilterBar } from './FilterBar';
import {
  allFeatureKeys,
  bugMark,
  filterTree,
  isFiltering,
  litBy,
  liveBeneath,
  MAP_ROOT,
  matches,
  namesIn,
  placesAt,
  productMap,
  UNASSIGNED,
  type MapFilter,
} from './model';
import { TONE } from '@/lib/tones';

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
  /** The change under the pointer, on a row or a card: its row and path light. */
  hover?: string;
  onHover: (change: string | undefined) => void;
  /** The changes held: their rows and paths lit, the rest dimmed. */
  held: readonly string[];
  onHold: (change: string) => void;
  now: number;
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
  hover,
  onHover,
  held,
  onHold,
  now,
}: ProductMapProps) {
  const filtering = isFiltering(filter);
  const places = useMemo(() => placesAt(scope.aspects, filter.aspect), [scope.aspects, filter.aspect]);
  const tree = useMemo(() => filterTree(scope.tree, filter, places), [scope.tree, filter, places]);
  const map = useMemo(() => productMap(tree), [tree]);
  const names = useMemo(
    () => namesIn(scope.tree, scope.changes, scope.node ? [...scope.crumbs, scope.node] : scope.crumbs),
    [scope.tree, scope.changes, scope.crumbs, scope.node],
  );
  const alive = useMemo(() => liveBeneath(tree), [tree]);
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
  const all = allFeatureKeys(tree);
  // while filtering every match is visible: the whole narrowed tree is open
  const shownExpanded = filtering ? [...all, UNASSIGNED] : expanded;
  const allOpen = all.length > 0 && all.every((k) => shownExpanded.includes(k));
  // the features at the top; the changes and the unassigned group beside them are not counted as features
  const top = (map.children.get(MAP_ROOT) ?? []).filter((id) => {
    const t = map.items.get(id)?.type;
    return t === 'feature' || t === 'product';
  });
  const matched = filtering
    ? [...map.items.values()].filter((n) => n.type !== 'change' && matches(n, filter, places)).length
    : undefined;
  // what is lit: the held changes and the paths down to them; the hover the same, without the dimming
  const heldLit = useMemo(() => litBy(tree, held), [tree, held]);
  const hoverLit = useMemo(() => (hover ? litBy(tree, [hover]) : undefined), [tree, hover]);
  const holding = held.length > 0;
  const heldSet = useMemo(() => new Set(held), [held]);
  const selectedIds = selected ? (map.idsOf.get(selected) ?? [selected]) : undefined;
  const sessions: LiveSession[] = scope.sessions;

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
            onClick={() => onExpandedChange(allOpen ? [] : [...all, UNASSIGNED])}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        )}
      </div>
      <FilterBar
        filter={filter}
        onChange={onFilterChange}
        matched={matched}
        changes={changes}
        aspects={scope.aspects}
      />
      <div className="flex-1 px-3 pb-4">
        {top.length === 0 && !map.items.has(UNASSIGNED) && (
          <p className="px-2 py-3 text-xs text-ink-faint">
            {filtering
              ? filter.aspect && !filter.q && !filter.states?.length && !filter.bugs
                ? 'This aspect applies nowhere beneath this node.'
                : filter.bugs && !filter.q && !filter.states?.length
                  ? 'No open bugs beneath this node.'
                  : 'No feature matches the filter.'
              : 'Nothing beneath this node: no feature and no change.'}
          </p>
        )}
        <Tree<ScopeNode>
          rootId={MAP_ROOT}
          getItem={(id) => (id === MAP_ROOT ? root : map.items.get(id)!)}
          getChildren={(id) => map.children.get(id) ?? []}
          isFolder={(n) =>
            n.type !== 'change' && (map.children.get(n.type === 'unassigned' ? UNASSIGNED : n.key)?.length ?? 0) > 0
          }
          getName={(n) => n.name ?? n.title ?? n.key}
          expanded={shownExpanded}
          onExpandedChange={filtering ? () => undefined : onExpandedChange}
          selectedIds={selectedIds}
          onSelect={(n) => n.type !== 'unassigned' && onSelect(n.key)}
          version={`${version}:${filtering ? JSON.stringify(filter) : ''}`}
          label="Product map"
          renderRow={({ data: n, level }) => {
            if (n.type === 'change' && n.row) {
              const key = n.row.key;
              return (
                <ChangeLine
                  change={factsOfRow(n.row, sessions, names)}
                  held={heldSet.has(key)}
                  lit={!heldSet.has(key) && (heldLit.has(key) || hoverLit?.has(key))}
                  dim={holding && !heldLit.has(key)}
                  onHover={onHover}
                  onHold={() => onHold(key)}
                  now={now}
                />
              );
            }
            if (n.type === 'unassigned') {
              return (
                <div
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 pr-2',
                    holding && !heldLit.has(UNASSIGNED) && 'opacity-45',
                  )}
                >
                  <span className="truncate text-ink-muted">{n.title ?? 'No feature named'}</span>
                  {alive.has(UNASSIGNED) && <Pulse className="size-[6px]" />}
                  <span className="ml-auto text-meta text-ink-faint">{n.open ? `${n.open} open` : '—'}</span>
                </div>
              );
            }
            return (
              <FeatureRow
                node={n}
                top={level === 0}
                capabilities={
                  (map.children.get(n.key) ?? []).filter((id) => map.items.get(id)?.type !== 'change').length
                }
                dim={(filtering && !matches(n, filter, places)) || (holding && !heldLit.has(n.key))}
                lit={heldLit.has(n.key) || !!hoverLit?.has(n.key)}
                alive={alive.has(n.key)}
                place={filter.aspect ? places.get(n.key) : undefined}
              />
            );
          }}
        />
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
        <span className="inline-flex items-center gap-1.5">
          <Pulse className="size-[6px]" /> a session is on it
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-[7px] rounded-full', TONE.waits.bg)} /> waits on you
        </span>
        {scope.retiredHidden > 0 && <span className="pl-2 text-ink-faint">{scope.retiredHidden} retired hidden</span>}
      </footer>
    </section>
  );
}

function FeatureRow({
  node: n,
  top,
  capabilities,
  dim,
  lit,
  alive,
  place,
}: {
  node: ScopeNode;
  top: boolean;
  capabilities: number;
  dim?: boolean;
  /** On a held or hovered change's path: the steady ring. */
  lit?: boolean;
  /** A session is working beneath it: the breathing dot. */
  alive?: boolean;
  /** Under an aspect: the place at this feature, which covers everything beneath it. */
  place?: { forked: boolean };
}) {
  const label = n.name ?? n.title ?? short(n.key);
  const bugs = bugMark(n);
  const waiting = n.health?.waiting ?? 0;
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-row pr-2 transition-opacity',
        dim && 'opacity-45',
        lit && 'ring-1 ring-primary ring-inset pl-1',
      )}
      title={n.title}
    >
      <StateDot state={n.derived ?? n.status} title={n.derived ?? n.status} />
      <span className="min-w-0 truncate font-medium">{label}</span>
      {top && n.level && <Label>{n.level}</Label>}
      {place && (
        <Chip tone="quiet" title={place.forked ? 'The aspect forks here' : 'The aspect applies here as its base says'}>
          {place.forked ? 'forked' : 'base'}
        </Chip>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-meta text-ink-faint">
        {alive && <Pulse className="size-[6px]" />}
        {waiting > 0 && (
          <span
            role="img"
            aria-label={`${waiting} waiting on you beneath`}
            title={`${waiting} waiting on you beneath`}
            className={cn('size-[7px] rounded-full', TONE.waits.bg)}
          />
        )}
        {bugs && (
          <span
            title={bugs.title}
            className={
              bugs.tone === 'loud'
                ? cn('inline-flex items-center gap-1 font-medium', TONE.alarm.text)
                : bugs.tone === 'warn'
                  ? cn('inline-flex items-center gap-1', TONE.waits.text)
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
