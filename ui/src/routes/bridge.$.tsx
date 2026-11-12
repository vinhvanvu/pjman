// /bridge/*: the bridge, the first of the product's three destinations and its home (decisions three-destinations and
// bridge-is-home): the transport as the one timeline and the changes in motion as cards beneath it (decision
// bridge-rework/cards-and-transport). The rest of the path is the product's key. The shell is the product frame; the
// content is the bridge feature. The tie between the two lives here: the change under the pointer, on a card or on a
// tick, and the change held in the URL (`hold`), which filters the transport and lifts its card.
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem, type RailProduct } from '@/components/shell/Rail';
import { TopBar } from '@/components/shell/TopBar';
import { EmptyState } from '@/components/EmptyState';
import { Pending } from '@/components/Pending';
import type { ProductRow, TimelineEvent } from '@/data/contract';
import { useBridge, usePrefetchDestinations, useStore } from '@/data/queries';
import { Bridge, changeOfEvent, sessionChanges, ticksOf } from '@/features/bridge';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { MomentChip } from '@/features/moment';
import { touchedBy, TransportBar, useRolling } from '@/features/transport';
import { FollowPill, ThisSession } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { restOf, short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';
import { pageSearch } from '@/lib/search';

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

const NO_SESSIONS: never[] = [];

function BridgePage() {
  const { _splat } = Route.useParams();
  const { hold } = Route.useSearch();
  const navigate = useNavigate();
  const node = _splat || undefined;
  const wide = useWide();
  const { data: store } = useStore();
  // the product is the URL's; a bare /bridge lands on the last product opened, as the home does
  const lastProduct = usePreferences((s) => s.lastProduct);
  const setLastProduct = usePreferences((s) => s.setLastProduct);
  const productKey = node?.startsWith('product:') ? node : undefined;
  const product = store?.products.find((p) => p.key === productKey);
  const bridge = useBridge(productKey);
  usePrefetchDestinations(productKey);
  // the transport's window, read once and handed to the transport, so the two stand on one clock
  const rolling = useRolling(productKey);
  const locked = rolling.selected;
  useEffect(() => {
    if (product?.key) setLastProduct(product.key);
  }, [product?.key, setLastProduct]);

  const [railOpen, setRailOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);

  // the tie: the change under the pointer lights its ticks and its card; the held change filters the transport
  const [hover, setHover] = useState<string | undefined>(undefined);
  const sessions = bridge.data?.sessions ?? NO_SESSIONS;
  const onChange = useMemo(() => sessionChanges(sessions), [sessions]);
  const lit = useMemo(
    () => (hover ? ticksOf(hover, rolling.events, onChange) : undefined),
    [hover, rolling.events, onChange],
  );
  // several changes may be held at once, a comma list in the URL; the transport shows the union of their writes. Only
  // this product's changes count: a hold carried over from another product's bridge is left out
  const held = useMemo(() => {
    const mine = productKey ? `change:${restOf(productKey)}/` : undefined;
    return hold ? hold.split(',').filter((k) => k && (!mine || k.startsWith(mine))) : [];
  }, [hold, productKey]);
  const only = useMemo(() => {
    if (held.length === 0) return undefined;
    const out = new Set<number>();
    for (const k of held) for (const seq of ticksOf(k, rolling.events, onChange)) out.add(seq);
    return out;
  }, [held, rolling.events, onChange]);
  const onHoverEvent = useCallback(
    (e: TimelineEvent | undefined) => setHover(e ? changeOfEvent(e, onChange) : undefined),
    [onChange],
  );
  const writeHold = useCallback(
    (next: readonly string[]) => {
      // the card under the pointer moves between the grid and the held row, and no pointer event marks that, so
      // what is lit is let go with the move
      setHover(undefined);
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, hold: next.length ? next.join(',') : undefined }),
        replace: true,
      });
    },
    [navigate],
  );
  const toggleHold = useCallback(
    (change: string) => writeHold(held.includes(change) ? held.filter((k) => k !== change) : [...held, change]),
    [held, writeHold],
  );
  const releaseAll = useCallback(() => writeHold([]), [writeHold]);

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
      lens="feature"
      crumbs={[]}
      current={productKey ? { key: productKey, title: 'Bridge' } : undefined}
      liveSessions={bridge.data?.sessions.filter((s) => s.state === 'working').length ?? 0}
      onOpenPalette={openPalette}
      onOpenRail={wide ? undefined : () => setRailOpen(true)}
      trailing={
        <>
          <MomentChip />
          <FollowPill />
        </>
      }
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
    content = <Pending />;
  } else {
    content = (
      <Bridge
        data={bridge.data}
        product={productKey}
        productName={product?.name ?? short(productKey)}
        events={rolling.events}
        now={rolling.now}
        hover={hover}
        onHover={setHover}
        held={held}
        onHold={toggleHold}
        onRelease={releaseAll}
        touched={locked && touchedBy(locked)}
      />
    );
  }

  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpen(false)}>
      {/* the transport stands above the scroll, so it stays in reach while the cards scroll */}
      {productKey && <TransportBar r={rolling} lit={lit} only={only} onHoverEvent={onHoverEvent} />}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto">{content}</div>
      <CommandPalette open={palette} onOpenChange={setPalette} lens="feature" />
    </AppShell>
  );
}
