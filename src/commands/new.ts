import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../config.js';
import { aspectKey, changeKey, decisionKey, featureKey, parseAspectRest, parseDecisionRest, parseKey, parseReleaseRest, parseScopedRest, RECORD_KINDS, releaseKey, SLUG_RE, sourceFileSlug } from '../keys.js';
import { loadStore, recordOf, resolve, unresolved, unresolvedError, type Loaded, type Rec, type RecordType } from '../records.js';
import { rootProductOf } from '../tree.js';
import { CliError, isDateString, isTimestamp, localDate, nowIso, today, notFound, usageError } from '../util.js';
import { RELEASE_LEVELS } from '../validate.js';
import { envelope, finishWrite, fullKeys, render, validateOrUndo, writeFile } from '../write.js';
import { CHANGE_SECTIONS, foundationHash, foundationOf, gistProblem, nameProblem, type ChangeSection } from '../foundation.js';
import { sections as parseSections } from '../frontmatter.js';

export interface NewFlags {
  title?: string;
  /** A change filed with its plan: each text a step, open (decision interface-audit/bulk-writes). */
  steps?: string[];
  project?: string;
  tracker?: string;
  /** A project's answer to the map question: propose (the first session proposes a product map) or skip. */
  map?: string;
  /** What the project's repository holds, as init inventoried it: bare, docs, code or docs+code. */
  holds?: string;
  status?: string;
  summary?: string;
  /** A change's rungs and sections (foundation.ts): name, gist, Origin, Intent, Done when, then the optional ones. */
  name?: string;
  gist?: string;
  origin?: string;
  intent?: string;
  doneWhen?: string;
  scope?: string;
  openQuestions?: string;
  blockedOn?: string;
  notes?: string;
  binds?: string[];
  links?: string[];
  decidedBy?: string;
  decidedOn?: string;
  supersedes?: string;
  url?: string;
  agent?: string;
  onBehalfOf?: string;
  parent?: string;
  product?: string;
  owners?: string[];
  features?: string[];
  aspects?: string[];
  /** A place's feature: where the aspect applies. */
  feature?: string;
  dependsOn?: string[];
  kind?: string;
  severity?: string;
  target?: string;
  sequence?: string[];
  level?: string;
  levels?: string[];
  /** A release: its tag, the instant it was cut, the commit it was cut from, the changes it ships in order. */
  tag?: string;
  at?: string;
  commit?: string;
  ships?: string[];
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

/** The Origin section: where the work came from, as it was said. A key (a ticket, a document, a change or a decision
 *  it spun off) is linked, not copied; words are quoted and never edited; the session it was made in is named. */
export function originText(text: string, env: { session?: string; writer?: string }, date: string): string {
  const t = text.trim();
  const key = parseKey(t);
  const who = [env.session, date].filter(Boolean).join(', ');
  if (key && !/\s/.test(t)) return `from ${t}\n\n— ${who}`;
  return `${t.split('\n').map((l) => `> ${l}`).join('\n')}\n\n— ${who}`;
}

/** The sections of a new change, in order, from the flags; the required three must be given. */
export function changeBody(flags: Pick<NewFlags, 'origin' | 'intent' | 'doneWhen' | 'scope' | 'openQuestions' | 'blockedOn' | 'notes'>, env: { session?: string; writer?: string }, date: string): string {
  const text: Partial<Record<ChangeSection, string | undefined>> = {
    Origin: flags.origin ? originText(flags.origin, env, date) : undefined,
    Intent: flags.intent, 'Done when': flags.doneWhen, Scope: flags.scope, 'Open questions': flags.openQuestions, 'Blocked on': flags.blockedOn, Notes: flags.notes,
  };
  return CHANGE_SECTIONS.filter((s) => text[s]?.trim()).map((s) => section(s, text[s])).join('\n');
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
    case 'aspect':
      return newAspect(store, ident, flags);
    case 'place':
      return newPlace(store, ident, flags);
    case 'project':
      return newProject(store, ident, flags);
    case 'change':
      return newChange(store, ident, flags);
    case 'decision':
      return newDecision(store, ident, flags);
    case 'release':
      return newRelease(store, ident, flags);
    case 'source':
      return newSource(store, ident, flags);
    case 'actor':
      return newActor(store, ident, flags);
    case 'session':
      return newSession(store, ident, flags);
    case 'session-kind':
      return newSessionKind(store, ident, flags);
    default:
      throw new CliError(`unknown record type '${type}' (product, feature, aspect, place, project, change, decision, release, source, actor, session, session-kind)`);
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
  if (!rec || rec.type !== 'product') throw notFound(`${what} ${key}`, { as: 'product' });
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

/** The product a new aspect or place is keyed under: the one its key names, else the current project's. */
function aspectProduct(loaded: Loaded, named: string | null, what: string): string {
  if (named) return productSlugOf(loaded, named, what);
  if (loaded.scope) return loaded.scope;
  throw new CliError(`${what}: no product in scope; name it in the key (${what}:<product>/${what === 'release' ? '<version>' : '<slug>'})`);
}

export function newAspect(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('aspect:') ? ident.slice(7) : ident;
  const a = parseAspectRest(rest);
  if (!a || a.segments.length > 2) throw new CliError(`'${rest}' is not a slug (lower-case letters, digits, hyphens), or <product>/<slug>`);
  if (!flags.title) throw new CliError('--title is required');
  const loaded = loadStore(store);
  const [named, slug] = a.segments.length === 2 ? a.segments : [null, a.segments[0]];
  const product = aspectProduct(loaded, named, 'aspect');
  const key = aspectKey(product, slug);
  const rel = path.join('products', product, 'aspects', slug, 'aspect.md');
  refuseExisting(store, rel);
  const data: Record<string, unknown> = { title: flags.title, name: flags.name, parent: flags.parent, owners: listOrNone(flags.owners), links: listOrNone(flags.links), ...stamp(flags) };
  fullKeys(loaded, 'aspect', data, undefined, product);
  writeFile(store, rel, render('aspect', data, flags.body?.trim() ? flags.body.trim() + '\n' : ''));
  return finish(store, 'aspect', key, rel, [rel], flags);
}

export function newPlace(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('aspect:') ? ident.slice(7) : ident;
  const a = parseAspectRest(rest);
  if (!a || a.segments.length < 2) throw new CliError(`'${ident}' must be aspect:<aspect>/<place> (aspect:<product>/<aspect>/<place> in full)`);
  if (!flags.feature) throw new CliError('--feature is required: the feature the aspect applies at');
  const loaded = loadStore(store);
  const [named, aslug, pslug] = a.segments.length === 3 ? a.segments : [null, a.segments[0], a.segments[1]];
  const product = aspectProduct(loaded, named, 'place');
  const aspect = loaded.byKey.get(aspectKey(product, aslug))?.[0];
  if (!aspect || aspect.type !== 'aspect') throw notFound(aspectKey(product, aslug), { hint: `pjman new aspect ${aslug} --title … makes it` });
  const key = aspectKey(product, aslug, pslug);
  const rel = path.join('products', product, 'aspects', aslug, 'places', `${pslug}.md`);
  refuseExisting(store, rel);
  const data: Record<string, unknown> = { feature: flags.feature, links: listOrNone(flags.links), ...stamp(flags) };
  fullKeys(loaded, 'place', data, undefined, product);
  writeFile(store, rel, render('place', data, flags.body?.trim() ? flags.body.trim() + '\n' : ''));
  return finish(store, 'place', key, rel, [rel], flags);
}

/** A release: the version a product shipped (decision releases-homebrew/release-is-a-record). Keyed under the product
 *  by version; its creation is the event a release is. What it ships is the changes in order; the body is the notes as
 *  they were published. */
export function newRelease(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('release:') ? ident.slice(8) : ident;
  const r = parseReleaseRest(rest);
  if (!r) throw new CliError(`'${rest}' is not a version (<major>.<minor>.<patch>), or <product>/<version>`);
  if (!flags.at) throw new CliError('--at is required: the instant the release was cut');
  if (!isTimestamp(flags.at)) throw new CliError('--at must be a timestamp');
  if (flags.level && !(RELEASE_LEVELS as readonly string[]).includes(flags.level)) throw new CliError(`--level must be one of ${RELEASE_LEVELS.join(', ')}`);
  const loaded = loadStore(store);
  const product = aspectProduct(loaded, r.product, 'release');
  const key = releaseKey(product, r.version);
  const rel = path.join('products', product, 'releases', `${r.version}.md`);
  refuseExisting(store, rel);
  const data: Record<string, unknown> = {
    version: r.version, tag: flags.tag ?? `v${r.version}`, level: flags.level, at: flags.at, commit: flags.commit, url: flags.url,
    ships: listOrNone(flags.ships), links: listOrNone(flags.links), ...stamp(flags),
  };
  fullKeys(loaded, 'release', data, undefined, product);
  writeFile(store, rel, render('release', data, flags.body?.trim() ? flags.body.trim() + '\n' : ''));
  return finish(store, 'release', key, rel, [rel], flags);
}

export function newProject(store: Store, ident: string, flags: NewFlags): NewResult {
  const slug = ident.startsWith('project:') ? ident.slice(8) : ident;
  if (!SLUG_RE.test(slug)) throw new CliError(`'${slug}' is not a slug (lower-case letters, digits, hyphens)`);
  if (!flags.title) throw new CliError('--title is required');
  const rel = path.join('projects', `${slug}.md`);
  refuseExisting(store, rel);
  const loaded = loadStore(store);
  const data: Record<string, unknown> = { title: flags.title, product: flags.product, parent: flags.parent, tracker: flags.tracker, map: flags.map, holds: flags.holds, owners: listOrNone(flags.owners), links: flags.links?.length ? flags.links : undefined, ...stamp(flags) };
  fullKeys(loaded, 'project', data, undefined, null);
  writeFile(store, rel, render('project', data, flags.body ? flags.body.trim() + '\n' : ''));
  return finish(store, 'project', `project:${slug}`, rel, [rel], flags);
}

/** The product a project names, as a slug; refused when it names none. */
export function productOfProject(loaded: Loaded, projectKey: string): { project: Rec; product: string } {
  const project = recordOf(loaded, projectKey, null);
  if (!project || project.type !== 'project') throw notFound(projectKey, { as: 'project' });
  const product = typeof project.data.product === 'string' ? recordOf(loaded, project.data.product, null) : undefined;
  if (!product || product.type !== 'product') throw new CliError(`${project.key} names no product; a change is keyed under its project's product: pjman set ${project.key} product=product:<slug> (pjman new product <slug> --title … first, when there is none)`);
  return { project, product: product.productSlug! };
}

/** Steps from their texts, each open and stamped now; an empty text is refused. */
function stepsFrom(texts: string[]): { text: string; state: 'open'; at: string }[] {
  const at = nowIso();
  return texts.map((t) => {
    if (!t.trim()) throw new CliError('--step: an empty step');
    return { text: t.trim(), state: 'open' as const, at };
  });
}

export function newChange(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('change:') ? ident.slice(7) : ident;
  const s = parseScopedRest(rest);
  if (!s) throw new CliError(`'${rest}' is not a slug (lower-case letters, digits, hyphens), or <product>/<slug>`);
  if (flags.title !== undefined || flags.summary !== undefined) throw usageError('a change has no title or summary: its rungs are --name (one to four words) and --gist (one line), its foundation --origin, --intent and --done-when (then --scope, --open-questions, --blocked-on, --notes); the plan is written with pjman step');
  for (const [flag, value] of [['--name', flags.name], ['--gist', flags.gist], ['--origin', flags.origin], ['--intent', flags.intent], ['--done-when', flags.doneWhen]] as const) {
    if (!value?.trim()) throw usageError(`${flag} is required: a change is filed with its name, gist, origin (the request in the person's words, or the key of what it came from), intent and done-when`);
  }
  const bad = nameProblem(flags.name!) ? `--name: ${nameProblem(flags.name!)}` : gistProblem(flags.gist!) ? `--gist: ${gistProblem(flags.gist!)}` : null;
  if (bad) throw new CliError(bad);
  const loaded = loadStore(store);
  const projectKey = flags.project ?? store.project;
  if (!projectKey) throw new CliError('no project: run from a registered repository or pass --project project:<slug>');
  const { project, product } = productOfProject(loaded, projectKey);
  if (s.product && productSlugOf(loaded, s.product, 'change') !== product) throw new CliError(`${project.key} belongs to product:${product}, not product:${s.product}; a change is keyed under its project's product`);
  const key = changeKey(product, s.slug);
  const rel = path.join('products', product, 'changes', s.slug, 'change.md');
  refuseExisting(store, rel);
  if (loaded.aliases.has(key)) throw new CliError(`refused: '${s.slug}' is a former name of ${loaded.aliases.get(key)!.join(', ')} in product:${product}`);
  const env = stamp(flags);
  // a source the origin names is linked, never copied
  const originKey = parseKey(flags.origin!.trim());
  const links = [...(flags.links ?? [])];
  if (originKey && !/\s/.test(flags.origin!.trim()) && !RECORD_KINDS.has(originKey.kind) && !links.includes(originKey.raw)) links.push(originKey.raw);
  const body = changeBody(flags, { session: env.session as string | undefined, writer: env.writer as string | undefined }, env.created as string) + (flags.body ? '\n' + flags.body.trim() + '\n' : '');
  const data: Record<string, unknown> = {
    name: flags.name!.trim(),
    gist: flags.gist!.trim(),
    status: flags.status ?? 'open',
    kind: flags.kind,
    severity: flags.severity,
    project: project.key,
    parent: flags.parent,
    depends_on: listOrNone(flags.dependsOn),
    features: listOrNone(flags.features),
    aspects: listOrNone(flags.aspects),
    owners: listOrNone(flags.owners),
    target: flags.target,
    binds: flags.binds?.length ? flags.binds : undefined,
    links: links.length ? links : undefined,
    plan: flags.steps?.length ? stepsFrom(flags.steps) : undefined,
    rungs_from: foundationHash(foundationOf('change', {}, parseSections(body))),
    ...env,
  };
  fullKeys(loaded, 'change', data, undefined, product);
  writeFile(store, rel, render('change', data, body));
  return finish(store, 'change', key, rel, [rel], flags);
}

/** The place a new decision lives, from its key: under a change, at product level, or at store level. */
export function decisionHome(loaded: Loaded, ident: string, date: string): { key: string; rel: string; product: string | null; change?: Rec } {
  const rest = ident.startsWith('decision:') ? ident.slice(9) : ident;
  const parsed = parseDecisionRest(rest);
  if (!parsed) throw usageError(`'${ident}' must be <change>/<decision-slug> (<product>/<change>/<slug> in full), <product>/<slug> at product level, or /<slug> at store level`);
  let product: string | null = null;
  let change: Rec | undefined;
  if (parsed.head) {
    if (parsed.segments === 3) {
      product = productSlugOf(loaded, parsed.head, 'decision');
      change = recordOf(loaded, `change:${product}/${parsed.change}`, null);
      if (!change) throw notFound(`change:${product}/${parsed.change}`);
    } else {
      const res = resolve(loaded, `change:${parsed.head}`);
      if (res.status === 'ok' || res.status === 'alias') {
        change = res.rec;
        product = change.productSlug!;
      } else if (res.status === 'ambiguous') throw unresolvedError(res, `change:${parsed.head}`);
      else if (loaded.byKey.has(`product:${parsed.head}`)) product = parsed.head; // product level
      else throw notFound(parsed.head, { tried: [`change:${parsed.head}`, `product:${parsed.head}`] });
    }
  }
  const key = decisionKey(product, change?.changeSlug ?? null, parsed.slug);
  const rel = change
    ? path.join('products', product!, 'changes', change.changeSlug!, 'decisions', `${date}-${parsed.slug}.md`)
    : product
      ? path.join('products', product, 'decisions', `${date}-${parsed.slug}.md`)
      : path.join('decisions', `${date}-${parsed.slug}.md`);
  return { key, rel, product, change };
}

export function newDecision(_store: Store, ident: string, _flags: NewFlags): NewResult {
  throw new CliError(`a decision is written with pjman decision ${ident.replace(/^decision:/, '')} --name "…" --gist "…" --question "…" --option <id>="…" [--recommend <id>="…"]: one command at any size, the same one to add to it later`);
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

/** A session kind (decision unbound-sessions/kinds): store-wide, keyed by slug, with a name (the slug's words when none
 *  is given) and a one-line gist. The naming command creates one it is handed that does not exist. */
export function newSessionKind(store: Store, ident: string, flags: NewFlags): NewResult {
  const slug = ident.startsWith('session-kind:') ? ident.slice('session-kind:'.length) : ident;
  if (!SLUG_RE.test(slug)) throw new CliError(`'${slug}' is not a slug (lower-case letters, digits, hyphens)`);
  const key = `session-kind:${slug}`;
  const rel = path.join('session-kinds', `${slug}.md`);
  refuseExisting(store, rel);
  const loaded = loadStore(store);
  if (loaded.aliases.has(key)) throw new CliError(`refused: '${slug}' is a former name of ${loaded.aliases.get(key)!.join(', ')}`);
  const name = flags.name?.trim() || slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const np = nameProblem(name);
  if (np) throw new CliError(`--name: ${np}`);
  const gist = flags.gist?.trim() || undefined;
  if (gist) {
    const gp = gistProblem(gist);
    if (gp) throw new CliError(`--gist: ${gp}`);
  }
  const data: Record<string, unknown> = { name, gist, links: listOrNone(flags.links), ...stamp(flags) };
  writeFile(store, rel, render('session-kind', data, flags.body ? flags.body.trim() + '\n' : ''));
  return finish(store, 'session-kind', key, rel, [rel], flags);
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
    // the project the session runs in, so a view of it knows its product before it binds a change
    project: flags.project ?? store.project,
    writer: env.writer,
    created: date,
  };
  const body = section('Log', flags.body);
  writeFile(store, rel, render('session', data, body));
  validateOrUndo(store, [rel], [rel]);
  const commit = finishWrite(store, `pjman: new session:${id}`, `session:${id}`, [{ op: 'created', key: `session:${id}`, type: 'session', path: rel, writer: env.writer }]);
  return { type: 'session', key: `session:${id}`, path: rel, commit, notes: [] };
}
