// Server state: every piece of data a component shows comes through one of these hooks. Keys are structured so the
// event stream can invalidate by prefix (see live.ts); nothing is ever copied out of the cache into other state.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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
  /** The one key with no moment: the timeline is the axis a moment is placed on, always read now. */
  timeline: (product: string, from: string, to: string, after?: number) =>
    ['pjman', 'timeline', product, from, to, after ?? null] as const,
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

/** Deciding a decision in place, or reopening one. The stream invalidates too; this makes the refetch immediate, and
 *  the write settles only once the views have it, so a control never shows its decision as it was before. */
export function useDecide(kind: 'decide' | 'reopen') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decision: string) => (kind === 'decide' ? api.decide({ decision }) : api.reopen({ decision })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.all }),
  });
}

/** The write a decision's Accept or Reopen calls, or nothing on a page held at a past moment: the past is read, never
 *  written (decision decide-in-place/accept-holds-then-writes). */
export function useDecideAction(kind: 'decide' | 'reopen'): ((decision: string) => Promise<unknown>) | undefined {
  const at = useAt();
  const mutation = useDecide(kind);
  return at ? undefined : (decision) => mutation.mutateAsync(decision);
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

/** Warm the product's three destinations (the bridge, the product map, the roadmap) as soon as any of them mounts, so
 *  the first switch between them reads from the cache instead of painting a loading state. The keys are the ones the
 *  pages ask for with no search flags set: the map's scope, the roadmap's scope with the done changes, the bridge. */
export function usePrefetchDestinations(product: string | undefined) {
  const client = useQueryClient();
  // at the page's moment, so a page held at a moment warms the other two at the same one
  const at = useAt();
  useEffect(() => {
    if (!product) return;
    const map: ScopeQuery = { lens: 'feature', node: product };
    const roadmap: ScopeQuery = { lens: 'roadmap', node: product, done: true };
    for (const q of [map, roadmap])
      void client.prefetchQuery({
        queryKey: queryKeys.scope(q, at),
        queryFn: () => api.scope(q, at),
        staleTime: 15_000,
      });
    void client.prefetchQuery({
      queryKey: queryKeys.bridge(product, undefined, at),
      queryFn: () => api.bridge(product, undefined, at),
      staleTime: 15_000,
    });
  }, [client, product, at]);
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

/** The product's events over a window (the transport's ticks), read now whatever the page's moment; the stream
 *  invalidates it, so a paused page still sees what arrives. */
export function useTimeline(product: string | undefined, from: string, to: string, after?: number) {
  return useQuery({
    queryKey: queryKeys.timeline(product ?? '', from, to, after),
    queryFn: () => api.timeline(product!, from, to, after),
    enabled: !!product,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
