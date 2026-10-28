import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../config.js';
import { changeKey, decisionKey, featureKey, parseDecisionRest, parseKey, parseScopedRest, SLUG_RE, sourceFileSlug } from '../keys.js';
import { loadStore, recordOf, resolve, unresolved, type Loaded, type Rec, type RecordType } from '../records.js';
import { rootProductOf } from '../tree.js';
import type { EventInput } from '../events.js';
import { CliError, isDateString, localDate, today } from '../util.js';
import { envelope, finishWrite, fullKeys, render, validateOrUndo, writeFile } from '../write.js';

export interface NewFlags {
  title?: string;
  project?: string;
  tracker?: string;
  /** A project's answer to the map question: propose (the first session proposes a product map) or skip. */
  map?: string;
  status?: string;
  summary?: string;
  plan?: string;
  next?: string;
  binds?: string[];
  links?: string[];
  decidedBy?: string;
  decidedOn?: string;
  supersedes?: string;
  decision?: string;
  why?: string;
  name?: string;
  url?: string;
  agent?: string;
  onBehalfOf?: string;
  parent?: string;
  product?: string;
  owners?: string[];
  features?: string[];
  dependsOn?: string[];
  kind?: string;
  severity?: string;
  target?: string;
  sequence?: string[];
  level?: string;
  levels?: string[];
  started?: string;
  created?: string;
  body?: string;
  writer?: string;
  session?: string;
}

function refuseExisting(store: Store, rel: string): void {
  if (fs.existsSync(path.join(store.root, rel))) throw new CliError(`refused: ${rel} already exists`);
}

function stamp(flags: NewFlags): Record<string, unknown> {
  const env = envelope(flags);
  const created = flags.created ?? today();
  if (!isDateString(created)) throw new CliError(`--created must be a date (yyyy-mm-dd)`);
  return { writer: env.writer, session: env.session, created };
}

function section(name: string, text?: string): string {
  return `## ${name}\n\n${(text ?? '').trim()}\n`;
}

export interface NewResult {
  type: RecordType;
  key: string;
  path: string;
  commit: string | null;
  notes: string[];
}

export function newRecord(store: Store, type: string, ident: string, flags: NewFlags): NewResult {
  switch (type) {
    case 'product':
      return newProduct(store, ident, flags);
    case 'feature':
      return newFeature(store, ident, flags);
    case 'project':
      return newProject(store, ident, flags);
    case 'change':
      return newChange(store, ident, flags);
    case 'decision':
      return newDecision(store, ident, flags);
    case 'source':
      return newSource(store, ident, flags);
    case 'actor':
      return newActor(store, ident, flags);
    case 'session':
      return newSession(store, ident, flags);
    default:
      throw new CliError(`unknown record type '${type}' (product, feature, project, change, decision, source, actor, session)`);
  }
}

function finish(store: Store, type: RecordType, key: string, rel: string, created: string[], flags: NewFlags, notes: string[] = []): NewResult {
  validateOrUndo(store, [rel, ...created], created);
  const env = envelope(flags);
  const commit = finishWrite(store, `pjman: new ${key}`, env.session, [{ op: 'created', key, type, path: rel, writer: env.writer }]);
  return { type, key, path: rel, commit, notes };
}

const listOrNone = (v?: string[]): string[] | undefined => (v?.length ? v : undefined);

/** A product named by key or slug, resolved; refused when it does not exist. */
function productSlugOf(loaded: Loaded, raw: string, what: string): string {
  const key = raw.startsWith('product:') ? raw : `product:${raw}`;
  const rec = recordOf(loaded, key, null);
  if (!rec || rec.type !== 'product') throw new CliError(`${what}: ${key} does not exist`);
  return rec.productSlug!;
}

export function newProduct(store: Store, ident: string, flags: NewFlags): NewResult {
  const slug = ident.startsWith('product:') ? ident.slice(8) : ident;
  if (!SLUG_RE.test(slug)) throw new CliError(`'${slug}' is not a slug (lower-case letters, digits, hyphens)`);
  if (!flags.title) throw new CliError('--title is required');
  const rel = path.join('products', slug, 'product.md');
  refuseExisting(store, rel);
  const loaded = loadStore(store);
  if (loaded.aliases.has(`product:${slug}`)) throw new CliError(`refused: '${slug}' is a former name of ${loaded.aliases.get(`product:${slug}`)!.join(', ')}`);
  const data: Record<string, unknown> = { title: flags.title, name: flags.name, owners: listOrNone(flags.owners), levels: listOrNone(flags.levels), sequence: listOrNone(flags.sequence), links: listOrNone(flags.links), ...stamp(flags) };
  fullKeys(loaded, 'product', data, undefined, slug);
  let body = flags.summary ? section('Summary', flags.summary) : '';
  if (flags.body) body += (body ? '\n' : '') + flags.body.trim() + '\n';
  writeFile(store, rel, render('product', data, body));
  return finish(store, 'product', `product:${slug}`, rel, [rel], flags);
}

export function newFeature(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('feature:') ? ident.slice(8) : ident;
  const s = parseScopedRest(rest);
  if (!s) throw new CliError(`'${rest}' is not a slug (lower-case letters, digits, hyphens), or <product>/<slug>`);
  if (!flags.title) throw new CliError('--title is required');
  if (!flags.product && !flags.parent) throw new CliError('a feature needs --product product:<slug> (top level) or --parent feature:<slug>');
  const loaded = loadStore(store);
  // the product it is keyed under: named in the ident, else --product, else the parent's
  let product: string | null = s.product ? productSlugOf(loaded, s.product, 'feature') : null;
  if (flags.product) {
    const p = productSlugOf(loaded, flags.product, '--product');
    if (product && p !== product) throw new CliError(`--product ${flags.product} is not the product the key names (product:${product})`);
    product = p;
  }
  if (flags.parent) {
    const res = resolve(loaded, flags.parent, product ?? loaded.scope);
    if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`--parent: ${unresolved(res, flags.parent)}`);
    const above = rootProductOf(loaded, res.rec)?.productSlug ?? res.rec.productSlug ?? null;
    if (product && above !== product) throw new CliError(`--parent ${res.rec.key} is in product:${above}, not product:${product}; a feature nests inside its own product`);
    product = above;
    flags = { ...flags, parent: res.rec.key };
  }
  if (!product) throw new CliError('the feature belongs to no product: name one with --product or a parent beneath one');
  const key = featureKey(product, s.slug);
  const rel = path.join('products', product, 'features', s.slug, 'feature.md');
  refuseExisting(store, rel);
  if (loaded.aliases.has(key)) throw new CliError(`refused: '${s.slug}' is a former name of ${loaded.aliases.get(key)!.join(', ')} in product:${product}`);
  const data: Record<string, unknown> = {
    title: flags.title, name: flags.name, status: flags.status, level: flags.level, product: flags.product ? `product:${product}` : undefined, parent: flags.parent,
    owners: listOrNone(flags.owners), links: listOrNone(flags.links), ...stamp(flags),
  };
  fullKeys(loaded, 'feature', data, undefined, product);
  let body = flags.summary ? section('Summary', flags.summary) : '';
  if (flags.body) body += (body ? '\n' : '') + flags.body.trim() + '\n';
  writeFile(store, rel, render('feature', data, body));
  return finish(store, 'feature', key, rel, [rel], flags);
}

export function newProject(store: Store, ident: string, flags: NewFlags): NewResult {
  const slug = ident.startsWith('project:') ? ident.slice(8) : ident;
  if (!SLUG_RE.test(slug)) throw new CliError(`'${slug}' is not a slug (lower-case letters, digits, hyphens)`);
  if (!flags.title) throw new CliError('--title is required');
  const rel = path.join('projects', `${slug}.md`);
  refuseExisting(store, rel);
  const loaded = loadStore(store);
  const data: Record<string, unknown> = { title: flags.title, product: flags.product, parent: flags.parent, tracker: flags.tracker, map: flags.map, owners: listOrNone(flags.owners), links: flags.links?.length ? flags.links : undefined, ...stamp(flags) };
  fullKeys(loaded, 'project', data, undefined, null);
  writeFile(store, rel, render('project', data, flags.body ? flags.body.trim() + '\n' : ''));
  return finish(store, 'project', `project:${slug}`, rel, [rel], flags);
}

/** The product a project names, as a slug; refused when it names none. */
export function productOfProject(loaded: Loaded, projectKey: string): { project: Rec; product: string } {
  const project = recordOf(loaded, projectKey, null);
  if (!project || project.type !== 'project') throw new CliError(`${projectKey} does not resolve to a project`);
  const product = typeof project.data.product === 'string' ? recordOf(loaded, project.data.product, null) : undefined;
  if (!product || product.type !== 'product') throw new CliError(`${project.key} names no product; a change is keyed under its project's product: pjman set ${project.key} product=product:<slug> (pjman new product <slug> --title … first, when there is none)`);
  return { project, product: product.productSlug! };
}

export function newChange(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('change:') ? ident.slice(7) : ident;
  const s = parseScopedRest(rest);
  if (!s) throw new CliError(`'${rest}' is not a slug (lower-case letters, digits, hyphens), or <product>/<slug>`);
  if (!flags.title) throw new CliError('--title is required');
  const loaded = loadStore(store);
  const projectKey = flags.project ?? store.project;
  if (!projectKey) throw new CliError('no project: run from a registered repository or pass --project project:<slug>');
  const { project, product } = productOfProject(loaded, projectKey);
  if (s.product && productSlugOf(loaded, s.product, 'change') !== product) throw new CliError(`${project.key} belongs to product:${product}, not product:${s.product}; a change is keyed under its project's product`);
  const key = changeKey(product, s.slug);
  const rel = path.join('products', product, 'changes', s.slug, 'change.md');
  refuseExisting(store, rel);
  if (loaded.aliases.has(key)) throw new CliError(`refused: '${s.slug}' is a former name of ${loaded.aliases.get(key)!.join(', ')} in product:${product}`);
  const data: Record<string, unknown> = {
    title: flags.title,
    status: flags.status ?? 'open',
    kind: flags.kind,
    severity: flags.severity,
    project: project.key,
    parent: flags.parent,
    depends_on: listOrNone(flags.dependsOn),
    features: listOrNone(flags.features),
    owners: listOrNone(flags.owners),
    target: flags.target,
    next: flags.next,
    binds: flags.binds?.length ? flags.binds : undefined,
    links: flags.links?.length ? flags.links : undefined,
    ...stamp(flags),
  };
  fullKeys(loaded, 'change', data, undefined, product);
  let body = section('Summary', flags.summary);
  if (flags.plan) body += '\n' + section('Plan', flags.plan);
  if (flags.body) body += '\n' + flags.body.trim() + '\n';
  writeFile(store, rel, render('change', data, body));
  return finish(store, 'change', key, rel, [rel], flags);
}

export function newDecision(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('decision:') ? ident.slice(9) : ident;
  const parsed = parseDecisionRest(rest);
  if (!parsed) throw new CliError(`'${ident}' must be <change>/<decision-slug> (<product>/<change>/<slug> in full), <product>/<slug> at product level, or /<slug> at store level`);
  if (!flags.title) throw new CliError('--title is required');
  const loaded = loadStore(store);
  // where it lives: under a change, at product level, or at store level
  let product: string | null = null;
  let change: Rec | undefined;
  if (parsed.head) {
    if (parsed.segments === 3) {
      product = productSlugOf(loaded, parsed.head, 'decision');
      change = recordOf(loaded, `change:${product}/${parsed.change}`, null);
      if (!change) throw new CliError(`change:${product}/${parsed.change} does not exist`);
    } else {
      const res = resolve(loaded, `change:${parsed.head}`);
      if (res.status === 'ok' || res.status === 'alias') {
        change = res.rec;
        product = change.productSlug!;
      } else if (res.status === 'ambiguous') throw new CliError(unresolved(res, `change:${parsed.head}`));
      else if (loaded.byKey.has(`product:${parsed.head}`)) product = parsed.head; // product level
      else throw new CliError(`change:${parsed.head} does not exist (nor does product:${parsed.head})`);
    }
  }
  const env = stamp(flags);
  const date = env.created as string;
  const key = decisionKey(product, change?.changeSlug ?? null, parsed.slug);
  const rel = change
    ? path.join('products', product!, 'changes', change.changeSlug!, 'decisions', `${date}-${parsed.slug}.md`)
    : product
      ? path.join('products', product, 'decisions', `${date}-${parsed.slug}.md`)
      : path.join('decisions', `${date}-${parsed.slug}.md`);
  if (loaded.byKey.has(key)) throw new CliError(`refused: ${key} already exists at ${loaded.byKey.get(key)![0].path}`);
  refuseExisting(store, rel);

  let status = flags.status;
  if (!status) status = flags.decidedBy || flags.decidedOn ? 'decided' : 'proposed';
  // A person running the tool decides by default; an agent never does.
  const writerDecides = typeof env.writer === 'string' && env.writer.startsWith('person:') ? env.writer : undefined;
  if (status === 'decided' && !flags.decidedBy && !writerDecides) {
    throw new CliError('a decided decision needs --decided-by <person:…>; an agent is not the decider by default');
  }
  const data: Record<string, unknown> = {
    title: flags.title,
    status,
    decided_by: flags.decidedBy ?? (status === 'decided' ? writerDecides : undefined),
    decided_on: flags.decidedOn ?? (status === 'decided' ? date : undefined),
    supersedes: flags.supersedes,
    links: flags.links?.length ? flags.links : undefined,
    ...env,
  };
  fullKeys(loaded, 'decision', data, undefined, product);
  const notes: string[] = [];
  const touched: string[] = [];
  const also: EventInput[] = [];
  const prior = new Map<string, string>();
  if (flags.supersedes) {
    const res = resolve(loaded, flags.supersedes, product);
    if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`supersedes: ${unresolved(res, flags.supersedes)}`);
    if (res.rec.data.status !== 'superseded') {
      const text = fs.readFileSync(res.rec.abs, 'utf8');
      prior.set(res.rec.path, text);
      const updated = render('decision', { ...res.rec.data, status: 'superseded' }, res.rec.body);
      if (updated !== text) fs.writeFileSync(res.rec.abs, updated);
      touched.push(res.rec.path);
      also.push({ op: 'set', key: res.rec.key, type: 'decision', path: res.rec.path, fields: ['status'], writer: env.writer as string | undefined });
      notes.push(`${res.rec.key} is now superseded`);
    }
  }
  let body = section('Decision', flags.decision) + '\n' + section('Why', flags.why);
  if (flags.body) body += '\n' + flags.body.trim() + '\n';
  writeFile(store, rel, render('decision', data, body));
  validateOrUndo(store, [rel, ...touched], [rel], prior);
  const commit = finishWrite(store, `pjman: new ${key}`, envelope(flags).session, [{ op: 'created', key, type: 'decision', path: rel, writer: env.writer as string | undefined }, ...also]);
  return { type: 'decision', key, path: rel, commit, notes };
}

export function newSource(store: Store, ident: string, flags: NewFlags): NewResult {
  const key = parseKey(ident);
  if (!key) throw new CliError(`'${ident}' is not a key (<kind>:<key>)`);
  const kind = key.kind.toLowerCase();
  if (!store.config.source_kinds.map((k) => k.toLowerCase()).includes(kind)) {
    throw new CliError(`'${kind}' is not in source_kinds (${store.config.source_kinds.join(', ')}); add it to pjman.yaml first`);
  }
  const rel = path.join('sources', kind, `${sourceFileSlug(kind, key.rest)}.md`);
  refuseExisting(store, rel);
  const data: Record<string, unknown> = {
    kind,
    key: key.rest,
    title: flags.title,
    url: flags.url ?? (kind === 'url' ? key.rest : undefined),
    links: flags.links?.length ? flags.links : undefined,
    ...stamp(flags),
  };
  writeFile(store, rel, render('source', data, flags.body ? flags.body.trim() + '\n' : ''));
  return finish(store, 'source', `${kind}:${key.rest}`, rel, [rel], flags);
}

export function newActor(store: Store, ident: string, flags: NewFlags): NewResult {
  const key = parseKey(ident);
  if (!key || (key.kind !== 'person' && key.kind !== 'agent')) throw new CliError(`'${ident}' must be person:<handle> or agent:<handle>`);
  if (!SLUG_RE.test(key.rest)) throw new CliError(`'${key.rest}' is not a slug`);
  const rel = path.join('actors', `${key.rest}.md`);
  refuseExisting(store, rel);
  const loaded = loadStore(store);
  if (loaded.aliases.has(key.raw)) throw new CliError(`refused: '${key.rest}' is a former handle of ${loaded.aliases.get(key.raw)!.join(', ')}`);
  const data: Record<string, unknown> = { kind: key.kind, name: flags.name, url: flags.url, links: listOrNone(flags.links), ...stamp(flags) };
  writeFile(store, rel, render('actor', data, flags.body ? flags.body.trim() + '\n' : ''));
  return finish(store, 'actor', key.raw, rel, [rel], flags);
}

export function newSession(store: Store, ident: string, flags: NewFlags): NewResult {
  const id = ident.startsWith('session:') ? ident.slice(8) : ident;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new CliError(`'${id}' is not a usable session id`);
  if (!flags.agent) throw new CliError('--agent is required (an agent key)');
  if (!flags.onBehalfOf) throw new CliError('--on-behalf-of is required (a person key)');
  const started = flags.started ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(started))) throw new CliError('--started must be a timestamp');
  const date = localDate(new Date(started));
  const loaded = loadStore(store);
  if (loaded.byKey.has(`session:${id}`)) throw new CliError(`refused: session:${id} already exists at ${loaded.byKey.get(`session:${id}`)![0].path}`);
  const rel = path.join('sessions', `${date}-${id}.md`);
  refuseExisting(store, rel);
  const env = envelope(flags);
  const data: Record<string, unknown> = {
    agent: flags.agent,
    on_behalf_of: flags.onBehalfOf,
    started,
    parent: flags.parent,
    writer: env.writer,
    created: date,
  };
  const body = section('Log', flags.body);
  writeFile(store, rel, render('session', data, body));
  validateOrUndo(store, [rel], [rel]);
  const commit = finishWrite(store, `pjman: new session:${id}`, `session:${id}`, [{ op: 'created', key: `session:${id}`, type: 'session', path: rel, writer: env.writer }]);
  return { type: 'session', key: `session:${id}`, path: rel, commit, notes: [] };
}
