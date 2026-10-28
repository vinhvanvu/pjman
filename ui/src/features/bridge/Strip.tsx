// The need strip: the product's sessions grouped by what each needs from the person, in the order of need. Each card
// is a session: its state, the change it is on and the feature path above it, its last line and when, the decision
// that waits on the person or the next it left; its subagents are a count on it, never rows. A card opens that
// session's dock, which adopts the session for the tab. At desktop the strip is the bridge's command panel beside the
// stage; until the stage exists it stands alone.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { BridgeSession, Lens, SessionState } from '@/data/contract';
import { plural } from '@/lib/format';
import { restOf, short } from '@/lib/keys';
import { Label, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { cardWhen, needGroups, subagentWords } from './model';

const DOT: Record<SessionState, string> = {
  working: 'bg-live shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_25%,transparent)]',
  waiting: 'bg-status-review',
  stopped: 'bg-ink-muted',
  ended: 'bg-ink-faint',
};

const EMPTY: Record<SessionState, string> = {
  waiting: 'Nothing waits on you.',
  stopped: 'No session stopped with a next set.',
  working: 'No session is working now.',
  ended: 'No session ended today.',
};

export function Strip({
  sessions,
  lens,
  className,
}: {
  sessions: readonly BridgeSession[];
  lens: Lens;
  className?: string;
}) {
  const groups = needGroups(sessions);
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {groups.map((g) => (
        <section key={g.state} className="flex flex-col gap-2" aria-label={g.label}>
          <div className="flex items-center gap-2">
            <Label
              className={cn(
                g.sessions.length > 0 && g.state === 'waiting' && 'text-status-review',
                g.sessions.length > 0 && g.state === 'working' && 'text-live',
              )}
            >
              {g.label}
            </Label>
            <span className="text-meta text-ink-faint">
              {g.sessions.length > 0
                ? `${plural(g.sessions.length, 'session')}${g.sessions.length > 1 ? ' · by last write' : ''}`
                : 'none'}
            </span>
          </div>
          {g.sessions.length === 0 ? (
            <div className="text-xs text-ink-faint">{EMPTY[g.state]}</div>
          ) : (
            <ol className="flex flex-col gap-2">
              {g.sessions.map((s) => (
                <li key={s.key}>
                  <SessionCard session={s} lens={lens} />
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

/** One session as the strip carries it. The whole card opens the session's dock; the change and the features inside
 *  it are links of their own. */
export function SessionCard({ session: s, lens }: { session: BridgeSession; lens: Lens }) {
  const title = s.change ? (s.change.title ?? short(s.change.key)) : 'No change yet';
  return (
    <Link
      to="/session/$id"
      params={{ id: restOf(s.key) }}
      search={{}}
      className={cn(
        'flex flex-col gap-1.5 rounded-card border bg-surface px-3.5 py-3 hover:bg-raised',
        s.state === 'waiting' ? 'border-status-review/60' : 'border-line',
        s.state === 'ended' && 'opacity-70',
      )}
      aria-label={`Open the session on ${title}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[s.state])} />
        <span className={cn('min-w-0 flex-1 truncate font-medium', !s.change && 'text-ink-muted')}>{title}</span>
        {s.change?.status && s.state === 'ended' && <StatusChip status={s.change.status} />}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-meta text-ink-faint">
        {s.change && s.change.path.length > 0 ? (
          <span className="truncate">
            {s.change.path.map((f, i) => (
              <span key={f.key}>
                {i > 0 && ' › '}
                <NodeLink to={f.key} lens={lens} className="hover:text-ink">
                  {f.name}
                </NodeLink>
              </span>
            ))}
          </span>
        ) : (
          <span className="truncate">{s.change ? 'no feature named' : 'binds a change when it names one'}</span>
        )}
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{cardWhen(s)}</span>
        {subagentWords(s.children) && (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{subagentWords(s.children)}</span>
          </>
        )}
      </span>
      {s.decision && (
        <span className="flex items-start gap-2 rounded-row bg-status-review/10 px-2.5 py-2 text-xs">
          <Label className="mt-px shrink-0 text-status-review">decide</Label>
          <span className="line-clamp-2 min-w-0 text-ink">{s.decision.title ?? short(s.decision.key)}</span>
        </span>
      )}
      {s.line && <span className="line-clamp-2 text-xs text-ink-muted">{s.line.text}</span>}
      {s.state === 'stopped' && s.change?.next && (
        <span className="line-clamp-2 text-xs text-ink-muted">
          <Label className="mr-1.5">next</Label>
          {s.change.next}
        </span>
      )}
    </Link>
  );
}
