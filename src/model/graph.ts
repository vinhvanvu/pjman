import fs from 'node:fs';
import path from 'node:path';
import { canonicalSourceKey, canonicalUrl, parseKey, RECORD_KINDS, SLUG_RE, typedRef } from '../store/keys.js';
import { ambiguous, notFound } from '../store/util.js';
import { grammarOf, keyFromUrl, mentions, scopeOf, shortForms, trackerOf } from './refs.js';
import { slugsOfBranch } from './branch.js';
export { keyFromUrl, repoOf } from './refs.js';
import { memo, push, resolve, type Loaded, type Rec } from '../store/records.js';
import { supersedesOf } from './supersede.js';
import { parseEffect } from './tree.js';
import { parseAspectEffect } from './aspects.js';
import { changeContext, lineOfRow, row, type ChangeContext, type Row } from './view.js';

// --- edges ---------------------------------------------------------------------------------------

export interface Edge {
  edge: string;
  from: string;
  to: string;
  /** The path of the record that declares (or observed) the edge. */
  on: string;
  observed: boolean;
  at: string | null;
}

/** A reference in canonical form: `url:` keys are normalised; everything else is verbatim. */
export function canon(raw: string): string {
  const k = parseKey(raw);
  return k && k.kind === 'url' ? canonicalSourceKey('url', k.rest) : raw;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Every edge the records declare, plus every edge a session observed. Targets that resolve through an alias are rewritten to the live key. */
export function allEdges(loaded: Loaded): Edge[] {
  return memo(loaded, 'edges', () => edgesOnce(loaded));
}

/** The edges by the key they leave and the key they reach. */
export function edgesAt(loaded: Loaded): { from: Map<string, Edge[]>; to: Map<string, Edge[]> } {
  return memo(loaded, 'edges-at', () => {
    const from = new Map<string, Edge[]>();
    const to = new Map<string, Edge[]>();
    for (const e of allEdges(loaded)) {
      push(from, e.from, e);
      push(to, e.to, e);
    }
    return { from, to };
  });
}

function edgesOnce(loaded: Loaded): Edge[] {
  const out: Edge[] = [];
  const edge = (name: string, from: string, to: string, on: Rec) =>
    out.push({ edge: name, from, to: canon(to), on: on.path, observed: false, at: null });
  const live = (raw: string, scope?: string | null): string => {
    const res = resolve(loaded, raw, scope);
    return res.status === 'ok' || res.status === 'alias' ? res.rec.key : raw;
  };
  for (const r of loaded.records) {
    if (!r.valid) continue;
    const d = r.data;
    const s = r.productSlug ?? null;
    for (const k of list(d.owners)) edge('owners', r.key, k, r);
    switch (r.type) {
      case 'product':
        for (const k of list(d.sequence)) edge('sequence', r.key, live(k, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'feature':
        if (typeof d.product === 'string') edge('product', r.key, d.product, r);
        if (typeof d.parent === 'string') edge('parent', r.key, live(d.parent, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'aspect':
        if (typeof d.parent === 'string') edge('parent', r.key, live(d.parent, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        edge('in', r.key, `product:${r.productSlug}`, r);
        break;
      case 'place':
        if (typeof d.feature === 'string') edge('feature', r.key, live(d.feature, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        if (r.aspectKey) edge('in', r.key, r.aspectKey, r);
        break;
      case 'project':
        if (typeof d.product === 'string') edge('product', r.key, d.product, r);
        if (typeof d.parent === 'string') edge('parent', r.key, live(d.parent, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'change':
        if (typeof d.project === 'string') edge('project', r.key, d.project, r);
        if (typeof d.parent === 'string') edge('parent', r.key, live(d.parent, s), r);
        for (const k of list(d.depends_on)) edge('depends_on', r.key, live(k, s), r);
        for (const f of list(d.features)) {
          const e = parseEffect(f);
          if (e) edge(e.effect, r.key, live(e.key, s), r);
        }
        for (const a of list(d.aspects)) {
          const e = parseAspectEffect(a);
          if (e) edge(e.effect, r.key, live(e.key, s), r);
        }
        for (const k of list(d.binds)) edge('binds', r.key, k, r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'decision':
        for (const k of supersedesOf(d)) edge('supersedes', r.key, live(k, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        if (r.changeKey) edge('in', r.key, r.changeKey, r);
        else if (r.productSlug) edge('in', r.key, `product:${r.productSlug}`, r);
        break;
      case 'release':
        for (const k of list(d.ships)) edge('ships', r.key, live(k, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        edge('in', r.key, `product:${r.productSlug}`, r);
        break;
      case 'source':
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'session':
        if (typeof d.parent === 'string') edge('parent', r.key, d.parent, r);
        for (const k of list(d.changes)) edge('changes', r.key, live(k), r);
        if (typeof d.kind === 'string') edge('kind', r.key, live(d.kind), r);
        if (Array.isArray(d.observed)) {
          for (const o of d.observed) {
            if (!o || typeof o !== 'object') continue;
            const e = o as Record<string, unknown>;
            if (typeof e.edge !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
            out.push({
              edge: e.edge,
              from: live(e.from),
              to: canon(e.to),
              on: r.path,
              observed: true,
              at: typeof e.at === 'string' ? e.at : null,
            });
          }
        }
        break;
      case 'session-kind':
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'actor':
        break;
    }
    if (typeof d.writer === 'string') edge('writer', r.key, d.writer, r);
    if (typeof d.session === 'string') edge('session', r.key, d.session, r);
  }
  return out;
}

/** Keys of sources that are referenced but have no record. */
export function sourceKeysOnly(loaded: Loaded, edges: Edge[]): Set<string> {
  const keys = new Set<string>();
  for (const e of edges) {
    for (const k of [e.from, e.to]) {
      const p = parseKey(k);
      if (p && !RECORD_KINDS.has(p.kind) && !loaded.byKey.has(k)) keys.add(k);
    }
  }
  return keys;
}

// --- the getter ----------------------------------------------------------------------------------

export type Shape = 'record key' | 'source key' | 'url' | 'ticket id' | 'file path' | 'slug';

export interface Resolution {
  /** record: a record exists; alias: a change record reached through a former slug; invalid: the record exists but does not parse;
   *  key: a well-formed source key with no record; none: nothing matched. */
  status: 'record' | 'alias' | 'invalid' | 'key' | 'none';
  key?: string;
  via?: string;
  shape?: Shape;
  /** Two or more records answer to the reference (a slug, `<change>/<slug>`): none is picked. */
  candidates?: string[];
  /** What was tried, for a reference that matched nothing. */
  tried: string[];
}

export interface Neighbourhood {
  input: string;
  resolution: Resolution;
  record?: Row;
  /** Edges into the resolved key. The session that observed an edge is its `on` record. */
  in: Edge[];
  out: Edge[];
  /** Every change within two hops, with its full context. */
  changes: ChangeContext[];
  /** change key → how it was reached (`binds`, `decision:x/y links`, `session:… changes`, `self`). */
  via: Record<string, string>;
  /** For a source: change key → how the change relates to it, the strongest that holds (binds over links over observed). */
  relation: Record<string, Relation>;
  /** A project's changes, a session's children, an actor's sessions: rows, not contexts. */
  members: Row[];
}

/** How a change relates to a source in its reach: it binds it, it (or one of its decisions) links it, or a session
 *  observed it linking it. */
export type Relation = 'binds' | 'links' | 'observed';
const RELATION_RANK: Record<Relation, number> = { observed: 1, links: 2, binds: 3 };

/** The relation an edge between a change (or its decision) and a source makes. */
function relationOf(e: Edge): Relation {
  return e.observed ? 'observed' : e.edge === 'binds' ? 'binds' : 'links';
}

export interface GetOpts {
  cwd?: string;
  /** The directory a `file:` key is relative to. */
  projectDir?: string;
  /** The current project's key, for its tracker. */
  project?: string;
}

export interface ResolveOpts extends GetOpts {
  /** A command's argument (decision interface-audit/key-arguments): a slug is asked of every kind of record it can name
   *  and two records answering to it are refused by name rather than one picked; `<a>/<b>` names a decision or an
   *  aspect's place and nothing else. */
  strict?: boolean;
  /** A command that takes one kind (a product, a feature) asks only those of a slug: a product and its project often
   *  share a name. */
  kinds?: string[];
}

/** The one resolver: every alias of a record or a source to its key (change:pjman-22). In a fixed order: a record key
 *  (full, short or former); a URL; a source key; a ticket's short form (a bare id only where one tracker of the project
 *  claims its prefix); a decision or place key with its kind left off (`<change>/<slug>`); a slug; a file path; a
 *  decision slug or session id prefix. The getter, the text scanner and every command's argument go through it. Never
 *  writes. */
export function resolveRef(loaded: Loaded, input: string, opts: ResolveOpts = {}): Resolution {
  const store = loaded.store;
  const ref = input.trim();
  const tried: string[] = [];
  const kinds = store.config.source_kinds.map((k) => k.toLowerCase());
  const referenced = (key: string): boolean => edgesAt(loaded).to.has(key) || edgesAt(loaded).from.has(key);
  const fromRecord = (raw: string, shape: Shape): Resolution | null => {
    const res = resolve(loaded, raw);
    if (res.status === 'ok') return { status: 'record', key: res.rec.key, shape, tried };
    if (res.status === 'alias') return { status: 'alias', key: res.rec.key, via: raw, shape, tried };
    if (res.status === 'invalid') return { status: 'invalid', key: res.rec.key, shape, tried };
    return null;
  };
  const sourceKey = (raw: string, shape: Shape): Resolution => {
    const key = canon(raw);
    const rec = loaded.byKey.get(key)?.[0];
    if (rec) return { status: rec.valid ? 'record' : 'invalid', key, shape, tried };
    return { status: 'key', key, shape, tried };
  };

  /** The keys that name a record, each through its scope and aliases: one is the answer, several are refused. */
  const named = (keys: string[], also: string[] = []): Resolution => {
    const hits = new Map<string, Resolution>();
    for (const k of keys) {
      const hit = fromRecord(k, 'slug');
      if (hit?.key && !hits.has(hit.key)) hits.set(hit.key, hit);
    }
    for (const k of also) if (!hits.has(k)) hits.set(k, fromRecord(k, 'slug')!);
    if (hits.size === 1) return [...hits.values()][0];
    if (hits.size > 1) {
      tried.push(`${ref} names ${hits.size}: ${[...hits.keys()].join(', ')}`);
      return { status: 'none', candidates: [...hits.keys()], tried };
    }
    return { status: 'none', tried };
  };
  const decisionsNamed = (slug: string): string[] =>
    loaded.records.filter((r) => r.type === 'decision' && r.decisionSlug === slug).map((r) => r.key);

  const parsed = parseKey(ref);
  if (parsed && RECORD_KINDS.has(parsed.kind)) {
    tried.push(`record key ${ref}`);
    return fromRecord(ref, 'record key') ?? { status: 'none', tried };
  }
  if (/^https?:\/\//i.test(ref)) {
    tried.push('url');
    const u = canonicalUrl(ref);
    const direct = loaded.byKey.get(`url:${u}`)?.[0];
    if (direct) return { status: direct.valid ? 'record' : 'invalid', key: direct.key, shape: 'url', tried };
    const byField = loaded.records.find(
      (r) => r.type === 'source' && typeof r.data.url === 'string' && canonicalUrl(r.data.url) === u,
    );
    if (byField)
      return { status: byField.valid ? 'record' : 'invalid', key: byField.key, via: `url:${u}`, shape: 'url', tried };
    const vendor = keyFromUrl(u);
    if (vendor) return { ...sourceKey(vendor, 'url'), via: `url:${u}` };
    return sourceKey(`url:${u}`, 'url');
  }
  if (parsed && kinds.includes(parsed.kind.toLowerCase())) {
    tried.push(`source key ${ref}`);
    return sourceKey(ref, 'source key');
  }
  if (opts.kinds && SLUG_RE.test(ref)) {
    tried.push(...opts.kinds.map((k) => `${k}:${ref}`));
    return named(opts.kinds.map((k) => `${k}:${ref}`));
  }
  // a short form (ABC-1234, #12, owner/repo#12): only through its own kind's grammar. A bare prefixed id resolves where
  // exactly one tracker of the project claims its prefix, and nowhere else (decision pjman-22/bare-ticket-ids); for `#12`
  // the project's tracker admits one it has no record of, any the store already references resolves, and a qualified
  // form resolves anywhere.
  const forms = shortForms(ref, scopeOf(loaded, opts.project));
  if (forms.length) {
    const tracker = trackerOf(loaded, opts.project);
    for (const f of forms) {
      if (!f.key) {
        tried.push(
          `${f.kind} short form: ${opts.project ? `${opts.project} names no scope for it (${f.needs})` : `no current project (${f.needs})`}`,
        );
        continue;
      }
      tried.push(`${f.kind} short form ${f.key}`);
      if (f.claimed || loaded.byKey.has(f.key) || referenced(f.key)) return sourceKey(f.key, 'ticket id');
      if (f.qualified || (f.kind === tracker && f.inScope))
        return { status: 'key', key: f.key, shape: 'ticket id', tried };
    }
    if (!tracker && forms.some((f) => f.key))
      tried.push(
        `a ticket through the project's tracker (${opts.project ? `${opts.project} names none` : 'no current project'})`,
      );
  }
  // a decision or an aspect's place with its kind left off: `<change>/<slug>`, `<aspect>/<place>`
  if (/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(ref)) {
    tried.push(`decision:${ref}`, `aspect:${ref}`);
    const hit = named([`decision:${ref}`, `aspect:${ref}`]);
    if (opts.strict || hit.key || hit.candidates) return hit;
  }
  if (SLUG_RE.test(ref) && opts.strict) {
    // a command's argument: every kind a slug names, and a decision of that slug; several are refused, none goes on
    tried.push('change, project, feature, product, aspect, decision named so');
    const hit = named(
      ['change', 'project', 'feature', 'product', 'aspect'].map((k) => `${k}:${ref}`),
      decisionsNamed(ref),
    );
    if (hit.key || hit.candidates) return hit;
  } else if (SLUG_RE.test(ref)) {
    tried.push(`change:${ref}, project:${ref}`);
    const hit = fromRecord(`change:${ref}`, 'slug') ?? fromRecord(`project:${ref}`, 'slug');
    if (hit) return hit;
  }
  const cwd = opts.cwd ?? process.cwd();
  if (/[/.]/.test(ref) || fs.existsSync(path.resolve(cwd, ref))) {
    const base = opts.projectDir ?? cwd;
    const abs = path.resolve(cwd, ref);
    const rel = path.relative(base, abs);
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    const key = `file:${inside ? rel : ref.replace(/^\.\//, '')}`;
    tried.push(`file path ${key}`);
    const hit = sourceKey(key, 'file path');
    if (hit.status === 'record' || referenced(hit.key!)) return hit;
    if (fs.existsSync(abs)) return hit;
  }
  if (SLUG_RE.test(ref) && !opts.strict) {
    const decisions = loaded.records.filter((r) => r.type === 'decision' && r.decisionSlug === ref);
    tried.push(
      `a decision named ${ref}${decisions.length > 1 ? ` (${decisions.length} match: ${decisions.map((r) => r.key).join(', ')})` : ''}`,
    );
    if (decisions.length === 1)
      return { status: decisions[0].valid ? 'record' : 'invalid', key: decisions[0].key, shape: 'slug', tried };
  }
  if (ref.length >= 6 && /^[A-Za-z0-9._-]+$/.test(ref)) {
    const sessions = loaded.records.filter((r) => r.type === 'session' && r.sessionId?.startsWith(ref));
    tried.push(`a session id starting ${ref}${sessions.length > 1 ? ` (${sessions.length} match)` : ''}`);
    if (sessions.length === 1)
      return { status: sessions[0].valid ? 'record' : 'invalid', key: sessions[0].key, shape: 'slug', tried };
  }
  return { status: 'none', tried };
}

/** A command's record argument as a key (decision interface-audit/key-arguments): a key passes through for the command
 *  to resolve; anything else goes through the one resolver as an argument (`strict`): a slug two records answer to is
 *  refused by name rather than one picked. Nothing found is refused with what was tried. */
export function resolveArg(loaded: Loaded, raw: string, opts: GetOpts & { kinds?: string[] } = {}): string {
  const ref = raw.trim();
  if (parseKey(ref) && !/^https?:\/\//i.test(ref)) return ref;
  const res = resolveRef(loaded, ref, { ...opts, strict: true });
  if (res.candidates) throw ambiguous(ref, res.candidates);
  if (res.key && res.status !== 'none') return res.key;
  throw notFound(ref, { as: opts.kinds?.join(' or '), tried: res.tried });
}

/** A value written into a field that names records of `kind` (`fieldKind`), as the key the store writes: a slug alone
 *  gains the kind (`typedRef`); where a source is meant, the value goes through the one resolver, so a ticket's URL, its
 *  bare id or `#12` is written as the ticket's key, a file path as `file:`, any other URL as `url:`. A key passes as it
 *  is; what resolves to no source is left as written, for the write's own check to refuse. */
export function fieldRef(loaded: Loaded, kind: string, value: string, opts: GetOpts = {}): string {
  const v = value.trim();
  if (kind !== 'source' || (parseKey(v) && !/^https?:\/\//i.test(v))) return typedRef(v, kind);
  const r = resolveRef(loaded, v, opts);
  const k = r.status !== 'none' && r.key ? parseKey(r.key) : null;
  return k && !RECORD_KINDS.has(k.kind) ? k.raw : typedRef(v, kind);
}

/** The getter: a reference in, the record and its neighbourhood out. */
export function get(loaded: Loaded, input: string, opts: GetOpts = {}): Neighbourhood {
  const resolution = resolveRef(loaded, input, opts);
  const result: Neighbourhood = {
    input,
    resolution,
    in: [],
    out: [],
    changes: [],
    via: {},
    relation: {},
    members: [],
  };
  if (resolution.status === 'none' || !resolution.key) return result;
  const key = resolution.key;
  const rec = loaded.byKey.get(key)?.[0];
  if (rec) result.record = row(rec);
  result.in = [...(edgesAt(loaded).to.get(key) ?? [])];
  result.out = [...(edgesAt(loaded).from.get(key) ?? [])];

  const reach = new Map<string, string>();
  const changeOf = (k: string): string | null => {
    const p = parseKey(k);
    if (!p) return null;
    if (p.kind === 'change') return k;
    if (p.kind === 'decision') return loaded.byKey.get(k)?.[0]?.changeKey ?? null;
    return null;
  };
  const add = (k: string, how: string) => {
    if (loaded.byKey.get(k)?.[0]?.valid && !reach.has(k)) reach.set(k, how);
  };
  if (rec?.type === 'change') add(key, 'self');
  else if (rec?.type === 'decision' && rec.changeKey) add(rec.changeKey, 'in');
  else if (rec?.type === 'session') for (const k of list(rec.data.changes)) add(canon(k), 'changes');
  // a source names how each change in its reach relates to it: the strongest edge wins, whichever came first
  const parsedKey = parseKey(key);
  const source = rec?.type === 'source' || (!!parsedKey && !RECORD_KINDS.has(parsedKey.kind));
  const relation = new Map<string, Relation>();
  const relate = (c: string, e: Edge, how: string) => {
    add(c, how);
    if (!source || !reach.has(c)) return;
    const r = relationOf(e);
    const was = relation.get(c);
    if (was && RELATION_RANK[was] >= RELATION_RANK[r]) return;
    relation.set(c, r);
    reach.set(c, how);
  };
  if (rec?.type !== 'project' && rec?.type !== 'actor') {
    for (const e of result.in) {
      const c = changeOf(e.from);
      if (c) relate(c, e, c === e.from ? `${e.edge}${e.observed ? ' (observed)' : ''}` : `${e.from} ${e.edge}`);
    }
    for (const e of result.out) {
      const c = changeOf(e.to);
      if (c && e.edge !== 'session' && e.edge !== 'writer') relate(c, e, e.edge);
    }
  }
  for (const [k, how] of reach) {
    try {
      result.changes.push(changeContext(loaded.store, k, loaded));
      result.via[k] = how;
      const r = relation.get(k);
      if (r) result.relation[k] = r;
    } catch {
      // an unresolvable change in reach is reported by validate, not here
    }
  }
  if (rec?.type === 'project')
    result.members = loaded.records.filter((r) => r.type === 'change' && r.data.project === key).map(row);
  if (rec?.type === 'session')
    result.members = loaded.records.filter((r) => r.type === 'session' && r.data.parent === key).map(row);
  if (rec?.type === 'actor')
    result.members = loaded.records
      .filter((r) => r.type === 'session' && (r.data.on_behalf_of === key || r.data.agent === key))
      .map(row);
  return result;
}

export function formatNeighbourhood(n: Neighbourhood, formatChange: (c: ChangeContext) => string): string {
  const r = n.resolution;
  if (r.status === 'none') return `${n.input} resolves to nothing; tried: ${r.tried.join('; ')}`;
  const out: string[] = [];
  const how = r.via && r.via !== r.key ? ` via ${r.via}` : '';
  const what =
    r.status === 'key'
      ? 'a source key with no record'
      : r.status === 'invalid'
        ? 'a record that does not parse'
        : r.status === 'alias'
          ? 'a former slug'
          : (n.record?.type ?? 'a record');
  out.push(`${n.input} → ${r.key} (${r.shape}${how}; ${what})`);
  if (n.record)
    out.push(
      `${n.record.type} ${n.record.key}${lineOfRow(n.record) ? ` — ${lineOfRow(n.record)}` : ''}${n.record.status ? ` [${n.record.status}]` : ''}  ${n.record.path}`,
    );
  const line = (e: Edge, other: string) =>
    `- ${e.edge} ${other}${
      e.observed
        ? ` (observed by ${e.on.replace(/^sessions\/(\d{4}-\d{2}-\d{2}-)?/, 'session:').replace(/\.md$/, '')}${e.at ? ` at ${e.at.slice(0, 10)}` : ''})`
        : ''
    }`;
  const inbound = n.in.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
  const outbound = n.out.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
  if (inbound.length) out.push(`\nreferenced by:\n${inbound.map((e) => line(e, e.from)).join('\n')}`);
  if (outbound.length) out.push(`\nrefers to:\n${outbound.map((e) => line(e, e.to)).join('\n')}`);
  if (n.members.length)
    out.push(
      `\nmembers:\n${n.members.map((m) => `- ${m.key}${m.status ? ` [${m.status}]` : ''}${lineOfRow(m) ? ` — ${lineOfRow(m)}` : ''}`).join('\n')}`,
    );
  if (!n.record && !inbound.length && !outbound.length) out.push('nothing in the store references it');
  for (const c of n.changes) {
    const v = n.via[c.change.key];
    out.push(
      `\n${'─'.repeat(60)}\n${v === 'self' ? '' : `reached ${c.change.key} through ${v}\n\n`}${formatChange(c).trimEnd()}`,
    );
  }
  return out.join('\n') + '\n';
}

// --- references in text ----------------------------------------------------------------------------

export interface Reference {
  /** The span as written. */
  text: string;
  at: number;
  /** How it was recognised: `change`, `url`, `slug`, or a source kind's short form. */
  shape: string;
  resolution: Resolution;
  key: string;
  /** The change it leads to: itself, the change that binds it, or the nearest change in reach. */
  change?: string;
  /** For a source: how that change relates to it (binds, links, observed). */
  relation?: Relation;
  /** A ticket of the project's tracker that no change binds: the tracker can be asked and the sync would create the change. */
  creatable: boolean;
  /** Too ambiguous to act on (a bare `#1`): listed with what it would lead to, never binding a session or creating a change. */
  weak: boolean;
}

/** Every reference in a text that resolves to something, in order of appearance, each with the change it leads to.
 *  The last mention that is not weak is what a prompt is about. Never writes. */
export function findReferences(loaded: Loaded, text: string, opts: GetOpts = {}): Reference[] {
  // bare slugs: changes still in play (a dropped change is reached by its full key only)
  const slugs = [
    ...new Set(
      loaded.records.filter((r) => r.type === 'change' && r.data.status !== 'dropped').map((r) => r.changeSlug!),
    ),
  ];
  const tracker = trackerOf(loaded, opts.project);
  const out: Reference[] = [];
  for (const m of mentions(text, slugs)) {
    const last = out[out.length - 1];
    if (last && m.at < last.at + last.text.length) continue; // inside a span already accepted
    const resolution = resolveRef(loaded, m.shape === 'slug' ? m.text.toLowerCase() : m.text, opts);
    if (resolution.status === 'none' || !resolution.key) continue;
    const key = resolution.key;
    const kind = key.slice(0, key.indexOf(':'));
    // a tracker's ticket leads only to the change that binds it: a change that merely links it (a follow-up it filed)
    // is not its work, and the ticket is to be read and synced instead (change:pjman-21)
    const ticket = kind === tracker || !!grammarOf(kind)?.ticket;
    let change: string | undefined;
    let relation: Relation | undefined;
    if (key.startsWith('change:')) change = key;
    else {
      const n = get(loaded, key, opts);
      change = (ticket ? n.changes.filter((c) => n.relation[c.change.key] === 'binds') : n.changes)[0]?.change.key;
      if (change) relation = n.relation[change];
    }
    if (!change && kind === 'branch') {
      // no record links the branch yet: the name itself says which change it was cut for
      for (const slug of slugsOfBranch(key.slice('branch:'.length))) {
        const r = resolveRef(loaded, `change:${slug}`, opts);
        if ((r.status === 'record' || r.status === 'alias') && r.key?.startsWith('change:')) {
          change = r.key;
          break;
        }
      }
    }
    const weak = !!m.weak;
    out.push({
      text: m.text,
      at: m.at,
      shape: m.shape,
      resolution,
      key,
      change,
      relation,
      // a ticket no change binds, recorded or not: the sync creates its change
      creatable:
        !weak && !change && (resolution.status === 'key' || resolution.status === 'record') && kind === tracker,
      weak,
    });
  }
  return out;
}

export function formatReferences(refs: Reference[]): string {
  if (!refs.length) return 'no references';
  return refs
    .map(
      (r) =>
        `${r.text} → ${r.key} (${r.shape}${r.resolution.status === 'key' ? ', no record' : ''}${r.weak ? ', bare: never binds' : ''})${r.change ? ` · ${r.relation ? `${r.relation} ` : ''}${r.change}` : r.creatable ? ' · no change yet: ask the tracker' : ''}`,
    )
    .join('\n');
}
