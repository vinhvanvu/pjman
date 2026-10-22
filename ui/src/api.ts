// The client for pjman's API (/api/v1): one function per endpoint, and a subscription to the event stream.
// Types mirror the tool's result types; record fields are as in the files (snake case), computed fields camel case.

export interface Row {
  type: 'project' | 'change' | 'decision' | 'source' | 'session' | 'actor';
  key: string;
  path: string;
  valid: boolean;
  title?: string;
  status?: string;
  created?: string;
  writer?: string;
  session?: string;
  data: Record<string, unknown>;
}

export interface Decision extends Row {
  decision?: string;
  why?: string;
  supersededBy?: string;
}

export interface ChangeContext {
  change: Row;
  summary?: string;
  plan?: string;
  sections: Record<string, string>;
  decisions: Decision[];
  sources: { key: string; record?: Row; via: 'binds' | 'links' }[];
  sessions: (Row & { last?: string })[];
  parent?: Row;
  children: Row[];
  observed: { edge: string; to: string; session: string; at?: string }[];
}

export interface Edge {
  edge: string;
  from: string;
  to: string;
  on: string;
  observed: boolean;
  at: string | null;
}

export interface Neighbourhood {
  input: string;
  resolution: { status: 'record' | 'alias' | 'invalid' | 'key' | 'none'; key?: string; via?: string; shape?: string; tried: string[] };
  record?: Row;
  in: Edge[];
  out: Edge[];
  changes: ChangeContext[];
  via: Record<string, string>;
  members: Row[];
}

export interface Board {
  store: { name: string; mode: string; root: string };
  project: Row | null;
  projects: Row[];
  changes: Row[];
  proposed: Row[];
  counts: Record<string, number>;
}

export interface ViewData {
  showing: { key?: string; session?: string; board?: string | null };
  neighbourhood?: Neighbourhood;
  board?: Board;
}

export interface StoreInfo {
  root: string;
  mode: string;
  name: string;
  project: string | null;
  actor: string | null;
  source_kinds: string[];
  vocabulary: Record<string, string>;
  projects: Row[];
}

export interface StoreEvent {
  seq: number;
  at: string;
  op: string;
  key: string;
  type: string;
  path: string;
  fields?: string[];
  writer?: string;
  session?: string;
  commit?: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public tried?: string[]) {
    super(message);
  }
}

const BASE = '/api/v1';

async function call<T>(route: string): Promise<{ seq: number; data: T }> {
  const res = await fetch(BASE + route, { headers: { accept: 'application/json' } });
  const body = (await res.json()) as { seq: number; data?: T; error?: { code: string; message: string; tried?: string[] } };
  if (!res.ok || body.error) throw new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? res.statusText, body.error?.tried);
  return { seq: body.seq, data: body.data as T };
}

/** `kind:rest` → `/records/kind/rest`. */
const keyPath = (key: string) => {
  const i = key.indexOf(':');
  return `/records/${key.slice(0, i)}/${key.slice(i + 1).split('/').map(encodeURIComponent).join('/')}`;
};

export const api = {
  store: () => call<StoreInfo>('/store'),
  records: (q: { type?: string; status?: string; project?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return call<Row[]>(`/records${p.size ? `?${p}` : ''}`);
  },
  record: (key: string) => call<Row & { body: string; sections: Record<string, string>; via?: string }>(keyPath(key)),
  neighbourhood: (key: string) => call<Neighbourhood>(`${keyPath(key)}/neighbourhood`),
  resolve: (ref: string) => call<Neighbourhood>(`/resolve?ref=${encodeURIComponent(ref)}`),
  sessionView: (id: string) => call<ViewData>(`/sessions/${encodeURIComponent(id)}/view`),
  board: (project?: string | null) => call<Board>(project ? `/projects/${project.replace(/^project:/, '')}/board` : '/board'),
  events: (since = 0) => call<StoreEvent[]>(`/events?since=${since}`),
  /** Subscribe to the stream; `fn` gets every new event. Returns a stop function. The browser resumes from the last id on its own. */
  subscribe(fn: (e: StoreEvent) => void): () => void {
    const es = new EventSource(`${BASE}/events`);
    const handler = (ev: MessageEvent) => fn(JSON.parse(ev.data as string) as StoreEvent);
    for (const op of ['created', 'set', 'log', 'bind', 'observe', 'moved', 'formatted', 'init', 'write']) es.addEventListener(op, handler as EventListener);
    return () => es.close();
  },
};
