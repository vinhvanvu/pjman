// /bridge/*: the bridge, the first of the product's three destinations and its home (decisions three-destinations and
// bridge-is-home): what waits on the person and its sessions by need. The rest of the path is the product's key. The
// shell is the product frame; the content is the bridge feature.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem, type RailProduct } from '@/components/shell/Rail';
import { TopBar } from '@/components/shell/TopBar';
import { EmptyState } from '@/components/EmptyState';
import type { ProductRow } from '@/data/contract';
import { useBridge, useStore } from '@/data/queries';
import { Bridge } from '@/features/bridge';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { FollowPill } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';
import { pageSearch } from './-search';

export const Route = createFileRoute('/bridge/$')({
  validateSearch: pageSearch,
  component: BridgePage,
});

const railProduct = (p: ProductRow): RailProduct => ({
  key: p.key,
  name: p.name ?? short(p.key),
  title: p.title,
  open: p.open,
  inFlight: p.inFlight,
  loud: p.loud,
});

function BridgePage() {
  const { _splat } = Route.useParams();
  const node = _splat || undefined;
  const wide = useWide();
  const { data: store } = useStore();
  // the product is the URL's; a bare /bridge lands on the last product opened, as the home does
  const lastProduct = usePreferences((s) => s.lastProduct);
  const setLastProduct = usePreferences((s) => s.setLastProduct);
  const productKey = node?.startsWith('product:') ? node : undefined;
  const product = store?.products.find((p) => p.key === productKey);
  const bridge = useBridge(productKey);
  useEffect(() => {
    if (product?.key) setLastProduct(product.key);
  }, [product?.key, setLastProduct]);

  const [railOpen, setRailOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);

  if (!productKey && store) {
    const target = store.products.find((p) => p.key === lastProduct) ?? store.products[0];
    if (target) return <Navigate to="/bridge/$" params={{ _splat: target.key }} search={(prev) => prev} replace />;
  }

  const rail = (
    <Rail
      product={product ? railProduct(product) : productKey ? { key: productKey, name: short(productKey) } : undefined}
      products={store?.products.map(railProduct)}
      current="bridge"
      lens="feature"
      node={productKey}
      waiting={bridge.data?.waiting}
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
      lens="feature"
      crumbs={[]}
      current={productKey ? { key: productKey, title: 'Bridge' } : undefined}
      liveSessions={bridge.data?.sessions.filter((s) => s.state === 'working').length ?? 0}
      onOpenPalette={openPalette}
      onOpenRail={wide ? undefined : () => setRailOpen(true)}
      trailing={<FollowPill />}
    />
  );

  let content: React.ReactNode;
  if (!productKey) {
    content = (
      <EmptyState title="No product to stand on." hint="The bridge is a view of one product." className="m-6" />
    );
  } else if (bridge.error) {
    content = <EmptyState title="The bridge could not be read." hint={bridge.error.message} className="m-6" />;
  } else if (!bridge.data) {
    content = <div className="p-6 text-xs text-ink-faint">Loading…</div>;
  } else {
    content = <Bridge data={bridge.data} lens="feature" productName={product?.name ?? short(productKey)} />;
  }

  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpen(false)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{content}</div>
      <CommandPalette open={palette} onOpenChange={setPalette} lens="feature" />
    </AppShell>
  );
}
