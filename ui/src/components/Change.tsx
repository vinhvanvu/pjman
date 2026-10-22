import type { ChangeContext } from '../api';
import { Key, MARK, Status } from './Keys';

function decisionLine(d: ChangeContext['decisions'][number]): string {
  const by = d.data.decided_by ? `decided by ${String(d.data.decided_by)}${d.data.decided_on ? ` on ${String(d.data.decided_on)}` : ''}` : '';
  if (d.status === 'decided') return by || 'decided';
  if (d.status === 'superseded') return `superseded${d.supersededBy ? ` by ${d.supersededBy}` : ''}${by ? ` (${by})` : ''}`;
  if (d.status === 'reverted') return `reverted${by ? ` (${by})` : ''}`;
  return d.status ?? '?';
}

/** One change with its neighbourhood: the pane's content. */
export function Change({ c, reached }: { c: ChangeContext; reached?: string }) {
  const d = c.change.data;
  const binds = c.sources.filter((s) => s.via === 'binds');
  const links = c.sources.filter((s) => s.via === 'links');
  return (
    <article className="change">
      {reached && <div className="reached">reached through {reached}</div>}
      <h1>
        <Key k={c.change.key} /> <Status s={c.change.status} />
      </h1>
      <h2>{c.change.title}</h2>
      <div className="facts">
        {typeof d.project === 'string' && <Key k={d.project} />}
        {c.parent && (
          <span>
            part of <Key k={c.parent.key} />
          </span>
        )}
        {binds.map((s) => (
          <span key={s.key}>
            binds{' '}
            {typeof s.record?.data.url === 'string' ? (
              <a href={s.record.data.url} target="_blank" rel="noreferrer">{s.key}</a>
            ) : (
              <Key k={s.key} />
            )}
          </span>
        ))}
        {c.change.created && <span className="muted">since {c.change.created}</span>}
      </div>
      {typeof d.next === 'string' && (
        <blockquote className="next">
          <b>next</b> {d.next}
        </blockquote>
      )}
      {c.summary && <p className="summary">{c.summary}</p>}
      {c.plan && (
        <section>
          <h3>Plan</h3>
          <pre className="prose">{c.plan}</pre>
        </section>
      )}
      {c.decisions.length > 0 && (
        <section>
          <h3>Decisions</h3>
          <ul className="decisions">
            {c.decisions.map((dec) => (
              <li key={dec.key} className={`decision ${dec.status ?? ''}`}>
                <span className="mark">{MARK[dec.status ?? ''] ?? '•'}</span>
                <div>
                  <Key k={dec.key}>
                    <b>{dec.title}</b>
                  </Key>
                  <div className="muted">{decisionLine(dec)}</div>
                  {dec.decision && <p>{dec.decision}</p>}
                  {dec.why && (
                    <p className="why">
                      <i>Why:</i> {dec.why}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {c.children.length > 0 && (
        <section>
          <h3>Children</h3>
          <ul>
            {c.children.map((ch) => (
              <li key={ch.key}>
                <Key k={ch.key} /> <Status s={ch.status} /> {ch.title}
              </li>
            ))}
          </ul>
        </section>
      )}
      {links.length > 0 && (
        <section>
          <h3>Sources</h3>
          <ul>
            {links.map((s) => (
              <li key={s.key}>
                <Key k={s.key} />
                {s.record?.title && <span className="muted"> — {s.record.title}</span>}
                {typeof s.record?.data.url === 'string' && (
                  <>
                    {' '}
                    <a href={s.record.data.url} target="_blank" rel="noreferrer">↗</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {c.observed.length > 0 && (
        <section>
          <h3>Files touched</h3>
          <ul className="files">
            {c.observed.map((o) => (
              <li key={`${o.edge} ${o.to}`}>
                <code>{o.to.replace(/^file:/, '')}</code>
                {o.at && <span className="muted"> · {o.at.slice(0, 10)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {c.sessions.length > 0 && (
        <section>
          <h3>Sessions</h3>
          <ul className="sessions">
            {c.sessions.slice(-5).map((s) => (
              <li key={s.key}>
                <span className="muted">{String(s.data.started).slice(0, 10)}</span> <Key k={s.key}>{s.key.slice(8, 16)}</Key>{' '}
                <span className="muted">{String(s.data.agent)} for {String(s.data.on_behalf_of)}</span>
                {s.last && <div className="last">{s.last}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
