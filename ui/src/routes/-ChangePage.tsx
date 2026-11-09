// The change's own page (change:change-detail; decisions mirror-the-session-page, own-route, docked-is-folded): the
// shell (the rail and the crumb, product › parent › change), then the change read whole: the change bar, the tree,
// and the sources and the rail, in the panel wide and beneath the body docked. A milestone is this page too (decision
// milestone-detail/milestone-is-a-page): the same view read over its children.
import { useCallback, useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Pending } from '@/components/Pending';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem, type RailProduct } from '@/components/shell/Rail';
import { TopBar } from '@/components/shell/TopBar';
import type { ProductRow } from '@/data/contract';
import { usePrefetchDestinations, useScope, useStore } from '@/data/queries';
import { ChangeView } from '@/features/change';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { MomentChip } from '@/features/moment';
import { FollowPill, ThisSession } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';
const LENS = 'feature';

const railProduct = (p: ProductRow): RailProduct => ({
  key: p.key,
  name: p.name ?? short(p.key),
  title: p.title,
  open: p.open,
  inFlight: p.inFlight,
  loud: p.loud,
});

export function ChangePage({ changeKey }: { changeKey: string }) {
  const wide = useWide();
  const { data: store } = useStore();
  const scope = useScope({ lens: LENS, node: changeKey });
  // identity has one source: this page's own scope, never the page before it while this one loads
  const data = scope.data && !scope.isPlaceholderData ? scope.data : undefined;
  const productKey = data?.crumbs.find((c) => c.key.startsWith('product:'))?.key;
  usePrefetchDestinations(productKey);
  const setLastProduct = usePreferences((s) => s.setLastProduct);
  useEffect(() => {
    if (productKey) setLastProduct(productKey);
  }, [productKey, setLastProduct]);
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);
  const [railOpenFor, setRailOpenFor] = useState<string | null>(null);
  const railOpen = railOpenFor === changeKey;

  if (scope.error) return <EmptyState title={`Nothing at ${changeKey}.`} hint={scope.error.message} className="m-6" />;
  const ctx = data?.change;
  if (!data || !ctx) return <Pending />;

  const product = store?.products.find((p) => p.key === productKey);
  const rail = (
    <Rail
      product={product ? railProduct(product) : productKey ? { key: productKey, name: short(productKey) } : undefined}
      products={store?.products.map(railProduct)}
      lens={LENS}
      node={productKey}
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
  const c = ctx.change;
  const bar = (
    <TopBar
      lens={LENS}
      crumbs={wide ? data.crumbs.filter((k) => !k.key.startsWith('product:') && k.key !== c.key) : []}
      current={wide ? { key: c.key, title: c.name ?? c.title ?? short(c.key) } : undefined}
      kind={wide ? (c.data.kind === 'bug' ? 'bug' : ctx.children.length ? 'milestone' : 'change') : undefined}
      onOpenPalette={openPalette}
      onOpenRail={wide ? undefined : () => setRailOpenFor(changeKey)}
      trailing={
        <>
          <MomentChip />
          <FollowPill className={wide ? undefined : 'min-w-0 flex-1'} />
        </>
      }
    />
  );
  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpenFor(null)}>
      {wide ? (
        <ChangeView ctx={ctx} scope={data} lens={LENS} wide page />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <ChangeView ctx={ctx} scope={data} lens={LENS} wide={false} page />
        </div>
      )}
      <CommandPalette open={palette} onOpenChange={setPalette} lens={LENS} />
    </AppShell>
  );
}
