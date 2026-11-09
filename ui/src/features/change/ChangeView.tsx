// The change as the subject (change:change-detail; decisions mirror-the-session-page, docked-is-folded): the change
// bar, the change tree, the sources and the change's rail, composed once for every place the change is read whole.
// Width forks two things, as on the session page: how far the tree opens, and where the sources and the rail sit
// (wide, in the panel beside the body; folded, beneath it, the sources one line). The change's own page mounts it at
// either width, the map's side panel folded. The rail runs by session (decision rail-unfiltered): every session that
// touched the change, a head at each hand-off, the live ones breathing, and no filter of its own.
import { cn } from 'cn';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ChangeContext, Lens, RailSession, Scope } from '@/data/contract';
import { useDecideAction, useRail, useStore } from '@/data/queries';
import { ActivityRail } from '@/features/rail/ActivityRail';
import type { RunSession } from '@/features/rail/model';
import { sessionTitle } from '@/features/session/model';
import type { PageSearch } from '@/routes/-search';
import { ChangeBar } from './ChangeBar';
import { ChangeTree, Sources } from './ChangeTree';
import { featureNames, workingOn } from './model';

/** The lane's colour on the change page: the step the work is on in the primary, as nothing else is lit. */
const PAGE_LANE = { '--lane': 'var(--primary)' } as React.CSSProperties;
const LAST_QUERY = { limit: 1 } as const;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function ChangeView({
  ctx,
  scope,
  lens,
  wide,
  page = false,
  className,
}: {
  ctx: ChangeContext;
  /** The change's own scope: its live sessions, what waits beneath it, the chain above it. */
  scope: Scope;
  lens: Lens;
  wide: boolean;
  /** The change's own page; else the map's side panel, where the tree is the way to the page. */
  page?: boolean;
  className?: string;
}) {
  const c = ctx.change;
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const onLink = (decision: string | undefined) =>
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, decision }), replace: true });
  const decide = useDecideAction('decide');
  const reopen = useDecideAction('reopen');
  const { data: store } = useStore();
  const head = useRail(c.key, LAST_QUERY).data;
  const last = head?.last?.at;
  const waits = ctx.decisions.filter((d) => d.status === 'proposed').length;
  const touched = touchedBy(ctx, head?.sessions ?? []);
  const liveKeys = new Set(scope.sessions.map((s) => s.key));
  const sessions: RunSession[] = touched.map((s) => ({
    key: s.key,
    title: sessionTitle(s),
    live: liveKeys.has(s.key),
  }));
  // on the page, links make their key the page; in the side panel they select it on the map
  const mode = page ? 'focus' : 'select';
  const under = scope.crumbs.filter((k) => !k.key.startsWith('product:') && k.key !== c.key).toReversed();
  const working = workingOn(scope.sessions, c.key);
  const tree = (
    <ChangeTree
      key={c.key}
      ctx={ctx}
      lens={lens}
      where="change"
      page={page}
      mode={mode}
      wide={wide}
      working={working}
      under={under}
      names={featureNames(scope.tree)}
      decide={decide}
      reopen={reopen}
      actor={store?.actor ?? undefined}
      linked={search.decision}
      onLink={onLink}
      bar={<ChangeBar sessions={touched} live={scope.sessions} last={last} waits={waits} />}
    />
  );
  const sources = <Sources ctx={ctx} lens={lens} mode={mode} wide={wide} />;
  const rail = (
    <ActivityRail
      scope={c.key}
      lens={lens}
      limit={wide ? 20 : 8}
      sessions={sessions}
      label="Timeline"
      note={<span className="text-meta text-ink-faint">newest first · a head where the session changes</span>}
    />
  );

  if (wide)
    return (
      <div className={cn('flex min-h-0 flex-1', className)} style={PAGE_LANE}>
        <section
          aria-label="The change"
          className="flex min-w-0 flex-[999_1_560px] flex-col overflow-auto px-9 pt-6 pb-12"
        >
          {tree}
        </section>
        <aside
          aria-label="The change's sources and timeline"
          className="flex w-[520px] shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-surface px-[22px] py-6"
        >
          {sources}
          <div className="my-1.5 h-px bg-line" aria-hidden="true" />
          {rail}
        </aside>
      </div>
    );

  return (
    <article className={cn('flex flex-col gap-[22px] px-4 pt-[18px] pb-4', className)} style={PAGE_LANE}>
      {tree}
      {sources}
      {rail}
    </article>
  );
}

type Touched = { key: string; agent?: string; onBehalfOf?: string; started?: string; first?: string };

/** The sessions that touched the change: every one that wrote on it, from its rail, and any bound to it that has not
 *  written yet, each named as the crumb names a session. */
function touchedBy(ctx: ChangeContext, wrote: readonly RailSession[]): Touched[] {
  const out: Touched[] = wrote.map((s) => ({ ...s }));
  for (const s of ctx.sessions)
    if (!out.some((w) => w.key === s.key))
      out.push({
        key: s.key,
        agent: str(s.data.agent),
        onBehalfOf: str(s.data.on_behalf_of),
        started: str(s.data.started),
        first: str(s.data.started),
      });
  return out;
}
