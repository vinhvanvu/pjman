import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { canonicalSourceKey, canonicalUrl, parseKey, RECORD_KINDS, SLUG_RE } from './keys.js';
import { keyFromUrl, mentions, scopeOf, shortForms, slugFor, trackerOf } from './refs.js';
export { keyFromUrl, repoOf } from './refs.js';
import { resolve, type Loaded, type Rec } from './records.js';
import { supersedesOf } from './supersede.js';
import { parseEffect } from './tree.js';
import { changeContext, row, type ChangeContext, type Row } from './commands/view.js';

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
  const out: Edge[] = [];
  const edge = (name: string, from: string, to: string, on: Rec) => out.push({ edge: name, from, to: canon(to), on: on.path, observed: false, at: null });
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
        for (const k of list(d.binds)) edge('binds', r.key, k, r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'decision':
        for (const k of supersedesOf(d)) edge('supersedes', r.key, live(k, s), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        if (r.changeKey) edge('in', r.key, r.changeKey, r);
        else if (r.productSlug) edge('in', r.key, `product:${r.productSlug}`, r);
        break;
      case 'source':
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'session':
        if (typeof d.parent === 'string') edge('parent', r.key, d.parent, r);
        for (const k of list(d.changes)) edge('changes', r.key, live(k), r);
        if (Array.isArray(d.observed)) {
          for (const o of d.observed) {
            if (!o || typeof o !== 'object') continue;
            const e = o as Record<string, unknown>;
            if (typeof e.edge !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
            out.push({ edge: e.edge, from: live(e.from), to: canon(e.to), on: r.path, observed: true, at: typeof e.at === 'string' ? e.at : null });
          }
        }
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
  /** A project's changes, a session's children, an actor's sessions: rows, not contexts. */
  members: Row[];
}

export interface GetOpts {
  cwd?: string;
  /** The directory a `file:` key is relative to. */
  projectDir?: string;
  /** The current project's key, for its tracker. */
  project?: string;
}

/** Resolve one reference to a key, in the fixed order: record key, source key, URL, ticket id, slug, file path. Never writes. */
export function resolveRef(loaded: Loaded, input: string, opts: GetOpts = {}): Resolution {
  const store = loaded.store;
  const ref = input.trim();
  const tried: string[] = [];
  const kinds = store.config.source_kinds.map((k) => k.toLowerCase());
  const referenced = (key: string): boolean => allEdges(loaded).some((e) => e.to === key || e.from === key);
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
    const byField = loaded.records.find((r) => r.type === 'source' && typeof r.data.url === 'string' && canonicalUrl(r.data.url) === u);
    if (byField) return { status: byField.valid ? 'record' : 'invalid', key: byField.key, via: `url:${u}`, shape: 'url', tried };
    const vendor = keyFromUrl(u);
    if (vendor) return { ...sourceKey(vendor, 'url'), via: `url:${u}` };
    return sourceKey(`url:${u}`, 'url');
  }
  if (parsed && kinds.includes(parsed.kind.toLowerCase())) {
    tried.push(`source key ${ref}`);
    return sourceKey(ref, 'source key');
  }
  // a short form (ABC-1234, #12, owner/repo#12): only through its own kind's grammar. The project's tracker admits one it
  // has no record of; any kind the store already references resolves one that exists; a qualified form resolves anywhere.
  const forms = shortForms(ref, scopeOf(loaded, opts.project));
  if (forms.length) {
    const tracker = trackerOf(loaded, opts.project);
    for (const f of forms) {
      if (!f.key) {
        tried.push(`${f.kind} short form: ${opts.project ? `${opts.project} names no scope for it (${f.needs})` : `no current project (${f.needs})`}`);
        continue;
      }
      tried.push(`${f.kind} short form ${f.key}`);
      if (loaded.byKey.has(f.key) || referenced(f.key)) return sourceKey(f.key, 'ticket id');
      if (f.qualified || (f.kind === tracker && f.inScope)) return { status: 'key', key: f.key, shape: 'ticket id', tried };
    }
    if (!tracker) tried.push(`a ticket through the project's tracker (${opts.project ? `${opts.project} names none` : 'no current project'})`);
  }
  if (SLUG_RE.test(ref)) {
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
  if (SLUG_RE.test(ref)) {
    const decisions = loaded.records.filter((r) => r.type === 'decision' && r.decisionSlug === ref);
    tried.push(`a decision named ${ref}${decisions.length > 1 ? ` (${decisions.length} match: ${decisions.map((r) => r.key).join(', ')})` : ''}`);
    if (decisions.length === 1) return { status: decisions[0].valid ? 'record' : 'invalid', key: decisions[0].key, shape: 'slug', tried };
  }
  if (ref.length >= 6 && /^[A-Za-z0-9._-]+$/.test(ref)) {
    const sessions = loaded.records.filter((r) => r.type === 'session' && r.sessionId?.startsWith(ref));
    tried.push(`a session id starting ${ref}${sessions.length > 1 ? ` (${sessions.length} match)` : ''}`);
    if (sessions.length === 1) return { status: sessions[0].valid ? 'record' : 'invalid', key: sessions[0].key, shape: 'slug', tried };
  }
  return { status: 'none', tried };
}

/** The getter: a reference in, the record and its neighbourhood out. */
export function get(loaded: Loaded, input: string, opts: GetOpts = {}): Neighbourhood {
  const resolution = resolveRef(loaded, input, opts);
  const result: Neighbourhood = { input, resolution, in: [], out: [], changes: [], via: {}, members: [] };
  if (resolution.status === 'none' || !resolution.key) return result;
  const key = resolution.key;
  const rec = loaded.byKey.get(key)?.[0];
  if (rec) result.record = row(rec);
  const edges = allEdges(loaded);
  result.in = edges.filter((e) => e.to === key);
  result.out = edges.filter((e) => e.from === key);

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
  if (rec?.type !== 'project' && rec?.type !== 'actor') {
    for (const e of result.in) {
      const c = changeOf(e.from);
      if (c) add(c, c === e.from ? `${e.edge}${e.observed ? ' (observed)' : ''}` : `${e.from} ${e.edge}`);
    }
    for (const e of result.out) {
      const c = changeOf(e.to);
      if (c && e.edge !== 'session' && e.edge !== 'writer') add(c, e.edge);
    }
  }
  for (const [k, how] of reach) {
    try {
      result.changes.push(changeContext(loaded.store, k, loaded));
      result.via[k] = how;
    } catch {
      // an unresolvable change in reach is reported by validate, not here
    }
  }
  if (rec?.type === 'project') result.members = loaded.records.filter((r) => r.type === 'change' && r.data.project === key).map(row);
  if (rec?.type === 'session') result.members = loaded.records.filter((r) => r.type === 'session' && r.data.parent === key).map(row);
  if (rec?.type === 'actor') result.members = loaded.records.filter((r) => r.type === 'session' && (r.data.on_behalf_of === key || r.data.agent === key)).map(row);
  return result;
}

export function formatNeighbourhood(n: Neighbourhood, formatChange: (c: ChangeContext) => string): string {
  const r = n.resolution;
  if (r.status === 'none') return `${n.input} resolves to nothing; tried: ${r.tried.join('; ')}`;
  const out: string[] = [];
  const how = r.via && r.via !== r.key ? ` via ${r.via}` : '';
  const what = r.status === 'key' ? 'a source key with no record' : r.status === 'invalid' ? 'a record that does not parse' : r.status === 'alias' ? 'a former slug' : n.record?.type ?? 'a record';
  out.push(`${n.input} → ${r.key} (${r.shape}${how}; ${what})`);
  if (n.record) out.push(`${n.record.type} ${n.record.key}${n.record.title ? ` — ${n.record.title}` : ''}${n.record.status ? ` [${n.record.status}]` : ''}  ${n.record.path}`);
  const line = (e: Edge, other: string) => `- ${e.edge} ${other}${e.observed ? ` (observed by ${e.on.replace(/^sessions\//, 'session:').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '')}${e.at ? ` at ${e.at.slice(0, 10)}` : ''})` : ''}`;
  const inbound = n.in.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
  const outbound = n.out.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
  if (inbound.length) out.push(`\nreferenced by:\n${inbound.map((e) => line(e, e.from)).join('\n')}`);
  if (outbound.length) out.push(`\nrefers to:\n${outbound.map((e) => line(e, e.to)).join('\n')}`);
  if (n.members.length) out.push(`\nmembers:\n${n.members.map((m) => `- ${m.key}${m.status ? ` [${m.status}]` : ''}${m.title ? ` — ${m.title}` : ''}`).join('\n')}`);
  if (!n.record && !inbound.length && !outbound.length) out.push('nothing in the store references it');
  for (const c of n.changes) {
    const v = n.via[c.change.key];
    out.push(`\n${'─'.repeat(60)}\n${v === 'self' ? '' : `reached ${c.change.key} through ${v}\n\n`}${formatChange(c).trimEnd()}`);
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
  /** A ticket of the project's tracker with no record yet: the tracker can be asked and the sync would create the change. */
  creatable: boolean;
  /** Too ambiguous to act on (a bare `#1`): listed with what it would lead to, never binding a session or creating a change. */
  weak: boolean;
}

/** Every reference in a text that resolves to something, in order of appearance, each with the change it leads to.
 *  The last mention that is not weak is what a prompt is about. Never writes. */
export function findReferences(loaded: Loaded, text: string, opts: GetOpts = {}): Reference[] {
  // bare slugs: changes still in play (a dropped change is reached by its full key only)
  const slugs = [...new Set(loaded.records.filter((r) => r.type === 'change' && r.data.status !== 'dropped').map((r) => r.changeSlug!))];
  const tracker = trackerOf(loaded, opts.project);
  const out: Reference[] = [];
  for (const m of mentions(text, slugs)) {
    const last = out[out.length - 1];
    if (last && m.at < last.at + last.text.length) continue; // inside a span already accepted
    const resolution = resolveRef(loaded, m.shape === 'slug' ? m.text.toLowerCase() : m.text, opts);
    if (resolution.status === 'none' || !resolution.key) continue;
    const key = resolution.key;
    let change: string | undefined;
    if (key.startsWith('change:')) change = key;
    else {
      const n = get(loaded, key, opts);
      change = n.changes[0]?.change.key;
    }
    const kind = key.slice(0, key.indexOf(':'));
    if (!change && kind === 'branch') {
      // no record links the branch yet: the name itself says which change it was cut for
      const r = resolveRef(loaded, `change:${slugFor('branch', key.slice('branch:'.length))}`, opts);
      if ((r.status === 'record' || r.status === 'alias') && r.key?.startsWith('change:')) change = r.key;
    }
    const weak = !!m.weak;
    out.push({ text: m.text, at: m.at, shape: m.shape, resolution, key, change, creatable: !weak && !change && resolution.status === 'key' && kind === tracker, weak });
  }
  return out;
}

export function formatReferences(refs: Reference[]): string {
  if (!refs.length) return 'no references';
  return refs.map((r) => `${r.text} → ${r.key} (${r.shape}${r.resolution.status === 'key' ? ', no record' : ''}${r.weak ? ', bare: never binds' : ''})${r.change ? ` · ${r.change}` : r.creatable ? ' · no change yet: ask the tracker' : ''}`).join('\n');
}
