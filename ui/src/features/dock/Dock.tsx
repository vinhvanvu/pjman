// The dock: the session's page at docked width, one column beside the terminal (change:docked-view; decision
// dock-column). What the session is on first; what waits on the person next; this session's own lines, newest first;
// the next step and the Intent clamped; then rows that drill into the record in place. A session with no change yet
// shows a pickup list, the product's open changes by feature with the nearest to fully decided first, until the first
// bind moves the dock to the change. The next step is the plan's, derived (change:foundation-views), so it never
// restates a handoff the way the retired next field did (decision next-leaves-the-dock).
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronRight, Diamond } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useRef, useState } from 'react';
import type { ChangeAspects, ChangeContext, Lens, Scope, SessionFacts, StoreEvent } from '@/data/contract';
import { ago, plural } from '@/lib/format';
import { useHeldList, useHold } from '@/lib/hold';
import { short } from '@/lib/keys';
import { liveItem, swapView, Wash } from '@/lib/motion';
import { statusTone, TONE } from '@/lib/tones';
import { useFreshEvents } from '@/state/arrivals';
import { useAt } from '@/state/moment';
import { Chip, KeyText, Label, StatusChip } from '@/components/chips/Chip';
import { DecisionRows } from '@/components/cards/DecisionRows';
import { useDecideAction } from '@/data/queries';
import { NodeLink } from '@/components/links/NodeLink';
import { SourceChip } from '@/components/links/SourceChip';
import { Pulse } from '@/components/presence/Presence';
import { livenessWords, newestLines } from '@/features/session-follow';
import { AspectReading, AspectWholeBody } from '@/features/aspects';
import { nextLine, Readiness } from '@/components/record/Foundation';
import { dockArrivals, pickups, readiness, type Pickup } from './model';

const LIVE_LINES = 5;
const NO_EVENTS: readonly StoreEvent[] = [];
const keyOf = (d: { key: string }) => d.key;
const lineKey = (l: { at: string }) => l.at;

export function Dock({
  scope,
  session,
  lens,
  settled = true,
}: {
  scope: Scope;
  session?: SessionFacts;
  lens: Lens;
  /** The scope is the one asked for, not the last one held while it loads. */
  settled?: boolean;
}) {
  const ctx = session?.on ? scope.change : undefined;
  // the dock moves with its session (change:dock-moves; decision dock-swap): keyed on the change it draws, not the one
  // the session is on, so the swap waits for the new change's scope. A live move fades the old view, returns the
  // column to the top and brings the new one in with its header washed. A swap is live only when the view before and
  // the view after both belong to now: into or out of a held moment it is the person's act, and swaps at once
  // (change:dock-moves-held-moment)
  const subject = ctx?.change.key ?? 'fresh';
  const at = useAt();
  const [shown, setShown] = useState({ subject, from: at });
  const [live, setLive] = useState(false);
  const [moves, setMoves] = useState(0);
  // the moment the drawn scope belongs to: while the asked-for one loads, the held one is still the last moment's
  const from = settled ? at : shown.from;
  if (shown.subject !== subject || shown.from !== from) {
    setShown({ subject, from });
    if (shown.subject !== subject) {
      const move = !from && !shown.from;
      setLive(move);
      if (move) setMoves((n) => n + 1);
    }
  }
  const moved = live && !at ? moves : undefined;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <AnimatePresence
        mode="wait"
        initial={false}
        custom={live}
        onExitComplete={() => scrollParent(ref.current)?.scrollTo({ top: 0 })}
      >
        <m.div key={subject} {...swapView} custom={live} initial={live ? 'enter' : false}>
          {ctx && session ? (
            <DockChange scope={scope} ctx={ctx} session={session} lens={lens} moved={moved} />
          ) : (
            <DockFresh scope={scope} session={session} lens={lens} moved={moved} />
          )}
        </m.div>
      </AnimatePresence>
    </div>
  );
}

/** The nearest ancestor that scrolls: the column the dock stands in. */
function scrollParent(el: HTMLElement | null): HTMLElement | undefined {
  for (let p = el?.parentElement; p; p = p.parentElement)
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return undefined;
}

/** The wash on a header the dock just moved to, a little wider than the text. */
function Moved({ arrival }: { arrival?: number }) {
  if (arrival === undefined) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -inset-x-2 -inset-y-1.5 rounded-card">
      <Wash arrival={arrival} className={TONE.active.wash} />
    </span>
  );
}

/** The dock on a change: the session is on it. */
function DockChange({
  scope,
  ctx,
  session,
  lens,
  moved,
}: {
  scope: Scope;
  ctx: ChangeContext;
  session: SessionFacts;
  lens: Lens;
  /** The dock just moved here with its session: the header washes. */
  moved?: number;
}) {
  const c = ctx.change;
  const waiting = ctx.decisions.filter((d) => d.status === 'proposed');
  const features = Array.isArray(c.data.features) ? (c.data.features as string[]) : [];
  // the feature path the change sits under, nearest first, the product left out: the rail names it
  const under = scope.crumbs.filter((k) => !k.key.startsWith('product:')).toReversed();
  // alive (change:motion-design): what the stream just changed washes in place, and the dock holds still under the
  // pointer or focus; at a held moment nothing on it is arriving
  const at = useAt();
  const decide = useDecideAction('decide');
  const fresh = useFreshEvents();
  const arrivals = dockArrivals(at ? NO_EVENTS : fresh, session.key, c.key);
  const hold = useHold();
  const { shown: waits, letGo } = useHeldList(waiting, hold.held, keyOf);
  // the decision the person just decided leaves at once, held or not (decision decide-is-slow/acted-card-leaves-the-hold)
  const onDecide =
    decide &&
    ((k: string) =>
      decide(k).then(() => {
        letGo(k);
        hold.settle();
      }));
  return (
    <article className="flex flex-col gap-5 p-4" {...hold.props}>
      <header className="relative flex flex-col gap-1.5">
        <Moved arrival={moved} />
        <div className="flex flex-wrap items-center gap-2">
          <Label>{c.data.kind === 'bug' ? 'bug' : 'change'}</Label>
          <span className="text-ink-faint">·</span>
          <span className="relative overflow-hidden rounded-chip">
            <StatusChip status={c.status} />
            <Wash arrival={arrivals.status?.seq} className={statusTone(c.status).wash} />
          </span>
          {ctx.parent && (
            <NodeLink to={ctx.parent.key} lens={lens}>
              <Chip tone="quiet">↳ {short(ctx.parent.key)}</Chip>
            </NodeLink>
          )}
        </div>
        <h1 className="text-section font-semibold tracking-tight">{c.name ?? c.title ?? short(c.key)}</h1>
        {c.name && c.title && c.title !== c.name && <p className="text-xs leading-relaxed text-ink-muted">{c.title}</p>}
        <Readiness needs={ctx.needs} stale={ctx.stale} migrated={ctx.migrated} />
        {(features.length > 0 || under.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
            {features.map((f) => {
              const [effect, key] = f.includes(' ') ? f.split(' ', 2) : ['changes', f];
              return (
                <span key={f}>
                  {effect}{' '}
                  <NodeLink to={key!} lens={lens} className="text-ink hover:text-primary">
                    {short(key!)}
                  </NodeLink>
                </span>
              );
            })}
            {under.length > 0 && (
              <span>
                {features.length > 0 && <span className="text-ink-faint">· </span>}in{' '}
                {under.map((k, i) => (
                  <span key={k.key}>
                    {i > 0 && <span className="text-ink-faint"> › </span>}
                    <NodeLink to={k.key} lens={lens} className="text-ink hover:text-primary">
                      {k.name ?? k.title ?? short(k.key)}
                    </NodeLink>
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        {ctx.aspects && <DockAspects aspects={ctx.aspects} lens={lens} />}
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label className={waits.length ? 'text-primary' : undefined}>Waits on you</Label>
          <span className="text-meta text-ink-faint">
            {waits.length > 0
              ? plural(waits.length, 'decision')
              : `nothing${ctx.decisions.length > 0 ? ` · ${plural(ctx.decisions.length, 'decision')} decided` : ''}`}
          </span>
        </div>
        <DecisionRows
          items={waits.map((d) => {
            return {
              key: d.key,
              name: d.name,
              title: d.title,
              change: c.key,
              state: d.state,
              needs: d.needs,
              stale: d.stale,
              created: d.created,
            };
          })}
          lens={lens}
          showChange={false}
          opened={arrivals.opened}
          moment={at}
          onDecide={onDecide}
        />
      </section>

      <LiveLines session={session} arrival={arrivals.line} held={hold.held} moment={at} />

      {ctx.next && <Clamped label="Next" text={nextLine(ctx.next)!} />}
      {ctx.sections.Intent && <Clamped label="Intent" text={ctx.sections.Intent} />}

      <nav aria-label="More of this change" className="flex flex-col border-t border-line">
        <TabRow tab="decisions" count={ctx.decisions.length}>
          Decisions
        </TabRow>
        <TabRow tab="activity" count={scope.recent.length}>
          Activity
        </TabRow>
      </nav>

      <Rows label="Beneath" lens={lens} items={ctx.children} progress={ctx.progress} />
      <Rows label="Depends on" lens={lens} items={ctx.dependsOn} />
      <Rows label="Needed by" lens={lens} items={ctx.neededBy} />
      {ctx.sources.length > 0 && (
        <section className="flex flex-wrap items-center gap-2">
          <Label>Sources</Label>
          {ctx.sources.map((s) => (
            <SourceChip key={s.key} source={s} lens={lens} title={s.via} />
          ))}
        </section>
      )}
      <KeyText>{c.key}</KeyText>
    </article>
  );
}

/** The dock before the session binds a change: a pickup list, what this session could take up (decision
 *  fresh-dock-readiness): open changes by the feature they name, in the roadmap's order, the nearest to fully decided first. */
function DockFresh({
  scope,
  session,
  lens,
  moved,
}: {
  scope: Scope;
  session?: SessionFacts;
  lens: Lens;
  moved?: number;
}) {
  const groups = pickups(scope);
  const open = groups.reduce((n, g) => n + g.changes.length, 0);
  const product = scope.node?.name ?? scope.node?.title ?? (scope.node ? short(scope.node.key) : 'the store');
  return (
    <article className="flex flex-col gap-5 p-4">
      <header className="relative flex flex-col gap-1.5">
        <Moved arrival={moved} />
        <div className="flex flex-wrap items-center gap-2">
          <Label>session · {product}</Label>
          {session?.started && (
            <>
              <span className="text-ink-faint">·</span>
              <span className="text-meta text-ink-muted">started {ago(session.started)}</span>
            </>
          )}
        </div>
        <h1 className="text-section font-semibold tracking-tight">No change yet</h1>
        <p className="text-xs text-ink-muted">
          The dock moves to the change the moment this session binds one: name it in a prompt, or start on its branch.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Label>Pick up</Label>
          <span className="text-meta text-ink-faint">
            {plural(open, 'open change')} · in roadmap order, the nearest to decided first
          </span>
        </div>
        {groups.length === 0 ? (
          <div className="text-xs text-ink-faint">Nothing open across {product}.</div>
        ) : (
          groups.map((g) => (
            <section key={g.key ?? ''} className="flex flex-col gap-1.5">
              {g.key ? (
                <NodeLink to={g.key} lens={lens} className="text-xs font-medium text-ink-muted hover:text-primary">
                  {g.name}
                </NodeLink>
              ) : (
                <span className="text-xs font-medium text-ink-faint">{g.name}</span>
              )}
              <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
                {g.changes.map((p) => (
                  <PickupRow key={p.row.key} pickup={p} lens={lens} />
                ))}
              </ul>
            </section>
          ))
        )}
      </section>

      {session && <LiveLines session={session} />}
    </article>
  );
}

/** One change to pick up: its title, and how decided it is, the proposed decisions named; or what it is stacked on. */
function PickupRow({ pickup: { row, proposed, stackedOn }, lens }: { pickup: Pickup; lens: Lens }) {
  const r = readiness(row, stackedOn.length > 0);
  return (
    <li className="flex flex-col gap-0.5 px-3.5 py-2">
      <NodeLink to={row.key} lens={lens} className="line-clamp-2 text-xs font-medium hover:text-primary">
        {row.title ?? short(row.key)}
      </NodeLink>
      <span className="flex min-w-0 items-center gap-1.5 text-meta">
        <span
          className={cn(
            'shrink-0',
            r.state === 'ready'
              ? 'font-medium text-primary'
              : r.state === 'deciding'
                ? 'text-ink-muted'
                : 'text-ink-faint',
          )}
        >
          {r.state === 'stacked' ? 'stacked on' : r.text}
        </span>
        {stackedOn.map((d, i) => (
          <span key={d.key} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-ink-faint">·</span>}
            <NodeLink to={d.key} lens={lens} className="truncate text-ink-muted hover:text-primary" title={d.title}>
              {short(d.key)}
            </NodeLink>
          </span>
        ))}
        {proposed.length > 0 && (
          <span className="truncate text-ink-faint" title={proposed.join(', ')}>
            · waits: {proposed.join(', ')}
          </span>
        )}
      </span>
    </li>
  );
}

/** This session's own lines, newest first: what it last said at every stop. */
function LiveLines({
  session,
  arrival,
  held,
  moment,
}: {
  session: SessionFacts;
  /** The line the stream just brought, which washes the newest line. */
  arrival?: StoreEvent;
  held?: boolean;
  moment?: string;
}) {
  const [all, setAll] = useState(false);
  const { shown: lines } = useHeldList(
    all ? session.log.toReversed() : newestLines(session.log, LIVE_LINES),
    held ?? false,
    lineKey,
  );
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>Live</Label>
        {session.state === 'live' && <Pulse />}
        <span className="text-meta text-ink-faint">this session · {livenessWords(session)}</span>
      </div>
      {lines.length === 0 ? (
        <div className="text-xs text-ink-faint">Nothing written yet.</div>
      ) : (
        // a new line opens its space at the top and fades in; the oldest is pushed out at the bottom as it fades;
        // showing all or fewer, or another moment, redraws at once
        <ol key={`${moment ?? 'now'}|${all}`} className="flex flex-col">
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <m.li
                key={l.at}
                {...liveItem}
                className="relative flex items-start gap-2.5 overflow-hidden rounded-row pb-1.5 text-xs"
              >
                {i === 0 && <Wash arrival={arrival?.seq} className={TONE.live.wash} />}
                <span className="w-8 shrink-0 pt-px text-right font-mono text-meta text-ink-faint">{ago(l.at)}</span>
                <span className={cn('min-w-0 leading-relaxed', all ? '' : 'line-clamp-2')}>{l.text}</span>
              </m.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {session.log.length > LIVE_LINES && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start text-xs text-primary hover:underline"
        >
          {all ? 'fewer' : `all ${session.log.length}`}
        </button>
      )}
    </section>
  );
}

/** A section of text clamped to three lines, with a way to read it whole. */
function Clamped({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <p className={cn('whitespace-pre-line text-[13px] leading-relaxed text-ink-muted', !open && 'line-clamp-3')}>
        {text}
      </p>
      {text.length > 160 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="self-start text-xs text-primary hover:underline"
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </section>
  );
}

/** The aspects the change works under, as chips under its title (aspect:aspects/dock): no section of their own. A chip
 *  opens as a drill-in beneath the header: an aspect the change names lists every place it is linked to, each forked
 *  or the base as it is; any other reads as it applies here. */
function DockAspects({ aspects, lens }: { aspects: ChangeAspects; lens: Lens }) {
  const [open, setOpen] = useState<string | undefined>();
  const chips = [
    ...aspects.named.map((n) => ({ key: n.aspect, named: true, forked: false })),
    ...aspects.at.map((x) => ({ key: x.aspect, named: false, forked: x.layers.some((l) => l.from === x.place) })),
  ];
  if (!chips.length) return null;
  const named = aspects.named.find((n) => n.aspect === open);
  const at = aspects.at.find((x) => x.aspect === open);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-expanded={open === c.key}
            onClick={() => setOpen(open === c.key ? undefined : c.key)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-chip border px-1.5 text-meta',
              open === c.key
                ? 'border-primary/50 bg-selection text-ink'
                : 'border-line-strong text-ink-muted hover:bg-raised hover:text-ink',
            )}
            title={c.named ? 'This change works on the aspect' : 'The change works under this aspect'}
          >
            <Diamond className="size-3" aria-hidden="true" />
            {c.key.split('/').pop()}
            {c.named && <span className="text-ink-faint">· working on it</span>}
            {c.forked && <span className="text-ink-faint">· forked</span>}
          </button>
        ))}
      </div>
      {(named || at) && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface px-3.5 py-3">
          {named ? <AspectWholeBody whole={named} lens={lens} /> : at && <AspectReading at={at} lens={lens} />}
        </div>
      )}
    </div>
  );
}

/** A row that opens one of the record's tabs in place; the tab's overview brings the dock back. */
function TabRow({ tab, count, children }: { tab: 'decisions' | 'activity'; count?: number; children: string }) {
  return (
    <Link
      to="."
      search={(prev: Record<string, unknown>) => ({ ...prev, tab })}
      className="flex h-10 items-center gap-2 border-b border-line text-[13px] font-medium hover:text-primary"
    >
      {children}
      <span className="ml-auto text-meta text-ink-faint">{count || 'none'}</span>
      <ChevronRight className="size-4 text-ink-faint" aria-hidden="true" />
    </Link>
  );
}

/** Related changes as rows; a tap opens one in place. Nothing when there are none. */
function Rows({
  label,
  lens,
  items,
  progress,
}: {
  label: string;
  lens: Lens;
  items: { key: string; title?: string; status?: string }[];
  progress?: { done: number; total: number };
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {progress && (
          <Chip tone="quiet">
            {progress.done} / {progress.total}
          </Chip>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {items.map((k) => (
          <li key={k.key} className="flex items-center gap-2 px-3.5 py-2">
            <NodeLink
              to={k.key}
              lens={lens}
              className="line-clamp-2 min-w-0 flex-1 text-xs font-medium hover:text-primary"
            >
              {k.title ?? short(k.key)}
            </NodeLink>
            <StatusChip status={k.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
