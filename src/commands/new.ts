import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../config.js';
import { parseDecisionRest, parseKey, SLUG_RE, sourceFileSlug } from '../keys.js';
import { loadStore, resolve, type RecordType } from '../records.js';
import { CliError, isDateString, localDate, today } from '../util.js';
import { commitIfStandalone, envelope, render, validateOrUndo, writeFile } from '../write.js';

export interface NewFlags {
  title?: string;
  project?: string;
  tracker?: string;
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
      throw new CliError(`unknown record type '${type}' (project, change, decision, source, actor, session)`);
  }
}

function finish(store: Store, type: RecordType, key: string, rel: string, created: string[], flags: NewFlags, notes: string[] = []): NewResult {
  validateOrUndo(store, [rel, ...created], created);
  const commit = commitIfStandalone(store, `pjman: new ${key}`, envelope(flags).session);
  return { type, key, path: rel, commit, notes };
}

export function newProject(store: Store, ident: string, flags: NewFlags): NewResult {
  const slug = ident.startsWith('project:') ? ident.slice(8) : ident;
  if (!SLUG_RE.test(slug)) throw new CliError(`'${slug}' is not a slug (lower-case letters, digits, hyphens)`);
  if (!flags.title) throw new CliError('--title is required');
  const rel = path.join('projects', `${slug}.md`);
  refuseExisting(store, rel);
  const data: Record<string, unknown> = { title: flags.title, tracker: flags.tracker, links: flags.links?.length ? flags.links : undefined, ...stamp(flags) };
  writeFile(store, rel, render('project', data, flags.body ? flags.body.trim() + '\n' : ''));
  return finish(store, 'project', `project:${slug}`, rel, [rel], flags);
}

export function newChange(store: Store, ident: string, flags: NewFlags): NewResult {
  const slug = ident.startsWith('change:') ? ident.slice(7) : ident;
  if (!SLUG_RE.test(slug)) throw new CliError(`'${slug}' is not a slug (lower-case letters, digits, hyphens)`);
  if (!flags.title) throw new CliError('--title is required');
  const rel = path.join('changes', slug, 'change.md');
  refuseExisting(store, rel);
  const loaded = loadStore(store);
  if (loaded.aliasOf.has(slug)) throw new CliError(`refused: '${slug}' is an alias of ${loaded.aliasOf.get(slug)}`);
  const data: Record<string, unknown> = {
    title: flags.title,
    status: flags.status ?? 'open',
    project: flags.project ?? store.project,
    parent: flags.parent,
    next: flags.next,
    binds: flags.binds?.length ? flags.binds : undefined,
    links: flags.links?.length ? flags.links : undefined,
    ...stamp(flags),
  };
  let body = section('Summary', flags.summary);
  if (flags.plan) body += '\n' + section('Plan', flags.plan);
  if (flags.body) body += '\n' + flags.body.trim() + '\n';
  writeFile(store, rel, render('change', data, body));
  return finish(store, 'change', `change:${slug}`, rel, [rel], flags);
}

export function newDecision(store: Store, ident: string, flags: NewFlags): NewResult {
  const rest = ident.startsWith('decision:') ? ident.slice(9) : ident;
  const parsed = parseDecisionRest(rest);
  if (!parsed) throw new CliError(`'${ident}' must be <change-slug>/<decision-slug> or /<decision-slug> for store level`);
  if (!flags.title) throw new CliError('--title is required');
  const loaded = loadStore(store);
  if (parsed.changeSlug) {
    const res = resolve(loaded, `change:${parsed.changeSlug}`);
    if (res.status === 'missing' || res.status === 'malformed') throw new CliError(`change:${parsed.changeSlug} does not exist`);
    if (res.status === 'alias') parsed.changeSlug = res.rec.changeSlug!;
  }
  const env = stamp(flags);
  const date = env.created as string;
  const rel = parsed.changeSlug
    ? path.join('changes', parsed.changeSlug, 'decisions', `${date}-${parsed.dslug}.md`)
    : path.join('decisions', `${date}-${parsed.dslug}.md`);
  const key = `decision:${parsed.changeSlug ?? ''}/${parsed.dslug}`;
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
  const notes: string[] = [];
  const touched: string[] = [];
  if (flags.supersedes) {
    const res = resolve(loaded, flags.supersedes);
    if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`supersedes: ${flags.supersedes} does not resolve`);
    if (res.rec.data.status !== 'superseded') {
      const text = fs.readFileSync(res.rec.abs, 'utf8');
      const updated = render('decision', { ...res.rec.data, status: 'superseded' }, res.rec.body);
      if (updated !== text) fs.writeFileSync(res.rec.abs, updated);
      touched.push(res.rec.path);
      notes.push(`${res.rec.key} is now superseded`);
    }
  }
  let body = section('Decision', flags.decision) + '\n' + section('Why', flags.why);
  if (flags.body) body += '\n' + flags.body.trim() + '\n';
  writeFile(store, rel, render('decision', data, body));
  validateOrUndo(store, [rel, ...touched], [rel]);
  const commit = commitIfStandalone(store, `pjman: new ${key}`, envelope(flags).session);
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
  const data: Record<string, unknown> = { kind: key.kind, name: flags.name, url: flags.url, ...stamp(flags) };
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
  const commit = commitIfStandalone(store, `pjman: new session:${id}`, `session:${id}`);
  return { type: 'session', key: `session:${id}`, path: rel, commit, notes: [] };
}
