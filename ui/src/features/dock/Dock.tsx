// The dock: the session's page at docked width, one column beside the terminal (change:docked-view; decision
// session-leads-the-dock supersedes dock-column). It is the session tree folded to docked width
// (features/session, decision one-tree-two-variables): the session bar, the focus card on the change the session is
// on with the chips when several were touched, and the session's rail beneath. A session with no change yet shows a
// pickup list, the product's open changes by feature with the nearest to fully decided first, until the first bind
// moves the dock to the change.
import { cn } from 'cn';
import { AnimatePresence, m } from 'motion/react';
import { useRef, useState } from 'react';
import type { Lens, Scope, SessionFacts } from '@/data/contract';
import { ago, plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { swapView, Wash } from '@/lib/motion';
import { TONE } from '@/lib/tones';
import { useAt } from '@/state/moment';
import { Label } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { livenessWords } from '@/features/session-follow';
import { ActivityRail } from '@/features/rail/ActivityRail';
import { SessionTree, useSessionSearch } from '@/features/session';
import { pickups, readiness, type Pickup } from './model';

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
  const { pick } = useSessionSearch();
  // the dock moves from the pickup list to the session tree with its session's first bind (change:dock-moves;
  // decision dock-swap): a live move fades the old view, returns the column to the top and brings the new one in. A
  // swap is live only when the view before and the view after both belong to now (change:dock-moves-held-moment)
  const subject = session && (session.on || pick) ? 'tree' : 'fresh';
  const at = useAt();
  const [shown, setShown] = useState({ subject, from: at });
  const [live, setLive] = useState(false);
  const [moves, setMoves] = useState(0);
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
          {subject === 'tree' && session ? (
            <SessionTree session={session} lens={lens} wide={false} />
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

      {session && (
        <ActivityRail scope={session.key} lens={lens} limit={8} label="Live" note={<Liveness session={session} />} />
      )}
    </article>
  );
}

/** Beside the rail's head: the session's pulse while it is live, and its liveness in words. */
function Liveness({ session }: { session: SessionFacts }) {
  return (
    <>
      {session.state === 'live' && <Pulse />}
      <span className="text-meta text-ink-faint">this session · {livenessWords(session)}</span>
    </>
  );
}

/** One change to pick up: its title, and how decided it is, the proposed decisions named; or what it is stacked on. */
function PickupRow({ pickup: { row, proposed, stackedOn }, lens }: { pickup: Pickup; lens: Lens }) {
  const r = readiness(row, stackedOn.length > 0);
  return (
    <li className="flex flex-col gap-0.5 px-3.5 py-2">
      <NodeLink to={row.key} lens={lens} className="line-clamp-2 text-xs font-medium hover:text-primary">
        {row.gist ?? short(row.key)}
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
            <NodeLink to={d.key} lens={lens} className="truncate text-ink-muted hover:text-primary" title={d.gist}>
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
