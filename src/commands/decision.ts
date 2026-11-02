// pjman decision: one command writes a decision at any size (decisions record-foundation/one-decision-verb,
// changes-sectioned-decisions-threaded). A decision's foundation is a thread of typed entries, append-only: the
// question, the criteria, the options with their case, the recommendation with its reasoning, the person's comments in
// their words, rejections, the acceptance. The same call creates the record when it does not exist (then its name,
// gist, question and at least one option are required) and adds to it later; its status, decider and date are
// maintained from the thread in the same write, so every reader of those fields reads what the thread says.
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../config.js';
import type { EventInput } from '../events.js';
import { SLUG_RE } from '../keys.js';
import { loadStore, resolve, unresolved, type Loaded, type Rec } from '../records.js';
import { markSuperseded, resolveSupersedes, supersededBy, supersedesOf } from '../supersede.js';
import { CliError, isDateString, nowIso, today } from '../util.js';
import { envelope, finishWrite, fullKeys, render, snapshot, validateOrUndo, writeFile } from '../write.js';
import { dayOf, decisionState, foundationHash, foundationOf, gistProblem, nameProblem, threadOf, type DecisionState, type Entry } from '../foundation.js';
import { decisionHome } from './new.js';

/** An entry as the command takes it, before the tool stamps it. */
export type EntryInput = Omit<Entry, 'at'> & { at?: string };

export interface DecisionOpts {
  name?: string;
  gist?: string;
  /** The entries to append, in order. */
  entries: EntryInput[];
  supersedes?: string;
  links?: string[];
  /** The record's creation date when the call creates it. */
  created?: string;
  session?: string;
  writer?: string;
}

export interface DecisionResult {
  key: string;
  path: string;
  created: boolean;
  /** The entries appended, by type. */
  appended: string[];
  status: string;
  state: DecisionState;
  commit: string | null;
  notes: string[];
}

/** `<id>=<text>` as the flags take an option, a case, a recommendation, a rejection or an acceptance; a bare `<id>`
 *  when the text is optional. */
export function idText(raw: string, what: string, textRequired: boolean): { id: string; text?: string } {
  const i = raw.indexOf('=');
  const id = (i < 0 ? raw : raw.slice(0, i)).trim();
  const text = i < 0 ? undefined : raw.slice(i + 1).trim();
  if (!SLUG_RE.test(id)) throw new CliError(`${what}: '${id}' is not an option id (a slug)`);
  if (textRequired && !text) throw new CliError(`${what}: ${id}=<text> needs its text`);
  return { id, text: text || undefined };
}

function writerOf(opts: { writer?: string; session?: string }): string | undefined {
  return envelope(opts).writer;
}

/** The entries from the command's flags, in the order a reader expects them: question, criteria, options and their
 *  case, comments, rejections, the recommendation, the acceptance, a reopening. */
export function entriesFromFlags(f: { question?: string; criterion?: string[]; option?: string[]; case?: string[]; recommend?: string; comment?: string; reject?: string[]; accept?: string; revisit?: string; reopen?: boolean; by?: string }, writer: string | undefined): EntryInput[] {
  const out: EntryInput[] = [];
  const by = f.by ?? writer;
  if (f.question?.trim()) out.push({ type: 'question', text: f.question.trim(), by: writer });
  for (const c of f.criterion ?? []) if (c.trim()) out.push({ type: 'criterion', text: c.trim(), by: writer });
  const cases = new Map<string, string>();
  for (const c of f.case ?? []) { const { id, text } = idText(c, '--case', true); cases.set(id, text!); }
  for (const o of f.option ?? []) {
    const { id, text } = idText(o, '--option', true);
    out.push({ type: 'option', id, text, case: cases.get(id), by: writer });
    cases.delete(id);
  }
  if (cases.size) throw new CliError(`--case names ${[...cases.keys()].join(', ')}, which --option does not define in this call; a case is written with its option`);
  if (f.comment?.trim()) out.push({ type: 'comment', text: f.comment.trim(), by });
  for (const r of f.reject ?? []) { const { id, text } = idText(r, '--reject', false); out.push({ type: 'reject', option: id, text, by: writer }); }
  if (f.recommend) { const { id, text } = idText(f.recommend, '--recommend', false); out.push({ type: 'recommendation', option: id, text, by: writer }); }
  if (f.accept) { const { id, text } = idText(f.accept, '--accept', false); out.push({ type: 'accept', option: id, text, by, revisit: f.revisit?.trim() || undefined }); }
  else if (f.revisit) throw new CliError('--revisit goes with --accept');
  if (f.reopen) out.push({ type: 'reopen', by, text: f.comment?.trim() || undefined });
  return out;
}

/** The entries from JSON on stdin: `{name, gist, entries: [{type, …}]}` or a bare list of entries. */
export function entriesFromJson(text: string, writer: string | undefined): { name?: string; gist?: string; entries: EntryInput[] } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new CliError('stdin is not JSON: {name, gist, entries: [{type, text, id, case, option, by, revisit}, …]}');
  }
  const o = Array.isArray(v) ? { entries: v } : (v as Record<string, unknown>);
  if (!o || typeof o !== 'object' || !Array.isArray(o.entries)) throw new CliError('the JSON needs an entries list');
  const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
  const entries: EntryInput[] = (o.entries as unknown[]).map((raw, i) => {
    const e = raw as Record<string, unknown>;
    if (!e || typeof e !== 'object' || typeof e.type !== 'string') throw new CliError(`entries[${i}] needs a type`);
    return { type: e.type as Entry['type'], text: str(e.text), id: str(e.id), case: str(e.case), option: str(e.option), by: str(e.by) ?? writer, revisit: str(e.revisit) };
  });
  return { name: str(o.name), gist: str(o.gist), entries };
}

function find(loaded: Loaded, ref: string): Rec | undefined {
  const raw = ref.startsWith('decision:') ? ref : `decision:${ref}`;
  const res = resolve(loaded, raw);
  if (res.status === 'ok' || res.status === 'alias') {
    if (res.rec.type !== 'decision') throw new CliError(`${res.rec.key} is not a decision`);
    if (!res.rec.valid) throw new CliError(`${res.rec.path} is invalid; fix it before writing to it`);
    return res.rec;
  }
  if (res.status === 'ambiguous') throw new CliError(unresolved(res, raw));
  return undefined;
}

/** Write a decision: created with its first entries, or added to. One commit; the status, decider and date follow
 *  the thread. */
export function decision(store: Store, ref: string, opts: DecisionOpts): DecisionResult {
  const loaded = loadStore(store);
  const env = envelope(opts);
  const existing = find(loaded, ref);
  const date = opts.created ?? today();
  if (!isDateString(date)) throw new CliError('--created must be a date (yyyy-mm-dd)');
  const home = existing ? undefined : decisionHome(loaded, ref, date);
  const key = existing?.key ?? home!.key;
  // a store-level decision has no product: its keys resolve store-wide
  const product = existing ? (existing.productSlug ?? null) : home!.product;
  if (!existing && fs.existsSync(path.join(store.root, home!.rel))) throw new CliError(`refused: ${home!.rel} already exists`);

  const data: Record<string, unknown> = existing ? { ...existing.data } : { status: 'proposed', writer: env.writer, session: env.session, created: date };
  const notes: string[] = [];
  const changed: string[] = [];
  if (opts.name !== undefined) {
    const p = nameProblem(opts.name);
    if (p) throw new CliError(`--name: ${p}`);
    data.name = opts.name.trim();
    changed.push('name');
  }
  if (opts.gist !== undefined) {
    const p = gistProblem(opts.gist);
    if (p) throw new CliError(`--gist: ${p}`);
    data.gist = opts.gist.trim();
    changed.push('gist');
  }
  if (opts.links?.length) {
    const have = Array.isArray(data.links) ? (data.links as string[]) : [];
    data.links = [...have, ...opts.links.filter((l) => !have.includes(l))];
    changed.push('links');
  }

  // the thread: what is there, then what this call appends, each entry checked against the thread so far
  const thread = threadOf(data);
  const before = decisionState(thread);
  const status = String(data.status);
  if (opts.entries.length && (status === 'superseded' || status === 'reverted')) throw new CliError(`${key} is ${status}; its thread is closed. Open a decision that supersedes it`);
  const at = nowIso();
  const appended: string[] = [];
  let state = before;
  for (const e of opts.entries) {
    const entry: Entry = { ...e, at: e.at ?? at, by: e.by ?? env.writer };
    if (!entry.text?.trim() && !['recommendation', 'reject', 'accept', 'reopen'].includes(entry.type)) throw new CliError(`a ${entry.type} needs its text`);
    const ids = new Set(state.options.map((o) => o.id));
    switch (entry.type) {
      case 'option':
        if (!entry.id || !SLUG_RE.test(entry.id)) throw new CliError(`an option needs an id (a slug): --option <id>="<text>"`);
        if (ids.has(entry.id)) notes.push(`${entry.id} restated; its earlier text and case stay in the thread`);
        break;
      case 'recommendation': case 'reject':
        if (!entry.option || !ids.has(entry.option)) throw new CliError(`${entry.type}: '${String(entry.option)}' is not an option of ${key} (${[...ids].join(', ') || 'none yet'})`);
        break;
      case 'accept': {
        if (!entry.option || !ids.has(entry.option)) throw new CliError(`accept: '${String(entry.option)}' is not an option of ${key} (${[...ids].join(', ') || 'none yet'})`);
        if (state.accepted) throw new CliError(`${key} is decided (${state.accepted.option}); --reopen first, or open a decision that supersedes it`);
        if (!entry.by?.startsWith('person:')) throw new CliError(`an acceptance is a person's: --by person:<handle>; ${entry.by ?? 'an agent'} is not the decider`);
        if (state.options.find((o) => o.id === entry.option)?.rejected !== undefined) notes.push(`${entry.option} had been rejected; accepted now`);
        break;
      }
      case 'reopen':
        if (!state.accepted) throw new CliError(`${key} is not decided; nothing to reopen`);
        if (supersededBy(loaded, key).length) throw new CliError(`${key} is superseded by ${supersededBy(loaded, key).map((r) => r.key).join(', ')}; reopen that instead`);
        break;
      default:
        break;
    }
    const clean: Entry = { type: entry.type, at: entry.at };
    if (entry.by) clean.by = entry.by;
    if (entry.text?.trim()) clean.text = entry.text.trim();
    if (entry.id) clean.id = entry.id;
    if (entry.case?.trim()) clean.case = entry.case.trim();
    if (entry.option) clean.option = entry.option;
    if (entry.revisit?.trim()) clean.revisit = entry.revisit.trim();
    thread.push(clean);
    appended.push(entry.type);
    state = decisionState(thread);
  }
  if (!existing) {
    const missing = [!data.name && '--name', !data.gist && '--gist', !state.question && '--question', !state.options.length && '--option <id>="…"'].filter(Boolean);
    if (missing.length) throw new CliError(`a new decision needs ${missing.join(', ')}`);
  }
  if (appended.length) {
    data.thread = thread.map((e) => ({ ...e }));
    changed.push('thread');
  }
  // the status, the decider and the date follow the thread
  if (status === 'proposed' || status === 'decided') {
    const next = state.accepted ? 'decided' : 'proposed';
    if (next !== status || (state.accepted && (data.decided_by !== state.accepted.by || !data.decided_on))) changed.push('status');
    data.status = next;
    if (state.accepted) {
      data.decided_by = state.accepted.by;
      data.decided_on = dayOf(state.accepted.at);
    } else {
      delete data.decided_by;
      delete data.decided_on;
    }
  }
  // the rungs: written here they read from the foundation as it stands now; a foundation written without them is said
  const hash = foundationHash(foundationOf('decision', data, new Map()));
  const foundationMoved = appended.some((t) => t === 'question' || t === 'recommendation' || t === 'accept' || t === 'reopen');
  if (changed.includes('name') || changed.includes('gist') || !existing || !data.rungs_from) data.rungs_from = hash;
  else if (foundationMoved && data.rungs_from !== hash) notes.push('the name and gist were written from an earlier thread: rewrite them (--name … --gist …) so they read from this one');
  delete data.migrated;

  // supersedes: the targets are marked in this same commit
  const touched: string[] = [];
  const also: EventInput[] = [];
  const prior = new Map<string, string>();
  if (opts.supersedes) {
    const keys = opts.supersedes.split(',').map((s) => s.trim()).filter(Boolean);
    const targets = resolveSupersedes(loaded, keys, product ? `product:${product}` : null, existing);
    const have = supersedesOf(data);
    const fresh = targets.filter((t) => !have.includes(t.key));
    if (fresh.length) {
      data.supersedes = [...have, ...fresh.map((t) => t.key)];
      const m = markSuperseded(fresh, env.writer);
      touched.push(...m.touched);
      also.push(...m.also);
      notes.push(...m.notes);
      for (const [k, v] of m.prior) prior.set(k, v);
      changed.push('supersedes');
    }
  }
  if (existing && !changed.length) throw new CliError(`nothing to write to ${key}: give an entry (--question, --option, --recommend, --comment, --reject, --accept, --reopen), --name, --gist, --links or --supersedes`);
  fullKeys(loaded, 'decision', data, undefined, product);
  const rel = existing?.path ?? home!.rel;
  const snap = existing ? snapshot(store, [rel]) : new Map<string, string>();
  for (const [k, v] of snap) prior.set(k, v);
  writeFile(store, rel, render('decision', data, existing?.body ?? ''));
  validateOrUndo(store, [rel, ...touched], existing ? [] : [rel], prior);
  const subject = existing ? `pjman: decision ${key} ${[...new Set(appended)].join(' ') || changed.join(' ')}` : `pjman: new ${key}`;
  const event: EventInput = existing
    ? { op: 'set', key, type: 'decision', path: rel, fields: [...new Set(changed)], writer: env.writer }
    : { op: 'created', key, type: 'decision', path: rel, writer: env.writer };
  const commit = finishWrite(store, subject, env.session, [event, ...also]);
  return { key, path: rel, created: !existing, appended, status: String(data.status), state, commit, notes };
}

/** A proposed decision accepted by the person from the dashboard or `pjman decide`: the recommended option, else the
 *  only one; refused when the thread leaves the choice open. */
export function decide(store: Store, ref: string, opts: { by: string; option?: string; words?: string; session?: string }): DecisionResult {
  const loaded = loadStore(store);
  const rec = find(loaded, ref);
  if (!rec) throw new CliError(`${ref} does not resolve to a decision`);
  if (rec.data.status !== 'proposed') throw new CliError(`${rec.key} is ${String(rec.data.status)}, not proposed; only a proposed decision is decided`);
  const state = decisionState(threadOf(rec.data));
  const option = opts.option ?? state.recommendation?.option ?? (state.options.length === 1 ? state.options[0].id : undefined);
  if (!option) throw new CliError(`${rec.key} recommends nothing and has ${state.options.length} options (${state.options.map((o) => o.id).join(', ')}); name the one accepted: pjman decision ${rec.key} --accept <id> --by ${opts.by}`);
  return decision(store, rec.key, { entries: [{ type: 'accept', option, by: opts.by, text: opts.words }], session: opts.session, writer: writerOf(opts) });
}

/** Deciding's reverse: a decided decision reopened, the acceptance no longer in force. */
export function reopen(store: Store, ref: string, opts: { session?: string; writer?: string } = {}): DecisionResult {
  const loaded = loadStore(store);
  const rec = find(loaded, ref);
  if (!rec) throw new CliError(`${ref} does not resolve to a decision`);
  if (rec.data.status !== 'decided') throw new CliError(`${rec.key} is ${String(rec.data.status)}, not decided; only a decided decision is reopened`);
  return decision(store, rec.key, { entries: [{ type: 'reopen' }], session: opts.session, writer: opts.writer });
}
