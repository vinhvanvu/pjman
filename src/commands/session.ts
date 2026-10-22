import fs from 'node:fs';
import type { Store } from '../config.js';
import { findSession, loadStore } from '../records.js';
import { CliError, nowIso } from '../util.js';
import { envelope, finishWrite, render, validateOrUndo } from '../write.js';
import { EDGES } from '../validate.js';

function load(store: Store, id: string) {
  const loaded = loadStore(store);
  const rec = findSession(loaded, id.startsWith('session:') ? id.slice(8) : id);
  if (!rec) throw new CliError(`session:${id} does not exist; create it with \`pjman new session ${id} --agent … --on-behalf-of …\``);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before appending`);
  return { loaded, rec };
}

function save(store: Store, rec: ReturnType<typeof load>['rec'], data: Record<string, unknown>, body: string, message: string, op: 'log' | 'bind' | 'observe'): string | null {
  fs.writeFileSync(rec.abs, render('session', data, body));
  validateOrUndo(store, [rec.path], []);
  const fields = { log: ['log'], bind: ['changes'], observe: ['observed'] }[op];
  return finishWrite(store, message, rec.key, [{ op, key: rec.key, type: 'session', path: rec.path, fields, writer: envelope({}).writer }]);
}

/** Append one line to `## Log`. */
export function sessionLog(store: Store, id: string, text: string): { path: string; commit: string | null } {
  const { rec } = load(store, id);
  let body = rec.body.replace(/\s+$/, '');
  if (!rec.sections.has('Log')) body += `${body ? '\n\n' : ''}## Log`;
  body += `\n- ${nowIso()} — ${text.trim()}`;
  const commit = save(store, rec, rec.data, body + '\n', `pjman: session log ${rec.key}`, 'log');
  return { path: rec.path, commit };
}

/** Append a change key to `changes`, in order, once. */
export function sessionBind(store: Store, id: string, changeKey: string): { path: string; commit: string | null; added: boolean } {
  const { rec } = load(store, id);
  const key = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const changes = Array.isArray(rec.data.changes) ? [...(rec.data.changes as string[])] : [];
  if (changes.includes(key)) return { path: rec.path, commit: null, added: false };
  changes.push(key);
  const commit = save(store, rec, { ...rec.data, changes }, rec.body, `pjman: session bind ${rec.key} ${key}`, 'bind');
  return { path: rec.path, commit, added: true };
}

/** Append an observed edge `{edge, from, to, at}`. */
export function sessionObserve(store: Store, id: string, edge: string, from: string, to: string): { path: string; commit: string | null } {
  if (!EDGES[edge]) throw new CliError(`'${edge}' is not an edge (${Object.keys(EDGES).join(', ')})`);
  const { rec } = load(store, id);
  const observed = Array.isArray(rec.data.observed) ? [...(rec.data.observed as unknown[])] : [];
  observed.push({ edge, from, to, at: nowIso() });
  const commit = save(store, rec, { ...rec.data, observed }, rec.body, `pjman: session observe ${rec.key} ${edge} ${from} ${to}`, 'observe');
  return { path: rec.path, commit };
}
