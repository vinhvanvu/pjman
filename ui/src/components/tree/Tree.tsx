// The tree: a generic outline over headless-tree with connectors from every parent to its children, keyboard
// navigation and controlled expansion. The row's content is the caller's; the structure, the guides and the chevron are
// this component's. Data in (a root id and two lookups), expansion out.
import {
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type ItemInstance,
} from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export interface TreeRowContext<T> {
  item: ItemInstance<T>;
  data: T;
  level: number;
  expanded: boolean;
  folder: boolean;
  selected: boolean;
  toggle: () => void;
}

export interface TreeProps<T> {
  rootId: string;
  getItem: (id: string) => T;
  getChildren: (id: string) => string[];
  isFolder: (data: T) => boolean;
  getName: (data: T) => string;
  expanded: string[];
  onExpandedChange: (ids: string[]) => void;
  selectedId?: string;
  /** A click on a row. */
  onSelect?: (data: T) => void;
  renderRow: (ctx: TreeRowContext<T>) => ReactNode;
  /** Changes when the data behind the lookups changed, so the tree rebuilds. */
  version: string | number;
  label: string;
  className?: string;
  /** Pixels per level of depth. */
  indent?: number;
}

const INDENT = 24;

export function Tree<T>({
  rootId,
  getItem,
  getChildren,
  isFolder,
  getName,
  expanded,
  onExpandedChange,
  selectedId,
  onSelect,
  renderRow,
  version,
  label,
  className,
  indent = INDENT,
}: TreeProps<T>) {
  const tree = useTree<T>({
    rootItemId: rootId,
    dataLoader: { getItem, getChildren },
    isItemFolder: (item) => isFolder(item.getItemData()),
    getItemName: (item) => getName(item.getItemData()),
    onPrimaryAction: (item) => onSelect?.(item.getItemData()),
    state: { expandedItems: expanded, selectedItems: selectedId ? [selectedId] : [] },
    setExpandedItems: (updater) => onExpandedChange(typeof updater === 'function' ? updater(expanded) : updater),
    setSelectedItems: () => undefined,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, expandAllFeature],
  });

  // the lookups are closures over fresh data whenever `version` changes; the tree instance is stable
  // `version` is the signal; the tree instance is stable and the lookups close over fresh data
  // oxlint-disable-next-line react/exhaustive-effect-dependencies
  useEffect(() => tree.rebuildTree(), [version, tree]);

  return (
    <div {...tree.getContainerProps(label)} className={cn('flex flex-col outline-none', className)}>
      {tree.getItems().map((item) => {
        const meta = item.getItemMeta();
        const data = item.getItemData();
        const folder = item.isFolder();
        const isExpanded = item.isExpanded();
        const guides = ancestorsWithLaterSiblings(item);
        const last = meta.posInSet === meta.setSize - 1;
        const props = item.getProps() as Record<string, unknown>;
        return (
          <div
            key={item.getId()}
            {...props}
            role="treeitem"
            tabIndex={item.isSelected() ? 0 : -1}
            aria-selected={item.isSelected()}
            onClick={() => onSelect?.(data)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect?.(data);
            }}
            className={cn(
              'group flex h-8 cursor-default items-stretch rounded-row outline-none select-none focus-visible:ring-1 focus-visible:ring-ring',
              item.isSelected() ? 'bg-selection' : 'hover:bg-raised',
            )}
          >
            {guides.map((on, i) => (
              <span key={i} className="relative w-6 shrink-0" style={{ width: indent }} aria-hidden="true">
                {on && (
                  <span className="absolute inset-y-0 border-l border-line-strong" style={{ left: indent / 2 - 1 }} />
                )}
              </span>
            ))}
            {meta.level > 0 && (
              <span className="relative shrink-0" style={{ width: indent }} aria-hidden="true">
                <span
                  className="absolute top-0 h-1/2 rounded-bl-[7px] border-b border-l border-line-strong"
                  style={{ left: indent / 2 - 1, width: indent / 2 }}
                />
                {!last && (
                  <span
                    className="absolute top-1/2 bottom-0 border-l border-line-strong"
                    style={{ left: indent / 2 - 1 }}
                  />
                )}
              </span>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={folder ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
              aria-hidden={!folder}
              disabled={!folder}
              onClick={(e) => {
                e.stopPropagation();
                if (isExpanded) item.collapse();
                else item.expand();
              }}
              className={cn(
                'grid size-6 shrink-0 place-items-center self-center rounded text-ink-faint',
                folder ? 'hover:bg-raised hover:text-ink' : 'invisible',
              )}
            >
              <ChevronRight className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')} />
            </button>
            {renderRow({
              item,
              data,
              level: meta.level,
              expanded: isExpanded,
              folder,
              selected: item.isSelected(),
              toggle: () => (isExpanded ? item.collapse() : item.expand()),
            })}
          </div>
        );
      })}
    </div>
  );
}

/** For each ancestor level above this item, whether a guide line should pass through: true when that ancestor has
 *  siblings after it. Root children (level 0) have no guides. */
function ancestorsWithLaterSiblings<T>(item: ItemInstance<T>): boolean[] {
  const out: boolean[] = [];
  let cur = item.getParent();
  while (cur && cur.getItemMeta().level >= 0) {
    const m = cur.getItemMeta();
    out.unshift(m.posInSet < m.setSize - 1);
    cur = cur.getParent();
  }
  return out;
}
