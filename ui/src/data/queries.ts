// Server state: every piece of data a component shows comes through one of these hooks. Keys are structured so the
// event stream can invalidate by prefix (see live.ts); nothing is ever copied out of the cache into other state.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAt } from '@/state/moment';
import { api } from './client';
import type { OrderBody, ScopeQuery } from './contract';

/** Every key ends with the moment it reads as of ('now' when none), so a page at a moment never shares a cache
 *  entry with the live page, and the stream's invalidation by prefix reaches both. */
export const queryKeys = {
  all: ['pjman'] as const,
  store: (at?: string) => ['pjman', 'store', at ?? 'now'] as const,
  records: (q: { type?: string; status?: string; project?: string }, at?: string) =>
    ['pjman', 'records', q, at ?? 'now'] as const,
  record: (key: string, at?: string) => ['pjman', 'record', key, at ?? 'now'] as const,
  resolve: (ref: string, at?: string) => ['pjman', 'resolve', ref, at ?? 'now'] as const,
  sessionView: (id: string, at?: string) => ['pjman', 'session-view', id, at ?? 'now'] as const,
  scope: (q: ScopeQuery, at?: string) => ['pjman', 'scope', q, at ?? 'now'] as const,
  bridge: (product: string, days?: number, at?: string) =>
    ['pjman', 'bridge', product, days ?? 1, at ?? 'now'] as const,
};

export function useStore() {
  const at = useAt();
  return useQuery({ queryKey: queryKeys.store(at), queryFn: () => api.store(at), staleTime: 60_000 });
}

export function useScope(q: ScopeQuery, enabled = true) {
  const at = useAt();
  return useQuery({
    queryKey: queryKeys.scope(q, at),
    queryFn: () => api.scope(q, at),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useRecords(q: { type?: string; status?: string; project?: string } = {}, enabled = true) {
  const at = useAt();
  return useQuery({
    queryKey: queryKeys.records(q, at),
    queryFn: () => api.records(q, at),
    enabled,
    staleTime: 60_000,
  });
}

export function useRecord(key: string | undefined) {
  const at = useAt();
  return useQuery({
    queryKey: queryKeys.record(key ?? '', at),
    queryFn: () => api.record(key!, at),
    enabled: !!key,
  });
}

export function useResolve(ref: string | undefined) {
  const at = useAt();
  return useQuery({
    queryKey: queryKeys.resolve(ref ?? '', at),
    queryFn: () => api.resolve(ref!, at),
    enabled: !!ref,
    retry: false,
  });
}

/** The one write: the roadmap's order. The stream invalidates too; this makes the refetch immediate. */
export function useOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderBody) => api.order(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.all }),
  });
}

export function useSessionView(id: string | undefined) {
  const at = useAt();
  return useQuery({
    queryKey: queryKeys.sessionView(id ?? '', at),
    queryFn: () => api.sessionView(id!, at),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

/** The bridge: the product's sessions by state. The stream invalidates it like everything else. */
export function useBridge(product: string | undefined, days?: number) {
  const at = useAt();
  return useQuery({
    queryKey: queryKeys.bridge(product ?? '', days, at),
    queryFn: () => api.bridge(product!, days, at),
    enabled: !!product,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
