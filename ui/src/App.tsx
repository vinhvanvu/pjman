import { useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';
import { short } from './components/Keys';
import { useLive } from './live';
import { HomePage } from './pages/Home';
import { LensPage } from './pages/Page';
import { ResolvePage } from './pages/Resolve';
import { SessionPage } from './pages/Session';

function Search() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/get/${encodeURIComponent(q.trim())}`);
    setQ('');
  };
  return (
    <form onSubmit={go} className="search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="a key, a ticket, a URL, a file…" aria-label="resolve a reference" />
    </form>
  );
}

/** The old board address: a project in the project lens. */
function BoardRedirect() {
  const { project } = useParams();
  return <Navigate to={project ? `/project/project:${project}` : '/project'} replace />;
}

export function App() {
  const store = useLive(() => api.store(), [], (e) => e.type === 'product' || e.op === 'init');
  const products = store.data?.products ?? [];
  return (
    <div className="app">
      <header>
        <Link to="/" className="brand">pjman</Link>
        {products.length > 1 && (
          <nav aria-label="products">
            {products.map((p) => (
              <Link key={p.key} to={`/feature/${p.key}`}>{p.title ?? short(p.key)}</Link>
            ))}
          </nav>
        )}
        <Search />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/*" element={<LensPage lens="project" />} />
          <Route path="/feature/*" element={<LensPage lens="feature" />} />
          <Route path="/milestone/*" element={<LensPage lens="milestone" />} />
          <Route path="/board" element={<BoardRedirect />} />
          <Route path="/board/:project" element={<BoardRedirect />} />
          <Route path="/session/:id" element={<SessionPage />} />
          <Route path="/get/*" element={<ResolvePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
