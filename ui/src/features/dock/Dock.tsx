// The dock: the session's page at docked width, one column beside the terminal (change:docked-view; decision
// dock-column). What the session is on first; what waits on the person next; the handoff; this session's own lines,
// newest first; the summary clamped; then rows that drill into the record in place. A session with no change yet
// shows its product's board, until the first bind moves the dock to the change.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ChangeContext, Lens, Scope, SessionFacts, View } from '@/data/contract';
import { ago, plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { DecisionRows } from '@/components/cards/DecisionRows';
import { Chip, KeyText, Label, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { livenessWords, newestLines } from '@/features/session-follow';

const LIVE_LINES = 5;

export function Dock({ scope, session, lens }: { scope: Scope; session?: SessionFacts; lens: Lens }) {
  return session?.on && scope.change ? (
    <DockChange scope={scope} ctx={scope.change} session={session} lens={lens} />
  ) : (
    <DockFresh scope={scope} session={session} lens={lens} />
  );
}

/** The dock on a change: the session is on it. */
function DockChange({
  scope,
  ctx,
  session,
  lens,
}: {
  scope: Scope;
  ctx: ChangeContext;
  session: SessionFacts;
  lens: Lens;
}) {
  const c = ctx.change;
  const waiting = ctx.decisions.filter((d) => d.status === 'proposed');
  const features = Array.isArray(c.data.features) ? (c.data.features as string[]) : [];
  // the feature path the change sits under, nearest first, the product left out: the rail names it
  const under = scope.crumbs.filter((k) => !k.key.startsWith('product:')).toReversed();
  return (
    <article className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Label>{c.data.kind === 'bug' ? 'bug' : 'change'}</Label>
          <span className="text-ink-faint">·</span>
          <StatusChip status={c.status} />
          {ctx.parent && (
            <NodeLink to={ctx.parent.key} lens={lens}>
              <Chip tone="quiet">↳ {short(ctx.parent.key)}</Chip>
            </NodeLink>
          )}
        </div>
        <h1 className="text-section font-semibold tracking-tight">{c.title ?? short(c.key)}</h1>
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
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label className={waiting.length ? 'text-primary' : undefined}>Waits on you</Label>
          {waiting.length > 0 && <span className="text-meta text-ink-faint">{plural(waiting.length, 'decision')}</span>}
        </div>
        {waiting.length === 0 ? (
          <div className="text-xs text-ink-faint">
            Nothing.{ctx.decisions.length > 0 ? ` ${plural(ctx.decisions.length, 'decision')} decided.` : ''}
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {waiting.map((d) => (
              <li key={d.key}>
                <NodeLink
                  to={d.key}
                  lens={lens}
                  className="flex flex-col gap-1.5 rounded-card border border-primary bg-surface px-3.5 py-3 hover:bg-raised"
                >
                  <span className="line-clamp-2 font-medium leading-[1.35]">{d.title ?? short(d.key)}</span>
                  {d.decision && <span className="line-clamp-3 text-xs text-ink-muted">{d.decision}</span>}
                  <span className="flex items-center gap-2 text-meta text-ink-faint">
                    <Chip tone="quiet">proposed</Chip>
                    {d.created && <span>{d.created}</span>}
                  </span>
                </NodeLink>
              </li>
            ))}
          </ol>
        )}
      </section>

      {typeof c.data.next === 'string' && c.data.next && (
        <section className="flex flex-col gap-1.5">
          <Label>Next</Label>
          <p className="rounded-card bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed">{c.data.next}</p>
        </section>
      )}

      <LiveLines session={session} />

      {ctx.summary && <Clamped label="Summary" text={ctx.summary} />}

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
            <NodeLink key={s.key} to={s.key} lens={lens}>
              <Chip tone="quiet" mono title={s.via}>
                {short(s.key)}
              </Chip>
            </NodeLink>
          ))}
        </section>
      )}
      <KeyText>{c.key}</KeyText>
    </article>
  );
}

/** The dock before the session binds a change: the product's board, what waits on the person first. */
function DockFresh({ scope, session, lens }: { scope: Scope; session?: SessionFacts; lens: Lens }) {
  const open = scope.changes.filter((r) => r.status !== 'done' && r.status !== 'dropped');
  const count = (s: string) => open.filter((r) => (r.status ?? 'open') === s).length;
  const review = count('review');
  const inOrder = scope.roadmap.sequence
    .map((k) => scope.changes.find((r) => r.key === k))
    .filter((r): r is NonNullable<typeof r> => !!r && r.status !== 'done' && r.status !== 'dropped')
    .slice(0, 3);
  const product = scope.node?.name ?? scope.node?.title ?? (scope.node ? short(scope.node.key) : 'the store');
  return (
    <article className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1.5">
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

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label className={scope.waitingOn.length || review ? 'text-primary' : undefined}>Waits on you</Label>
          <span className="text-meta text-ink-faint">across {product}</span>
        </div>
        <div className="flex gap-2">
          <Stat n={scope.waitingOn.length} label="decisions proposed" to={{ view: 'inbox' }} />
          <Stat n={review} label="changes in review" to={{ view: 'lanes' }} />
        </div>
        {scope.waitingOn.length > 0 && (
          <DecisionRows items={scope.waitingOn.slice(0, 3)} lens={lens} className="gap-1.5" />
        )}
        {scope.waitingOn.length > 3 && (
          <Link
            to="."
            search={(prev: Record<string, unknown>) => ({ ...prev, view: 'inbox' as const })}
            className="text-xs text-primary hover:underline"
          >
            {scope.waitingOn.length - 3} more in the inbox
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label>Open</Label>
          <span className="text-meta text-ink-faint">{plural(open.length, 'change')}</span>
        </div>
        <div className="flex gap-3">
          {(['active', 'planning', 'review', 'open'] as const).map((s) => (
            <div key={s} className="flex flex-1 flex-col">
              <span className="text-section font-semibold tabular-nums">{count(s)}</span>
              <span className="text-meta text-ink-muted">{s}</span>
            </div>
          ))}
        </div>
        {inOrder.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {inOrder.map((r, i) => (
              <li key={r.key} className="flex items-center gap-2 px-3.5 py-2">
                <NodeLink
                  to={r.key}
                  lens={lens}
                  className="line-clamp-2 min-w-0 flex-1 text-xs font-medium hover:text-primary"
                >
                  {r.title ?? short(r.key)}
                </NodeLink>
                <span className="shrink-0 text-meta text-ink-faint">{i === 0 ? 'next up' : 'then'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {session && <LiveLines session={session} />}
    </article>
  );
}

/** This session's own lines, newest first: what it last said at every stop. */
function LiveLines({ session }: { session: SessionFacts }) {
  const [all, setAll] = useState(false);
  const lines = all ? session.log.toReversed() : newestLines(session.log, LIVE_LINES);
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
        <ol className="flex flex-col gap-1.5">
          {lines.map((l) => (
            <li key={l.at} className="flex items-start gap-2.5 text-xs">
              <span className="w-8 shrink-0 pt-px text-right font-mono text-meta text-ink-faint">{ago(l.at)}</span>
              <span className={cn('min-w-0 leading-relaxed', all ? '' : 'line-clamp-2')}>{l.text}</span>
            </li>
          ))}
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

function Stat({ n, label, to }: { n: number; label: string; to: { view: View } }) {
  return (
    <Link
      to="."
      search={(prev: Record<string, unknown>) => ({ ...prev, ...to })}
      className={cn(
        'flex flex-1 flex-col rounded-card border border-line bg-surface px-3.5 py-2.5 hover:bg-raised',
        n > 0 && 'border-primary',
      )}
    >
      <span className="text-heading font-semibold tabular-nums">{n}</span>
      <span className="text-meta text-ink-muted">{label}</span>
    </Link>
  );
}
