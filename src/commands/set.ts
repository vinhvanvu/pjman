import fs from 'node:fs';
import type { Store } from '../config.js';
import { loadStore, resolve, type RecordType } from '../records.js';
import { CliError } from '../util.js';
import { commitIfStandalone, render, validateOrUndo } from '../write.js';

/** Authored scalar and list fields a person may set through the tool, per record type. */
const SETTABLE: Record<RecordType, string[]> = {
  change: ['title', 'status', 'next', 'binds', 'links'],
  decision: ['title', 'status', 'decided_by', 'decided_on', 'links'],
  source: ['title', 'url', 'links'],
  actor: ['name', 'url'],
  session: [],
};
const LISTS = new Set(['binds', 'links']);

export interface SetResult {
  key: string;
  path: string;
  changed: string[];
  commit: string | null;
}

/** `field=value` pairs; a list field takes comma-separated keys; an empty value removes the field. */
export function set(store: Store, keyRaw: string, pairs: string[], opts: { session?: string }): SetResult {
  const loaded = loadStore(store);
  const res = resolve(loaded, keyRaw);
  if (res.status !== 'ok' && res.status !== 'alias') {
    if (res.status === 'invalid') throw new CliError(`${res.rec.path} is invalid; fix it before setting fields`);
    throw new CliError(`${keyRaw} does not resolve to a record`);
  }
  const rec = res.rec;
  const allowed = SETTABLE[rec.type];
  if (allowed.length === 0) throw new CliError(`a ${rec.type} is append-only; use \`pjman session log|bind|observe\``);
  const data: Record<string, unknown> = { ...rec.data };
  const changed: string[] = [];
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i <= 0) throw new CliError(`'${pair}' is not field=value`);
    const field = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (!allowed.includes(field)) throw new CliError(`'${field}' cannot be set on a ${rec.type} (${allowed.join(', ')})`);
    if (value === '') delete data[field];
    else data[field] = LISTS.has(field) ? value.split(',').map((s) => s.trim()).filter(Boolean) : value;
    changed.push(field);
  }
  const text = render(rec.type, data, rec.body);
  const before = fs.readFileSync(rec.abs, 'utf8');
  fs.writeFileSync(rec.abs, text);
  try {
    validateOrUndo(store, [rec.path], []);
  } catch (e) {
    fs.writeFileSync(rec.abs, before);
    throw e;
  }
  const commit = commitIfStandalone(store, `pjman: set ${rec.key} ${changed.join(' ')}`, opts.session);
  return { key: rec.key, path: rec.path, changed, commit };
}
