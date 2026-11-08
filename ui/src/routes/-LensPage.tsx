// The page: a scope in a lens, with a selection in the record pane. Composes the shell and the
// features; owns nothing but the composition. URL state comes in as props and search (the path is the scope, `sel`
// the selection, the filter params the narrowing); server state through the scope hook, once for the scope and once
// for the selection; client state from the stores.
import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Diamond, Flag, User } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Pending } from '@/components/Pending';
import { SelectionBadge } from '@/components/SelectionBadge';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { fromRow, groupHead } from '@/components/decisions/model';
import { changePath, focusSearch, NodeLink, selectSearch } from '@/components/links/NodeLink';
import { RecordHeader } from '@/components/record/RecordHeader';
import { AppShell } from '@/components/shell/AppShell';
import { Rail, railItem, type RailProduct } from '@/components/shell/Rail';
import { SplitPane } from '@/components/shell/SplitPane';
import { TopBar } from '@/components/shell/TopBar';
import { StructureTree } from '@/components/tree/StructureTree';
import type { ChangeContext, Lens, ProductRow, Scope, SessionView, Tab } from '@/data/contract';
import { useDecideAction, usePrefetchDestinations, useScope, useStore } from '@/data/queries';
import { ActivityView } from '@/features/activity';
import { CommandPalette, useCommandPaletteHotkey } from '@/features/command-palette';
import { Dock } from '@/features/dock';
import { AspectPane } from '@/features/aspects';
import { AspectPicker, NodeRecord, pathTo, ProductMap, type MapFilter } from '@/features/feature-lens';
import { MilestonePage } from '@/features/milestone-lens';
import { RoadmapChart, RoadmapHome } from '@/features/roadmap-lens';
import { narrowToAspect, narrowToMilestone } from '@/lib/narrow';
import { ChangeView } from '@/features/change';
import { MomentChip } from '@/features/moment';
import { FollowPill, ThisSession } from '@/features/session-follow';
import { ThemePicker } from '@/features/theme';
import { useWide } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import { productOf, short } from '@/lib/keys';
import { usePreferences } from '@/state/preferences';
import { freshScope, pageProduct } from '@/lib/identity';
import type { PageSearch } from './-search';

export interface LensPageProps {
  lens: Lens;
  /** The scope: the node the structure pane draws. */
  node?: string;
  /** The session this page follows, when it is a session's page: at docked width the page is the dock. */
  following?: { session: string; view: SessionView };
}

/** What the top bar calls the product's own page in each lens: the rail already names the product. */
const LENS_HOME: Partial<Record<Lens, string>> = { feature: 'Product map', roadmap: 'Roadmap' };

/** A node's kind as a word for the record header. */
function kindOf(s: Scope): string {
  const n = s.node;
  if (!n) return 'store';
  if (n.type === 'change') return s.change?.children.length ? 'milestone' : 'change';
  return n.level ?? n.type;
}

const isContainer = (s: Scope): boolean =>
  !!s.node && (s.node.type !== 'change' || (s.change?.children.length ?? 0) > 0);

/** A change with no children: its own page is the change (decision change-detail/own-route), the lens only selects it. */
const isLeafChange = (s: Scope | undefined): boolean => !!s?.node && s.node.type === 'change' && !isContainer(s);

const narrowScope = (s: Scope | undefined, milestone?: string, aspect?: string): Scope | undefined => {
  const m = s && milestone ? narrowToMilestone(s, milestone) : s;
  return m && aspect ? narrowToAspect(m, aspect) : m;
};

const list = (v: string | undefined): string[] | undefined => (v ? v.split(',').filter(Boolean) : undefined);

export function LensPage({ lens, node, following }: LensPageProps) {
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const wide = useWide();
  // width decides panes, never routes: the session's page at docked width is the dock column
  const docked = !!following && !wide;
  const { data: store } = useStore();

  // the roadmap's chart draws the past, so its scope always carries the done changes
  const withDone = lens === 'roadmap' || search.done;
  const flags = useMemo(
    () => ({ days: search.days, done: withDone, retired: search.retired }),
    [search.days, withDone, search.retired],
  );
  const scope = useScope({ lens, node, ...flags });
  // identity has one source (lib/identity.ts): the URL, else this page's own scope; never a guess
  const fresh = freshScope(scope.data, scope.isPlaceholderData);
  const product = pageProduct(node, fresh, store?.products);
  const sel = search.sel && search.sel !== node ? search.sel : undefined;
  const selection = useScope({ lens, node: sel, ...flags }, !!sel);
  const isScope = !sel;
  // the milestone filter narrows everything the lens shows, the scope and the selection alike, before anything is drawn
  const milestone = lens === 'feature' ? search.milestone : undefined;
  // on the roadmap an aspect narrows the same way, to the work on it (change:aspects-roadmap); on the map it is a lens
  // over the tree, applied by the map's own filter
  const workOn = lens === 'roadmap' ? search.aspect : undefined;
  const narrowed = useMemo(() => narrowScope(scope.data, milestone, workOn), [scope.data, milestone, workOn]);
  const narrowedSelection = useMemo(
    () => narrowScope(selection.data, milestone, workOn),
    [selection.data, milestone, workOn],
  );
  const chosenMilestone = milestone ? scope.data?.changes.find((r) => r.key === milestone) : undefined;
  // the record pane's subject: the selection when there is one, else the scope itself
  const shown = sel ? narrowedSelection : narrowed;

  const tab: Tab = search.tab ?? 'overview';
  const now = useNow();
  // the tie between the map and the record (decision feature-detail/hold-lights-the-map): the change under the
  // pointer, on a row or a card, lights its row, its path and its card; the changes held in the URL (`hold`, the
  // param the bridge uses, so a hold carries between the two) light their paths, dim the rest of the map, lift their
  // cards under the figures and narrow the timeline to their writes. Only this product's changes count
  const [hover, setHover] = useState<string | undefined>(undefined);
  const hold = search.hold;
  const held = useMemo(() => {
    const mine = node ? productOf(node) : undefined;
    return hold ? hold.split(',').filter((k) => k && (!mine || productOf(k) === mine)) : [];
  }, [hold, node]);
  const writeHold = useCallback(
    (next: readonly string[]) => {
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
  const filter = useMemo<MapFilter>(
    () => ({
      q: search.q,
      states: list(search.state),
      milestone: search.milestone,
      bugs: search.bugs,
      aspect: lens === 'feature' ? search.aspect : undefined,
    }),
    [search.q, search.state, search.milestone, search.bugs, search.aspect, lens],
  );
  // the aspect the map is narrowed to: with nothing selected, the record pane reads it whole
  const chosenAspect = filter.aspect ? scope.data?.aspects.find((a) => a.aspect === filter.aspect) : undefined;
  const workedOn = workOn ? scope.data?.aspects.find((a) => a.aspect === workOn) : undefined;
  const setWorkOn = (aspect: string | undefined) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, aspect }),
      replace: true,
    });

  // the rail drawer is open for one page only: any navigation closes it, no effect needed
  const pageKey = `${lens}|${node ?? ''}`;
  const [railOpenFor, setRailOpenFor] = useState<string | null>(null);
  const railOpen = railOpenFor === pageKey;
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), [setPalette]);
  useCommandPaletteHotkey(openPalette);

  // the acts. A history entry per place (scope, selection): select, clear and focus push, so Back undoes the last
  // click; refinements of the same place (tab, filter, flags, window) replace. Components call these and
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
  const setFilter = (f: MapFilter) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        q: f.q?.trim() ? f.q : undefined,
        state: f.states?.length ? f.states.join(',') : undefined,
        milestone: f.milestone || undefined,
        bugs: f.bugs || undefined,
        aspect: f.aspect || undefined,
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
  usePrefetchDestinations(product?.key);
  const setLastProduct = usePreferences((s) => s.setLastProduct);
  useEffect(() => {
    if (product?.key) setLastProduct(product.key);
  }, [product?.key, setLastProduct]);
  // the rail names the product, so the crumb starts beneath it; on the product's own page the bar names the lens
  const onProduct = fresh?.node?.key.startsWith('product:') ?? false;
  const crumbsBeneath = (fresh?.crumbs ?? []).filter((c) => !c.key.startsWith('product:'));
  const railProduct = (p: { key: string; title?: string; name?: string }, health?: ProductRow): RailProduct => ({
    key: p.key,
    name: p.name ?? health?.name ?? short(p.key),
    title: p.title ?? health?.title,
    open: health?.open,
    inFlight: health?.inFlight,
    loud: health?.loud,
  });

  const rail = (
    <Rail
      product={
        product
          ? railProduct(
              product,
              store?.products.find((p) => p.key === product.key),
            )
          : undefined
      }
      products={store?.products.map((p) => railProduct(p, p))}
      current={lens === 'feature' || lens === 'roadmap' ? lens : undefined}
      lens={lens}
      node={node}
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

  // the pill is the way back to the followed session from any page; at docked width it is the location, so no crumb
  const bar = (
    <TopBar
      lens={lens}
      crumbs={docked ? [] : crumbsBeneath}
      current={
        fresh?.node && !docked
          ? {
              key: fresh.node.key,
              title: onProduct ? (LENS_HOME[lens] ?? fresh.node.name) : (fresh.node.name ?? fresh.node.title),
            }
          : undefined
      }
      kind={fresh && !onProduct && !docked ? kindOf(fresh) : undefined}
      liveSessions={docked ? 0 : (data?.sessions.length ?? 0)}
      onOpenPalette={openPalette}
      onOpenRail={wide ? undefined : () => setRailOpenFor(pageKey)}
      trailing={
        <>
          <MomentChip />
          <FollowPill className={docked ? 'min-w-0 flex-1' : undefined} />
        </>
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
    pane = <Pending />;
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
    // a leaf change is read whole in the tree (its decisions and its rail with it); a milestone keeps its tabs
    const leaf = isLeafChange(shown);
    // a milestone keeps its tabs; a node is read whole, its timeline in the record (decision one-node-record)
    const tabs: readonly Tab[] = !leaf && shown.change ? ['overview', 'activity', 'decisions'] : ['overview'];
    const shownTab: Tab = tabs.includes(tab) ? tab : 'overview';
    let body: React.ReactNode;
    if (leaf && shown.change) {
      // the change tree folded, the change bar on top and the rail beneath (decision change-detail/docked-is-folded)
      body = <ChangeView ctx={shown.change} scope={shown} lens={lens} wide={false} />;
    } else if (shownTab === 'activity') {
      // the rail beneath the node, whatever it is (change:activity-timeline): a change, a milestone, a feature, the product
      const beneath = shown.node?.key ?? node;
      body = beneath ? (
        <ActivityView node={beneath} sessions={shown.sessions} lens={lens} />
      ) : (
        <EmptyState title="Nothing has happened here yet." className="m-5" />
      );
    } else if (shownTab === 'decisions' && shown.change) {
      body = <DecisionsTab ctx={shown.change} lens={lens} />;
    } else if (shown.node?.type === 'change' && shown.change) {
      body = <MilestonePage scope={shown} ctx={shown.change} lens={lens} />;
    } else if (isScope && chosenAspect) {
      // the map narrowed to an aspect and nothing selected: the aspect, read whole
      body = <AspectPane aspect={chosenAspect} lens={lens} />;
    } else if (lens === 'roadmap' && isScope) {
      // nothing selected in the roadmap lens: the order as a list
      body = <RoadmapHome scope={shown} lens={lens} />;
    } else {
      body = (
        <NodeRecord
          scope={shown}
          lens={lens}
          aspect={filter.aspect}
          held={held}
          onHold={toggleHold}
          onRelease={releaseAll}
          hover={hover}
          onHover={setHover}
          now={now}
        />
      );
    }
    pane = (
      <div className="flex min-h-0 flex-1 flex-col">
        <RecordHeader
          kind={lens === 'roadmap' && isScope ? 'scope' : isScope && chosenAspect ? 'aspect' : kind}
          isScope={isScope}
          path={path}
          tab={shownTab}
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
        {workOn && (
          <div className="flex items-center gap-2 border-b border-line bg-raised px-5 py-1.5 text-xs text-ink-muted">
            <Diamond className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="min-w-0 truncate">
              Showing only the work on {workedOn ? (workedOn.name ?? workedOn.title) : short(workOn)}
            </span>
            <button type="button" onClick={() => setWorkOn(undefined)} className="ml-auto shrink-0 hover:text-ink">
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
  if (scope.error) {
    structure = (
      <EmptyState title={`Nothing at ${node ?? 'the root'} in this lens.`} hint={scope.error.message} className="m-6" />
    );
  } else if (!data) {
    structure = <Pending />;
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
        hover={hover}
        onHover={setHover}
        held={held}
        onHold={toggleHold}
        now={now}
      />
    );
  } else if (lens === 'roadmap' && data.node?.type !== 'change') {
    structure = (
      <div className="flex min-h-0 flex-1 flex-col">
        {(data.aspects.length > 0 || workOn) && (
          <div className="flex items-center justify-end gap-2 px-5 pt-3">
            <AspectPicker aspects={data.aspects} chosen={workOn} onChoose={setWorkOn} narrows="roadmap" />
          </div>
        )}
        <RoadmapChart
          scope={data}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          selected={sel}
          onSelect={select}
        />
      </div>
    );
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

  // the badge floats over the structure pane whenever something is selected: one way to clear it in every lens.
  // Not at narrow width: the record stands alone there and its header names the selection and closes it
  const primary = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {structure}
      {wide && sel && selectedLabel && <SelectionBadge label={selectedLabel} kind={selectedKind} onClear={clear} />}
    </div>
  );

  const splitId = `pjman.split.${lens}.tree`;
  // width decides panes, never routes (change:dashboard-v2; decision phone-width-record-pane/pane-replaces-map-when-narrow):
  // two panes wide; narrow, one column holding the record when something is selected (its close returns to the
  // structure), else the structure
  // the dock stands where the structure would: what is selected, or a tab other than the overview, opens the record
  // in place and its overview tab or close brings the dock back
  const dockHome = docked && !sel && tab === 'overview';
  const content = !wide ? (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto"
      data-scroll-restoration-id={`${splitId}.${dockHome ? 'dock' : sel ? 'record' : 'only'}`}
    >
      {dockHome ? (
        data ? (
          <Dock scope={data} session={following?.view.session} lens={lens} settled={!scope.isPlaceholderData} />
        ) : (
          <Pending />
        )
      ) : docked || sel ? (
        pane
      ) : (
        primary
      )}
    </div>
  ) : (
    <SplitPane
      wide={wide}
      id={splitId}
      primary={primary}
      secondary={pane}
      primarySize={lens === 'roadmap' ? 64 : 55}
      layout={splits[splitId]}
      onLayoutChange={(l) => setSplit(splitId, l)}
    />
  );

  // a milestone stood on in the feature lens is the roadmap's (decision feature-detail/one-rollup-every-scope): its
  // children sit at their features on the map, the milestone itself is read where milestones live
  if (!following && lens === 'feature' && fresh?.node?.type === 'change' && isContainer(fresh))
    return (
      <Navigate
        to="/$lens/$"
        params={{ lens: 'roadmap', _splat: fresh.node.key }}
        search={{ decision: search.decision, tab: search.tab }}
        replace
      />
    );
  // a leaf change stood on is its own page (decision change-detail/own-route): an old link moves there, the decision
  // it named open; the docked session page stands on its change and stays
  if (!following && fresh && isLeafChange(fresh) && fresh.node)
    return (
      <Navigate
        to="/change/$"
        params={{ _splat: changePath(fresh.node.key) }}
        search={{ decision: search.decision }}
        replace
      />
    );

  return (
    <AppShell wide={wide} rail={rail} bar={bar} railOpen={railOpen} onCloseRail={() => setRailOpenFor(null)}>
      {content}
      <CommandPalette open={palette} onOpenChange={setPalette} lens={lens} />
    </AppShell>
  );
}

/** The decisions tab (decision detail-pages/decision-card): the decision card at three depths, the proposed first and
 *  oldest first, the decided as rows whose thread opens read-only with Reopen, the superseded under history; the
 *  decision in the URL open. */
function DecisionsTab({ ctx, lens }: { ctx: ChangeContext; lens: Lens }) {
  const decide = useDecideAction('decide');
  const reopen = useDecideAction('reopen');
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const wide = useWide();
  const link = (decision: string | undefined) =>
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, decision }), replace: true });
  if (ctx.decisions.length === 0) return <EmptyState title="No decisions on this change yet." className="m-5" />;
  const decisions = ctx.decisions.map((d) => fromRow(d, ctx.change.key));
  const waiting = decisions.filter((d) => d.status === 'proposed').length;
  return (
    <div className="flex flex-col gap-3 p-5 md:px-6">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold">Decisions</span>
        <span className="text-xs text-ink-faint">{groupHead(waiting, decisions.length - waiting, 'change')}</span>
      </div>
      <DecisionGroup
        decisions={decisions}
        lens={lens}
        where="change"
        wide={wide}
        linked={search.decision}
        onLink={link}
        onDecide={decide}
        onReopen={reopen}
      />
      <p className="text-xs text-ink-faint">
        Accepting decides it as you and wakes the sessions working this change; the dock shows what waits on you.{' '}
        <NodeLink to={ctx.change.key} lens={lens} className="hover:text-primary">
          Back to the change
        </NodeLink>
      </p>
    </div>
  );
}
