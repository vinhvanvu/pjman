// The page: a node in a lens, in a view. Composes the shell and the features; owns nothing but the composition.
// URL state comes in as props and search; server state through the scope hook; client state from the stores.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem } from '@/components/shell/Rail';
import { SplitPane } from '@/components/shell/SplitPane';
import { TopBar } from '@/components/shell/TopBar';
import { StructureTree } from '@/components/tree/StructureTree';
import type { Grouping, Lens, View } from '@/data/contract';
import { useScope, useStore } from '@/data/queries';
import { ActivityView } from '@/features/activity';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { FeatureDetail, pathTo, ProductMap } from '@/features/feature-lens';
import { MilestoneList, MilestonePage } from '@/features/milestone-lens';
import { Inbox, inbox, WorkQueue } from '@/features/project-lens';
import { ChangeRecord } from '@/features/record';
import { FollowPill } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';
import { User } from 'lucide-react';
import type { PageSearch } from './-search';

export interface LensPageProps {
  lens: Lens;
  node?: string;
  /** The session this page follows, when it does. */
  following?: { session: string; on?: string };
}

const VIEWS_BY_LENS: Record<Lens, readonly View[]> = {
  feature: ['tree', 'lanes', 'inbox', 'activity'],
  project: ['lanes', 'tree', 'inbox', 'activity'],
  milestone: ['tree', 'lanes', 'inbox', 'activity'],
};

export function LensPage({ lens, node, following }: LensPageProps) {
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const wide = useWide();
  const { data: store } = useStore();
  const query = useMemo(
    () => ({ lens, node, days: search.days, done: search.done, retired: search.retired }),
    [lens, node, search.days, search.done, search.retired],
  );
  const { data, error, dataUpdatedAt } = useScope(query);

  const defaultView: View = lens === 'project' ? 'lanes' : 'tree';
  const view: View = search.view ?? defaultView;
  const grouping: Grouping = search.group ?? 'status';

  // the rail drawer is open for one page only: any navigation closes it, no effect needed
  const pageKey = `${lens}|${node ?? ''}|${view}`;
  const [railOpenFor, setRailOpenFor] = useState<string | null>(null);
  const railOpen = railOpenFor === pageKey;
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);

  // expansion is remembered per container and lens; the path to the selection is always open
  const expandedAll = usePreferences((s) => s.expanded);
  const setExpanded = usePreferences((s) => s.setExpanded);
  const splits = usePreferences((s) => s.splits);
  const setSplit = usePreferences((s) => s.setSplit);
  const container = data?.container ?? 'root';
  const scopeKey = `${lens}:${container}`;
  const remembered = expandedAll[scopeKey];
  const selected = data && node && data.container !== node ? node : undefined;
  const expanded = useMemo(() => {
    const base = remembered ?? [];
    const path = data && selected ? pathTo(data.tree, selected) : [];
    return [...new Set([...base, ...path])];
  }, [remembered, data, selected]);
  const onExpandedChange = useCallback((ids: string[]) => setExpanded(scopeKey, ids), [setExpanded, scopeKey]);

  const setGrouping = (g: Grouping) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, group: g === 'status' ? undefined : g }),
    });

  const product = data?.crumbs[0]?.key.startsWith('product:')
    ? data.crumbs[0]
    : data?.node?.key.startsWith('product:')
      ? data.node
      : store?.products[0];
  const inboxData = data ? inbox(data) : undefined;

  const rail = (
    <Rail
      product={product ? { key: product.key, title: product.title ?? short(product.key) } : undefined}
      products={store?.products.map((p) => ({ key: p.key, title: p.title ?? short(p.key) }))}
      lens={lens}
      node={node}
      view={view}
      views={VIEWS_BY_LENS[lens]}
      viewCounts={{ inbox: inboxData?.total }}
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

  const kind = data?.node
    ? data.node.type === 'change'
      ? data.change?.children.length
        ? 'milestone'
        : 'change'
      : (data.node.level ?? data.node.type)
    : undefined;
  const bar = (
    <TopBar
      lens={lens}
      crumbs={data?.crumbs ?? []}
      current={data?.node ? { key: data.node.key, title: data.node.name ?? data.node.title } : undefined}
      kind={kind}
      liveSessions={data?.sessions.length ?? 0}
      onOpenPalette={openPalette}
      onOpenRail={wide ? undefined : () => setRailOpenFor(pageKey)}
      trailing={
        following ? (
          <FollowPill session={following.session} on={following.on ? short(following.on) : undefined} />
        ) : undefined
      }
    />
  );

  let content: React.ReactNode;
  if (error) {
    content = (
      <EmptyState title={`Nothing at ${node ?? 'the root'} in this lens.`} hint={error.message} className="m-6" />
    );
  } else if (!data) {
    content = <div className="p-6 text-xs text-ink-faint">Loading…</div>;
  } else if (view === 'activity') {
    content = <ActivityView recent={data.recent} sessions={data.sessions} lens={lens} days={data.days} />;
  } else if (view === 'inbox') {
    content = <Inbox data={inboxData!} lens={lens} selected={selected} />;
  } else if (view === 'lanes') {
    content = (
      <WorkQueue
        scope={data}
        lens={lens}
        grouping={grouping}
        onGroupingChange={setGrouping}
        selected={selected}
        showDone={!!search.done}
      />
    );
  } else {
    const isMilestoneNode = data.node?.type === 'change' && !!data.change && data.change.children.length > 0;
    const primary =
      lens === 'feature' && data.node?.type !== 'change' ? (
        <ProductMap
          scope={data}
          lens={lens}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          selected={selected}
          version={dataUpdatedAt}
        />
      ) : lens === 'milestone' && !isMilestoneNode && data.node?.type !== 'change' ? (
        <MilestoneList scope={data} lens={lens} selected={selected} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-2">
            <h2 className="text-section font-semibold">
              {lens === 'milestone' ? 'Beneath' : lens === 'project' ? 'Changes' : 'Here'}
            </h2>
            <span className="text-xs text-ink-muted">
              {data.changes.length} open{data.doneHidden ? ` · ${data.doneHidden} done hidden` : ''}
            </span>
          </div>
          <div className="px-3 pb-4">
            <StructureTree
              nodes={data.tree}
              lens={lens}
              expanded={expanded}
              onExpandedChange={onExpandedChange}
              selected={selected}
              showProject={data.projects.length > 1}
              version={dataUpdatedAt}
            />
          </div>
        </div>
      );
    const live = new Set(data.sessions.map((s) => s.key));
    const secondary =
      data.node?.type === 'change' && data.change ? (
        isMilestoneNode ? (
          <MilestonePage
            scope={data}
            ctx={data.change}
            lens={lens}
            node={data.tree.find((n) => n.key === data.node!.key)}
          />
        ) : (
          <ChangeRecord ctx={data.change} lens={lens} liveSessions={live} />
        )
      ) : (
        <FeatureDetail scope={data} lens={lens} />
      );
    const splitId = `pjman.split.${lens}`;
    content = (
      <SplitPane
        wide={wide}
        id={splitId}
        primary={primary}
        secondary={secondary}
        primarySize={lens === 'milestone' ? 38 : 55}
        layout={splits[splitId]}
        onLayoutChange={(l) => setSplit(splitId, l)}
      />
    );
  }

  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpenFor(null)}>
      {content}
      <CommandPalette open={palette} onOpenChange={setPalette} lens={lens} />
    </AppShell>
  );
}
