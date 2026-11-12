// pjman rm: remove a record. Refused while anything else refers to it, naming each referrer; --detach drops the
// references that can be dropped (a key in a list, a parent, a superseded decision, an observed edge) in the same
// commit. A reference that is required (a change's project, a record's writer or session) always refuses. A change
// or a feature takes its folder.
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import { canon } from '../model/graph.js';
import { parseKey } from '../store/keys.js';
import { eventKeysOf, loadStore, resolve, unresolvedError, type Rec } from '../store/records.js';
import { CliError } from '../store/util.js';
import { envelope, errorsAt, finishWrite, render, settleIndex } from './write.js';
import { noteReshaping } from '../store/store-index.js';

export interface Detached {
  key: string;
  path: string;
  fields: string[];
}

export interface RmResult {
  key: string;
  /** Paths removed: the record, and for a change its decisions. */
  removed: string[];
  detached: Detached[];
  commit: string | null;
}

const LISTS = ['binds', 'links', 'changes', 'owners', 'features', 'aspects', 'depends_on', 'sequence', 'supersedes'];
const SINGLE = ['parent', 'supersedes']; // supersedes is one key or a list; each branch handles its shape

/** Drop `key` from the fields that may lose a reference. Returns the fields changed. */
function detach(data: Record<string, unknown>, keys: Set<string>): string[] {
  const changed: string[] = [];
  const is = (v: unknown): boolean =>
    typeof v === 'string' && (keys.has(canon(v)) || keys.has(canon(v.replace(/^(adds|changes|removes)\s+/, ''))));
  for (const f of LISTS) {
    if (!Array.isArray(data[f])) continue;
    const kept = (data[f] as unknown[]).filter((v) => !is(v));
    if (kept.length !== (data[f] as unknown[]).length) {
      if (kept.length) data[f] = kept;
      else delete data[f];
      changed.push(f);
    }
  }
  for (const f of SINGLE) {
    if (is(data[f])) {
      delete data[f];
      changed.push(f);
    }
  }
  if (Array.isArray(data.observed)) {
    const kept = (data.observed as unknown[]).filter(
      (o) =>
        !(
          o &&
          typeof o === 'object' &&
          (is((o as Record<string, unknown>).from) || is((o as Record<string, unknown>).to))
        ),
    );
    if (kept.length !== (data.observed as unknown[]).length) {
      if (kept.length) data.observed = kept;
      else delete data.observed;
      changed.push('observed');
    }
  }
  return changed;
}

/** Records outside the removed set whose data names one of the removed keys, with the fields that do. */
function referrers(records: Rec[], removedPaths: Set<string>, keys: Set<string>): { rec: Rec; fields: string[] }[] {
  const out: { rec: Rec; fields: string[] }[] = [];
  for (const r of records) {
    if (removedPaths.has(r.path) || !r.valid) continue;
    const fields: string[] = [];
    const walk = (v: unknown, field: string): void => {
      if (typeof v === 'string') {
        if (keys.has(canon(v)) || keys.has(canon(v.replace(/^(adds|changes|removes)\s+/, '')))) fields.push(field);
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, field));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, field === '' ? k : field);
    };
    for (const [k, v] of Object.entries(r.data)) walk(v, k);
    if (fields.length) out.push({ rec: r, fields: [...new Set(fields)] });
  }
  return out;
}

export function rm(
  store: Store,
  raw: string,
  opts: { detach?: boolean; session?: string; writer?: string } = {},
): RmResult {
  noteReshaping(store);
  const key = parseKey(raw);
  if (!key) throw new CliError(`'${raw}' is not a key (kind:rest)`);
  const loaded = loadStore(store);
  const res = resolve(loaded, key.raw);
  if (res.status !== 'ok' && res.status !== 'alias' && res.status !== 'invalid') throw unresolvedError(res, key.raw);
  const rec = res.rec;

  // what goes: a change takes its folder (decisions included), an aspect its places; anything else is one file
  const dir =
    rec.type === 'change' || rec.type === 'feature' || rec.type === 'product' || rec.type === 'aspect'
      ? path.dirname(rec.path)
      : null;
  const going = loaded.records.filter((r) => r.path === rec.path || (dir !== null && r.path.startsWith(dir + '/')));
  const removedPaths = new Set(going.map((r) => r.path));
  const keys = new Set<string>(going.flatMap((r) => eventKeysOf(r)));

  if (rec.type === 'project') {
    const members = loaded.records.filter((r) => r.type === 'change' && r.data.project === rec.key).map((r) => r.key);
    if (members.length)
      throw new CliError(`refused: ${rec.key} is the project of ${members.join(', ')}; move or remove them first`);
  }
  if (rec.type === 'product') {
    const members = loaded.records
      .filter(
        (r) =>
          (r.type !== 'product' && r.productSlug === rec.productSlug) ||
          (r.type === 'project' && r.data.product === rec.key),
      )
      .map((r) => r.key);
    if (members.length)
      throw new CliError(`refused: ${rec.key} is the product of ${members.join(', ')}; move or remove them first`);
  }
  const refs = referrers(loaded.records, removedPaths, keys);
  if (refs.length && !opts.detach) {
    const lines = refs.map((x) => `  ${x.rec.key}  ${x.fields.join(', ')}`);
    throw new CliError(
      `refused: ${rec.key} is referenced by\n${lines.join('\n')}\n--detach drops those references (a key in a list, a parent, a superseded decision, an observed edge); a change's project, a writer or a session cannot be dropped`,
    );
  }

  // remove, detach, validate what remains; undo everything on an error
  const before = new Map<string, string>();
  for (const r of going) before.set(r.path, fs.readFileSync(r.abs, 'utf8'));
  const undo = (): void => {
    for (const [rel, text] of before) {
      const abs = path.join(store.root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
    settleIndex(store, before.keys());
  };
  if (dir !== null) fs.rmSync(path.join(store.root, dir), { recursive: true, force: true });
  else fs.rmSync(rec.abs, { force: true });

  const detached: Detached[] = [];
  for (const { rec: r } of refs) {
    const data = JSON.parse(JSON.stringify(r.data)) as Record<string, unknown>;
    const fields = detach(data, keys);
    if (!fields.length) continue;
    before.set(r.path, fs.readFileSync(r.abs, 'utf8'));
    fs.writeFileSync(r.abs, render(r.type, data, r.body));
    detached.push({ key: r.key, path: r.path, fields });
  }
  const still = refs.filter(
    (x) =>
      !detached.some((d) => d.path === x.rec.path) ||
      x.fields.some((f) => !detached.find((d) => d.path === x.rec.path)!.fields.includes(f)),
  );
  const errors = errorsAt(store, [...refs.map((x) => x.rec.path)]);
  if (errors.length || still.length) {
    undo();
    const why = still.length
      ? still
          .map(
            (x) =>
              `  ${x.rec.key}  ${x.fields.filter((f) => !detached.find((d) => d.path === x.rec.path)?.fields.includes(f)).join(', ')}`,
          )
          .join('\n')
      : errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new CliError(`refused: ${rec.key} is still required by\n${why}`);
  }

  const env = envelope(opts);
  const events: EventInput[] = [
    ...going
      .sort((a, b) => (a.path === rec.path ? -1 : b.path === rec.path ? 1 : 0))
      .map((r) => ({ op: 'removed' as const, key: r.key, type: r.type, path: r.path, writer: env.writer })),
    ...detached.map((d) => ({
      op: 'set' as const,
      key: d.key,
      type: loaded.records.find((r) => r.path === d.path)!.type,
      path: d.path,
      fields: d.fields,
      writer: env.writer,
    })),
  ];
  const commit = finishWrite(store, `pjman: rm ${rec.key}`, env.session, events);
  return { key: rec.key, removed: [...removedPaths], detached, commit };
}
