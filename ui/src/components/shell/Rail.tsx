// The rail: the product, then three destinations with no headings (decision rail-destinations/three-destinations),
// the bridge first as where a person lands, the product map and the roadmap as the structures everything derives from;
// at the bottom the session this tab follows (change:session-detail), the theme and the person. Links to the lenses
// carry the node across. Slots take what a feature owns.
import { Link, useNavigate } from '@tanstack/react-router';
import { cn } from 'cn';
import { Check, ChevronDown, Layers, Radar, Route, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lens } from '@/data/contract';
import { plural } from '@/lib/format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TONE } from '@/lib/tones';

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

/** Where the page is: the bridge, or one of the two lenses. */
export type Destination = 'bridge' | Lens;

export interface RailProps {
  product?: RailProduct;
  /** Every product in the store: with more than one, the header is a switcher. */
  products?: RailProduct[];
  /** The destination this page is; nothing is marked when it is none of the three. */
  current?: Destination;
  /** The node the lens links carry across, when the page stands on one. */
  node?: string;
  /** The lens the product switcher lands in, and that the node links use. */
  lens: Lens;
  /** The session this tab follows, as a destination at the foot (features/session-follow). */
  sessionSlot?: ReactNode;
  themeSlot?: ReactNode;
  personSlot?: ReactNode;
  className?: string;
}

const LENS_ITEMS: { lens: Lens; label: string; icon: LucideIcon }[] = [
  { lens: 'feature', label: 'Product map', icon: Layers },
  { lens: 'roadmap', label: 'Roadmap', icon: Route },
];

export function Rail({
  product,
  products,
  current,
  node,
  lens,
  sessionSlot,
  themeSlot,
  personSlot,
  className,
}: RailProps) {
  const navigate = useNavigate();
  const several = (products?.length ?? 0) > 1;
  const headerClass =
    'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13.5px] font-semibold hover:bg-raised';
  const lensOf = (d: Destination | undefined): Lens => (d && d !== 'bridge' ? d : lens);
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
                onSelect={() =>
                  current === 'bridge' || !current
                    ? navigate({ to: '/bridge/$', params: { _splat: p.key }, search: {} })
                    : navigate({ to: '/$lens/$', params: { lens: lensOf(current), _splat: p.key }, search: {} })
                }
                className="flex items-start gap-2 py-1.5"
                aria-current={p.key === product?.key ? 'true' : undefined}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className={cn('truncate text-xs text-ink-muted', p.loud && TONE.alarm.text)}>
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
          to="/bridge/$"
          params={{ _splat: product?.key ?? '' }}
          search={{}}
          className={headerClass}
          title={product?.title ?? 'Home'}
        >
          <span className="truncate">{product?.name ?? 'pjman'}</span>
        </Link>
      )}

      <div className="flex flex-col gap-0.5 pt-3">
        {product && (
          <Link
            to="/bridge/$"
            params={{ _splat: product.key }}
            search={{}}
            className={cn(railItem, current === 'bridge' && railItemOn)}
            aria-current={current === 'bridge' ? 'page' : undefined}
          >
            <Radar className="size-[15px] shrink-0" />
            Bridge
          </Link>
        )}
        {LENS_ITEMS.map(({ lens: l, label, icon: Icon }) => (
          <Link
            key={l}
            to="/$lens/$"
            params={{ lens: l, _splat: node ?? product?.key ?? '' }}
            search={{}}
            className={cn(railItem, current === l && railItemOn)}
            aria-current={current === l ? 'page' : undefined}
          >
            <Icon className="size-[15px] shrink-0" />
            {label}
          </Link>
        ))}
      </div>

      <div className="flex-1" />
      {sessionSlot}
      {themeSlot}
      {personSlot}
    </nav>
  );
}

export const railItem =
  'flex h-8 items-center gap-2.5 rounded-row px-2.5 font-medium text-ink-muted hover:bg-raised hover:text-ink';
export const railItemOn = 'bg-raised text-ink';
