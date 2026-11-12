import fs from 'node:fs';
import type { Store } from '../store/config.js';
import { replaceSection, sections as parseSections } from '../store/frontmatter.js';
import { loadStore, resolve, unresolvedError, type RecordType } from '../store/records.js';
import { markSuperseded, resolveSupersedes, supersedesOf, unmark, type Marked } from '../model/supersede.js';
import { CliError, usageError } from '../store/util.js';
import { fieldKind, typedRef } from '../store/keys.js';
import { reachOfBase } from '../model/aspects.js';
import { CHANGE_FOUNDATION, foundationHash, foundationOf, gistProblem, nameProblem, SECTION_FIELDS } from '../model/foundation.js';
import { envelope, finishWrite, fullKeys, render, validateOrUndo } from './write.js';

/** Authored fields a person may set through the tool, per record type. Body sections are set by their heading, lower-cased. */
const SETTABLE: Record<RecordType, string[]> = {
  product: ['title', 'name', 'owners', 'levels', 'sequence', 'links', 'summary'],
  feature: ['title', 'name', 'status', 'level', 'product', 'parent', 'owners', 'links', 'summary'],
  aspect: ['title', 'name', 'parent', 'owners', 'links', 'body'],
  place: ['feature', 'links', 'body'],
  project: ['title', 'product', 'parent', 'tracker', 'map', 'holds', 'owners', 'links'],
  // a change's rungs, its fields and its sections; the plan is written with pjman step
  change: ['name', 'gist', 'status', 'kind', 'severity', 'project', 'parent', 'depends_on', 'features', 'aspects', 'owners', 'target', 'binds', 'links', ...Object.keys(SECTION_FIELDS)],
  // a decision's rungs and links; its thread, status and decider are written with pjman decision
  decision: ['name', 'gist', 'supersedes', 'links'],
  // a release's version, tag, level, instant, commit and what it ships are facts of the release; its URL and links may follow
  release: ['url', 'links'],
  source: ['title', 'url', 'links'],
  actor: ['name', 'url', 'links'],
  session: [],
  'session-kind': ['name', 'gist', 'links'],
};
const LISTS = new Set(['binds', 'links', 'owners', 'features', 'aspects', 'levels', 'depends_on', 'sequence']);
const SECTIONS: Record<string, string> = { summary: 'Summary', ...SECTION_FIELDS };
/** What was a field once, and where its job went. */
const RETIRED: Record<string, string> = {
  title: 'a change or a decision has no title: set name= (one to four words) and gist= (one line)',
  summary: "a change has no summary: its Intent opens with the need (intent=…), and its gist is the line views show (gist=…)",
  next: 'next is retired: the next step is the plan\'s first open step (pjman step <change> add "…"), an outside blocker is blocked-on=…, a blocking change is depends_on',
  plan: 'the plan is steps as data: pjman step <change> add|start|done|drop|note|move|reopen',
  status: 'a decision\'s status follows its thread: pjman decision <key> --accept <option> --by person:<handle>, or --reopen',
  decided_by: 'a decision\'s decider follows its thread: pjman decision <key> --accept <option> --by person:<handle>',
  decided_on: 'a decision\'s date follows its thread: pjman decision <key> --accept <option> --by person:<handle>',
  decision: 'a decision\'s text is its thread: pjman decision <key> --question "…" --option <id>="…" --recommend <id>="…"',
  why: 'a decision\'s reasoning is on its options: pjman decision <key> --recommend <id>="…" or --case <id>="…"',
  thread: 'the thread is append-only, written with pjman decision',
};

export interface SetResult {
  key: string;
  path: string;
  changed: string[];
  commit: string | null;
  /** What else the write did, one line each: a decision marked superseded; the rungs now stale. */
  notes: string[];
}

/** `field=value` pairs; a list field takes comma-separated keys; an empty value removes the field. On a list,
 *  `field+=item` adds each item not there and `field-=item` takes each out (decision interface-audit/list-field-edits):
 *  one item changes without the read-then-replace that loses an item another writer added between the two. */
export function set(store: Store, keyRaw: string, pairs: string[], opts: { session?: string; because?: string }): SetResult {
  const loaded = loadStore(store);
  const res = resolve(loaded, keyRaw);
  if (res.status !== 'ok' && res.status !== 'alias') {
    if (res.status === 'invalid') throw new CliError(`${res.rec.path} is invalid; fix it before setting fields`);
    throw unresolvedError(res, keyRaw);
  }
  const rec = res.rec;
  const allowed = SETTABLE[rec.type];
  if (allowed.length === 0) throw new CliError(`a ${rec.type} is append-only; use \`pjman session log|bind|observe\``);
  const data: Record<string, unknown> = { ...rec.data };
  let body = rec.body;
  const changed: string[] = [];
  const env = envelope(opts);
  let marked: Marked | undefined;
  const notes: string[] = [];
  for (const pair of pairs) {
    const m = /^([a-z_][a-z0-9_.-]*?)([+-])?=([\s\S]*)$/.exec(pair);
    if (!m) throw usageError(`'${pair}' is not field=value, field+=item or field-=item`);
    const [, field, op, value] = m as unknown as [string, string, '+' | '-' | undefined, string];
    if (op) {
      if (!allowed.includes(field) || !LISTS.has(field)) throw usageError(`${field}${op}= takes a list field of a ${rec.type} (${allowed.filter((f) => LISTS.has(f)).join(', ') || 'it has none'}); ${field}=… replaces`);
      const kind = fieldKind(rec.type, field);
      const items = value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (kind ? typedRef(x, kind) : x));
      if (!items.length) throw usageError(`${field}${op}= needs an item`);
      // the items as the store writes them (full keys), so a short form finds its stored twin
      const given: Record<string, unknown> = { [field]: items };
      fullKeys(loaded, rec.type, given, field, rec.productSlug ?? null);
      const want = given[field] as string[];
      const cur = Array.isArray(data[field]) ? (data[field] as string[]) : [];
      const next = op === '+' ? [...cur, ...want.filter((x) => !cur.includes(x))] : cur.filter((x) => !want.includes(x));
      if (next.length === cur.length) {
        notes.push(op === '+' ? `${field} already holds ${want.join(', ')}` : `${field} holds none of ${want.join(', ')}`);
        continue;
      }
      if (next.length) data[field] = next;
      else delete data[field];
      changed.push(field);
      continue;
    }
    if (field.startsWith('ext.')) {
      const parts = field.split('.').slice(1);
      if (parts.length < 2 || parts.some((p) => !p)) throw new CliError(`'${field}' must be ext.<owner>.<field>`);
      const ext = (typeof data.ext === 'object' && data.ext && !Array.isArray(data.ext) ? { ...(data.ext as Record<string, unknown>) } : {}) as Record<string, unknown>;
      let cur = ext;
      for (const p of parts.slice(0, -1)) {
        const next = typeof cur[p] === 'object' && cur[p] && !Array.isArray(cur[p]) ? { ...(cur[p] as Record<string, unknown>) } : {};
        cur[p] = next;
        cur = next;
      }
      const last = parts[parts.length - 1];
      if (value === '') delete cur[last];
      else cur[last] = value;
      if (Object.keys(ext).length) data.ext = ext;
      else delete data.ext;
      changed.push(field);
      continue;
    }
    if (!allowed.includes(field)) {
      if ((rec.type === 'change' || rec.type === 'decision') && RETIRED[field]) throw new CliError(RETIRED[field]);
      throw new CliError(`'${field}' cannot be set on a ${rec.type} (${allowed.join(', ')}; ext.<owner>.<field> on any record)`);
    }
    if (field === 'project' && rec.type === 'change' && value) {
      // a change is keyed under its project's product: a project of another product means a move, not a field
      const project = loaded.byKey.get(value.startsWith('project:') ? value : `project:${value}`)?.[0];
      const product = project && typeof project.data.product === 'string' ? project.data.product : undefined;
      if (product && product !== `product:${rec.productSlug}`) throw new CliError(`${project!.key} belongs to ${product}; this change is keyed under product:${rec.productSlug}. Move it: pjman mv ${rec.key} change:${product.slice('product:'.length)}/${rec.changeSlug}`);
    }
    if (field === 'supersedes') {
      // a decision made later names the one it replaces: the list only grows, and each target is marked superseded
      // in this same commit, as creating with --supersedes does
      const keys = value.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length === 0) throw new CliError(`supersedes is never emptied: a superseded decision stays pointed at`);
      const scope = rec.productSlug ? `product:${rec.productSlug}` : null;
      const targets = resolveSupersedes(loaded, keys, scope, rec);
      const have = supersedesOf(data);
      const fresh = targets.filter((t) => !have.includes(t.key));
      if (fresh.length) {
        data.supersedes = [...have, ...fresh.map((t) => t.key)];
        marked = markSuperseded(fresh, env.writer as string | undefined);
        changed.push(field);
      }
      continue;
    }
    if ((rec.type === 'change' || rec.type === 'decision') && (field === 'name' || field === 'gist')) {
      if (value === '') throw new CliError(`${field} is a rung every ${rec.type} carries; rewrite it rather than remove it`);
      const p = field === 'name' ? nameProblem(value) : gistProblem(value);
      if (p) throw new CliError(`${field}: ${p}`);
    }
    // an aspect's body is its base and a place's its fork, whole and in no shape the store prescribes
    if (field === 'body') body = value.trim() ? value.trim() + '\n' : '';
    else if (SECTIONS[field]) body = replaceSection(body, SECTIONS[field], value);
    else if (value === '') delete data[field];
    else {
      // a slug alone names a record of the kind the field holds; a bare URL in links is a url: source
      const kind = fieldKind(rec.type, field);
      const typed = (x: string) => (kind ? typedRef(x, kind) : x);
      data[field] = LISTS.has(field) ? value.split(',').map((s) => s.trim()).filter(Boolean).map(typed) : typed(value);
    }
    if (value !== '' && field !== 'body') fullKeys(loaded, rec.type, data, field, rec.productSlug ?? null);
    changed.push(field);
  }
  if (!changed.length) return { key: rec.key, path: rec.path, changed, commit: null, notes };
  if (rec.type === 'change' || rec.type === 'decision') {
    // the rungs record the foundation they were written from (decision projections-stay-fresh): rewritten, they are
    // written from the foundation as it stands now; a foundation written without them leaves them stale, and says so.
    // A write through the tool is the record reviewed: the migrated mark drops
    const sections = parseSections(body);
    const hash = foundationHash(foundationOf(rec.type, data, sections));
    const rungsWritten = changed.includes('name') || changed.includes('gist');
    const foundationWritten = rec.type === 'change' && changed.some((f) => CHANGE_FOUNDATION.includes(SECTION_FIELDS[f]));
    if (rungsWritten || (foundationWritten && !data.rungs_from)) data.rungs_from = hash;
    else if (foundationWritten && data.rungs_from !== hash) notes.push(`the name and gist were written from an earlier ${rec.type === 'change' ? 'Origin, Intent and Done when' : 'thread'}: rewrite them (name=… gist=…) so they read from this one`);
    delete data.migrated;
  }
  const text = render(rec.type, data, body);
  const before = fs.readFileSync(rec.abs, 'utf8');
  fs.writeFileSync(rec.abs, text);
  try {
    validateOrUndo(store, [rec.path, ...(marked?.touched ?? [])], [], marked?.prior);
  } catch (e) {
    fs.writeFileSync(rec.abs, before);
    if (marked) unmark(store, marked);
    throw e;
  }
  // the value a set leaves in status, or that aside decided_by, rides on the event so a reader can say what the move was
  const moved = changed.find((f) => f === 'status' || f === 'decided_by');
  const value = moved && typeof data[moved] === 'string' ? (data[moved] as string) : undefined;
  const commit = finishWrite(store, `pjman: set ${rec.key} ${changed.join(' ')}${opts.because ? ` (${opts.because})` : ''}`, env.session, [{ op: 'set', key: rec.key, type: rec.type, path: rec.path, fields: changed, value, writer: env.writer }, ...(marked?.also ?? [])]);
  notes.push(...(marked?.notes ?? []));
  // a write to a base shows every place it reaches, so each fork is reconciled with it in the same pass
  if (rec.type === 'aspect' && changed.includes('body')) notes.push(...reachOfBase(loadStore(store), rec));
  return { key: rec.key, path: rec.path, changed, commit, notes };
}
