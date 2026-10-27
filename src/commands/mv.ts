// pjman mv: rename a product, a feature, a project, a change or a decision. The file or folder moves, every reference
// in the store is rewritten in the same commit, and a change or a feature keeps its old slug as an alias. Sources, actors and sessions are not
// renamed: their keys are external.
import fs from 'node:fs';
import path from 'node:path';
import { readUserConfig, writeUserConfig, type Store } from '../config.js';
import { gitMv, isTracked, toplevel } from '../git.js';
import { parseDecisionRest, parseKey, SLUG_RE } from '../keys.js';
import { loadStore, type Loaded, type Rec, type RecordType } from '../records.js';
import { CliError } from '../util.js';
import { envelope, finishWrite, render, validateOrUndo } from '../write.js';

export interface MvResult {
  from: string;
  to: string;
  rewritten: string[];
  commit: string | null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrite `change:old` → `change:new` and `decision:old/` → `decision:new/` wherever they appear as whole keys. */
function rewriteChangeKeys(text: string, oldSlug: string, newSlug: string): string {
  return text
    .replace(new RegExp(`(^|[^A-Za-z0-9_/-])change:${esc(oldSlug)}(?![A-Za-z0-9_-])`, 'g'), `$1change:${newSlug}`)
    .replace(new RegExp(`(^|[^A-Za-z0-9_/-])decision:${esc(oldSlug)}/`, 'g'), `$1decision:${newSlug}/`);
}

/** Rewrite one whole key wherever it appears. */
function rewriteKey(text: string, oldKey: string, newKey: string): string {
  return text.replace(new RegExp(`(^|[^A-Za-z0-9_/:-])${esc(oldKey)}(?![A-Za-z0-9_/-])`, 'g'), `$1${newKey}`);
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

function mvChange(store: Store, loaded: Loaded, from: string, to: string, opts: { session?: string }): MvResult {
  const fromSlug = from.slice('change:'.length);
  const toSlug = to.slice('change:'.length);
  if (!SLUG_RE.test(toSlug)) throw new CliError(`'${toSlug}' is not a slug`);
  const rec = loaded.byKey.get(from)?.[0];
  if (!rec || rec.type !== 'change') throw new CliError(`${from} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  if (loaded.aliasOf.has(toSlug)) throw new CliError(`'${toSlug}' is an alias of ${loaded.aliasOf.get(toSlug)}`);

  const oldDir = path.join('changes', fromSlug);
  const newDir = path.join('changes', toSlug);
  move(store, oldDir, newDir);
  const pathAfter = (rel: string) => (rel.startsWith(oldDir + '/') ? newDir + rel.slice(oldDir.length) : rel);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text, r) => {
    if (r !== rec) return rewriteChangeKeys(text, fromSlug, toSlug);
    const aliases = Array.isArray(r.data.aliases) ? [...(r.data.aliases as string[])] : [];
    if (!aliases.includes(fromSlug)) aliases.push(fromSlug);
    const data = JSON.parse(rewriteChangeKeys(JSON.stringify({ ...r.data, aliases }), fromSlug, toSlug)) as Record<string, unknown>;
    return render('change', data, rewriteChangeKeys(r.body, fromSlug, toSlug));
  });
  return finish(store, loaded, from, to, 'change', path.join(newDir, 'change.md'), rewritten, pathAfter, opts, ['aliases']);
}

/** A one-file record (project, product): the file moves and every reference follows. */
function mvFile(store: Store, loaded: Loaded, type: 'project' | 'product', dir: string, from: string, to: string, opts: { session?: string }): MvResult {
  const toSlug = to.slice(type.length + 1);
  if (!SLUG_RE.test(toSlug)) throw new CliError(`'${toSlug}' is not a slug`);
  const rec = loaded.byKey.get(from)?.[0];
  if (!rec || rec.type !== type) throw new CliError(`${from} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  const newRel = path.join(dir, `${toSlug}.md`);
  move(store, rec.path, newRel);
  const pathAfter = (rel: string) => (rel === rec.path ? newRel : rel);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text) => rewriteKey(text, from, to));
  return finish(store, loaded, from, to, type, newRel, rewritten, pathAfter, opts);
}

/** A feature: the folder moves and every reference, effects included, follows. */
function mvFeature(store: Store, loaded: Loaded, from: string, to: string, opts: { session?: string }): MvResult {
  const toSlug = to.slice('feature:'.length);
  if (!SLUG_RE.test(toSlug)) throw new CliError(`'${toSlug}' is not a slug`);
  const rec = loaded.byKey.get(from)?.[0];
  if (!rec || rec.type !== 'feature') throw new CliError(`${from} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  if (loaded.featureAliasOf.has(toSlug)) throw new CliError(`'${toSlug}' is an alias of ${loaded.featureAliasOf.get(toSlug)}`);
  const fromSlug = from.slice('feature:'.length);
  const oldDir = path.join('features', fromSlug);
  const newDir = path.join('features', toSlug);
  move(store, oldDir, newDir);
  const pathAfter = (rel: string) => (rel.startsWith(oldDir + '/') ? newDir + rel.slice(oldDir.length) : rel);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text, r) => {
    if (r !== rec) return rewriteKey(text, from, to);
    const aliases = Array.isArray(r.data.aliases) ? [...(r.data.aliases as string[])] : [];
    if (!aliases.includes(fromSlug)) aliases.push(fromSlug);
    const data = JSON.parse(rewriteKey(JSON.stringify({ ...r.data, aliases }), from, to)) as Record<string, unknown>;
    return render('feature', data, rewriteKey(r.body, from, to));
  });
  return finish(store, loaded, from, to, 'feature', path.join(newDir, 'feature.md'), rewritten, pathAfter, opts, ['aliases']);
}

function mvProject(store: Store, loaded: Loaded, from: string, to: string, opts: { session?: string }): MvResult {
  const toSlug = to.slice('project:'.length);
  if (!SLUG_RE.test(toSlug)) throw new CliError(`'${toSlug}' is not a slug`);
  const rec = loaded.byKey.get(from)?.[0];
  if (!rec || rec.type !== 'project') throw new CliError(`${from} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
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

function mvDecision(store: Store, loaded: Loaded, from: string, to: string, opts: { session?: string }): MvResult {
  const f = parseDecisionRest(from.slice('decision:'.length));
  const t = parseDecisionRest(to.slice('decision:'.length));
  if (!f || !t) throw new CliError('usage: pjman mv decision:<change>/<old> decision:<change>/<new>  (decision:/<slug> at store level)');
  const rec = loaded.byKey.get(from)?.[0];
  if (!rec || rec.type !== 'decision') throw new CliError(`${from} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
  if (loaded.byKey.has(to)) throw new CliError(`${to} already exists`);
  if (t.changeSlug && !loaded.byKey.has(`change:${t.changeSlug}`)) throw new CliError(`change:${t.changeSlug} does not exist`);

  const base = path.basename(rec.path);
  const date = /^(\d{4}-\d{2}-\d{2})-/.exec(base)?.[1];
  const newBase = `${date ? `${date}-` : ''}${t.dslug}.md`;
  const newRel = t.changeSlug ? path.join('changes', t.changeSlug, 'decisions', newBase) : path.join('decisions', newBase);
  move(store, rec.path, newRel);
  const pathAfter = (rel: string) => (rel === rec.path ? newRel : rel);
  const rewritten = rewriteAll(store, loaded, pathAfter, (text) => rewriteKey(text, from, to));
  return finish(store, loaded, from, to, 'decision', newRel, rewritten, pathAfter, opts);
}

export function mv(store: Store, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const from = parseKey(fromRaw);
  const to = parseKey(toRaw);
  if (!from || !to) throw new CliError('usage: pjman mv <key> <new key>  (product, feature, project, change or decision)');
  if (from.kind !== to.kind) throw new CliError(`mv keeps the kind: ${from.kind} → ${to.kind}`);
  const loaded = loadStore(store);
  switch (from.kind) {
    case 'change': return mvChange(store, loaded, from.raw, to.raw, opts);
    case 'project': return mvProject(store, loaded, from.raw, to.raw, opts);
    case 'product': return mvFile(store, loaded, 'product', 'products', from.raw, to.raw, opts);
    case 'feature': return mvFeature(store, loaded, from.raw, to.raw, opts);
    case 'decision': return mvDecision(store, loaded, from.raw, to.raw, opts);
    default: throw new CliError('mv renames products, features, projects, changes and decisions; sources, actors and sessions are not renamed (their keys are external)');
  }
}

export type { Rec };
