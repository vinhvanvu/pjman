// The milestone lens's pure derivations: the milestones at a node, and what leads a milestone to completion.
import type { ChangeContext, ChangeRow, Row, Scope, ScopeNode } from '@/data/contract';

/** Top-level milestones in the scope's tree, and what the lens could not place. */
export function milestones(scope: Scope): { list: ScopeNode[]; left?: ScopeNode } {
  return { list: scope.tree.filter((n) => n.type === 'change'), left: scope.tree.find((n) => n.type === 'unassigned') };
}

/** Every change row beneath a milestone node, flattened. */
export function rowsBeneath(node: ScopeNode): ChangeRow[] {
  const out: ChangeRow[] = [];
  const walk = (list: ScopeNode[]) => {
    for (const n of list) {
      if (n.row) out.push(n.row);
      walk(n.children);
    }
  };
  walk(node.children);
  return out;
}

export interface Touched {
  key: string;
  title?: string;
  effects: Set<string>;
}

/** The features the changes beneath touch, with how. */
export function featuresTouched(rows: ChangeRow[]): Touched[] {
  const m = new Map<string, Touched>();
  for (const r of rows) {
    for (const f of r.features) {
      const t = m.get(f.key) ?? { key: f.key, title: f.title, effects: new Set<string>() };
      t.effects.add(f.effect);
      m.set(f.key, t);
    }
  }
  return [...m.values()];
}

export const projectsInvolved = (rows: ChangeRow[]): string[] =>
  [...new Set(rows.map((r) => r.project).filter((p): p is string => !!p))].toSorted();

/** A milestone's direct children by status, done last. */
export function childrenByStatus(ctx: ChangeContext): { status: string; rows: Row[] }[] {
  const order = ['blocked', 'active', 'review', 'planning', 'open', 'done', 'dropped'];
  const groups = new Map<string, Row[]>();
  for (const c of ctx.children) {
    const s = c.status ?? 'open';
    groups.set(s, [...(groups.get(s) ?? []), c]);
  }
  return order.filter((s) => groups.has(s)).map((s) => ({ status: s, rows: groups.get(s)! }));
}

export const decided = (ctx: ChangeContext) => ctx.decisions.filter((d) => d.status === 'decided');
export const proposed = (ctx: ChangeContext) => ctx.decisions.filter((d) => d.status === 'proposed');

// --- the home page ------------------------------------------------------------------------------------------

export interface MilestoneSummary {
  inFlight: number;
  reached: number;
  /** Children done over children, across every milestone in flight. */
  progress: { done: number; total: number };
  waiting: number;
  live: number;
  /** The milestones in flight, nearest to done first. */
  list: {
    key: string;
    title?: string;
    status?: string;
    progress?: { done: number; total: number };
    waiting: number;
    live: boolean;
    next?: string;
  }[];
  /** Changes that belong to no milestone. */
  loose: number;
}

export function summarise(scope: Scope): MilestoneSummary {
  const { list, left } = milestones(scope);
  const rows = list.map((m) => {
    const beneath = rowsBeneath(m);
    const waiting = (m.row?.waiting ?? 0) + beneath.reduce((n, r) => n + r.waiting, 0);
    return {
      key: m.key,
      title: m.gist,
      status: m.status,
      progress: m.row?.progress,
      waiting,
      live: !!m.row?.live || beneath.some((r) => r.live),
      next: m.row?.next,
    };
  });
  const progress = rows.reduce(
    (p, r) => ({ done: p.done + (r.progress?.done ?? 0), total: p.total + (r.progress?.total ?? 0) }),
    { done: 0, total: 0 },
  );
  const share = (r: (typeof rows)[number]) => (r.progress?.total ? r.progress.done / r.progress.total : 0);
  return {
    inFlight: rows.length,
    reached: scope.doneHidden,
    progress,
    waiting: scope.waitingOn.length,
    live: scope.sessions.length,
    list: rows.toSorted((a, b) => share(b) - share(a) || (a.title ?? '').localeCompare(b.title ?? '')),
    loose: left?.open ?? 0,
  };
}
