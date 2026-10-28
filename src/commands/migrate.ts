// pjman migrate: the one move from store-wide keys to keys under the product. Every product becomes a folder
// (products/<slug>/product.md) holding its features and changes; every feature, change and decision key gains its
// product segment wherever it is written, in fields and in prose alike; each moved record keeps its old slug as an
// alias so old links, old prose and old URLs still resolve. One commit, one event; `pjman undo <commit>` reverts it.
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { IDENTITY_KINDS, type Store } from '../config.js';
import { emit } from '../events.js';
import { commitAll, git, gitMv, isTracked, toplevel } from '../git.js';
import { loadLegacy } from '../legacy.js';
import { isLegacyLayout, loadStore, type Rec } from '../records.js';
import { CliError } from '../util.js';
import { envelope, render } from '../write.js';
import { formatProblems, validate } from '../validate.js';

export interface MigrateResult {
  products: number;
  moved: number;
  rewritten: number;
  commit: string | null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole flat key (`change:<slug>`, `feature:<slug>`) → its key under the product. */
const rewriteFlat = (text: string, kind: string, slug: string, product: string): string =>
  text.replace(new RegExp(`(^|[^A-Za-z0-9_/:-])${kind}:${esc(slug)}(?![A-Za-z0-9_/-])`, 'g'), `$1${kind}:${product}/${slug}`);
/** `decision:<change>/` → `decision:<product>/<change>/`. */
const rewriteDecisions = (text: string, change: string, product: string): string =>
  text.replace(new RegExp(`(^|[^A-Za-z0-9_/:-])decision:${esc(change)}/`, 'g'), `$1decision:${product}/${change}/`);

export function migrate(store: Store, opts: { session?: string; writer?: string } = {}): MigrateResult {
  const root = store.root;
  if (!isLegacyLayout(root)) throw new CliError('nothing to migrate: every record is already keyed under its product');
  if (store.mode === 'standalone' && git(root, ['status', '--porcelain', '--', '.'])) throw new CliError('the store has uncommitted changes; commit or discard them first');
  const records = loadLegacy(store);
  const byKey = new Map(records.map((r) => [r.key, r]));
  const inGit = toplevel(root) !== null;

  // the product each record belongs to: a project's product; a feature's product or its parent chain's; a change's
  // project's product (else the product of the first feature it names); a decision's change's
  const productOfProject = (key: string): string | null => {
    const p = byKey.get(key);
    const product = p && typeof p.data.product === 'string' ? p.data.product : null;
    return product && byKey.has(product) ? product.slice('product:'.length) : null;
  };
  const featureProduct = new Map<string, string>();
  const productOfFeature = (r: Rec, seen = new Set<string>()): string | null => {
    if (featureProduct.has(r.key)) return featureProduct.get(r.key)!;
    if (seen.has(r.key)) return null;
    seen.add(r.key);
    let out: string | null = null;
    if (typeof r.data.product === 'string' && byKey.has(r.data.product)) out = r.data.product.slice('product:'.length);
    else if (typeof r.data.parent === 'string') {
      const parent = byKey.get(r.data.parent);
      out = parent ? productOfFeature(parent, seen) : null;
    }
    if (out) featureProduct.set(r.key, out);
    return out;
  };
  const productOfChange = (r: Rec): string | null => {
    if (typeof r.data.project === 'string') {
      const p = productOfProject(r.data.project);
      if (p) return p;
    }
    for (const f of Array.isArray(r.data.features) ? (r.data.features as unknown[]) : []) {
      const key = typeof f === 'string' ? f.replace(/^(adds|changes|removes)\s+/, '') : '';
      const feature = byKey.get(key);
      const p = feature ? productOfFeature(feature) : null;
      if (p) return p;
    }
    return null;
  };

  const homeless: string[] = [];
  const home = new Map<string, string>(); // old key → product slug
  for (const r of records) {
    if (r.type === 'feature') {
      const p = productOfFeature(r);
      if (p) home.set(r.key, p);
      else homeless.push(r.key);
    } else if (r.type === 'change') {
      const p = productOfChange(r);
      if (p) home.set(r.key, p);
      else homeless.push(r.key);
    }
  }
  for (const r of records) if (r.type === 'decision' && r.changeSlug) {
    const p = home.get(`change:${r.changeSlug}`);
    if (p) home.set(r.key, p);
  }
  if (homeless.length) {
    throw new CliError(`${homeless.length} record${homeless.length === 1 ? ' belongs' : 's belong'} to no product, and every feature and change is keyed under one:\n${homeless.map((k) => `  ${k}`).join('\n')}\nGive each project a product (pjman new product <slug> --title …; pjman set project:<slug> product=product:<slug>) and run the migration again`);
  }

  // moves: product files into folders, feature and change folders under their product
  const moves: [string, string][] = [];
  const pathAfter = new Map<string, string>();
  for (const r of records) {
    if (r.type === 'product' && !r.path.endsWith('/product.md')) moves.push([r.path, path.join('products', r.productSlug!, 'product.md')]);
    if (r.type === 'feature' || r.type === 'change') {
      const p = home.get(r.key)!;
      moves.push([path.dirname(r.path), path.join('products', p, r.type === 'feature' ? 'features' : 'changes', path.basename(path.dirname(r.path)))]);
    }
  }
  const after = (rel: string): string => {
    for (const [from, to] of moves) {
      if (rel === from) return to;
      if (rel.startsWith(from + '/')) return to + rel.slice(from.length);
    }
    return rel;
  };
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    if (inGit && isTracked(root, from)) gitMv(root, from, to);
    else fs.renameSync(path.join(root, from), path.join(root, to));
  }
  for (const dir of ['changes', 'features']) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs) && fs.readdirSync(abs).every((n) => n === '.gitkeep')) fs.rmSync(abs, { recursive: true, force: true });
  }

  // rewrites: every flat key in every record, longest slugs first so a slug that prefixes another is never clipped
  const features = records.filter((r) => r.type === 'feature').sort((a, b) => b.featureSlug!.length - a.featureSlug!.length);
  const changes = records.filter((r) => r.type === 'change').sort((a, b) => b.changeSlug!.length - a.changeSlug!.length);
  const rewrite = (text: string): string => {
    let out = text;
    for (const f of features) out = rewriteFlat(out, 'feature', f.featureSlug!, home.get(f.key)!);
    for (const c of changes) {
      out = rewriteFlat(out, 'change', c.changeSlug!, home.get(c.key)!);
      out = rewriteDecisions(out, c.changeSlug!, home.get(c.key)!);
    }
    return out;
  };
  let rewritten = 0;
  for (const r of records) {
    const rel = after(r.path);
    pathAfter.set(r.path, rel);
    const abs = path.join(root, rel);
    const text = fs.readFileSync(abs, 'utf8');
    let next: string;
    if (r.type === 'feature' || r.type === 'change') {
      const slug = r.type === 'feature' ? r.featureSlug! : r.changeSlug!;
      const aliases = Array.isArray(r.data.aliases) ? [...(r.data.aliases as string[])] : [];
      if (!aliases.includes(slug)) aliases.push(slug);
      const data = JSON.parse(rewrite(JSON.stringify({ ...r.data, aliases }))) as Record<string, unknown>;
      next = render(r.type, data, rewrite(r.body));
    } else next = rewrite(text);
    if (next !== text) {
      fs.writeFileSync(abs, next);
      rewritten++;
    }
  }
  // the store's config: the identity source kinds join the list
  const cfgPath = path.join(root, 'pjman.yaml');
  const cfg = (parse(fs.readFileSync(cfgPath, 'utf8')) ?? {}) as Record<string, unknown>;
  if (Array.isArray(cfg.source_kinds)) {
    const kinds = cfg.source_kinds.map(String);
    for (const k of IDENTITY_KINDS) if (!kinds.includes(k)) kinds.push(k);
    cfg.source_kinds = kinds;
    fs.writeFileSync(cfgPath, stringify(cfg, { lineWidth: 0 }));
  }

  const problems = validate(loadStore(store)).filter((p) => p.level === 'error');
  if (problems.length) {
    if (inGit) {
      git(root, ['reset', '-q', '--hard', 'HEAD']);
      git(root, ['clean', '-qfd', '--', '.']);
    }
    throw new CliError(`refused: the migrated store would not validate; nothing was written\n${formatProblems(problems)}`);
  }
  const env = envelope(opts);
  const commit = store.mode === 'standalone' ? commitAll(root, 'pjman: migrate keys under the product', env.session) : null;
  emit(store, [{ op: 'migrated', key: 'store', type: 'store', path: 'pjman.yaml', fields: [`${moves.length} moved`, `${rewritten} rewritten`], writer: env.writer, session: env.session }], commit);
  return { products: records.filter((r) => r.type === 'product').length, moved: moves.length, rewritten, commit };
}
