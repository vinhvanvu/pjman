import { api } from '../api';
import { Key, Status } from '../components/Keys';
import { useLive } from '../live';
import { BoardView } from './Board';

/** The store: its projects, the whole board, the latest sessions. */
export function StorePage() {
  const store = useLive(() => api.store(), []);
  const board = useLive(() => api.board(null), []);
  const sessions = useLive(() => api.records({ type: 'session' }), [], (e) => e.type === 'session');
  if (store.error) return <p className="error">{store.error.message}</p>;
  if (!store.data) return <p className="muted">loading…</p>;
  const s = store.data;
  const recent = [...(sessions.data ?? [])].sort((a, b) => String(b.data.started).localeCompare(String(a.data.started))).slice(0, 8);
  return (
    <div className="store-page">
      <div className="facts muted">
        <span>{s.name} store</span>
        <span>{s.root}</span>
        {s.actor && <span>{s.actor}</span>}
      </div>
      <section>
        <h3>Projects</h3>
        <ul className="projects">
          {s.projects.map((p) => (
            <li key={p.key}>
              <Key k={p.key} /> <span className="title">{p.title}</span>
              {typeof p.data.tracker === 'string' && <span className="muted"> · tracker {String(p.data.tracker)}</span>}
            </li>
          ))}
        </ul>
      </section>
      {board.data && <BoardView b={board.data} />}
      {recent.length > 0 && (
        <section>
          <h3>Sessions</h3>
          <ul className="sessions">
            {recent.map((r) => (
              <li key={r.key}>
                <span className="muted">{String(r.data.started).slice(0, 16).replace('T', ' ')}</span> <Key k={r.key}>{r.key.slice(8, 16)}</Key>{' '}
                <span className="muted">{String(r.data.agent)} for {String(r.data.on_behalf_of)}</span>
                {Array.isArray(r.data.changes) && r.data.changes.length > 0 && (
                  <> · <Key k={String(r.data.changes[r.data.changes.length - 1])} /> <Status s={undefined} /></>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
