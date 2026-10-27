// The rail: product, lens, view, and at the bottom the theme and the person. Links carry the node across lenses; the
// view is a search param on the current route. Slots take what a feature owns (the theme picker, the person).
import { Link, useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  Bug,
  ChartGantt,
  Check,
  ChevronDown,
  Columns3,
  Inbox,
  Layers,
  ListTree,
  Route,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lens, View } from '@/data/contract';
import { plural } from '@/lib/format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** A product as the rail names it: the short name, and one line of health for the switcher. */
export interface RailProduct {
  key: string;
  name: string;
  title?: string;
  open?: number;
  inFlight?: number;
  loud?: number;
}

const healthLine = (p: RailProduct): string =>
  [
    p.open !== undefined ? plural(p.open, 'open change') : '',
    p.inFlight ? `${p.inFlight} in flight` : '',
    p.loud ? `${plural(p.loud, 'loud bug')}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || 'nothing open';

export interface RailProps {
  product?: RailProduct;
  /** Every product in the store: with more than one, the header is a switcher. */
  products?: RailProduct[];
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
  { lens: 'feature', label: 'Product map', icon: Layers },
  { lens: 'roadmap', label: 'Roadmap', icon: Route },
];

/** The tree view is the lens's own structure: the map in the feature lens, the chart in the roadmap lens. */
const viewItems = (lens: Lens): { view: View; label: string; icon: LucideIcon }[] => [
  lens === 'roadmap'
    ? { view: 'tree', label: 'Chart', icon: ChartGantt }
    : { view: 'tree', label: 'Map', icon: ListTree },
  { view: 'lanes', label: 'Lanes', icon: Columns3 },
  { view: 'inbox', label: 'Inbox', icon: Inbox },
  { view: 'bugs', label: 'Bugs', icon: Bug },
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
  const navigate = useNavigate();
  const several = (products?.length ?? 0) > 1;
  const headerClass =
    'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13.5px] font-semibold hover:bg-raised';
  return (
    <nav
      aria-label="Rail"
      className={cn('flex h-full w-[220px] shrink-0 flex-col border-r border-line bg-sidebar p-2.5', className)}
    >
      {several ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(headerClass, 'data-[state=open]:bg-raised')}
            title={product?.title}
            aria-label={`Product: ${product?.name ?? 'none'}. Switch product`}
          >
            <span className="truncate">{product?.name ?? 'Products'}</span>
            <ChevronDown className="ml-auto size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[260px]">
            <DropdownMenuLabel className="text-meta text-ink-faint">Products</DropdownMenuLabel>
            {products!.map((p) => (
              <DropdownMenuItem
                key={p.key}
                onSelect={() => navigate({ to: '/$lens/$', params: { lens, _splat: p.key }, search: {} })}
                className="flex items-start gap-2 py-1.5"
                aria-current={p.key === product?.key ? 'true' : undefined}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className={cn('truncate text-xs text-ink-muted', p.loud && 'text-status-blocked')}>
                    {healthLine(p)}
                  </span>
                </span>
                {p.key === product?.key && (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Link
          to="/$lens/$"
          params={{ lens, _splat: product?.key ?? '' }}
          search={{}}
          className={headerClass}
          title={product?.title ?? 'Home'}
        >
          <span className="truncate">{product?.name ?? 'pjman'}</span>
        </Link>
      )}

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
      {viewItems(lens)
        .filter((v) => views.includes(v.view))
        .map(({ view: v, label, icon: Icon }) => (
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
            {viewCounts?.[v] ? (
              <span
                className={cn('ml-auto text-xs font-normal', v === 'bugs' ? 'text-status-blocked' : 'text-ink-faint')}
              >
                {viewCounts[v]}
              </span>
            ) : null}
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
