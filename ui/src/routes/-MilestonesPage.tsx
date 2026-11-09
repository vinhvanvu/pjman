// The Milestones page (decision milestone-detail/milestones-on-the-rail): the shell with the rail marking Milestones,
// then the index over the product's roadmap scope with the done changes shown, since a milestone's figures count its
// done children. A bare /milestones lands on the last product opened, as the bridge does.
import { Navigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Pending } from '@/components/Pending';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem, type RailProduct } from '@/components/shell/Rail';
import { TopBar } from '@/components/shell/TopBar';
import type { ProductRow } from '@/data/contract';
import { usePrefetchDestinations, useScope, useStore } from '@/data/queries';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { MilestonesIndex } from '@/features/milestones';
import { MomentChip } from '@/features/moment';
import { FollowPill, ThisSession } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';

const LENS = 'roadmap';

const railProduct = (p: ProductRow): RailProduct => ({
  key: p.key,
  name: p.name ?? short(p.key),
  title: p.title,
  open: p.open,
  inFlight: p.inFlight,
  loud: p.loud,
});

export function MilestonesPage({ productKey }: { productKey?: string }) {
  const wide = useWide();
  const { data: store } = useStore();
  const lastProduct = usePreferences((s) => s.lastProduct);
  const setLastProduct = usePreferences((s) => s.setLastProduct);
  const product = productKey?.startsWith('product:') ? productKey : undefined;
  usePrefetchDestinations(product);
  useEffect(() => {
    if (product) setLastProduct(product);
  }, [product, setLastProduct]);
  const scope = useScope({ lens: LENS, node: product, done: true }, !!product);
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);
  const [railOpen, setRailOpen] = useState(false);

  if (!product) {
    const fallback = lastProduct ?? store?.products[0]?.key;
    if (fallback) return <Navigate to="/milestones/$" params={{ _splat: fallback }} search={{}} replace />;
    if (!store) return <Pending />;
    return <EmptyState title="No product yet." hint="A product's milestones are listed here." className="m-6" />;
  }
  const row = store?.products.find((p) => p.key === product);
  const rail = (
    <Rail
      product={row ? railProduct(row) : { key: product, name: short(product) }}
      products={store?.products.map(railProduct)}
      current="milestones"
      lens={LENS}
      node={product}
      sessionSlot={<ThisSession />}
      themeSlot={<ThemePicker />}
      personSlot={
        store?.actor ? (
          <span className={railItem}>
            <User className="size-[15px]" />
            {short(store.actor)}
          </span>
        ) : undefined
      }
    />
  );
  const bar = (
    <TopBar
      lens={LENS}
      crumbs={[]}
      current={{ key: product, title: 'Milestones' }}
      onOpenPalette={openPalette}
      onOpenRail={wide ? undefined : () => setRailOpen(true)}
      trailing={
        <>
          <MomentChip />
          <FollowPill className={wide ? undefined : 'min-w-0 flex-1'} />
        </>
      }
    />
  );
  // identity has one source: this product's own scope, never the one before it while this one loads
  const data = scope.data && !scope.isPlaceholderData ? scope.data : undefined;
  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpen(false)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {scope.error ? (
          <EmptyState title={`Nothing at ${product}.`} hint={scope.error.message} className="m-6" />
        ) : data ? (
          <MilestonesIndex scope={data} lens={LENS} />
        ) : (
          <Pending />
        )}
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} lens={LENS} />
    </AppShell>
  );
}
