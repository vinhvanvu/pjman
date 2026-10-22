import { useParams } from 'react-router-dom';
import { api, type Board, type Row } from '../api';
import { Key, Status } from '../components/Keys';
import { useLive } from '../live';

const LANES = ['active', 'blocked', 'review', 'planning', 'open'];

function Item({ r, all, depth }: { r: Row; all: Row[]; depth: number }) {
  const children = all.filter((c) => c.data.parent === r.key);
  return (
    <li className={`item depth-${depth}`}>
      <div>
        <Key k={r.key} /> {depth > 0 && <Status s={r.status} />} <span className="title">{r.title}</span>
        {typeof r.data.project === 'string' && <span className="muted"> · {String(r.data.project).replace(/^project:/, '')}</span>}
      </div>
      {typeof r.data.next === 'string' && <div className="next-line muted">next: {r.data.next}</div>}
      {children.length > 0 && <ul>{children.map((c) => <Item key={c.key} r={c} all={all} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/** The board: open changes in lanes by status, nested by parent; proposed decisions. */
export function BoardView({ b }: { b: Board }) {
  const onBoard = new Set(b.changes.map((r) => r.key));
  const top = b.changes.filter((r) => !(typeof r.data.parent === 'string' && onBoard.has(r.data.parent)));
  const lanes = [...LANES, ...[...new Set(top.map((r) => r.status ?? '?'))].filter((s) => !LANES.includes(s))];
  return (
    <div className="board">
      <h1>{b.project ? <Key k={b.project.key} /> : b.store.name}</h1>
      {b.project?.title && <h2>{b.project.title}</h2>}
      <div className="lanes">
        {lanes.map((s) => {
          const rows = top.filter((r) => (r.status ?? '?') === s);
          if (!rows.length) return null;
          return (
            <section key={s} className={`lane lane-${s}`}>
              <h3>
                {s} <span className="count">{rows.length}</span>
              </h3>
              <ul>{rows.map((r) => <Item key={r.key} r={r} all={b.changes} depth={0} />)}</ul>
            </section>
          );
        })}
      </div>
      {b.proposed.length > 0 && (
        <section className="proposed">
          <h3>Proposed decisions <span className="count">{b.proposed.length}</span></h3>
          <ul>
            {b.proposed.map((r) => (
              <li key={r.key}>
                ○ <Key k={r.key} /> <span className="title">{r.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="counts muted">
        {Object.entries(b.counts).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(' · ')}
        {b.projects.length > 1 && !b.project && null}
      </div>
    </div>
  );
}

export function BoardPage() {
  const { project } = useParams();
  const b = useLive(() => api.board(project ? `project:${project}` : null), [project]);
  if (b.error) return <p className="error">{b.error.message}</p>;
  if (!b.data) return <p className="muted">loading…</p>;
  return <BoardView b={b.data} />;
}
