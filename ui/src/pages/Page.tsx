import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, LENSES, type Lens, type Scope } from '../api';
import { Change } from '../components/Change';
import { hrefOf, LensContext, short, Status } from '../components/Keys';
import { Lanes, Tree } from '../components/Rows';
import { Activity, HealthStrip, LiveSessions, Owners } from '../components/Strips';
import { useLive } from '../live';

const WIDE = '(min-width: 860px)';

/** Two widths: one column in a sidebar, tree beside record on a desktop. The width decides panes, never routes. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

function Toggles({ s, lens, node, view, wide }: { s: Scope; lens: Lens; node?: string; view: 'tree' | 'lanes'; wide: boolean }) {
  const [params, setParams] = useSearchParams();
  const search = params.toString() ? `?${params}` : '';
  const flip = (k: string, on: boolean) => {
    const p = new URLSearchParams(params);
    if (on) p.set(k, k === 'view' ? 'lanes' : '1');
    else p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <div className="toggles">
      <span className="seg" role="tablist" aria-label="lens">
        {LENSES.map((l) => (
          <Link key={l} to={`/${l}/${node ?? ''}${search}`} className={l === lens ? 'on' : ''} role="tab" aria-selected={l === lens}>
            {l}
          </Link>
        ))}
      </span>
      {wide && (
        <span className="seg" role="tablist" aria-label="view">
          <button type="button" className={view === 'tree' ? 'on' : ''} onClick={() => flip('view', false)}>tree</button>
          <button type="button" className={view === 'lanes' ? 'on' : ''} onClick={() => flip('view', true)}>lanes</button>
        </span>
      )}
      {(s.doneHidden > 0 || params.get('done') === '1') && (
        <button type="button" className={`flag${params.get('done') === '1' ? ' on' : ''}`} onClick={() => flip('done', params.get('done') !== '1')}>
          {params.get('done') === '1' ? 'hide done' : `${s.doneHidden} done`}
        </button>
      )}
      {(s.retiredHidden > 0 || params.get('retired') === '1') && (
        <button type="button" className={`flag${params.get('retired') === '1' ? ' on' : ''}`} onClick={() => flip('retired', params.get('retired') !== '1')}>
          {params.get('retired') === '1' ? 'hide retired' : `${s.retiredHidden} retired`}
        </button>
      )}
    </div>
  );
}

function Head({ s, lens, node, following }: { s: Scope; lens: Lens; node?: string; following?: string }) {
  const n = s.node;
  return (
    <>
      {following && (
        <div className="following muted">
          following <code>{following}</code>
          {n && <> · on <code>{n.key}</code></>}
        </div>
      )}
      {s.crumbs.length > 0 && (
        <nav className="crumbs" aria-label="above">
          {s.crumbs.map((c) => (
            <span key={c.key}>
              <Link to={hrefOf(c.key, lens)}>{c.title ?? c.key}</Link>
              <span className="sep"> › </span>
            </span>
          ))}
        </nav>
      )}
      <div className="page-title">
        <h1>{n ? n.title ?? n.key : 'everything'}</h1>
        {n && (
          <span className="facts">
            <code className="key">{n.key}</code>
            {n.level && <span className="level">{n.level}</span>}
            {n.type === 'feature' && (n.derived ?? n.status) && <span className={`state state-${n.derived ?? n.status}`}>{n.derived ?? n.status}</span>}
            {n.type === 'feature' && n.status && n.derived && n.status !== n.derived && <span className="muted">authored {n.status}</span>}
            {n.type === 'change' && <Status s={n.status} />}
            {n.type === 'change' && s.change?.progress && (
              <span className="progress">
                {s.change.progress.done}/{s.change.progress.total}
              </span>
            )}
          </span>
        )}
      </div>
    </>
  );
}

/** The one page template: a node in a lens, drawn as a tree or lanes, with the shared components scoped to the node. */
export function Page({ lens, node, following }: { lens: Lens; node?: string; following?: string }) {
  const [params] = useSearchParams();
  const wide = useWide();
  const done = params.get('done') === '1';
  const retired = params.get('retired') === '1';
  const days = Number(params.get('days') ?? 0) || undefined;
  const view: 'tree' | 'lanes' = wide && params.get('view') === 'lanes' ? 'lanes' : 'tree';
  const s = useLive(() => api.scope({ lens, node, days, done, retired }), [lens, node, days, done, retired]);
  if (s.error) {
    return (
      <div className="empty">
        <h1>{node ?? 'everything'}</h1>
        <p className="error">{s.error.message}</p>
        <p>
          <Link to="/">home</Link>
        </p>
      </div>
    );
  }
  if (!s.data) return <p className="muted">loading…</p>;
  const d = s.data;
  const multi = d.projects.length > 1;
  const selected = node && d.container !== node ? node : undefined;
  return (
    <LensContext.Provider value={lens}>
      <div className={`page page-${d.node?.type ?? 'root'}`}>
        <header className="page-head">
          <Head s={d} lens={lens} node={node} following={following} />
          <Toggles s={d} lens={lens} node={node} view={view} wide={wide} />
        </header>
        <div className="record-head">
          {d.node && <Owners o={d.owners} self={d.node.key} />}
          <HealthStrip h={d.health} />
          <LiveSessions sessions={d.sessions} />
        </div>
        <section className="tree-pane" aria-label={view}>
          {d.container && d.container !== d.node?.key && (
            <div className="in muted">
              in <Link to={hrefOf(d.container, lens)}>{short(d.container)}</Link>
            </div>
          )}
          {view === 'lanes' ? <Lanes rows={d.changes} multi={multi} selected={selected} /> : <Tree nodes={d.tree} multi={multi} selected={selected} />}
        </section>
        <section className="record-body">
          {d.change ? <Change c={d.change} /> : d.node?.summary ? <p className="summary">{d.node.summary}</p> : null}
          <h3>Activity</h3>
          <Activity events={d.recent} />
        </section>
      </div>
    </LensContext.Provider>
  );
}

/** `/:lens/*`: the rest of the path is the node's key, or nothing for the root. */
export function LensPage({ lens }: { lens: Lens }) {
  const rest = useParams()['*'] ?? '';
  return <Page lens={lens} node={rest ? decodeURIComponent(rest) : undefined} />;
}
