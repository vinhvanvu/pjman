import fs from 'node:fs';
import type { Store } from '../config.js';
import { CANONICAL_STATUSES, CHANGE_KINDS, DECISION_STATUSES, readUserConfig, SEVERITIES } from '../config.js';
import { branchNameFor, worktreeNameFor } from '../branch.js';
import { loadStore, memo, ofType, push, resolve, unresolved, unresolvedError, type Loaded, type Rec, type RecordType } from '../records.js';
import { supersedesOf } from '../supersede.js';
import { derivedStatus, effectsOf, FEATURE_STATUSES, live, rootProductOf, structuralParent } from '../tree.js';
import { describeInventory, inventory, isHolds, mapGuidance, type Inventory } from '../inventory.js';
import { aspectAt, aspectCuesOf, aspectsOfChange, featureOfPlace, formatAspectAt, formatAspectCues, formatChangeAspects, reachOfBase, type AspectCue, type ChangeAspects } from '../aspects.js';
import { urlOf } from '../refs.js';
import { CliError, usageError, notFound } from '../util.js';
import { CHANGE_SECTIONS, decisionState, formatDecisionState, formatStep, labelOf, lineOf, needsOf, nextStep, planProgress, rungsOf, stepsOf, threadOf, type DecisionState, type Step } from '../foundation.js';

export interface Row {
  type: RecordType;
  key: string;
  path: string;
  valid: boolean;
  /** A product's, feature's, project's, aspect's or source's sentence. A change and a decision have none: their line
   *  is the gist (decision interface-audit/output-follows-model). */
  title?: string;
  /** A change's or a decision's one line: what it is and why (the-ladder). */
  gist?: string;
  /** Which one in a crowd: a feature's, a change's or a decision's name, one to four words. */
  name?: string;
  status?: string;
  created?: string;
  writer?: string;
  session?: string;
  data: Record<string, unknown>;
  /** A change's branch and worktree name, on a listing's rows (pjman ls --json): an adapter matches worktrees against them. */
  branch?: ChangeBranch;
}

/** A row's one line: a change's or a decision's gist, anything else's title. */
export const lineOfRow = (r: Pick<Row, 'gist' | 'title'>): string | undefined => r.gist ?? r.title;

export function row(r: Rec): Row {
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    type: r.type, key: r.key, path: r.path, valid: r.valid,
    ...(r.type === 'change' || r.type === 'decision' ? { gist: s(r.data.gist) } : { title: s(r.data.title) }),
    name: s(r.data.name), status: s(r.data.status), created: s(r.data.created),
    writer: s(r.data.writer), session: s(r.data.session), data: r.data,
  };
}

/** A change's branch and worktree, as views say them: the branch a session was last seen on (observed), else one the
 *  change links, else the recommended name derived from the key (decision branch-names/derived-not-stored). */
export interface ChangeBranch {
  name: string;
  worktree: string;
  observed: boolean;
}

/** The latest branch a session was observed on, per change key, from every session's observed edges in one pass. */
export function observedBranches(loaded: Loaded): Map<string, { to: string; at: string }> {
  return memo(loaded, 'observed-branches', () => observedBranchesOnce(loaded));
}

function observedBranchesOnce(loaded: Loaded): Map<string, { to: string; at: string }> {
  const latest = new Map<string, { to: string; at: string }>();
  for (const s of ofType(loaded, 'session')) {
    if (!s.valid || !Array.isArray(s.data.observed)) continue;
    for (const o of s.data.observed as unknown[]) {
      if (!o || typeof o !== 'object') continue;
      const e = o as Record<string, unknown>;
      if (typeof e.from !== 'string' || typeof e.to !== 'string' || !e.to.startsWith('branch:')) continue;
      const from = resolve(loaded, e.from);
      if (!(from.status === 'ok' || from.status === 'alias')) continue;
      const at = typeof e.at === 'string' ? e.at : '';
      const prior = latest.get(from.rec.key);
      if (!prior || prior.at.localeCompare(at) <= 0) latest.set(from.rec.key, { to: e.to, at });
    }
  }
  return latest;
}

export function branchOf(rec: Rec, observed: Map<string, { to: string; at: string }>, prefix: string | undefined = readUserConfig().branch_prefix): ChangeBranch {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const seenOn = observed.get(rec.key)?.to ?? [...list(rec.data.binds), ...list(rec.data.links)].find((k) => k.startsWith('branch:'));
  return seenOn
    ? { name: seenOn.slice('branch:'.length), worktree: worktreeNameFor(rec.key), observed: true }
    : { name: branchNameFor(rec.key, prefix), worktree: worktreeNameFor(rec.key), observed: false };
}

const TYPE_ALIASES: Record<string, RecordType> = {
  product: 'product', products: 'product', feature: 'feature', features: 'feature', aspect: 'aspect', aspects: 'aspect', place: 'place', places: 'place',
  project: 'project', projects: 'project', change: 'change', changes: 'change', decision: 'decision', decisions: 'decision',
  release: 'release', releases: 'release',
  source: 'source', sources: 'source', session: 'session', sessions: 'session', actor: 'actor', actors: 'actor',
};

/** Bugs in queue order: the worst severity first, an unset severity last, then the oldest. */
export function bugOrder(a: { severity?: string; created?: string; key: string }, b: { severity?: string; created?: string; key: string }): number {
  const rank = (s?: string) => { const i = (SEVERITIES as readonly string[]).indexOf(s ?? ''); return i < 0 ? SEVERITIES.length : i; };
  return rank(a.severity) - rank(b.severity) || (a.created ?? '').localeCompare(b.created ?? '') || a.key.localeCompare(b.key);
}

const LIST_TYPES: RecordType[] = ['product', 'feature', 'aspect', 'place', 'project', 'change', 'decision', 'release', 'source', 'session', 'actor'];

/** The statuses a listing can filter by, per type that has one. */
const STATUSES: Partial<Record<RecordType, readonly string[]>> = { change: CANONICAL_STATUSES, decision: DECISION_STATUSES, feature: FEATURE_STATUSES };

export interface LsOpts {
  type?: string;
  status?: string;
  project?: string;
  kind?: string;
  /** Anything under this product (a project's records through the project). */
  product?: string;
  /** A milestone's children, a feature's nodes, a change's decisions. */
  parent?: string;
  /** The changes naming this node or a node beneath it, and the nodes beneath it. */
  feature?: string;
}

export function ls(store: Store, opts: LsOpts, loaded: Loaded = loadStore(store)): Row[] {
  // a feature's status is the one the tree shows: authored, else derived from the changes on it
  const statusOf = (r: Rec): string | undefined => (r.type === 'feature' ? (typeof r.data.status === 'string' ? r.data.status : derivedStatus(loaded, r.key).status) : typeof r.data.status === 'string' ? r.data.status : undefined);
  let recs = loaded.records;
  let t: RecordType | undefined;
  if (opts.type) {
    t = TYPE_ALIASES[opts.type];
    if (!t) throw usageError(`unknown entity '${opts.type}' (${LIST_TYPES.join(', ')})`);
    recs = recs.filter((r) => r.type === t);
  }
  if (opts.status) {
    // a status no listed type has is a typo, refused rather than answered with nothing (decision interface-audit/error-contract)
    const known = t ? STATUSES[t] : [...new Set(Object.values(STATUSES).flat())];
    if (t && !known) throw usageError(`a ${t} has no status to filter by`);
    if (known && !known.includes(opts.status)) throw usageError(`--status ${opts.status} is not a status${t ? ` of a ${t}` : ''} (${known.join(', ')})`);
    recs = recs.filter((r) => statusOf(r) === opts.status);
  }
  if (opts.kind) {
    if (!(CHANGE_KINDS as readonly string[]).includes(opts.kind)) throw usageError(`--kind ${opts.kind} is not a kind of change (${CHANGE_KINDS.join(', ')})`);
    recs = recs.filter((r) => r.type === 'change' && (r.data.kind ?? 'work') === opts.kind);
  }
  const node = (flag: string, raw: string): Rec => {
    const res = resolve(loaded, raw);
    if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, `${flag} ${raw}`);
    return res.rec;
  };
  if (opts.project) {
    const p = node('--project', opts.project.includes(':') ? opts.project : `project:${opts.project}`);
    recs = recs.filter((r) => r.type !== 'change' || r.data.project === p.key);
  }
  if (opts.product) {
    const p = node('--product', opts.product.includes(':') ? opts.product : `product:${opts.product}`);
    recs = recs.filter((r) => r.type !== 'product' && rootProductOf(loaded, r)?.key === p.key);
  }
  if (opts.parent) {
    const p = node('--parent', opts.parent);
    recs = recs.filter((r) => (r.type === 'decision' ? r.changeKey === p.key : live(loaded, r.data.parent)?.key === p.key || (r.type === 'feature' && live(loaded, r.data.product)?.key === p.key)));
  }
  if (opts.feature) {
    const f = node('--feature', opts.feature.includes(':') ? opts.feature : `feature:${opts.feature}`);
    const beneath = (rec: Rec | undefined): boolean => {
      const seen = new Set<string>();
      for (let cur = rec; cur && !seen.has(cur.key); cur = structuralParent(loaded, cur)) {
        if (cur.key === f.key) return true;
        seen.add(cur.key);
      }
      return false;
    };
    recs = recs.filter((r) => (r.type === 'change' ? effectsOf(r).some((e) => beneath(live(loaded, e.key))) : r.type === 'feature' ? r.key !== f.key && beneath(r) : false));
  }
  // a change's row carries its branch and worktree name, computed once for the listing
  const observed = recs.some((r) => r.type === 'change') ? observedBranches(loaded) : null;
  const prefix = readUserConfig().branch_prefix;
  const withBranch = (r: Rec): Row => (r.type === 'change' && r.valid && observed ? { ...row(r), branch: branchOf(r, observed, prefix) } : r.type === 'feature' ? { ...row(r), status: statusOf(r) } : row(r));
  if (opts.kind === 'bug') {
    const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
    return [...recs].sort((a, b) => bugOrder({ severity: s(a.data.severity), created: s(a.data.created), key: a.key }, { severity: s(b.data.severity), created: s(b.data.created), key: b.key })).map(withBranch);
  }
  const typeOrder: RecordType[] = ['product', 'feature', 'aspect', 'place', 'project', 'change', 'decision', 'release', 'source', 'session', 'actor'];
  const dateOf = (r: Rec) => r.fileDate ?? (typeof r.data.created === 'string' ? r.data.created : '');
  return [...recs]
    .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || dateOf(a).localeCompare(dateOf(b)) || a.key.localeCompare(b.key))
    .map(withBranch);
}

export function formatLs(rows: Row[]): string {
  if (rows.length === 0) return '(no records)';
  const w = Math.min(48, Math.max(...rows.map((r) => r.key.length)));
  const dateOf = (r: Row) => r.created ?? (typeof r.data.started === 'string' ? r.data.started.slice(0, 10) : '');
  return rows
    .map((r) => `${r.type.padEnd(8)} ${dateOf(r).padEnd(10)}  ${r.key.padEnd(w)}  ${(r.status ?? '').padEnd(10)} ${r.gist ?? r.title ?? (r.valid ? '' : '(invalid)')}`)
    .join('\n');
}

export function show(store: Store, key: string): { rec: Rec; text: string } {
  const loaded = loadStore(store);
  const res = resolve(loaded, key);
  if (res.status === 'ok' || res.status === 'alias' || res.status === 'invalid') {
    let text = fs.readFileSync(res.rec.abs, 'utf8');
    // an aspect is shown with every place it reaches; a place with the aspect read there, base then forks
    if (res.status !== 'invalid' && res.rec.type === 'aspect') text += '\n' + reachOfBase(loaded, res.rec).join('\n') + '\n';
    if (res.status !== 'invalid' && res.rec.type === 'place') {
      const aspect = loaded.byKey.get(res.rec.aspectKey ?? '')?.[0];
      const feature = featureOfPlace(loaded, res.rec);
      const at = aspect && feature ? aspectAt(loaded, aspect, feature) : undefined;
      if (at) text += '\n## Read here\n\n' + formatAspectAt(at) + '\n';
    }
    return { rec: res.rec, text };
  }
  if (res.status === 'malformed') throw new CliError(`'${key}' is not a key`);
  throw notFound(key);
}

// --- context ---------------------------------------------------------------

export interface ChangeContext {
  change: Row;
  /** The foundation's sections as written, in order of depth (Origin, Intent, Done when, Scope, Open questions,
   *  Blocked on, Notes); only those present. */
  sections: Record<string, string>;
  /** The plan: steps as data, their progress, and the next step (the active one, else the first open). */
  plan: Step[];
  planProgress?: { done: number; total: number };
  next?: { n: number; step: Step };
  /** What the record still needs before it is worked (an ingested or migrated one): name, gist, intent, done when. */
  needs: string[];
  /** The name and gist were written from an earlier foundation: rewrite them. */
  stale: boolean;
  /** Mapped mechanically from the old shape on this date and not written through the tool since. */
  migrated?: string;
  decisions: DecisionRow[];
  /** Each source once: a key both bound and linked is listed as bound. `url` is where it opens outside the store. */
  sources: { key: string; record?: Row; via: 'binds' | 'links'; url?: string }[];
  /** The change's branch: one a session was seen on (observed), else the recommended name derived from the key. */
  branch?: { name: string; worktree: string; observed: boolean };
  sessions: (Row & { last?: string })[];
  /** The parent change, resolved, and the changes whose parent this is. */
  parent?: Row;
  children: Row[];
  /** What must land before this change, resolved; and the changes that say they need this one. */
  dependsOn: Row[];
  neededBy: Row[];
  /** A parent change is a milestone: done children over children, dropped excluded. */
  progress?: { done: number; total: number };
  /** Edges sessions observed from this change (the files it touched), with the session that saw each. */
  observed: { edge: string; to: string; session: string; at?: string }[];
  /** The aspects the change works under: named by it, or at the features it names (decision aspects/aspect-shape). */
  aspects?: ChangeAspects;
  /** Decisions on it that read as applying across the product while it names no aspect: the cue to propose one
   *  (change:aspects-as-work-goes). */
  aspectCues: AspectCue[];
  /** The releases that shipped it, oldest first: a change can ship in part in one and finish in a later one. */
  releases: { key: string; version: string; at?: string; url?: string }[];
}

export interface StoreContext {
  store: { name: string; mode: string; root: string };
  /** The project the board is scoped to, or null for the whole store. */
  project: Row | null;
  projects: Row[];
  changes: Row[];
  proposed: Row[];
  counts: Record<string, number>;
  /** One line when the project's product has no map yet and the project did not decline one. */
  mapPrompt?: string;
  /** One line when the product's map has grown past the shape a proposal would have: a regrouping to offer, never to run unasked. */
  regroupPrompt?: string;
}

/** A decision as a change's context carries it: its rungs on the row, the thread read as its current state, and what it
 *  still needs. */
export interface DecisionRow extends Row {
  state: DecisionState;
  needs: string[];
  stale: boolean;
  migrated?: string;
  supersededBy?: string;
}

export function decisionRow(r: Rec, supersededBy?: string): DecisionRow {
  const rungs = rungsOf(r);
  return { ...row(r), state: decisionState(threadOf(r.data)), needs: needsOf(r), stale: rungs.stale, migrated: typeof r.data.migrated === 'string' ? r.data.migrated : undefined, supersededBy };
}

/** Milestone progress: done children over children that were not dropped; undefined without children. */
export function progressOf(children: { status?: string }[]): { done: number; total: number } | undefined {
  const counted = children.filter((c) => c.status !== 'dropped');
  return counted.length ? { done: counted.filter((c) => c.status === 'done').length, total: counted.length } : undefined;
}

function sessionsOf(loaded: Loaded, changeKey: string): Rec[] {
  return contextIndex(loaded).sessions.get(changeKey) ?? [];
}

/** What a change's context reads of the rest of the store, by the change's live key, built once per loaded store
 *  (change:dashboard-reads-slow): its decisions, sessions, what sessions observed from it, its children, what needs it. */
interface ContextIndex {
  supersededBy: Map<string, string>;
  decisions: Map<string, Rec[]>;
  sessions: Map<string, Rec[]>;
  observed: Map<string, ChangeContext['observed']>;
  children: Map<string, Rec[]>;
  neededBy: Map<string, Rec[]>;
}

function contextIndex(loaded: Loaded): ContextIndex {
  return memo(loaded, 'change-context', () => {
    const liveKey = (k: unknown, scope?: string): string | undefined => {
      const r = typeof k === 'string' ? resolve(loaded, k, scope) : null;
      return r && (r.status === 'ok' || r.status === 'alias') ? r.rec.key : undefined;
    };
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const cx: ContextIndex = { supersededBy: new Map(), decisions: new Map(), sessions: new Map(), observed: new Map(), children: new Map(), neededBy: new Map() };
    for (const r of ofType(loaded, 'decision')) {
      for (const sup of supersedesOf(r.data)) {
        const t = liveKey(sup, r.productSlug ? `product:${r.productSlug}` : undefined);
        if (t) cx.supersededBy.set(t, r.key);
      }
      if (r.changeKey) push(cx.decisions, r.changeKey, r);
    }
    for (const ds of cx.decisions.values()) ds.sort((a, b) => (a.fileDate! + a.path).localeCompare(b.fileDate! + b.path));
    for (const s of ofType(loaded, 'session')) {
      if (!s.valid) continue;
      if (Array.isArray(s.data.changes)) for (const k of new Set((s.data.changes as unknown[]).map((k) => liveKey(k)))) if (k) push(cx.sessions, k, s);
      if (!Array.isArray(s.data.observed)) continue;
      for (const o of s.data.observed as unknown[]) {
        if (!o || typeof o !== 'object') continue;
        const e = o as Record<string, unknown>;
        if (typeof e.edge !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
        const from = liveKey(e.from);
        if (from) push(cx.observed, from, { edge: e.edge, to: e.to, session: s.key, at: typeof e.at === 'string' ? e.at : undefined });
      }
    }
    for (const ss of cx.sessions.values()) ss.sort((a, b) => String(a.data.started).localeCompare(String(b.data.started)));
    for (const c of ofType(loaded, 'change')) {
      if (!c.valid) continue;
      const p = typeof c.data.parent === 'string' ? liveKey(c.data.parent) : undefined;
      if (p) push(cx.children, p, c);
      for (const d of new Set(list(c.data.depends_on).map((k) => liveKey(k)))) if (d) push(cx.neededBy, d, c);
    }
    return cx;
  });
}

export function changeContext(store: Store, key: string, loaded: Loaded = loadStore(store)): ChangeContext {
  const raw = key.startsWith('change:') ? key : `change:${key}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, raw);
  const rec = res.rec;
  // the sections in order of depth, the known ones first; anything else the record holds follows
  const sections: Record<string, string> = {};
  for (const k of CHANGE_SECTIONS) if (rec.sections.get(k)?.trim()) sections[k] = rec.sections.get(k)!;
  for (const [k, v] of rec.sections) if (k && !(k in sections) && v.trim()) sections[k] = v;
  const plan = stepsOf(rec.data);
  const rungs = rungsOf(rec);

  const cx = contextIndex(loaded);
  const decisions = (cx.decisions.get(rec.key) ?? []).map((r) => decisionRow(r, cx.supersededBy.get(r.key)));

  const sources: ChangeContext['sources'] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  for (const via of ['binds', 'links'] as const) {
    for (const k of list(rec.data[via])) {
      if (sources.some((s) => s.key === k)) continue;
      const r = resolve(loaded, k);
      const record = r.status === 'ok' || r.status === 'alias' || r.status === 'invalid' ? row(r.rec) : undefined;
      sources.push({ key: k, via, record, url: urlOf(k, record?.data.url) });
    }
  }
  const sessions = sessionsOf(loaded, rec.key).map((r) => {
    const log = r.sections.get('Log') ?? '';
    const lines = log.split('\n').filter((l) => l.trim());
    return { ...row(r), last: lines.length ? lines[lines.length - 1].replace(/^-\s*/, '').replace(/^\S+Z\s+—\s+/, '') : undefined };
  });
  const observed: ChangeContext['observed'] = [];
  const seen = new Set<string>();
  for (const o of cx.observed.get(rec.key) ?? []) {
    if (seen.has(`${o.edge} ${o.to}`)) continue;
    seen.add(`${o.edge} ${o.to}`);
    observed.push(o);
  }
  const parentRes = typeof rec.data.parent === 'string' ? resolve(loaded, rec.data.parent) : null;
  const parent = parentRes && (parentRes.status === 'ok' || parentRes.status === 'alias') ? row(parentRes.rec) : undefined;
  const children = (cx.children.get(rec.key) ?? []).map(row);
  const liveKey = (k: unknown): string | undefined => {
    const r = typeof k === 'string' ? resolve(loaded, k) : null;
    return r && (r.status === 'ok' || r.status === 'alias') ? r.rec.key : undefined;
  };
  const dependsOn = list(rec.data.depends_on).map((k) => liveKey(k)).map((k) => (k ? loaded.byKey.get(k)?.[0] : undefined)).filter((r): r is Rec => !!r).map(row);
  const neededBy = (cx.neededBy.get(rec.key) ?? []).map(row);
  // the branch: one seen by a session (the latest) or linked from the change, else the recommended name
  const branch = branchOf(rec, observedBranches(loaded));
  const features = effectsOf(rec).map((e) => liveKey(e.key)).map((k) => (k ? loaded.byKey.get(k)?.[0] : undefined)).filter((r): r is Rec => r?.type === 'feature');
  const aspects = aspectsOfChange(loaded, rec, features);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const releases = ofType(loaded, 'release')
    .filter((r) => r.valid && list(r.data.ships).some((k) => liveKey(k) === rec.key))
    .map((r) => ({ key: r.key, version: str(r.data.version) ?? r.releaseVersion ?? r.key, at: str(r.data.at), url: str(r.data.url) }))
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  return {
    change: row(rec), sections, plan, planProgress: planProgress(plan), next: nextStep(plan), needs: needsOf(rec), stale: rungs.stale,
    migrated: typeof rec.data.migrated === 'string' ? rec.data.migrated : undefined,
    decisions, sources, branch, sessions, parent, children, progress: progressOf(children), dependsOn, neededBy, observed, aspects, aspectCues: aspectCuesOf(loaded, rec), releases,
  };
}

/** The lines that say what a record still needs, that its rungs are stale, or that it was migrated and not yet reviewed. */
export function readinessLines(c: { needs: string[]; stale: boolean; migrated?: string }, what: 'change' | 'decision'): string[] {
  const out: string[] = [];
  if (c.needs.length) out.push(`needs: ${c.needs.join(', ')} (write them before working it${what === 'change' ? ': pjman set <change> name=… gist=… intent=… done-when=…' : ': pjman decision <key> --name … --gist … --question …'})`);
  if (c.stale) out.push(`rungs: stale (the name and gist were written from an earlier ${what === 'change' ? 'Origin, Intent and Done when' : 'thread'}; rewrite them)`);
  if (c.migrated) out.push(`migrated: ${c.migrated} (mapped from the old shape, not reviewed since; the first write through the tool clears this)`);
  return out;
}

/** The next step as one line: its number, text and note. */
export function nextLine(next: { n: number; step: Step } | undefined): string | undefined {
  return next ? `${next.n}. ${next.step.text}${next.step.note ? ` — ${next.step.note}` : ''}` : undefined;
}

/** "decided by X on Y", "superseded by Z (decided by X on Y)", "proposed", "reverted (decided by X on Y)". */
export function decisionLine(dec: Row & { supersededBy?: string }): string {
  const by = dec.data.decided_by ? `decided by ${String(dec.data.decided_by)}${dec.data.decided_on ? ` on ${String(dec.data.decided_on)}` : ''}` : '';
  const parts: string[] = [];
  if (dec.status === 'decided') parts.push(by || 'decided');
  else if (dec.status === 'superseded') parts.push(`superseded${dec.supersededBy ? ` by ${dec.supersededBy}` : ''}${by ? ` (${by})` : ''}`);
  else if (dec.status === 'reverted') parts.push(`reverted${by ? ` (${by})` : ''}`);
  else parts.push(dec.status ?? '?');
  const sup = supersedesOf(dec.data);
  if (sup.length) parts.push(`supersedes ${sup.join(', ')}`);
  return parts.join('; ');
}

/** `key — name`, the gist beneath: how a change or a decision heads its context. With no name yet (an ingested or
 *  migrated record), the gist heads it. */
function heading(level: string, r: Row): string {
  const line = lineOfRow(r);
  if (!r.name) return `${level} ${r.key} — ${line ?? labelOf(r.data, r.key)}`;
  return `${level} ${r.key} — ${r.name}${line && line !== r.name ? `\n${line}` : ''}`;
}

/** `name: gist` on one line, the name left out when it is the gist or absent. */
export function nameAndLine(r: Pick<Row, 'name' | 'title'>): string {
  const line = lineOfRow(r);
  return `${r.name && r.name !== line ? `${r.name}: ` : ''}${line ?? r.name ?? ''}`;
}

export function formatChangeContext(c: ChangeContext): string {
  const out: string[] = [];
  const d = c.change.data;
  out.push(heading('#', c.change));
  out.push(`status: ${c.change.status ?? '?'}${d.kind === 'bug' ? `\nkind: bug${d.severity ? ` · severity ${String(d.severity)}` : ''}` : d.kind === 'milestone' ? '\nkind: milestone (its children are its plan)' : ''}${d.project ? `\nproject: ${String(d.project)}` : ''}${c.parent ? `\nparent: ${c.parent.key} — ${c.parent.name ?? c.parent.title ?? ''}` : ''}${d.target ? `\ntarget: ${String(d.target)}` : ''}${c.next ? `\nnext: ${nextLine(c.next)}` : ''}${c.branch ? `\nbranch: ${c.branch.name}${c.branch.observed ? '' : ` (recommended; worktree ${c.branch.worktree})`}` : ''}`);
  out.push(...readinessLines(c, 'change'));
  // the foundation in order of depth; the plan sits after Scope, where the work's shape ends and its steps begin
  for (const [k, v] of Object.entries(c.sections)) {
    if (k === 'Open questions' && c.plan.length) out.push(`\n## Plan${c.planProgress ? ` (${c.planProgress.done}/${c.planProgress.total} done)` : ''}\n\n${c.plan.map((s, i) => formatStep(i + 1, s)).join('\n')}`);
    out.push(`\n## ${k}\n\n${v}`);
  }
  if (c.plan.length && !('Open questions' in c.sections)) out.push(`\n## Plan${c.planProgress ? ` (${c.planProgress.done}/${c.planProgress.total} done)` : ''}\n\n${c.plan.map((s, i) => formatStep(i + 1, s)).join('\n')}`);
  if (c.decisions.length) {
    out.push('\n## Decisions');
    for (const dec of c.decisions) {
      out.push(`\n${heading('###', dec)}\n${decisionLine(dec)}`);
      out.push(...readinessLines(dec, 'decision'));
      const lines = formatDecisionState(dec.state);
      if (lines.length) out.push(`\n${lines.join('\n')}`);
    }
  }
  // the contract the change works under, after what was decided on it
  if (c.aspects) out.push('\n' + formatChangeAspects(c.aspects).join('\n').trimEnd());
  if (c.aspectCues.length) out.push('\n' + formatAspectCues(c.aspectCues).join('\n'));
  if (c.sources.length) {
    out.push('\n## Sources');
    for (const s of c.sources) {
      const t = s.record?.title ? ` — ${s.record.title}` : '';
      const u = s.url && s.url !== s.key.slice('url:'.length) ? ` (${s.url})` : '';
      out.push(`- ${s.via} ${s.key}${t}${u}`);
    }
  }
  const line = (ch: Row) => `- ${ch.key} [${ch.status ?? '?'}] — ${nameAndLine(ch)}`;
  if (c.children.length) {
    out.push(`\n## Children${c.progress ? ` (${c.progress.done}/${c.progress.total} done)` : ''}`);
    for (const ch of c.children) out.push(line(ch));
  }
  if (c.dependsOn.length) {
    out.push('\n## Depends on');
    for (const ch of c.dependsOn) out.push(line(ch));
  }
  if (c.neededBy.length) {
    out.push('\n## Needed by');
    for (const ch of c.neededBy) out.push(line(ch));
  }
  if (c.observed.length) {
    out.push('\n## Observed');
    for (const o of c.observed) out.push(`- ${o.edge} ${o.to} (${o.session}${o.at ? `, ${o.at.slice(0, 10)}` : ''})`);
  }
  if (c.sessions.length) {
    out.push('\n## Sessions');
    for (const s of c.sessions.slice(-5)) {
      out.push(`- ${String(s.data.started).slice(0, 10)} ${s.key} ${String(s.data.agent)} for ${String(s.data.on_behalf_of)}${s.last ? ` — ${s.last}` : ''}`);
    }
  }
  return out.join('\n') + '\n';
}

/** The board: the open changes of one project (`opts.project`), or of the whole store. */
export function storeContext(store: Store, opts: { project?: string | null } = {}, loaded: Loaded = loadStore(store)): StoreContext {
  const counts: Record<string, number> = {};
  for (const r of loaded.records) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const projects = loaded.records.filter((r) => r.type === 'project').map(row);
  let project: Row | null = null;
  if (opts.project) {
    const res = resolve(loaded, opts.project.startsWith('project:') ? opts.project : `project:${opts.project}`);
    if (res.status !== 'ok') throw notFound(opts.project, { as: 'project' });
    project = row(res.rec);
  }
  const changes = loaded.records
    .filter((r) => r.type === 'change' && r.data.status !== 'done' && r.data.status !== 'dropped')
    .filter((r) => !project || r.data.project === project.key)
    .map(row);
  const proposed = loaded.records
    .filter((r) => r.type === 'decision' && r.data.status === 'proposed')
    .filter((r) => !project || !r.changeKey || loaded.byKey.get(r.changeKey)?.[0]?.data.project === project.key)
    .map(row);
  const map = project ? mapState(loaded, project, store.project === project.key ? store.projectDir : undefined) : undefined;
  return { store: { name: store.config.name, mode: store.mode, root: store.root }, project, projects, changes, proposed, counts, mapPrompt: map?.prompt, regroupPrompt: project ? regroupPrompt(loaded, project) : undefined };
}

/** The top-level features of a product: its layers, the roadmap's lanes. */
const topFeatures = (loaded: Loaded, product: string): Rec[] => loaded.records.filter((r) => r.type === 'feature' && r.valid && structuralParent(loaded, r)?.key === product);

export interface MapState {
  /** The product with no map, or null when the project has no product. */
  product: string | null;
  /** What the repository holds: read live when the repository is at hand, else as init recorded it, else unknown. */
  inventory: Inventory | null;
  /** The line the context opens with. */
  prompt: string;
}

/** The project has no product, or its product has no feature: how the map comes, by what the repository holds, unless
 *  the project said skip. Live from the repository when its directory is known; else from the `holds` init recorded. */
export function mapState(loaded: Loaded, project: Pick<Row, 'key' | 'data'>, projectDir?: string): MapState | undefined {
  if (project.data.map === 'skip') return undefined;
  const product = typeof project.data.product === 'string' ? project.data.product : undefined;
  if (product && loaded.records.some((r) => r.type === 'feature' && `product:${r.productSlug}` === product)) return undefined;
  const inv: Inventory | null = projectDir && fs.existsSync(projectDir) ? inventory(projectDir) : isHolds(project.data.holds) ? { holds: project.data.holds, docs: [], code: [] } : null;
  const what = product ? `${product} has no map yet` : `${project.key} has no product yet`;
  const holds = inv ? `; the repository holds ${describeInventory(inv)}` : '';
  const how = inv
    ? inv.holds === 'bare'
      ? 'Nothing to survey: the map grows from the work. When a change is filed, name the capability it needs under the feature it best correlates to, creating both when none exists (the intake skill); a bug that breaks a behaviour no node has creates the live node. Never a proposal of a tree that has nothing to read.'
      : `${mapGuidance(inv.holds)}. The first change filed goes through intake, which says the map is missing: file it with no feature and propose the map in the same breath, the whole tree in a proposed decision that names the change as the first it houses; apply only on the go, as one batch (pjman apply).`
    : 'Survey the repository (what the person said, the documentation, the code\'s split, the store) and propose a product map, the whole tree in a proposed decision; apply it only on the go, as one batch (pjman apply). The map skill carries the procedure.';
  return { product: product ?? null, inventory: inv, prompt: `${what}${holds}. ${how} \`pjman set ${project.key} map=skip\` stops this line.` };
}

/** The map skill's shape for a proposed tree is four to seven layers at the top; a map grown one change at a time
 *  (a bare repository, or capabilities filed before a proposal) can pass it. Then a regrouping is offered in the
 *  context: the person asks for it, the skill never runs it unasked. `map=skip` ends this line as it ends the other. */
export function regroupPrompt(loaded: Loaded, project: Pick<Row, 'key' | 'data'>): string | undefined {
  if (project.data.map === 'skip') return undefined;
  const product = typeof project.data.product === 'string' ? project.data.product : undefined;
  if (!product) return undefined;
  const top = topFeatures(loaded, product);
  if (top.length <= 7) return undefined;
  return `${product} has ${top.length} top-level features, more than a proposed map would have (four to seven layers): if the person asks, the map skill regroups them into layers as one proposed decision; say what you see, never regroup unasked.`;
}


export function formatStoreContext(c: StoreContext): string {
  const head = c.project
    ? `# ${c.project.key} — ${c.project.title ?? ''} (${c.store.name} store)`
    : `# ${c.store.name} (${c.store.mode} store)${c.projects.length ? `\nprojects: ${c.projects.map((p) => p.key).join(', ')}` : ''}`;
  const out: string[] = [head];
  if (c.mapPrompt) out.push(`no product map: ${c.mapPrompt}`);
  if (c.regroupPrompt) out.push(`map outgrown: ${c.regroupPrompt}`);
  const tag = (r: Row) => (!c.project && r.data.project ? ` [${String(r.data.project)}]` : '');
  const order = ['active', 'blocked', 'review', 'planning', 'open'];
  const onBoard = new Set(c.changes.map((r) => r.key));
  const childrenOf = (key: string) => c.changes.filter((r) => r.data.parent === key);
  const item = (r: Row, depth: number): string => {
    const pad = '  '.repeat(depth);
    const status = depth ? ` [${r.status ?? '?'}]` : '';
    const kids = childrenOf(r.key);
    const p = progressOf(kids);
    const next = nextLine(nextStep(stepsOf(r.data)));
    const line = `${pad}- ${r.key}${status} — ${nameAndLine(r)}${tag(r)}${p ? ` · ${p.done}/${p.total} done` : ''}${next ? `\n${pad}  next: ${next}` : ''}`;
    return [line, ...childrenOf(r.key).map((ch) => item(ch, depth + 1))].join('\n');
  };
  // a change whose parent is on the board is listed under it, not on its own
  const top = c.changes.filter((r) => !(typeof r.data.parent === 'string' && onBoard.has(r.data.parent)));
  const groups = new Map<string, Row[]>();
  for (const r of top) groups.set(r.status ?? '?', [...(groups.get(r.status ?? '?') ?? []), r]);
  for (const s of [...order, ...[...groups.keys()].filter((k) => !order.includes(k))]) {
    const rows = groups.get(s);
    if (!rows?.length) continue;
    out.push(`\n## ${s}`);
    for (const r of rows) out.push(item(r, 0));
  }
  if (c.project && c.projects.length > 1) out.push(`\nother projects: ${c.projects.filter((p) => p.key !== c.project!.key).map((p) => p.key).join(', ')} (pjman context --all)`);
  if (c.proposed.length) {
    out.push('\n## proposed decisions');
    for (const r of c.proposed) out.push(`- ${r.key} — ${nameAndLine(r)}`);
  }
  out.push(`\n${Object.entries(c.counts).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ') || 'no records'}`);
  return out.join('\n') + '\n';
}
