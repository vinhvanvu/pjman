import { useParams } from 'react-router-dom';
import { api } from '../api';
import { BoardView } from './Board';
import { Neighbourhood } from '../components/Neighbourhood';
import { useLive } from '../live';

/** What a session is on: its last bound change, else the project's board. Follows the session as it binds. */
export function SessionPage() {
  const { id = '' } = useParams();
  const view = useLive(() => api.sessionView(id), [id]);
  if (view.error) return <p className="error">{view.error.message}</p>;
  if (!view.data) return <p className="muted">loading…</p>;
  const v = view.data;
  return (
    <div className="session-page">
      <div className="following muted">
        following <code>{v.showing.session}</code>
        {v.showing.key && <> · on <code>{v.showing.key}</code></>}
        {view.seq !== undefined && <span className="seq"> · #{view.seq}</span>}
      </div>
      {v.neighbourhood ? <Neighbourhood n={v.neighbourhood} /> : v.board ? <BoardView b={v.board} /> : null}
    </div>
  );
}
