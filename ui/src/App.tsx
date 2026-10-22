import { useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useLive } from './live';
import { BoardPage } from './pages/Board';
import { ResolvePage } from './pages/Resolve';
import { SessionPage } from './pages/Session';
import { StorePage } from './pages/Store';

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

export function App() {
  const store = useLive(() => api.store(), [], (e) => e.type === 'project' || e.op === 'init');
  const projects = store.data?.projects ?? [];
  return (
    <div className="app">
      <header>
        <Link to="/" className="brand">pjman</Link>
        <nav>
          {projects.map((p) => (
            <Link key={p.key} to={`/board/${p.key.replace(/^project:/, '')}`}>{p.key.replace(/^project:/, '')}</Link>
          ))}
        </nav>
        <Search />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<StorePage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/board/:project" element={<BoardPage />} />
          <Route path="/session/:id" element={<SessionPage />} />
          <Route path="/get/*" element={<ResolvePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
