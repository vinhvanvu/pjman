import fs from 'node:fs';
import type { Store } from '../config.js';
import { replaceSection } from '../frontmatter.js';
import { loadStore, resolve, type RecordType } from '../records.js';
import { CliError } from '../util.js';
import { commitIfStandalone, render, validateOrUndo } from '../write.js';

/** Authored fields a person may set through the tool, per record type. Body sections are set by their heading, lower-cased. */
const SETTABLE: Record<RecordType, string[]> = {
  project: ['title', 'tracker', 'links'],
  change: ['title', 'status', 'project', 'parent', 'next', 'binds', 'links', 'summary', 'plan'],
  decision: ['title', 'status', 'decided_by', 'decided_on', 'links', 'decision', 'why'],
  source: ['title', 'url', 'links'],
  actor: ['name', 'url'],
  session: [],
};
const LISTS = new Set(['binds', 'links']);
const SECTIONS: Record<string, string> = { summary: 'Summary', plan: 'Plan', decision: 'Decision', why: 'Why' };

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
  let body = rec.body;
  const changed: string[] = [];
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i <= 0) throw new CliError(`'${pair}' is not field=value`);
    const field = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (!allowed.includes(field)) throw new CliError(`'${field}' cannot be set on a ${rec.type} (${allowed.join(', ')})`);
    if (SECTIONS[field] && rec.type === 'decision' && rec.data.status !== 'proposed') throw new CliError(`a ${String(rec.data.status)} decision's text is fixed; open a new decision that supersedes it`);
    if (SECTIONS[field]) body = replaceSection(body, SECTIONS[field], value);
    else if (value === '') delete data[field];
    else data[field] = LISTS.has(field) ? value.split(',').map((s) => s.trim()).filter(Boolean) : value;
    changed.push(field);
  }
  const text = render(rec.type, data, body);
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
