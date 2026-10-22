import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { canonicalSourceKey, canonicalUrl, parseKey, RECORD_KINDS, SLUG_RE } from './keys.js';
import { resolve, type Loaded, type Rec } from './records.js';
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
  const live = (raw: string): string => {
    const res = resolve(loaded, raw);
    return res.status === 'ok' || res.status === 'alias' ? res.rec.key : raw;
  };
  for (const r of loaded.records) {
    if (!r.valid) continue;
    const d = r.data;
    switch (r.type) {
      case 'project':
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'change':
        if (typeof d.project === 'string') edge('project', r.key, d.project, r);
        if (typeof d.parent === 'string') edge('parent', r.key, live(d.parent), r);
        for (const k of list(d.binds)) edge('binds', r.key, k, r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        break;
      case 'decision':
        if (typeof d.supersedes === 'string') edge('supersedes', r.key, live(d.supersedes), r);
        for (const k of list(d.links)) edge('links', r.key, k, r);
        if (r.changeSlug) edge('in', r.key, `change:${r.changeSlug}`, r);
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

const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** The source key a vendor URL names, when the tool knows the shape. */
export function keyFromUrl(u: string): string | null {
  let x: URL;
  try {
    x = new URL(u);
  } catch {
    return null;
  }
  const host = x.hostname.toLowerCase();
  const seg = x.pathname.split('/').filter(Boolean);
  if (host === 'linear.app' && seg[1] === 'issue' && seg[2] && TICKET_ID.test(seg[2])) return `linear:${seg[2]}`;
  if (host === 'github.com' && seg.length >= 2) {
    const repo = `${seg[0]}/${seg[1].replace(/\.git$/, '')}`;
    if (seg[2] === 'pull' && /^\d+$/.test(seg[3] ?? '')) return `github-pr:${repo}#${seg[3]}`;
    if (seg[2] === 'issues' && /^\d+$/.test(seg[3] ?? '')) return `github-issue:${repo}#${seg[3]}`;
    if (seg.length === 2) return `git-repo:${repo}`;
  }
  return null;
}

function trackerOf(loaded: Loaded, project?: string): string | undefined {
  if (!project) return undefined;
  const rec = loaded.byKey.get(project)?.[0];
  return rec && typeof rec.data.tracker === 'string' ? rec.data.tracker : undefined;
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
  if (TICKET_ID.test(ref)) {
    tried.push(`ticket id in ${kinds.join(', ')}`);
    for (const kind of kinds) {
      const key = `${kind}:${ref}`;
      if (loaded.byKey.has(key) || referenced(key)) return sourceKey(key, 'ticket id');
    }
    const tracker = trackerOf(loaded, opts.project);
    if (tracker) return { status: 'key', key: `${tracker}:${ref}`, shape: 'ticket id', tried };
    tried.push(`ticket id through the project's tracker (${opts.project ? `${opts.project} names none` : 'no current project'})`);
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
    if (p.kind === 'decision') {
      const i = p.rest.indexOf('/');
      return i > 0 ? `change:${p.rest.slice(0, i)}` : null;
    }
    return null;
  };
  const add = (k: string, how: string) => {
    if (loaded.byKey.get(k)?.[0]?.valid && !reach.has(k)) reach.set(k, how);
  };
  if (rec?.type === 'change') add(key, 'self');
  else if (rec?.type === 'decision' && rec.changeSlug) add(`change:${rec.changeSlug}`, 'in');
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
