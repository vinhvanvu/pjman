// The client for /api/v1: one function per route. Nothing here is called from a component; the hooks in queries.ts are.
import type { Resolution, Row, Scope, ScopeQuery, SessionView, StoreInfo } from './contract';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public tried?: string[],
  ) {
    super(message);
  }
}

export const BASE = '/api/v1';

interface Envelope<T> {
  seq: number;
  data?: T;
  error?: { code: string; message: string; tried?: string[] };
}

async function call<T>(route: string): Promise<T> {
  const res = await fetch(BASE + route, { headers: { accept: 'application/json' } });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || body.error) {
    throw new ApiError(
      res.status,
      body.error?.code ?? 'error',
      body.error?.message ?? res.statusText,
      body.error?.tried,
    );
  }
  return body.data as T;
}

/** `kind:rest` → `/records/kind/rest`, each path segment encoded. */
const recordPath = (key: string) => {
  const i = key.indexOf(':');
  return `/records/${key.slice(0, i)}/${key
    .slice(i + 1)
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
};

export const api = {
  store: () => call<StoreInfo>('/store'),
  records: (q: { type?: string; status?: string; project?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return call<Row[]>(`/records${p.size ? `?${p}` : ''}`);
  },
  record: (key: string) => call<Row & { body: string; sections: Record<string, string> }>(recordPath(key)),
  resolve: (ref: string) => call<Resolution>(`/resolve?ref=${encodeURIComponent(ref)}`),
  sessionView: (id: string) => call<SessionView>(`/sessions/${encodeURIComponent(id)}/view`),
  scope: (q: ScopeQuery) => {
    const p = new URLSearchParams({ lens: q.lens });
    if (q.node) p.set('node', q.node);
    if (q.days) p.set('days', String(q.days));
    if (q.done) p.set('done', '1');
    if (q.retired) p.set('retired', '1');
    return call<Scope>(`/scope?${p}`);
  },
};
