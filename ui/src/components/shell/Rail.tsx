// The rail: product, lens, view, and at the bottom the theme and the person. Links carry the node across lenses; the
// view is a search param on the current route. Slots take what a feature owns (the theme picker, the person).
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronDown, Columns3, Flag, Inbox, Layers, ListTree, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lens, View } from '@/data/contract';

export interface RailProps {
  product?: { key: string; title: string };
  /** Several products: the switcher lists them. */
  products?: { key: string; title: string }[];
  lens: Lens;
  node?: string;
  view: View;
  /** Figures beside each lens: features, projects, milestones. */
  lensCounts?: Partial<Record<Lens, number>>;
  /** Figures beside views that have one: the inbox count. */
  viewCounts?: Partial<Record<View, number>>;
  /** Views the current page offers, and the one the lens draws when none is asked for. */
  views: readonly View[];
  defaultView: View;
  themeSlot?: ReactNode;
  personSlot?: ReactNode;
  className?: string;
}

const LENS_ITEMS: { lens: Lens; label: string; icon: LucideIcon }[] = [
  { lens: 'feature', label: 'Feature', icon: Layers },
  { lens: 'milestone', label: 'Milestone', icon: Flag },
];

const VIEW_ITEMS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: 'tree', label: 'Tree', icon: ListTree },
  { view: 'lanes', label: 'Lanes', icon: Columns3 },
  { view: 'inbox', label: 'Inbox', icon: Inbox },
];

export function Rail({
  product,
  products,
  lens,
  node,
  view,
  lensCounts,
  viewCounts,
  views,
  defaultView,
  themeSlot,
  personSlot,
  className,
}: RailProps) {
  return (
    <nav
      aria-label="Rail"
      className={cn('flex h-full w-[220px] shrink-0 flex-col border-r border-line bg-sidebar p-2.5', className)}
    >
      <Link
        to="/"
        className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-[13.5px] font-semibold hover:bg-raised"
        title={products && products.length > 1 ? 'All products' : 'Home'}
      >
        <span className="grid size-[22px] place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {(product?.title ?? 'p').slice(0, 1).toLowerCase()}
        </span>
        <span className="truncate">{product?.title ?? 'pjman'}</span>
        {products && products.length > 1 && <ChevronDown className="ml-auto size-3.5 text-ink-faint" />}
      </Link>

      <RailHeading>Lens</RailHeading>
      {LENS_ITEMS.map(({ lens: l, label, icon: Icon }) => (
        <Link
          key={l}
          to="/$lens/$"
          params={{ lens: l, _splat: node ?? '' }}
          search={{}}
          className={cn(railItem, l === lens && railItemOn)}
          aria-current={l === lens ? 'page' : undefined}
        >
          <Icon className="size-[15px] shrink-0" />
          {label}
          {lensCounts?.[l] !== undefined && (
            <span className="ml-auto text-xs font-normal text-ink-faint">{lensCounts[l]}</span>
          )}
        </Link>
      ))}

      <RailHeading>View</RailHeading>
      {VIEW_ITEMS.filter((v) => views.includes(v.view)).map(({ view: v, label, icon: Icon }) => (
        <Link
          key={v}
          to="/$lens/$"
          params={{ lens, _splat: node ?? '' }}
          search={(prev: Record<string, unknown>) => ({ ...prev, view: v === defaultView ? undefined : v })}
          className={cn(railItem, v === view && railItemOn)}
          aria-current={v === view ? 'page' : undefined}
        >
          <Icon className="size-[15px] shrink-0" />
          {label}
          {viewCounts?.[v] ? <span className="ml-auto text-xs font-normal text-ink-faint">{viewCounts[v]}</span> : null}
        </Link>
      ))}

      <div className="flex-1" />
      {themeSlot}
      {personSlot}
    </nav>
  );
}

export const railItem =
  'flex h-8 items-center gap-2.5 rounded-row px-2.5 font-medium text-ink-muted hover:bg-raised hover:text-ink';
export const railItemOn = 'bg-raised text-ink';

export function RailHeading({ children }: { children: ReactNode }) {
  return <div className="label px-2.5 pt-3.5 pb-1.5">{children}</div>;
}
