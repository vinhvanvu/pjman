import fs from 'node:fs';
import type { Store } from '../config.js';
import { replaceSection } from '../frontmatter.js';
import { loadStore, resolve, unresolved, type RecordType } from '../records.js';
import { markSuperseded, resolveSupersedes, supersedesOf, unmark, type Marked } from '../supersede.js';
import { CliError } from '../util.js';
import { envelope, finishWrite, fullKeys, render, validateOrUndo } from '../write.js';

/** Authored fields a person may set through the tool, per record type. Body sections are set by their heading, lower-cased. */
const SETTABLE: Record<RecordType, string[]> = {
  product: ['title', 'name', 'owners', 'levels', 'sequence', 'links', 'summary'],
  feature: ['title', 'name', 'status', 'level', 'product', 'parent', 'owners', 'links', 'summary'],
  project: ['title', 'product', 'parent', 'tracker', 'map', 'owners', 'links'],
  change: ['title', 'status', 'kind', 'severity', 'project', 'parent', 'depends_on', 'features', 'owners', 'target', 'next', 'binds', 'links', 'summary', 'plan'],
  decision: ['title', 'status', 'decided_by', 'decided_on', 'supersedes', 'links', 'decision', 'why'],
  source: ['title', 'url', 'links'],
  actor: ['name', 'url', 'links'],
  session: [],
};
const LISTS = new Set(['binds', 'links', 'owners', 'features', 'levels', 'depends_on', 'sequence']);
const SECTIONS: Record<string, string> = { summary: 'Summary', plan: 'Plan', decision: 'Decision', why: 'Why' };

export interface SetResult {
  key: string;
  path: string;
  changed: string[];
  commit: string | null;
  /** What else the write did, one line each: a decision marked superseded. */
  notes: string[];
}

/** `field=value` pairs; a list field takes comma-separated keys; an empty value removes the field. */
export function set(store: Store, keyRaw: string, pairs: string[], opts: { session?: string }): SetResult {
  const loaded = loadStore(store);
  const res = resolve(loaded, keyRaw);
  if (res.status !== 'ok' && res.status !== 'alias') {
    if (res.status === 'invalid') throw new CliError(`${res.rec.path} is invalid; fix it before setting fields`);
    throw new CliError(unresolved(res, keyRaw));
  }
  const rec = res.rec;
  const allowed = SETTABLE[rec.type];
  if (allowed.length === 0) throw new CliError(`a ${rec.type} is append-only; use \`pjman session log|bind|observe\``);
  const data: Record<string, unknown> = { ...rec.data };
  let body = rec.body;
  const changed: string[] = [];
  const env = envelope(opts);
  let marked: Marked | undefined;
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i <= 0) throw new CliError(`'${pair}' is not field=value`);
    const field = pair.slice(0, i);
    const value = pair.slice(i + 1);
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
    if (!allowed.includes(field)) throw new CliError(`'${field}' cannot be set on a ${rec.type} (${allowed.join(', ')}; ext.<owner>.<field> on any record)`);
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
    if (SECTIONS[field] && rec.type === 'decision' && rec.data.status !== 'proposed') throw new CliError(`a ${String(rec.data.status)} decision's text is fixed; open a new decision that supersedes it`);
    if (SECTIONS[field]) body = replaceSection(body, SECTIONS[field], value);
    else if (value === '') delete data[field];
    else data[field] = LISTS.has(field) ? value.split(',').map((s) => s.trim()).filter(Boolean) : value;
    if (value !== '') fullKeys(loaded, rec.type, data, field, rec.productSlug ?? null);
    changed.push(field);
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
  const commit = finishWrite(store, `pjman: set ${rec.key} ${changed.join(' ')}`, env.session, [{ op: 'set', key: rec.key, type: rec.type, path: rec.path, fields: changed, writer: env.writer }, ...(marked?.also ?? [])]);
  return { key: rec.key, path: rec.path, changed, commit, notes: marked?.notes ?? [] };
}
