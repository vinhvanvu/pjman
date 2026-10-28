// pjman mv: rename a product, a feature, a change, a decision, a project or a person. The file or folder moves, every
// reference in the store is rewritten in the same commit, and the old key stays as an alias (a product's old slug, a
// feature's or change's old slug, a person's old handle) so old links and old prose still resolve. A feature or a
// change may move to another product the same way. Sources and sessions are not renamed: their keys are external.
import fs from 'node:fs';
import path from 'node:path';
import { readUserConfig, writeUserConfig, type Store } from '../config.js';
import { gitMv, isTracked, toplevel } from '../git.js';
import { parseDecisionRest, parseKey, parseScopedRest, SLUG_RE } from '../keys.js';
import { loadStore, resolve, unresolved, type Loaded, type Rec, type RecordType } from '../records.js';
import { CliError } from '../util.js';
import { envelope, finishWrite, render, validateOrUndo } from '../write.js';

export interface MvResult {
  from: string;
  to: string;
  rewritten: string[];
  commit: string | null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrite one whole key wherever it appears: not inside a longer slug, not inside a longer path. */
export function rewriteKey(text: string, oldKey: string, newKey: string): string {
  return text.replace(new RegExp(`(^|[^A-Za-z0-9_/:-])${esc(oldKey)}(?![A-Za-z0-9_/-])`, 'g'), `$1${newKey}`);
}

/** Rewrite a key prefix (`decision:p/old/` → `decision:p/new/`, `feature:old/` → `feature:new/`) wherever it opens a key. */
function rewritePrefix(text: string, oldPrefix: string, newPrefix: string): string {
  return text.replace(new RegExp(`(^|[^A-Za-z0-9_/:-])${esc(oldPrefix)}`, 'g'), `$1${newPrefix}`);
}

function move(store: Store, fromRel: string, toRel: string): void {
  const inGit = toplevel(store.root) !== null && isTracked(store.root, fromRel);
  fs.mkdirSync(path.dirname(path.join(store.root, toRel)), { recursive: true });
  if (inGit) gitMv(store.root, fromRel, toRel);
  else fs.renameSync(path.join(store.root, fromRel), path.join(store.root, toRel));
}

/** Apply `rewrite` to every record's text (at its path after the move) and write back what changed. */
function rewriteAll(store: Store, loaded: Loaded, pathAfter: (rel: string) => string, rewrite: (text: string, r: Rec) => string): string[] {
  const rewritten: string[] = [];
  for (const r of loaded.records) {
    const rel = pathAfter(r.path);
    const abs = path.join(store.root, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const next = rewrite(text, r);
    if (next !== text) {
      fs.writeFileSync(abs, next);
      rewritten.push(rel);
    }
  }
  return rewritten;
}

function finish(store: Store, loaded: Loaded, from: string, to: string, type: RecordType, movedRel: string, rewritten: string[], pathAfter: (rel: string) => string, opts: { session?: string }, fields?: string[]): MvResult {
  validateOrUndo(store, [movedRel, ...rewritten], []);
  const env = envelope(opts);
  const recAt = (p: string) => loaded.records.find((r) => pathAfter(r.path) === p);
  const commit = finishWrite(store, `pjman: mv ${from} ${to}`, env.session, [
    { op: 'moved', key: to, type, path: movedRel, fields, writer: env.writer },
    ...rewritten.filter((p) => p !== movedRel).map((p) => ({ op: 'set' as const, key: recAt(p)?.key ?? p, type: recAt(p)?.type ?? type, path: p, fields: ['references'], writer: env.writer })),
  ]);
  return { from, to, rewritten, commit };
}

/** With the record's own text, the alias list extended by what it was called, and any fields the move sets. */
function withAlias(r: Rec, alias: string, rewrite: (text: string) => string, patch: Record<string, unknown> = {}): string {
  const aliases = Array.isArray(r.data.aliases) ? [...(r.data.aliases as string[])] : [];
  if (!aliases.includes(alias)) aliases.push(alias);
  const data = JSON.parse(rewrite(JSON.stringify({ ...r.data, ...patch, aliases }))) as Record<string, unknown>;
  return render(r.type, data, rewrite(r.body));
}

const dirOf = (rel: string): string => path.dirname(rel);

/** The record a `from` key names, with its product; a bare key goes through the scope. */
function source(loaded: Loaded, from: string, type: RecordType): Rec {
  const res = resolve(loaded, from);
  if (res.status !== 'ok' && res.status !== 'alias' && res.status !== 'invalid') throw new CliError(res.status === 'missing' ? `${from} does not exist` : unresolved(res, from));
  if (res.rec.type !== type) throw new CliError(`${from} is a ${res.rec.type}, not a ${type}`);
  if (!res.rec.valid) throw new CliError(`${res.rec.path} is invalid; fix it before renaming`);
  return res.rec;
}

/** A feature or a change: the folder moves (within the product, or to another), every reference and effect follows,
 *  the old slug (or `<product>/<slug>` when the product changed) stays as an alias. */
function mvScoped(store: Store, loaded: Loaded, type: 'feature' | 'change', fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const rec = source(loaded, fromRaw, type);
  const t = parseScopedRest(toRaw.slice(type.length + 1));
  if (!t) throw new CliError(`'${toRaw}' is not ${type}:<slug> or ${type}:<product>/<slug>`);
  const toProduct = t.product ?? rec.productSlug!;
  if (t.product && !loaded.byKey.has(`product:${toProduct}`)) throw new CliError(`product:${toProduct} does not exist`);
  const from = rec.key;
  const to = `${type}:${toProduct}/${t.slug}`;
  if (to === from) throw new CliError(`${from} already has that key`);
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  if (loaded.aliases.has(to)) throw new CliError(`'${t.slug}' is a former name of ${loaded.aliases.get(to)!.join(', ')} in product:${toProduct}`);
  const folder = type === 'feature' ? 'features' : 'changes';
  const oldDir = dirOf(rec.path);
  const newDir = path.join('products', toProduct, folder, t.slug);
  move(store, oldDir, newDir);
  const pathAfter = (rel: string) => (rel.startsWith(oldDir + '/') ? newDir + rel.slice(oldDir.length) : rel);
  const alias = toProduct === rec.productSlug ? rec.key.slice(rec.key.lastIndexOf('/') + 1) : from.slice(type.length + 1);
  // a change moving to another product moves to a project of that product: the one it has, else the move needs a say
  const patch: Record<string, unknown> = {};
  if (type === 'change' && toProduct !== rec.productSlug) {
    const projects = loaded.records.filter((p) => p.type === 'project' && p.valid && p.data.product === `product:${toProduct}`).map((p) => p.key);
    if (projects.length !== 1) throw new CliError(projects.length ? `product:${toProduct} has ${projects.length} projects (${projects.join(', ')}); set the change's project after the move is not possible, so move it into a product with one project or give that product one` : `product:${toProduct} has no project; a change belongs to a project of its product (pjman new project <slug> --title … --product product:${toProduct})`);
    patch.project = projects[0];
  }
  const rewrite = (text: string) => {
    let out = rewriteKey(text, from, to);
    if (type === 'change') out = rewritePrefix(out, `decision:${from.slice('change:'.length)}/`, `decision:${to.slice('change:'.length)}/`);
    return out;
  };
  const rewritten = rewriteAll(store, loaded, pathAfter, (text, r) => (r === rec ? withAlias(r, alias, rewrite, patch) : rewrite(text)));
  return finish(store, loaded, from, to, type, path.join(newDir, `${type}.md`), rewritten, pathAfter, opts, ['aliases', ...(patch.project ? ['project'] : [])]);
}

/** A product: its folder moves and every key beneath it (features, changes, decisions) is rewritten with the new segment. */
function mvProduct(store: Store, loaded: Loaded, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const rec = source(loaded, fromRaw, 'product');
  const toSlug = toRaw.slice('product:'.length);
  if (!SLUG_RE.test(toSlug)) throw new CliError(`'${toSlug}' is not a slug`);
  const from = rec.key;
  const to = `product:${toSlug}`;
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  if (loaded.aliases.has(to)) throw new CliError(`'${toSlug}' is a former name of ${loaded.aliases.get(to)!.join(', ')}`);
  const fromSlug = rec.productSlug!;
  const oldDir = path.join('products', fromSlug);
  const newDir = path.join('products', toSlug);
  move(store, oldDir, newDir);
  const pathAfter = (rel: string) => (rel.startsWith(oldDir + '/') ? newDir + rel.slice(oldDir.length) : rel);
  const rewrite = (text: string) => {
    let out = rewriteKey(text, from, to);
    for (const kind of ['feature', 'change', 'decision']) out = rewritePrefix(out, `${kind}:${fromSlug}/`, `${kind}:${toSlug}/`);
    return out;
  };
  const rewritten = rewriteAll(store, loaded, pathAfter, (text, r) => (r === rec ? withAlias(r, fromSlug, rewrite) : rewrite(text)));
  return finish(store, loaded, from, to, 'product', path.join(newDir, 'product.md'), rewritten, pathAfter, opts, ['aliases']);
}

function mvProject(store: Store, loaded: Loaded, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const rec = source(loaded, fromRaw, 'project');
  const toSlug = toRaw.slice('project:'.length);
  if (!SLUG_RE.test(toSlug)) throw new CliError(`'${toSlug}' is not a slug`);
  const from = rec.key;
  const to = `project:${toSlug}`;
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  const newRel = path.join('projects', `${toSlug}.md`);
  move(store, rec.path, newRel);
  const pathAfter = (rel: string) => (rel === rec.path ? newRel : rel);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text) => rewriteKey(text, from, to));
  // the registry on this machine: directories bound to the project follow it
  const cfg = readUserConfig();
  let bound = false;
  for (const s of cfg.stores) for (const b of s.projects) if (b.project === from) { b.project = to; bound = true; }
  if (bound) writeUserConfig(cfg);
  return finish(store, loaded, from, to, 'project', newRel, rewritten, pathAfter, opts);
}

/** A person or an agent: the file moves, every writer, owner, decider and session follows, the old handle stays as an
 *  alias; the user config's actor follows when it was the old key. */
function mvActor(store: Store, loaded: Loaded, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const fromKey = parseKey(fromRaw)!;
  const rec = loaded.byKey.get(fromRaw)?.[0] ?? loaded.byKey.get(loaded.aliases.get(fromRaw)?.[0] ?? '')?.[0];
  if (!rec || rec.type !== 'actor') throw new CliError(`${fromRaw} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
  const toHandle = toRaw.slice(fromKey.kind.length + 1);
  if (!SLUG_RE.test(toHandle)) throw new CliError(`'${toHandle}' is not a slug`);
  const from = rec.key;
  const to = `${fromKey.kind}:${toHandle}`;
  if (loaded.byKey.has(to) || loaded.records.some((r) => r.type === 'actor' && r.handle === toHandle)) throw new CliError(`${to} already exists`);
  if (loaded.aliases.has(to)) throw new CliError(`'${toHandle}' is a former handle of ${loaded.aliases.get(to)!.join(', ')}`);
  const newRel = path.join('actors', `${toHandle}.md`);
  move(store, rec.path, newRel);
  const pathAfter = (rel: string) => (rel === rec.path ? newRel : rel);
  const rewrite = (text: string) => rewriteKey(text, from, to);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text, r) => (r === rec ? withAlias(r, rec.handle!, rewrite) : rewrite(text)));
  const cfg = readUserConfig();
  if (cfg.actor === from) {
    cfg.actor = to;
    writeUserConfig(cfg);
  }
  return finish(store, loaded, from, to, 'actor', newRel, rewritten, pathAfter, opts, ['aliases']);
}

function mvDecision(store: Store, loaded: Loaded, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const rec = source(loaded, fromRaw, 'decision');
  const t = parseDecisionRest(toRaw.slice('decision:'.length));
  if (!t) throw new CliError('usage: pjman mv decision:<change>/<old> decision:<change>/<new>  (decision:/<slug> at store level)');
  // where it goes: the same change, another change (through the scope), product level, or store level
  let product: string | null = null;
  let change: Rec | undefined;
  if (t.head) {
    if (t.segments === 3) {
      change = loaded.byKey.get(`change:${t.head}/${t.change}`)?.[0];
      if (!change) throw new CliError(`change:${t.head}/${t.change} does not exist`);
      product = t.head;
    } else {
      const res = resolve(loaded, `change:${t.head}`, rec.productSlug ?? loaded.scope);
      if (res.status === 'ok' || res.status === 'alias') {
        change = res.rec;
        product = change.productSlug!;
      } else if (loaded.byKey.has(`product:${t.head}`)) product = t.head;
      else throw new CliError(`change:${t.head} does not exist (nor does product:${t.head})`);
    }
  }
  const from = rec.key;
  const to = product ? `decision:${product}/${change ? `${change.changeSlug}/` : ''}${t.slug}` : `decision:/${t.slug}`;
  if (to === from) throw new CliError(`${from} already has that key`);
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  const base = path.basename(rec.path);
  const date = /^(\d{4}-\d{2}-\d{2})-/.exec(base)?.[1];
  const newBase = `${date ? `${date}-` : ''}${t.slug}.md`;
  const newRel = change ? path.join(dirOf(change.path), 'decisions', newBase) : product ? path.join('products', product, 'decisions', newBase) : path.join('decisions', newBase);
  move(store, rec.path, newRel);
  const pathAfter = (rel: string) => (rel === rec.path ? newRel : rel);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text) => rewriteKey(text, from, to));
  return finish(store, loaded, from, to, 'decision', newRel, rewritten, pathAfter, opts);
}

export function mv(store: Store, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const from = parseKey(fromRaw);
  const to = parseKey(toRaw);
  if (!from || !to) throw new CliError('usage: pjman mv <key> <new key>  (product, feature, change, decision, project, person or agent)');
  if (from.kind !== to.kind) throw new CliError(`mv keeps the kind: ${from.kind} → ${to.kind}`);
  const loaded = loadStore(store);
  switch (from.kind) {
    case 'change': return mvScoped(store, loaded, 'change', from.raw, to.raw, opts);
    case 'feature': return mvScoped(store, loaded, 'feature', from.raw, to.raw, opts);
    case 'product': return mvProduct(store, loaded, from.raw, to.raw, opts);
    case 'project': return mvProject(store, loaded, from.raw, to.raw, opts);
    case 'decision': return mvDecision(store, loaded, from.raw, to.raw, opts);
    case 'person':
    case 'agent': return mvActor(store, loaded, from.raw, to.raw, opts);
    default: throw new CliError('mv renames products, features, changes, decisions, projects, people and agents; sources and sessions are not renamed (their keys are external)');
  }
}

export type { Rec };
