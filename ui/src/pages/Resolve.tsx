import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { Neighbourhood } from '../components/Neighbourhood';
import { useLive } from '../live';

/** Anything in, the neighbourhood out. The reference is the rest of the path after /get/. */
export function ResolvePage() {
  const loc = useLocation();
  const ref = decodeURIComponent(loc.pathname.replace(/^\/get\//, ''));
  const n = useLive(() => api.resolve(ref), [ref]);
  if (n.error && (n.error as { status?: number }).status !== 404) return <p className="error">{n.error.message}</p>;
  if (n.error) {
    const tried = (n.error as { tried?: string[] }).tried ?? [];
    return (
      <div className="empty">
        <h1>{ref}</h1>
        <p>resolves to nothing</p>
        <ul className="muted">{tried.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    );
  }
  if (!n.data) return <p className="muted">loading…</p>;
  return <Neighbourhood n={n.data} />;
}
