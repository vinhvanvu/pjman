// The shared half of every tracker sync: observed tickets in, sources and the changes that bind them out. pjman is the
// source of truth (decision record-foundation/pjman-is-the-source-of-truth): a ticket is one more source, linked in the
// change's Origin and never copied. Ingesting it creates the change when none binds it yet, with a draft gist from the
// ticket's title, its status as the ticket stood then, and nothing else; afterwards the sync writes the source record,
// the binding and the owners, never a name, a status or a parent onto a change that exists.
import path from 'node:path';
import { readUserConfig, type Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import { sourceFileSlug } from '../store/keys.js';
import { loadStore, type Rec } from '../store/records.js';
import { productOfProject } from '../ops/new.js';
import { personOf } from '../model/refs.js';
import { localDate, nowIso } from '../store/util.js';
import { finishWrite, render, validateOrUndo, writeFile } from '../ops/write.js';
import { newSession, originText } from '../ops/new.js';
import { sessionLog } from '../ops/session.js';
import { foundationHash, foundationOf, stepsOf } from '../model/foundation.js';
import { sections as parseSections } from '../store/frontmatter.js';

/** One observed ticket, already translated to pjman's terms by the tracker's module. */
export interface Ticket {
  /** The source key's rest: `APP-1`, `acme/app#12`. */
  id: string;
  /** The change slug it binds: `app-1`, `app-12`. */
  slug: string;
  title: string;
  url?: string;
  /** Canonical status. */
  status: string;
  /** What was observed, kept under ext.<owner> on the source. */
  observed: Record<string, unknown>;
  /** The parent ticket's id, when the tracker has one. */
  parent?: string;
  /** `bug` when the tracker's own issue type or label says so; the sync never sets the feature or the severity. */
  kind?: 'bug';
  /** The accounts assigned on the tracker (`github-user:<login>`): each resolves to the person who claims it, or is left. */
  assignees?: string[];
}

export interface ApplyOpts {
  project: Rec;
  /** The source kind: `linear`, `github-issue`. */
  kind: string;
  /** The ext owner on the source record: `linear`, `github`. */
  owner: string;
  writer: string;
  tickets: Ticket[];
  session?: string;
  /** A short name for the commit message and the log line: `linear APP`, `github acme/app`. */
  label: string;
}

export interface SyncResult {
  project: string;
  team?: string;
  issues: number;
  created: string[];
  updated: string[];
  unchanged: string[];
  skipped: { id: string; reason: string }[];
  commit: string | null;
  session?: string;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

export function applyTickets(store: Store, opts: ApplyOpts): SyncResult {
  const { project, kind, owner, writer, tickets } = opts;
  const result: SyncResult = { project: project.key, issues: tickets.length, created: [], updated: [], unchanged: [], skipped: [], commit: null };
  if (!tickets.length) return result;

  const actor = readUserConfig().actor;
  let session = opts.session;
  if (!session && actor) {
    const id = `${owner}-sync-${nowIso().replace(/[:.]/g, '-')}`;
    // run from a session (a hook reading a ticket the prompt named), the sync is that session's child: its writes are
    // on that session's receipt
    const within = process.env.PJMAN_SESSION;
    const parent = within && loadStore(store).byKey.has(within) ? within : undefined;
    newSession(store, id, { agent: writer, onBehalfOf: actor, writer, parent });
    session = `session:${id}`;
  }
  const stamp = { writer, session, created: localDate() };
  const events: EventInput[] = [];
  const touched: string[] = [];
  let loaded = loadStore(store);
  const { product } = productOfProject(loaded, project.key);

  const byBind = new Map<string, Rec>();
  for (const r of loaded.records) if (r.type === 'change' && Array.isArray(r.data.binds)) for (const k of r.data.binds as unknown[]) if (typeof k === 'string') byBind.set(k, r);

  const write = (rec: Rec | undefined, type: 'source' | 'change', rel: string, key: string, data: Record<string, unknown>, body: string, fields: string[]) => {
    const text = render(type, data, body);
    if (rec && render(type, rec.data, rec.body) === text) {
      if (type === 'change') result.unchanged.push(key);
      return;
    }
    writeFile(store, rel, text);
    touched.push(rel);
    events.push(rec ? { op: 'set', key, type, path: rel, fields, writer, session } : { op: 'created', key, type, path: rel, writer, session });
    if (type === 'change') (rec ? result.updated : result.created).push(key);
  };

  // pass 1: sources and changes, without parents
  const changeOf = new Map<string, string>();
  for (const t of tickets) {
    const sourceKey = `${kind}:${t.id}`;
    const srcRel = path.join('sources', kind, `${sourceFileSlug(kind, t.id)}.md`);
    const src = loaded.byKey.get(sourceKey)?.[0];
    const observed = { ...t.observed, synced_at: nowIso() };
    const prev = obj(obj(src?.data.ext)?.[owner]);
    const same = src && prev && Object.keys(t.observed).every((k) => JSON.stringify(prev[k] ?? null) === JSON.stringify(t.observed[k] ?? null)) && src.data.title === t.title && (t.url ?? src.data.url) === src.data.url;
    if (!same) {
      const srcData: Record<string, unknown> = {
        ...(src?.data ?? {}), kind, key: t.id, title: t.title, url: t.url ?? src?.data.url,
        ...(src ? {} : stamp), ext: { ...(obj(src?.data.ext) ?? {}), [owner]: observed },
      };
      write(src, 'source', srcRel, sourceKey, srcData, src?.body ?? '', ['title', 'url', 'ext']);
    }
    const existing = byBind.get(sourceKey) ?? loaded.byKey.get(`change:${product}/${t.slug}`)?.[0];
    const changeKey = existing?.key ?? `change:${product}/${t.slug}`;
    changeOf.set(t.id, changeKey);
    const rel = existing?.path ?? path.join('products', product, 'changes', t.slug, 'change.md');
    // assignees the store knows become owners; an account no person claims is left alone, never matched by name
    const owners = (t.assignees ?? []).map((a) => personOf(loaded, a)).filter((p): p is string => !!p);
    if (existing) {
      const binds = Array.isArray(existing.data.binds) ? (existing.data.binds as string[]) : [];
      const had = Array.isArray(existing.data.owners) ? (existing.data.owners as string[]) : [];
      const merged = [...had, ...owners.filter((o) => !had.includes(o))];
      write(existing, 'change', rel, changeKey, { ...existing.data, kind: existing.data.kind ?? t.kind, owners: merged.length ? merged : undefined, binds: binds.includes(sourceKey) ? binds : [...binds, sourceKey] }, existing.body, ['kind', 'owners', 'binds']);
    } else {
      // the gist is a draft from the ticket's title; the name, intent and done-when are written by whoever first works it
      const gist = t.title.replace(/\s+/g, ' ').trim();
      const body = `## Origin\n\n${originText(sourceKey, { session }, stamp.created)}\n`;
      const data = { gist, status: t.status, kind: t.kind, project: project.key, owners: owners.length ? owners : undefined, binds: [sourceKey], rungs_from: foundationHash(foundationOf('change', {}, parseSections(body))), ...stamp };
      write(undefined, 'change', rel, changeKey, data, body, []);
    }
  }
  if (touched.length) validateOrUndo(store, touched, events.filter((e) => e.op === 'created').map((e) => e.path));

  // pass 2: parents on the changes this sync created, where the parent change exists; a change that exists keeps its own
  loaded = loadStore(store);
  for (const t of tickets) {
    if (!t.parent) continue;
    const key = changeOf.get(t.id)!;
    if (!result.created.includes(key)) continue;
    const rec = loaded.byKey.get(key)?.[0];
    const parentKey = changeOf.get(t.parent) ?? byBind.get(`${kind}:${t.parent}`)?.key;
    if (!rec || !parentKey || rec.data.parent === parentKey) {
      if (rec && !parentKey) result.skipped.push({ id: t.id, reason: `parent ${t.parent} is not in the store` });
      continue;
    }
    // a parent is a milestone by its kind (decision milestone-kind/kind-not-children): the parent change the ticket
    // names becomes one, unless it is a bug or carries steps of its own, in which case the parent is not written
    const parentRec = loaded.byKey.get(parentKey)?.[0];
    if (parentRec && parentRec.type === 'change' && parentRec.data.kind !== 'milestone') {
      const why = parentRec.data.kind === 'bug' ? 'is a bug' : stepsOf(parentRec.data).length ? 'carries steps of its own' : null;
      if (why) {
        result.skipped.push({ id: t.id, reason: `parent ${t.parent} (${parentKey}) ${why}, so it cannot be a milestone` });
        continue;
      }
      writeFile(store, parentRec.path, render('change', { ...parentRec.data, kind: 'milestone' }, parentRec.body));
      touched.push(parentRec.path);
      events.push({ op: 'set', key: parentKey, type: 'change', path: parentRec.path, fields: ['kind'], writer, session });
      if (!result.updated.includes(parentKey) && !result.created.includes(parentKey)) result.updated.push(parentKey);
      result.unchanged = result.unchanged.filter((k) => k !== parentKey);
    }
    writeFile(store, rec.path, render('change', { ...rec.data, parent: parentKey }, rec.body));
    touched.push(rec.path);
    events.push({ op: 'set', key, type: 'change', path: rec.path, fields: ['parent'], writer, session });
    if (!result.updated.includes(key) && !result.created.includes(key)) result.updated.push(key);
    result.unchanged = result.unchanged.filter((k) => k !== key);
  }
  if (touched.length) validateOrUndo(store, touched, []);

  result.commit = events.length ? finishWrite(store, `pjman: sync ${opts.label} (${tickets.length} issues)`, session, events) : null;
  if (session) sessionLog(store, session, `${opts.label}: ${tickets.length} issues; ${result.created.length} changes created, ${result.updated.length} updated, ${result.unchanged.length} unchanged`);
  result.session = session;
  return result;
}

/** The observed data: a path, `-` for stdin, inline JSON text, or the parsed value itself. */
export function readObserved(from: string | unknown): unknown {
  if (from === undefined) throw new Error("nothing to sync: pass --from <file> or --from - (the issues as JSON, as the tracker's tools answered)");
  if (typeof from !== 'string') return from;
  const trimmed = from.trim();
  const fs = require_fs();
  const text = trimmed.startsWith('{') || trimmed.startsWith('[') ? from : from === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(from, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${from === '-' ? 'stdin' : from} is not JSON`);
  }
}
import fsMod from 'node:fs';
function require_fs() {
  return fsMod;
}

/** The items inside a tool's answer: one object, an array, an object with a list field, or an MCP tool result with text content. */
export function itemsIn(data: unknown, isOne: (r: Record<string, unknown>) => boolean): unknown[] {
  if (typeof data === 'string') {
    try {
      return itemsIn(JSON.parse(data), isOne);
    } catch {
      return [];
    }
  }
  if (Array.isArray(data)) return data.flatMap((x) => itemsIn(x, isOne));
  const r = obj(data);
  if (!r) return [];
  if (isOne(r)) return [r];
  if (Array.isArray(r.content)) return (r.content as unknown[]).flatMap((c) => (obj(c)?.type === 'text' ? itemsIn(obj(c)!.text, isOne) : []));
  if (r.structuredContent !== undefined) return itemsIn(r.structuredContent, isOne);
  const list = (['issues', 'nodes', 'results', 'items', 'data'] as const).map((k) => r[k]).find(Array.isArray) ?? Object.values(r).find(Array.isArray);
  if (list) return itemsIn(list, isOne);
  // a wrapper with no list of its own (GraphQL: data.repository.issues.nodes): the first nested object that holds items
  for (const v of Object.values(r)) {
    if (!obj(v)) continue;
    const found = itemsIn(v, isOne);
    if (found.length) return found;
  }
  return [];
}

export { obj };
