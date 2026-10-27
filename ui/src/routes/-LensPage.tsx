// The page: a scope in a lens, drawn in a view, with a selection in the record pane. Composes the shell and the
// features; owns nothing but the composition. URL state comes in as props and search (the path is the scope, `sel`
// the selection, the filter params the narrowing); server state through the scope hook, once for the scope and once
// for the selection; client state from the stores.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { Flag, User } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { SelectionBadge } from '@/components/SelectionBadge';
import { Chip } from '@/components/chips/Chip';
import { focusSearch, NodeLink, selectSearch } from '@/components/links/NodeLink';
import { RecordHeader } from '@/components/record/RecordHeader';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem } from '@/components/shell/Rail';
import { SplitPane } from '@/components/shell/SplitPane';
import { TopBar } from '@/components/shell/TopBar';
import { StructureTree } from '@/components/tree/StructureTree';
import type { ChangeContext, Grouping, Lens, Scope, Tab, View } from '@/data/contract';
import { useScope, useStore } from '@/data/queries';
import { ActivityView } from '@/features/activity';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { Overview, pathTo, ProductMap, type MapFilter } from '@/features/feature-lens';
import { MilestoneHome, MilestoneList, MilestonePage } from '@/features/milestone-lens';
import { Inbox, inbox, WorkQueue } from '@/features/work';
import { narrowToMilestone } from '@/lib/narrow';
import { ChangeRecord } from '@/features/record';
import { FollowPill } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';
import type { PageSearch } from './-search';

export interface LensPageProps {
  lens: Lens;
  /** The scope: the node the structure pane draws. */
  node?: string;
  /** The session this page follows, when it does. */
  following?: { session: string; on?: string };
}

const VIEWS_BY_LENS: Record<Lens, readonly View[]> = {
  feature: ['tree', 'lanes', 'inbox'],
  project: ['lanes', 'tree', 'inbox'],
  milestone: ['tree', 'lanes', 'inbox'],
};

/** A node's kind as a word for the record header. */
function kindOf(s: Scope): string {
  const n = s.node;
  if (!n) return 'store';
  if (n.type === 'change') return s.change?.children.length ? 'milestone' : 'change';
  return n.level ?? n.type;
}

const isContainer = (s: Scope): boolean =>
  !!s.node && (s.node.type !== 'change' || (s.change?.children.length ?? 0) > 0);

const list = (v: string | undefined): string[] | undefined => (v ? v.split(',').filter(Boolean) : undefined);

export function LensPage({ lens, node, following }: LensPageProps) {
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const wide = useWide();
  const { data: store } = useStore();

  const flags = useMemo(
    () => ({ days: search.days, done: search.done, retired: search.retired }),
    [search.days, search.done, search.retired],
  );
  const scope = useScope({ lens, node, ...flags });
  const sel = search.sel && search.sel !== node ? search.sel : undefined;
  const selection = useScope({ lens, node: sel, ...flags }, !!sel);
  const isScope = !sel;
  // the milestone filter narrows everything the lens shows, the scope and the selection alike, before anything is drawn
  const milestone = lens === 'feature' ? search.milestone : undefined;
  const narrowed = useMemo(
    () => (scope.data && milestone ? narrowToMilestone(scope.data, milestone) : scope.data),
    [scope.data, milestone],
  );
  const narrowedSelection = useMemo(
    () => (selection.data && milestone ? narrowToMilestone(selection.data, milestone) : selection.data),
    [selection.data, milestone],
  );
  const chosenMilestone = milestone ? scope.data?.changes.find((r) => r.key === milestone) : undefined;
  // the record pane's subject: the selection when there is one, else the scope itself
  const shown = sel ? narrowedSelection : narrowed;

  const defaultView: View = 'tree';
  const view: View = search.view ?? defaultView;
  const grouping: Grouping = search.group ?? 'status';
  const tab: Tab = search.tab ?? 'overview';
  const filter = useMemo<MapFilter>(
    () => ({ q: search.q, states: list(search.state), milestone: search.milestone }),
    [search.q, search.state, search.milestone],
  );

  // the rail drawer is open for one page only: any navigation closes it, no effect needed
  const pageKey = `${lens}|${node ?? ''}|${view}`;
  const [railOpenFor, setRailOpenFor] = useState<string | null>(null);
  const railOpen = railOpenFor === pageKey;
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteHotkey(openPalette);

  // the acts. A history entry per place (scope, selection, view): select, clear and focus push, so Back undoes the last
  // click; refinements of the same place (tab, grouping, filter, flags, window) replace. Components call these and
  // never choose push or replace on their own.
  const clear = useCallback(
    () =>
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, sel: undefined, tab: undefined }),
      }),
    [navigate],
  );
  const select = useCallback(
    (key: string) => (key === sel ? clear() : void navigate({ to: '.', search: selectSearch(key) })),
    [navigate, sel, clear],
  );
  const focus = useCallback(
    (key: string) => void navigate({ to: '/$lens/$', params: { lens, _splat: key }, search: focusSearch }),
    [navigate, lens],
  );
  const setGrouping = (g: Grouping) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, group: g === 'status' ? undefined : g }),
      replace: true,
    });
  const setFilter = (f: MapFilter) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        q: f.q?.trim() ? f.q : undefined,
        state: f.states?.length ? f.states.join(',') : undefined,
        milestone: f.milestone || undefined,
      }),
      replace: true,
    });

  // expansion is kept per scope and lens for this page's life, never persisted: a dashboard reopened beside a fresh
  // session opens collapsed. The path to the selection is always open.
  const expandedAll = usePreferences((s) => s.expanded);
  const setExpanded = usePreferences((s) => s.setExpanded);
  const splits = usePreferences((s) => s.splits);
  const setSplit = usePreferences((s) => s.setSplit);
  const scopeKey = `${lens}:${node ?? 'root'}`;
  const remembered = expandedAll[scopeKey];
  const expanded = useMemo(() => {
    const path = scope.data && sel ? pathTo(scope.data.tree, sel) : [];
    return [...new Set([...(remembered ?? []), ...path])];
  }, [remembered, scope.data, sel]);
  const onExpandedChange = useCallback((ids: string[]) => setExpanded(scopeKey, ids), [setExpanded, scopeKey]);

  const data = narrowed;
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
      defaultView={defaultView}
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

  const bar = (
    <TopBar
      lens={lens}
      crumbs={data?.crumbs ?? []}
      current={data?.node ? { key: data.node.key, title: data.node.name ?? data.node.title } : undefined}
      kind={data ? kindOf(data) : undefined}
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

  // --- the record pane ---------------------------------------------------------------------------------------
  let pane: React.ReactNode;
  let selectedLabel: string | undefined;
  let selectedKind = 'entity';
  if (sel && selection.error) {
    pane = (
      <div className="flex flex-col">
        <RecordHeader kind="selection" isScope={false} path={[]} tab="overview" tabs={['overview']} onClose={clear} />
        <EmptyState title={`Nothing at ${sel}.`} hint={selection.error.message} className="m-5" />
      </div>
    );
    selectedLabel = sel;
  } else if (!shown) {
    pane = <div className="p-6 text-xs text-ink-faint">Loading…</div>;
  } else {
    const kind = kindOf(shown);
    if (!isScope) {
      selectedLabel = shown.node?.name ?? shown.node?.title ?? (sel ? short(sel) : undefined);
      selectedKind = kind;
    }
    // the chain from the scope down to the selection, both excluded
    const at = node ? shown.crumbs.findIndex((c) => c.key === node) : -1;
    const path = isScope
      ? []
      : shown.crumbs.slice(at + 1).map((c) => ({ key: c.key, label: c.name ?? c.title ?? short(c.key) }));
    const tabs: readonly Tab[] = shown.change ? ['overview', 'activity', 'decisions'] : ['overview', 'activity'];
    const live = new Set(shown.sessions.map((s) => s.key));
    let body: React.ReactNode;
    if (tab === 'activity') {
      body = <ActivityView recent={shown.recent} sessions={shown.sessions} lens={lens} days={shown.days} />;
    } else if (tab === 'decisions' && shown.change) {
      body = <DecisionsTab ctx={shown.change} lens={lens} />;
    } else if (shown.node?.type === 'change' && shown.change) {
      body = shown.change.children.length ? (
        <MilestonePage scope={shown} ctx={shown.change} lens={lens} />
      ) : (
        <ChangeRecord ctx={shown.change} lens={lens} liveSessions={live} />
      );
    } else if (lens === 'milestone' && isScope) {
      // nothing selected in the milestone lens: the milestones across the scope
      body = <MilestoneHome scope={shown} lens={lens} />;
    } else {
      body = <Overview scope={shown} lens={lens} />;
    }
    pane = (
      <div className="flex min-h-0 flex-1 flex-col">
        <RecordHeader
          kind={lens === 'milestone' && isScope ? 'scope' : kind}
          isScope={isScope}
          path={path}
          tab={tabs.includes(tab) ? tab : 'overview'}
          tabs={tabs}
          tabCounts={{ decisions: shown.change?.decisions.length }}
          onFocus={!isScope && isContainer(shown) && sel ? () => focus(sel) : undefined}
          onClose={isScope ? undefined : clear}
        />
        {milestone && (
          <div className="flex items-center gap-2 border-b border-line bg-raised px-5 py-1.5 text-xs text-ink-muted">
            <Flag className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="min-w-0 truncate">
              Showing only work toward {chosenMilestone?.title ?? short(milestone)}
            </span>
            <button
              type="button"
              onClick={() => setFilter({ ...filter, milestone: undefined })}
              className="ml-auto shrink-0 hover:text-ink"
            >
              clear
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    );
  }

  // --- the structure pane ------------------------------------------------------------------------------------
  let structure: React.ReactNode;
  let paneAlways = true;
  if (scope.error) {
    structure = (
      <EmptyState title={`Nothing at ${node ?? 'the root'} in this lens.`} hint={scope.error.message} className="m-6" />
    );
  } else if (!data) {
    structure = <div className="p-6 text-xs text-ink-faint">Loading…</div>;
  } else if (view === 'inbox') {
    paneAlways = false;
    structure = <Inbox data={inboxData!} lens={lens} selected={sel} showProject={data.projects.length > 1} />;
  } else if (view === 'lanes') {
    paneAlways = false;
    structure = (
      <WorkQueue
        scope={data}
        lens={lens}
        grouping={grouping}
        onGroupingChange={setGrouping}
        selected={sel}
        showDone={!!search.done}
      />
    );
  } else if (lens === 'feature' && data.node?.type !== 'change') {
    structure = (
      <ProductMap
        scope={data}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        selected={sel}
        onSelect={select}
        filter={filter}
        onFilterChange={setFilter}
        changes={scope.data?.changes ?? []}
        version={scope.dataUpdatedAt}
      />
    );
  } else if (lens === 'milestone' && data.node?.type !== 'change') {
    structure = <MilestoneList scope={data} lens={lens} selected={sel} />;
  } else {
    structure = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2.5 px-5 pt-3.5 pb-2">
          <h2 className="text-section font-semibold">{data.node?.type === 'change' ? 'Beneath' : 'Changes'}</h2>
          <span className="text-xs text-ink-muted">
            {data.changes.length} open{data.doneHidden ? ` · ${data.doneHidden} done hidden` : ''}
          </span>
        </div>
        <div className="px-3 pb-4">
          <StructureTree
            nodes={data.tree}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
            selected={sel}
            onSelect={select}
            showProject={data.projects.length > 1}
            version={scope.dataUpdatedAt}
          />
        </div>
      </div>
    );
  }

  // the badge floats over the structure pane whenever something is selected: one way to clear it in every lens
  const primary = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {structure}
      {sel && selectedLabel && <SelectionBadge label={selectedLabel} kind={selectedKind} onClear={clear} />}
    </div>
  );

  const splitId = `pjman.split.${lens}.${view}`;
  const content =
    paneAlways || sel ? (
      <SplitPane
        wide={wide}
        id={splitId}
        primary={primary}
        secondary={pane}
        primarySize={view === 'tree' ? (lens === 'milestone' ? 38 : 55) : 62}
        layout={splits[splitId]}
        onLayoutChange={(l) => setSplit(splitId, l)}
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-scroll-restoration-id={`${splitId}.only`}>
        {primary}
      </div>
    );

  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpenFor(null)}>
      {content}
      <CommandPalette open={palette} onOpenChange={setPalette} lens={lens} />
    </AppShell>
  );
}

/** The decisions tab: proposed first, each with its recommendation and why. */
function DecisionsTab({ ctx, lens }: { ctx: ChangeContext; lens: Lens }) {
  const items = [
    ...ctx.decisions.filter((d) => d.status === 'proposed'),
    ...ctx.decisions.filter((d) => d.status !== 'proposed'),
  ];
  if (items.length === 0) return <EmptyState title="No decisions on this change yet." className="m-5" />;
  return (
    <ol className="flex flex-col gap-3 p-5 md:px-6">
      {items.map((d) => (
        <li key={d.key} className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Chip className={d.status === 'proposed' ? 'text-status-review' : 'text-status-done'}>
              <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
              {d.status}
            </Chip>
            <span className="min-w-0 flex-1 font-medium">{d.title ?? short(d.key)}</span>
            {typeof d.data.decided_on === 'string' && (
              <span className="text-meta text-ink-faint">{d.data.decided_on}</span>
            )}
          </div>
          {d.decision && <p className="text-[13px] leading-relaxed text-ink-muted">{d.decision}</p>}
          {d.why && (
            <p className="text-xs leading-relaxed text-ink-faint">
              <span className="label mr-1.5">Why</span>
              {d.why}
            </p>
          )}
          <div className="flex items-center gap-2 text-meta text-ink-faint">
            <span className="font-mono">{short(d.key)}</span>
            {d.status === 'proposed' && (
              <span className="ml-auto font-mono">pjman set {short(d.key)} status=decided</span>
            )}
          </div>
        </li>
      ))}
      <li className="text-xs text-ink-faint">
        Decisions are made in the terminal for now; the inbox lists what waits on you.{' '}
        <NodeLink to={ctx.change.key} lens={lens} className="hover:text-primary">
          Back to the change
        </NodeLink>
      </li>
    </ol>
  );
}
