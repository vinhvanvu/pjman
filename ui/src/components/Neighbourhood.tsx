import type { Neighbourhood as N } from '../api';
import { Change } from './Change';
import { Key, Status } from './Keys';

/** The getter's answer: the record, its edges both ways, and every change in reach. */
export function Neighbourhood({ n }: { n: N }) {
  const r = n.resolution;
  const self = n.record?.type === 'change' ? n.changes.find((c) => c.change.key === n.record!.key) : undefined;
  const others = n.changes.filter((c) => c.change.key !== n.record?.key);
  const edges = (list: N['in'] | N['out'], side: 'from' | 'to') => list.filter((e) => e.edge !== 'writer' && e.edge !== 'session').map((e) => (
    <li key={`${e.edge} ${e[side]} ${e.on}`}>
      <span className="muted">{e.edge}</span> <Key k={e[side]} />
      {e.observed && <span className="muted"> (observed{e.at ? ` ${e.at.slice(0, 10)}` : ''})</span>}
    </li>
  ));
  return (
    <div className="neighbourhood">
      {r.status === 'none' ? (
        <div className="empty">
          <h1>{n.input}</h1>
          <p>resolves to nothing</p>
          <ul className="muted">{r.tried.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ) : self ? (
        <Change c={self} />
      ) : (
        <article className="record">
          <div className="resolved muted">
            {n.input !== r.key && <>{n.input} → </>}
            {r.shape}{r.via && r.via !== r.key ? ` via ${r.via}` : ''}
            {r.status === 'key' && ' · a source key with no record'}
            {r.status === 'invalid' && ' · the record does not parse'}
          </div>
          <h1>
            <Key k={r.key!} /> <Status s={n.record?.status} />
          </h1>
          {n.record?.title && <h2>{n.record.title}</h2>}
          {typeof n.record?.data.url === 'string' && (
            <p>
              <a href={n.record.data.url} target="_blank" rel="noreferrer">{n.record.data.url}</a>
            </p>
          )}
          {n.in.some((e) => e.edge !== 'writer' && e.edge !== 'session') && (
            <section>
              <h3>Referenced by</h3>
              <ul>{edges(n.in, 'from')}</ul>
            </section>
          )}
          {n.out.some((e) => e.edge !== 'writer' && e.edge !== 'session') && (
            <section>
              <h3>Refers to</h3>
              <ul>{edges(n.out, 'to')}</ul>
            </section>
          )}
          {n.members.length > 0 && (
            <section>
              <h3>Members</h3>
              <ul>
                {n.members.map((m) => (
                  <li key={m.key}>
                    <Key k={m.key} /> <Status s={m.status} /> {m.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
      {others.map((c) => (
        <Change key={c.change.key} c={c} reached={n.via[c.change.key]} />
      ))}
    </div>
  );
}
