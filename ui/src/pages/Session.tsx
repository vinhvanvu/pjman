import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Page } from './Page';

/** What a session is on: its last bound change, else its project; the page follows the session as it binds. */
export function SessionPage() {
  const { id = '' } = useParams();
  const view = useLive(() => api.sessionView(id), [id], (e) => e.session === `session:${id}` || e.key === `session:${id}`);
  if (view.error) return <p className="error">{view.error.message}</p>;
  if (!view.data) return <p className="muted">loading…</p>;
  const v = view.data;
  const key = v.showing.key ?? v.showing.board ?? undefined;
  return <Page lens={key?.startsWith('project:') ? 'project' : 'feature'} node={key} following={v.showing.session} />;
}
