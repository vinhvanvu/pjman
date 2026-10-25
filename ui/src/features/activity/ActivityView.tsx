// Activity: the motion beneath the node, as a view. Live sessions first, then the stream newest first.
import type { Lens, LiveSession, StoreEvent } from '@/data/contract';
import { ago } from '@/lib/format';
import { short } from '@/lib/keys';
import { EmptyState } from '@/components/EmptyState';
import { Label } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Presence } from '@/components/presence/Presence';

export function ActivityView({
  recent,
  sessions,
  lens,
  days,
}: {
  recent: StoreEvent[];
  sessions: LiveSession[];
  lens: Lens;
  days: number;
}) {
  // bounded: the last 30 beneath the entity, newest first; the window is the scope's
  const events = recent.slice(-30).toReversed();
  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <section className="flex flex-col gap-2">
        <Label>Live now</Label>
        {sessions.length === 0 ? (
          <div className="text-xs text-ink-faint">No session has moved here in the last 30 minutes.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sessions.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5"
              >
                <Presence>
                  <NodeLink to={s.key} lens={lens} className="font-mono text-meta text-ink hover:text-primary">
                    {short(s.key).slice(0, 8)}
                  </NodeLink>
                </Presence>
                {s.on && (
                  <span className="text-xs text-ink-muted">
                    on{' '}
                    <NodeLink to={s.on} lens={lens} className="text-ink hover:text-primary">
                      {short(s.on)}
                    </NodeLink>
                  </span>
                )}
                {s.onBehalfOf && <span className="text-xs text-ink-faint">for {short(s.onBehalfOf)}</span>}
                <span className="ml-auto text-meta text-ink-faint">{ago(s.last)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <Label>Stream</Label>
          <span className="text-meta text-ink-faint">
            last {events.length} events beneath it · window {days} days
          </span>
        </div>
        {events.length === 0 ? (
          <EmptyState title="Nothing has happened here yet." />
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {events.map((e) => (
              <li
                key={e.seq}
                className="grid grid-cols-[52px_72px_minmax(0,1fr)_auto] items-baseline gap-3 px-3.5 py-2 text-xs"
              >
                <span className="text-ink-faint">{ago(e.at)}</span>
                <span className="font-mono text-meta text-ink-muted">{e.op}</span>
                <span className="min-w-0 truncate">
                  <NodeLink to={e.key} lens={lens} className="text-ink hover:text-primary">
                    {e.key}
                  </NodeLink>
                  {e.fields?.length ? <span className="text-ink-faint"> · {e.fields.join(', ')}</span> : null}
                </span>
                <span className="text-ink-faint">{e.writer ? short(e.writer) : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
