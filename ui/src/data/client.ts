// The client for /api/v1: one function per route. Nothing here is called from a component; the hooks in queries.ts are.
import { useMoment } from '@/state/moment';
import type {
  Bridge,
  DecideBody,
  Moment,
  OrderBody,
  OrderResult,
  Rail,
  RailQuery,
  Resolution,
  Row,
  Scope,
  ScopeQuery,
  SessionView,
  SetResult,
  HostResult,
  LaunchResult,
  StoreInfo,
  Timeline,
} from './contract';

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
  moment?: Moment;
  data?: T;
  error?: { code: string; message: string; tried?: string[] };
}

/** A moment on a route: `at=` appended, so the server answers as of it. */
const asOf = (route: string, at?: string) =>
  at ? `${route}${route.includes('?') ? '&' : '?'}at=${encodeURIComponent(at)}` : route;

async function call<T>(route: string, at?: string): Promise<T> {
  const res = await fetch(BASE + asOf(route, at), { headers: { accept: 'application/json' } });
  const body = (await res.json()) as Envelope<T>;
  if (at && body.moment) useMoment.getState().setResolved(at, body.moment);
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

async function post<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + route, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Envelope<T>;
  if (!res.ok || json.error) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'error',
      json.error?.message ?? res.statusText,
      json.error?.tried,
    );
  }
  return json.data as T;
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
  store: (at?: string) => call<StoreInfo>('/store', at),
  records: (q: { type?: string; status?: string; project?: string } = {}, at?: string) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return call<Row[]>(`/records${p.size ? `?${p}` : ''}`, at);
  },
  record: (key: string, at?: string) =>
    call<Row & { body: string; sections: Record<string, string> }>(recordPath(key), at),
  resolve: (ref: string, at?: string) => call<Resolution>(`/resolve?ref=${encodeURIComponent(ref)}`, at),
  sessionView: (id: string, at?: string) => call<SessionView>(`/sessions/${encodeURIComponent(id)}/view`, at),
  /** The bridge's data: the product's sessions by state. `product` is the key; the slug is what the route takes. */
  bridge: (product: string, days?: number, at?: string) =>
    call<Bridge>(
      `/products/${encodeURIComponent(product.replace(/^product:/, ''))}/bridge${days ? `?days=${days}` : ''}`,
      at,
    ),
  /** The product's events over a window, always as of now: the transport's axis. */
  timeline: (product: string, from: string, to: string, after?: number) =>
    call<Timeline>(
      `/products/${encodeURIComponent(product.replace(/^product:/, ''))}/timeline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${after ? `&after=${after}` : ''}`,
    ),
  /** The rail at any key: its lanes, a page of rows and the day buckets before it, as of the page's moment. */
  rail: (key: string, q: RailQuery = {}, at?: string) => {
    const p = new URLSearchParams({ key });
    if (q.limit) p.set('limit', String(q.limit));
    if (q.before !== undefined) p.set('before', String(q.before));
    if (q.from) p.set('from', q.from);
    if (q.to) p.set('to', q.to);
    if (q.lanes) p.set('lanes', q.lanes.join(','));
    if (q.kinds) p.set('kinds', q.kinds.join(','));
    if (q.fold) p.set('fold', String(q.fold));
    return call<Rail>(`/rail?${p}`, at);
  },
  scope: (q: ScopeQuery, at?: string) => {
    const p = new URLSearchParams({ lens: q.lens });
    if (q.node) p.set('key', q.node);
    if (q.days) p.set('days', String(q.days));
    if (q.done) p.set('done', '1');
    if (q.retired) p.set('retired', '1');
    return call<Scope>(`/scope?${p}`, at);
  },
  /** The writes, as the person signed in: reorder the roadmap; decide a proposed decision, or reopen a decided one. */
  order: (body: OrderBody) => post<OrderResult>('/order', body),
  decide: (body: DecideBody) => post<SetResult>('/decide', body),
  /** A session's block brought to the front on its host (change:rex-adapter). */
  openHost: (body: { session: string }) => post<HostResult>('/open', body),
  /** A session for a change launched on the host the server's machine runs (change:rex-adapter). */
  launch: (body: { change: string }) => post<LaunchResult>('/launch', body),
  reopen: (body: DecideBody) => post<SetResult>('/reopen', body),
};
