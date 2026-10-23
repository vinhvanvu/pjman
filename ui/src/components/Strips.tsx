import type { Health, LiveSession, StoreEvent } from '../api';
import { ago, Key, short } from './Keys';

/** The health strip: last moved, then done, new, blocked and waiting in the window. Zero is hidden; no score. */
export function HealthStrip({ h, compact }: { h: Health; compact?: boolean }) {
  const stale = h.staleDays !== null && h.staleDays > h.days;
  return (
    <span className={`health${compact ? ' compact' : ''}`}>
      <span className={`h-last${stale ? ' stale' : ''}`} title={h.last ? `last moved ${h.last.replace('T', ' ').slice(0, 16)}` : 'nothing beneath it has moved'}>
        {h.last ? `moved ${ago(h.last)}` : 'never moved'}
      </span>
      {h.done > 0 && <span className="h-done" title={`changes done in the last ${h.days} days`}>{h.done} done</span>}
      {h.created > 0 && <span className="h-new" title={`changes opened in the last ${h.days} days`}>{h.created} new</span>}
      {h.blocked > 0 && <span className="h-blocked" title="changes blocked now">{h.blocked} blocked</span>}
      {h.waiting > 0 && <span className="h-waiting" title="decisions waiting on a person">{h.waiting} waiting</span>}
    </span>
  );
}

/** Who answers for a node, and where that was written when it was inherited. */
export function Owners({ o, self }: { o: { owners: string[]; from?: string }; self?: string }) {
  if (!o.owners.length) return <span className="owners muted">no owner</span>;
  return (
    <span className="owners">
      {o.owners.map((k, i) => (
        <span key={k}>
          {i > 0 && ', '}
          <Key k={k} className="owner">{short(k)}</Key>
        </span>
      ))}
      {o.from && o.from !== self && (
        <span className="muted">
          {' '}
          from <Key k={o.from}>{short(o.from)}</Key>
        </span>
      )}
    </span>
  );
}

/** The sessions moving beneath the node right now. */
export function LiveSessions({ sessions }: { sessions: LiveSession[] }) {
  if (!sessions.length) return null;
  return (
    <ul className="live-strip">
      {sessions.map((s) => (
        <li key={s.key} className="live-session">
          <span className="live" aria-label="live">●</span> <Key k={s.key}>{short(s.key).slice(0, 8)}</Key>{' '}
          <span className="muted">
            {s.agent ? short(s.agent) : 'session'}
            {s.onBehalfOf ? ` for ${short(s.onBehalfOf)}` : ''}
          </span>
          {s.on && (
            <>
              {' '}· on <Key k={s.on} />
            </>
          )}
          <span className="muted"> · {ago(s.last)}</span>
          {s.lastLine && <div className="last muted">{s.lastLine}</div>}
        </li>
      ))}
    </ul>
  );
}

/** The last events beneath the node, newest first. */
export function Activity({ events }: { events: StoreEvent[] }) {
  if (!events.length) return <p className="muted">nothing yet</p>;
  return (
    <ul className="activity">
      {[...events].reverse().map((e) => (
        <li key={e.seq}>
          <span className="when muted" title={e.at}>{ago(e.at)}</span> <span className={`op op-${e.op}`}>{e.op}</span>{' '}
          {e.key.includes(':') ? <Key k={e.key} /> : <code>{e.key}</code>}
          {e.fields && e.fields.length > 0 && <span className="muted"> {e.fields.join(', ')}</span>}
          {e.writer && <span className="muted"> · {short(e.writer)}</span>}
        </li>
      ))}
    </ul>
  );
}
