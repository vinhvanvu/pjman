// The product tree: products at the root, features (one nestable kind, levels labelled from the template) beneath,
// projects attached at the root, changes pointing at the features they affect with an effect. Everything here is
// derived from the records; nothing is stored.
import type { Store } from './config.js';
import { parseKey } from './keys.js';
import { resolve, type Loaded, type Rec } from './records.js';

export const FEATURE_STATUSES = ['planned', 'building', 'live', 'retired'] as const;
export const EFFECTS = ['adds', 'changes', 'removes'] as const;
export type EffectName = (typeof EFFECTS)[number];

export interface Effect {
  effect: EffectName;
  key: string;
}

/** `adds feature:x`, `changes feature:x`, `removes feature:x`, or a bare `feature:x` (changes). */
export function parseEffect(raw: unknown): Effect | null {
  if (typeof raw !== 'string') return null;
  const m = /^(?:(adds|changes|removes)\s+)?(\S+)$/.exec(raw.trim());
  if (!m) return null;
  const key = parseKey(m[2]);
  if (!key || key.kind !== 'feature') return null;
  return { effect: (m[1] as EffectName | undefined) ?? 'changes', key: key.raw };
}

export const formatEffect = (e: Effect): string => (e.effect === 'changes' ? e.key : `${e.effect} ${e.key}`);

/** The effects a change declares on features. */
export function effectsOf(rec: Rec): Effect[] {
  return Array.isArray(rec.data.features) ? rec.data.features.map(parseEffect).filter((e): e is Effect => e !== null) : [];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The record a reference resolves to, through aliases, or undefined. */
export function live(loaded: Loaded, raw: unknown): Rec | undefined {
  const res = typeof raw === 'string' ? resolve(loaded, raw) : null;
  return res && (res.status === 'ok' || res.status === 'alias') ? res.rec : undefined;
}

/** The structural parent of a node: a feature's parent feature or product; a project's parent project or product. */
export function structuralParent(loaded: Loaded, rec: Rec): Rec | undefined {
  if (rec.type === 'feature' || rec.type === 'project') return live(loaded, rec.data.parent) ?? live(loaded, rec.data.product);
  return undefined;
}

/** The product at the root above a feature or project, walking parents. */
export function rootProductOf(loaded: Loaded, rec: Rec): Rec | undefined {
  const seen = new Set<string>();
  let cur: Rec | undefined = rec;
  while (cur && !seen.has(cur.key)) {
    if (cur.type === 'product') return cur;
    seen.add(cur.key);
    cur = structuralParent(loaded, cur);
  }
  return undefined;
}

/** Every key above a record, across every chain: a change climbs its parents, its project's chain and each feature's
 *  chain; a decision climbs through its change; a feature or project climbs to its product. Cycles stop. */
export function ancestorsOf(loaded: Loaded, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([key]);
  const push = (k: string | undefined) => {
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
      return true;
    }
    return false;
  };
  const climb = (rec: Rec | undefined) => {
    while (rec) {
      const parent = structuralParent(loaded, rec);
      if (!parent || !push(parent.key)) break;
      rec = parent;
    }
  };
  const rec = live(loaded, key);
  if (!rec) return out;
  switch (rec.type) {
    case 'change': {
      let cur: Rec | undefined = rec;
      while (cur) {
        for (const e of effectsOf(cur)) {
          const f = live(loaded, e.key);
          if (f && push(f.key)) climb(f);
        }
        const p = live(loaded, cur.data.project);
        if (p && push(p.key)) climb(p);
        const parent = live(loaded, cur.data.parent);
        if (!parent || !push(parent.key)) break;
        cur = parent;
      }
      break;
    }
    case 'decision': {
      if (rec.changeKey) {
        const c = live(loaded, rec.changeKey);
        if (c && push(c.key)) for (const a of ancestorsOf(loaded, c.key)) push(a);
      } else if (rec.productSlug) push(`product:${rec.productSlug}`);
      break;
    }
    case 'feature':
    case 'project':
      climb(rec);
      break;
    default:
      break;
  }
  return out;
}

/** Every key whose ancestors include `key`: the subtree, across every chain. */
export function descendantsOf(loaded: Loaded, key: string): Set<string> {
  const out = new Set<string>();
  for (const r of loaded.records) {
    if (!r.valid || r.key === key) continue;
    if (r.type === 'source' || r.type === 'session' || r.type === 'actor') continue;
    if (ancestorsOf(loaded, r.key).includes(key)) out.add(r.key);
  }
  return out;
}

/** The owners a node answers to: its own, else the nearest ancestor's. */
export function effectiveOwners(loaded: Loaded, key: string): { owners: string[]; from?: string } {
  const rec = live(loaded, key);
  if (!rec) return { owners: [] };
  const own = list(rec.data.owners);
  if (own.length) return { owners: own, from: rec.key };
  for (const a of ancestorsOf(loaded, key)) {
    const r = live(loaded, a);
    const o = r ? list(r.data.owners) : [];
    if (o.length) return { owners: o, from: a };
  }
  return { owners: [] };
}

/** The level labels below the root: the product's own, else the store's template. */
export function levelsOf(store: Store, product?: Rec): string[] {
  const own = product ? list(product.data.levels) : [];
  return own.length ? own : store.config.tree_levels;
}

/** A feature's depth below its product (1 for a top-level feature). */
export function depthOf(loaded: Loaded, rec: Rec): number {
  let depth = 0;
  const seen = new Set<string>();
  let cur: Rec | undefined = rec;
  while (cur && cur.type !== 'product' && !seen.has(cur.key)) {
    seen.add(cur.key);
    depth++;
    cur = structuralParent(loaded, cur);
  }
  return depth;
}

/** The level label a node carries: authored, else the template at its depth (the last label for anything deeper). */
export function levelOf(loaded: Loaded, rec: Rec): string {
  if (rec.type === 'product') return 'product';
  if (rec.type === 'project') return 'project';
  const own = str(rec.data.level);
  if (own) return own;
  const levels = levelsOf(loaded.store, rootProductOf(loaded, rec));
  if (!levels.length) return 'feature';
  const d = depthOf(loaded, rec);
  return levels[Math.min(d, levels.length) - 1] ?? levels[levels.length - 1];
}

export interface DerivedStatus {
  status: (typeof FEATURE_STATUSES)[number];
  because: string;
}

/** What the done changes say a feature's state is: removed once a removing change is done, live once an adding change is
 *  done, building while any change that affects it is in flight (active, review, blocked; planning and open are not), else planned. A child's state lifts a parent to at
 *  least building or live. */
export function derivedStatus(loaded: Loaded, key: string): DerivedStatus {
  const affecting = loaded.records.filter((r) => r.type === 'change' && r.valid && effectsOf(r).some((e) => live(loaded, e.key)?.key === key));
  const done = (e: EffectName) => affecting.filter((r) => r.data.status === 'done' && effectsOf(r).some((x) => x.effect === e && live(loaded, x.key)?.key === key));
  const removed = done('removes');
  if (removed.length) return { status: 'retired', because: `${removed[removed.length - 1].key} (removes) is done` };
  const added = done('adds');
  if (added.length) return { status: 'live', because: `${added[0].key} (adds) is done` };
  // in flight means someone is building: active, review or blocked. planning is thinking; open is a backlog line.
  const inFlight = affecting.filter((r) => ['active', 'review', 'blocked'].includes(String(r.data.status)));
  if (inFlight.length) return { status: 'building', because: `${inFlight.map((r) => r.key).join(', ')} in flight` };
  const children = loaded.records.filter((r) => r.type === 'feature' && r.valid && live(loaded, r.data.parent)?.key === key);
  const childStates = children.map((c) => derivedStatus(loaded, c.key).status);
  if (childStates.includes('live')) return { status: 'live', because: 'a child is live' };
  if (childStates.includes('building')) return { status: 'building', because: 'a child is building' };
  if (affecting.length) return { status: 'planned', because: 'nothing affecting it is done or in flight' };
  // nothing to derive from: the authored status stands (a cold-started map is read from the documentation until changes name it)
  const authored = loaded.byKey.get(key)?.[0]?.data.status;
  if (typeof authored === 'string' && (FEATURE_STATUSES as readonly string[]).includes(authored)) return { status: authored as DerivedStatus['status'], because: 'authored; no change affects it yet' };
  return { status: 'planned', because: 'no change affects it yet' };
}

export interface TreeNode {
  key: string;
  type: 'product' | 'feature';
  title?: string;
  level: string;
  /** Authored status, when the person wrote one. */
  status?: string;
  derived?: DerivedStatus;
  owners: string[];
  ownersFrom?: string;
  children: TreeNode[];
  /** Changes in the subtree (direct effects on this node and its descendants), by status. */
  backlog: Record<string, number>;
  /** Projects those changes live in. */
  projects: string[];
  /** On a product: changes under its projects that name no feature. */
  unassigned?: number;
}

/** The tree below a product or a feature (every product when no root is given), with roll-ups. */
export function tree(loaded: Loaded, rootKey?: string): TreeNode[] {
  const features = loaded.records.filter((r) => r.type === 'feature' && r.valid);
  const changes = loaded.records.filter((r) => r.type === 'change' && r.valid);
  const childrenOf = (key: string) => features.filter((f) => (live(loaded, f.data.parent) ?? (f.data.parent ? undefined : live(loaded, f.data.product)))?.key === key);
  const node = (rec: Rec): TreeNode => {
    const children = childrenOf(rec.key).map(node);
    const subtree = new Set<string>([rec.key, ...children.flatMap(function all(n: TreeNode): string[] { return [n.key, ...n.children.flatMap(all)]; })]);
    const inSubtree = changes.filter((c) => effectsOf(c).some((e) => { const f = live(loaded, e.key); return f && subtree.has(f.key); }));
    const backlog: Record<string, number> = {};
    for (const c of inSubtree) backlog[String(c.data.status ?? '?')] = (backlog[String(c.data.status ?? '?')] ?? 0) + 1;
    const projects = [...new Set(inSubtree.map((c) => str(c.data.project)).filter((p): p is string => !!p))].sort();
    const eo = effectiveOwners(loaded, rec.key);
    const n: TreeNode = {
      key: rec.key, type: rec.type as 'product' | 'feature', title: str(rec.data.title), level: levelOf(loaded, rec),
      status: str(rec.data.status), derived: rec.type === 'feature' ? derivedStatus(loaded, rec.key) : undefined,
      owners: eo.owners, ownersFrom: eo.from, children, backlog, projects,
    };
    if (rec.type === 'product') {
      const projectKeys = new Set(loaded.records.filter((p) => p.type === 'project' && p.valid && rootProductOf(loaded, p)?.key === rec.key).map((p) => p.key));
      n.unassigned = changes.filter((c) => projectKeys.has(String(c.data.project)) && effectsOf(c).length === 0 && c.data.status !== 'done' && c.data.status !== 'dropped').length;
    }
    return n;
  };
  if (rootKey) {
    const rec = live(loaded, rootKey);
    if (!rec || (rec.type !== 'product' && rec.type !== 'feature')) return [];
    return [node(rec)];
  }
  return loaded.records.filter((r) => r.type === 'product' && r.valid).map(node);
}

export function formatTree(nodes: TreeNode[], depth = 0): string {
  const out: string[] = [];
  for (const n of nodes) {
    const pad = '  '.repeat(depth);
    const backlog = Object.entries(n.backlog).map(([s, c]) => `${c} ${s}`).join(', ');
    const state = n.type === 'feature' ? ` [${n.status ?? n.derived?.status}${n.status && n.derived && n.status !== n.derived.status ? `; derived ${n.derived.status}` : ''}]` : '';
    const owners = n.owners.length ? ` · ${n.owners.join(', ')}${n.ownersFrom && n.ownersFrom !== n.key ? ' (inherited)' : ''}` : '';
    out.push(`${pad}- ${n.key} (${n.level})${state} — ${n.title ?? ''}${owners}${backlog ? `\n${pad}  changes: ${backlog}${n.projects.length ? ` in ${n.projects.join(', ')}` : ''}` : ''}${n.unassigned ? `\n${pad}  ${n.unassigned} open change${n.unassigned === 1 ? '' : 's'} under its projects name no feature` : ''}`);
    if (n.children.length) out.push(formatTree(n.children, depth + 1).trimEnd());
  }
  return out.join('\n') + (depth === 0 ? '\n' : '');
}
