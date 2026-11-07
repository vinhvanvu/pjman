// The session page at desktop width (change:session-detail; decision session-leads-the-dock): the shell (the rail and
// the crumb), then the session tree opened out, the body on the left and the panel with the sources and the timeline
// on the right. No record pane: the change is one drill away, by the link on the identity row. The pill in the top
// bar is the way back from any other page.
import { useEffect, useState, useCallback } from 'react';
import { User } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem, type RailProduct } from '@/components/shell/Rail';
import { TopBar } from '@/components/shell/TopBar';
import type { ProductRow, SessionFacts } from '@/data/contract';
import { useBridge, usePrefetchDestinations, useStore } from '@/data/queries';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { MomentChip } from '@/features/moment';
import { FollowPill, ThisSession } from '@/features/session-follow';
import { SessionTree, sessionTitle } from '@/features/session';
import { ThemePicker } from '@/features/theme';
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

export function SessionWide({ session }: { session: SessionFacts }) {
  const { data: store } = useStore();
  const productKey = session.product;
  const bridge = useBridge(productKey);
  usePrefetchDestinations(productKey);
  const setLastProduct = usePreferences((s) => s.setLastProduct);
  useEffect(() => {
    if (productKey) setLastProduct(productKey);
  }, [productKey, setLastProduct]);
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);

  const product = store?.products.find((p) => p.key === productKey);
  const rail = (
    <Rail
      product={product ? railProduct(product) : productKey ? { key: productKey, name: short(productKey) } : undefined}
      products={store?.products.map(railProduct)}
      lens={LENS}
      node={productKey}
      waiting={bridge.data?.waiting}
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
      lead="Sessions"
      crumbs={[]}
      current={{ key: session.key, title: sessionTitle(session) }}
      onOpenPalette={openPalette}
      trailing={
        <>
          <MomentChip />
          <FollowPill />
        </>
      }
    />
  );
  return (
    <AppShell wide rail={rail} bar={bar}>
      <SessionTree session={session} lens={LENS} wide />
      <CommandPalette open={palette} onOpenChange={setPalette} lens={LENS} />
    </AppShell>
  );
}
