import fs from 'node:fs';
import type { Store } from '../config.js';
import { findSession, fullKey, loadStore, resolve, unresolved } from '../records.js';
import { CliError, nowIso } from '../util.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo } from '../write.js';
import { EDGES } from '../validate.js';
import { readEvents } from '../events.js';

function load(store: Store, id: string) {
  const loaded = loadStore(store);
  const rec = findSession(loaded, id.startsWith('session:') ? id.slice(8) : id);
  if (!rec) throw new CliError(`session:${id} does not exist; create it with \`pjman new session ${id} --agent … --on-behalf-of …\``);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before appending`);
  return { loaded, rec };
}

type SaveOp = 'log' | 'bind' | 'observe' | 'unbind' | 'focus' | 'briefed';

function save(store: Store, rec: ReturnType<typeof load>['rec'], data: Record<string, unknown>, body: string, message: string, op: SaveOp): string | null {
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(rec.abs, render('session', data, body));
  validateOrUndo(store, [rec.path], [], prior);
  const fields = { log: ['log'], bind: ['changes'], observe: ['observed'], unbind: ['changes', 'observed', 'log'], focus: ['focus'], briefed: ['briefed'] }[op];
  const evOp = op === 'unbind' || op === 'focus' || op === 'briefed' ? 'set' : op;
  return finishWrite(store, message, rec.key, [{ op: evOp, key: rec.key, type: 'session', path: rec.path, fields, writer: envelope({}).writer }]);
}

const withLogLine = (rec: ReturnType<typeof load>['rec'], text: string): string => {
  let body = rec.body.replace(/\s+$/, '');
  if (!rec.sections.has('Log')) body += `${body ? '\n\n' : ''}## Log`;
  return `${body}\n- ${nowIso()} — ${text.trim()}\n`;
};

/** Append one line to `## Log`. */
export function sessionLog(store: Store, id: string, text: string): { path: string; commit: string | null } {
  const { rec } = load(store, id);
  const commit = save(store, rec, rec.data, withLogLine(rec, text), `pjman: session log ${rec.key}`, 'log');
  return { path: rec.path, commit };
}

/** Why a session was bound: the person's prompt named it, the session created it, its branch was cut for it, or a
 *  person or agent bound it by hand. Every bind says which, as a line in `## Log`. */
export type BindReason = 'prompt' | 'created' | 'branch' | 'by hand';

/** Append a change key to `changes`, in order, once; the reason is a line in `## Log`. */
export function sessionBind(store: Store, id: string, changeKey: string, reason: BindReason = 'by hand'): { path: string; commit: string | null; added: boolean } {
  const { loaded, rec } = load(store, id);
  const raw = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(unresolved(res, raw));
  const key = res.rec.key; // the full key is what the record holds
  const changes = Array.isArray(rec.data.changes) ? [...(rec.data.changes as string[])] : [];
  if (changes.includes(key)) return { path: rec.path, commit: null, added: false };
  changes.push(key);
  const commit = save(store, rec, { ...rec.data, changes }, withLogLine(rec, `bound ${key} (${reason})`), `pjman: session bind ${rec.key} ${key}`, 'bind');
  return { path: rec.path, commit, added: true };
}

/** The change the session is looking at: set when it reads a change's context. Written only when it moves. */
export function sessionFocus(store: Store, id: string, changeKey: string): { path: string; commit: string | null; moved: boolean } {
  const { loaded, rec } = load(store, id);
  const raw = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(unresolved(res, raw));
  const key = res.rec.key;
  // unmoved only when the last read was this change and nothing the session did since (a write, a bind) moved it away
  const prior = rec.data.focus as { change?: string; at?: string } | undefined;
  const moved = readEvents(store).some((e) => e.session === rec.key && e.op !== 'log' && !(e.key === rec.key && e.op === 'set') && (!prior?.at || e.at > prior.at));
  if (prior?.change === key && !moved) return { path: rec.path, commit: null, moved: false };
  const commit = save(store, rec, { ...rec.data, focus: { change: key, at: nowIso() } }, rec.body, `pjman: session focus ${rec.key} ${key}`, 'focus');
  return { path: rec.path, commit, moved: true };
}

/** The watermark: the change the last brief was for (none when it carried only notes to an unbound session) and the
 *  stream position it reached. */
export function sessionBriefed(store: Store, id: string, mark: { change?: string; seq: number; at: string }): { path: string; commit: string | null } {
  const { rec } = load(store, id);
  const briefed = mark.change ? { change: mark.change, seq: mark.seq, at: mark.at } : { seq: mark.seq, at: mark.at };
  const commit = save(store, rec, { ...rec.data, briefed }, rec.body, `pjman: session briefed ${rec.key}${mark.change ? ` ${mark.change}` : ''}`, 'briefed');
  return { path: rec.path, commit };
}

/** Back out a binding made in error: the change leaves `changes`, the edges observed on it go with it, and the
 *  unbinding is a line in `## Log`, so the session still says it happened. One commit. */
export function sessionUnbind(store: Store, id: string, changeKey: string): { path: string; commit: string | null; dropped: number } {
  const { loaded, rec } = load(store, id);
  const raw = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const res = resolve(loaded, raw);
  const key = res.status === 'ok' || res.status === 'alias' ? res.rec.key : fullKey(loaded, raw); // a removed change can still be unbound
  const changes = Array.isArray(rec.data.changes) ? (rec.data.changes as string[]) : [];
  if (!changes.includes(key)) throw new CliError(`${rec.key} is not bound to ${key}`);
  const observed = Array.isArray(rec.data.observed) ? (rec.data.observed as { from?: string; to?: string }[]) : [];
  const kept = observed.filter((o) => o.from !== key && o.to !== key);
  const data: Record<string, unknown> = { ...rec.data, changes: changes.filter((c) => c !== key), observed: kept };
  if (!kept.length) delete data.observed;
  const dropped = observed.length - kept.length;
  const line = `unbound ${key}${dropped ? `; dropped ${dropped} edge${dropped === 1 ? '' : 's'} observed on it` : ''}`;
  const commit = save(store, rec, data, withLogLine(rec, line), `pjman: session unbind ${rec.key} ${key}`, 'unbind');
  return { path: rec.path, commit, dropped };
}

/** Append an observed edge `{edge, from, to, at}`. */
export function sessionObserve(store: Store, id: string, edge: string, from: string, to: string): { path: string; commit: string | null } {
  if (!EDGES[edge]) throw new CliError(`'${edge}' is not an edge (${Object.keys(EDGES).join(', ')})`);
  const { loaded, rec } = load(store, id);
  // the record holds full keys; a source key stays as written
  const observed = Array.isArray(rec.data.observed) ? [...(rec.data.observed as unknown[])] : [];
  observed.push({ edge, from: fullKey(loaded, from), to: fullKey(loaded, to), at: nowIso() });
  const commit = save(store, rec, { ...rec.data, observed }, rec.body, `pjman: session observe ${rec.key} ${edge} ${from} ${to}`, 'observe');
  return { path: rec.path, commit };
}
