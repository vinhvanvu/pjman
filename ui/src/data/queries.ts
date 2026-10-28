// Server state: every piece of data a component shows comes through one of these hooks. Keys are structured so the
// event stream can invalidate by prefix (see live.ts); nothing is ever copied out of the cache into other state.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { OrderBody, ScopeQuery } from './contract';

export const queryKeys = {
  all: ['pjman'] as const,
  store: () => ['pjman', 'store'] as const,
  records: (q: { type?: string; status?: string; project?: string }) => ['pjman', 'records', q] as const,
  record: (key: string) => ['pjman', 'record', key] as const,
  resolve: (ref: string) => ['pjman', 'resolve', ref] as const,
  sessionView: (id: string) => ['pjman', 'session-view', id] as const,
  scope: (q: ScopeQuery) => ['pjman', 'scope', q] as const,
  bridge: (product: string, days?: number) => ['pjman', 'bridge', product, days ?? 1] as const,
};

export function useStore() {
  return useQuery({ queryKey: queryKeys.store(), queryFn: api.store, staleTime: 60_000 });
}

export function useScope(q: ScopeQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scope(q),
    queryFn: () => api.scope(q),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useRecords(q: { type?: string; status?: string; project?: string } = {}, enabled = true) {
  return useQuery({ queryKey: queryKeys.records(q), queryFn: () => api.records(q), enabled, staleTime: 60_000 });
}

export function useRecord(key: string | undefined) {
  return useQuery({ queryKey: queryKeys.record(key ?? ''), queryFn: () => api.record(key!), enabled: !!key });
}

export function useResolve(ref: string | undefined) {
  return useQuery({
    queryKey: queryKeys.resolve(ref ?? ''),
    queryFn: () => api.resolve(ref!),
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
  return useQuery({
    queryKey: queryKeys.sessionView(id ?? ''),
    queryFn: () => api.sessionView(id!),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

/** The bridge: the product's sessions by state. The stream invalidates it like everything else. */
export function useBridge(product: string | undefined, days?: number) {
  return useQuery({
    queryKey: queryKeys.bridge(product ?? '', days),
    queryFn: () => api.bridge(product!, days),
    enabled: !!product,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
