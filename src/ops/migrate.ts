// pjman migrate: the one move the store still waits for, in order (decision releases-homebrew/store-names-its-version).
// The layout: from store-wide keys to keys under the product. Every product becomes a folder
// (products/<slug>/product.md) holding its features and changes; every feature, change and decision key gains its
// product segment wherever it is written, in fields and in prose alike; each moved record keeps its old slug as an
// alias so old links, old prose and old URLs still resolve. The foundation: every change and decision mapped into its
// shape. Then the stamp: pjman.yaml names the format the store is in. One commit, one event per move;
// `pjman undo <commit>` reverts it.
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { IDENTITY_KINDS, writeStoreConfig, type Store } from '../store/config.js';
import { emit } from '../store/events.js';
import { commitAll, git, gitMv, isTracked, toplevel } from '../store/git.js';
import { loadLegacy } from '../store/legacy.js';
import { isLegacyLayout, loadStore, resolve, type Rec } from '../store/records.js';
import { CliError, localDate, nowIso } from '../store/util.js';
import { envelope, render } from './write.js';
import { formatProblems, validate } from '../model/validate.js';
import { CHANGE_SECTIONS, foundationHash, foundationOf, stepsOf, unmigrated } from '../model/foundation.js';
import { sections as parseSections } from '../store/frontmatter.js';
import { compareVersions, UNSTAMPED_VERSION } from '../store/version.js';
import { noteReshaping } from '../store/store-index.js';
import { missingSessionKinds, seedSessionKinds } from './session-kinds.js';

/** A move the store's format has made, with the pjman version that introduced it. In order: the first whose check says
 *  the store still needs it is the one `pjman migrate` makes. The layout and the foundation check the store's shape,
 *  since they predate the stamp and a store from then carries no version; a move from here on checks the stamp
 *  (`compareVersions(storeVersion(store), since) < 0`). */
export type MigrationName = 'layout' | 'foundation' | 'kinds' | 'session-kinds';

export interface Migration {
  name: MigrationName;
  /** The pjman version that introduced the move; the release that ships a new one is at least a minor. */
  since: string;
  /** Whether the store still needs this move. */
  pending: (store: Store) => boolean;
  run: (store: Store, opts: { session?: string; writer?: string }) => MigrateResult;
  about: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: 'layout',
    since: '0.2.0',
    pending: (store) => isLegacyLayout(store.root),
    run: (store, opts) => migrateLayout(store, opts),
    about: 'every record keyed under its product',
  },
  {
    name: 'foundation',
    since: '0.2.0',
    pending: (store) =>
      loadStore(store).records.some((r) => (r.type === 'change' || r.type === 'decision') && r.valid && unmigrated(r)),
    run: (store, opts) => migrateFoundation(store, opts),
    about: 'every change and decision in its shape',
  },
  {
    name: 'kinds',
    since: '0.3.0',
    pending: (store) =>
      compareVersions(storeVersion(store), '0.3.0') < 0 && parentsToPromote(loadStore(store)).length > 0,
    run: (store, opts) => migrateKinds(store, opts),
    about: 'every change named as a parent a milestone by its kind',
  },
  {
    name: 'session-kinds',
    since: '0.3.0',
    pending: (store) =>
      compareVersions(storeVersion(store), '0.3.0') < 0 && missingSessionKinds(loadStore(store)).length > 0,
    run: (store, opts) => migrateSessionKinds(store, opts),
    about: 'the kinds a session with no change may be given (review, backlog, chat, other) as records',
  },
];

/** The session kinds (decision unbound-sessions/kinds): the four defaults the store lacks are created, one write each. */
export function migrateSessionKinds(store: Store, opts: { session?: string; writer?: string } = {}): MigrateResult {
  if (store.mode === 'standalone' && git(store.root, ['status', '--porcelain', '--', '.']))
    throw new CliError('the store has uncommitted changes; commit or discard them first');
  const created = seedSessionKinds(store, opts);
  const commit = store.mode === 'standalone' ? git(store.root, ['rev-parse', '--short', 'HEAD']) : null;
  return { kind: 'session-kinds', since: '0.3.0', products: 0, moved: 0, rewritten: created.length, commit };
}

/** The format this pjman writes: the version of the latest move it knows. A store stamped higher was written by a newer
 *  pjman; one stamped lower, or not at all, waits for `pjman migrate`. */
export const FORMAT_VERSION: string = MIGRATIONS.reduce(
  (top, m) => (compareVersions(m.since, top) > 0 ? m.since : top),
  UNSTAMPED_VERSION,
);

/** The format a store is in: its stamp, or the version before the stamp existed. */
export const storeVersion = (store: Store): string => store.config.version ?? UNSTAMPED_VERSION;

export interface MigrateResult {
  /** Which move ran: the layout, the foundation, the kinds, or the stamp (pjman.yaml names the format). */
  kind: MigrationName | 'stamp';
  /** The pjman version that introduced the move. */
  since: string;
  products: number;
  moved: number;
  rewritten: number;
  /** The foundation migration: how many changes and decisions were mapped. */
  changes?: number;
  decisions?: number;
  /** The stamp: the version written to pjman.yaml. */
  version?: string;
  commit: string | null;
}

/** The one move that still waits, or null: each migration in order, then the stamp. */
export function pendingMigration(store: Store): MigrationName | 'stamp' | null {
  for (const m of MIGRATIONS) if (m.pending(store)) return m.name;
  return compareVersions(storeVersion(store), FORMAT_VERSION) < 0 ? 'stamp' : null;
}

/** The move a pending migration is, named for a reader: `the layout move (introduced in 0.2.0)`. */
export function describeMigration(name: MigrationName | 'stamp'): string {
  if (name === 'stamp') return `the stamp (pjman.yaml names the format, ${FORMAT_VERSION})`;
  const m = MIGRATIONS.find((x) => x.name === name)!;
  return `the ${m.name} move (${m.about}, introduced in ${m.since})`;
}

export function migrate(store: Store, opts: { session?: string; writer?: string } = {}): MigrateResult {
  noteReshaping(store);
  const pending = pendingMigration(store);
  if (!pending) {
    throw new CliError(
      `nothing to migrate: every record is keyed under its product, every change and decision is in its shape, every parent change is a milestone, the session kinds are records, and the store is in format ${storeVersion(store)}`,
    );
  }
  if (pending === 'stamp') return stamp(store, opts);
  return MIGRATIONS.find((m) => m.name === pending)!.run(store, opts);
}

/** The stamp: pjman.yaml names the format this pjman writes. One commit, one event. */
function stamp(store: Store, opts: { session?: string; writer?: string }): MigrateResult {
  const root = store.root;
  if (store.mode === 'standalone' && git(root, ['status', '--porcelain', '--', '.']))
    throw new CliError('the store has uncommitted changes; commit or discard them first');
  const from = storeVersion(store);
  writeStoreConfig(root, { ...store.config, version: FORMAT_VERSION });
  store.config.version = FORMAT_VERSION;
  const env = envelope(opts);
  const commit =
    store.mode === 'standalone'
      ? commitAll(root, `pjman: the store is in format ${FORMAT_VERSION}`, env.session)
      : null;
  emit(
    store,
    [
      {
        op: 'migrated',
        key: 'store',
        type: 'store',
        path: 'pjman.yaml',
        fields: ['version', `${from} → ${FORMAT_VERSION}`],
        writer: env.writer,
        session: env.session,
      },
    ],
    commit,
  );
  return { kind: 'stamp', since: FORMAT_VERSION, products: 0, moved: 0, rewritten: 0, version: FORMAT_VERSION, commit };
}

/** Why this pjman may not write the store, or null: the store's format is newer than the tool's (install the newer
 *  pjman), or older (run `pjman migrate`). A store from before the stamp is read as 0.1.0 and never refused here: its
 *  moves guard themselves, and the stamp follows them. */
export function formatMismatch(store: Store, toolVersion: string): string | null {
  const have = store.config.version;
  if (!have) return null;
  if (compareVersions(have, FORMAT_VERSION) > 0)
    return `the store is in format ${have}, newer than this pjman (${toolVersion}, format ${FORMAT_VERSION}): install pjman ${have} or newer before writing it`;
  if (compareVersions(have, FORMAT_VERSION) < 0)
    return `the store is in format ${have}; this pjman (${toolVersion}) brings format ${FORMAT_VERSION}: run pjman migrate, which names each move it makes`;
  return null;
}

const LIST_LINE = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/;

/** The lines of a Plan section as steps, when it reads as a list; else nothing, and the text goes to Notes. */
function planSteps(text: string, done: boolean, at: string): { steps: Record<string, unknown>[] | null } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length || !lines.every((l) => LIST_LINE.test(l))) return { steps: null };
  return { steps: lines.map((l) => ({ text: LIST_LINE.exec(l)![1].trim(), state: done ? 'done' : 'open', at })) };
}

/** A note line as `pjman note` writes one: the instant, then the text. */
const noteLine = (at: string, text: string): string => `- ${at} — ${text.replace(/\s*\n\s*/g, ' ')}`;

/** The foundation migration (decision record-foundation/migration-maps-old-records): every change and decision in the
 *  old shape mapped mechanically, nothing dropped. A title becomes a draft gist; a change's Summary its Intent; next and
 *  a plan that is not a list go to Notes; a plan that is a list becomes steps; Origin says where the record came from;
 *  a decision's Decision and Why become one option with its case, accepted by whoever decided it, or recommended while
 *  proposed. Each record is marked migrated until it is next written through the tool. One commit; pjman undo reverts it. */
export function migrateFoundation(store: Store, opts: { session?: string; writer?: string } = {}): MigrateResult {
  noteReshaping(store);
  const root = store.root;
  if (store.mode === 'standalone' && git(root, ['status', '--porcelain', '--', '.']))
    throw new CliError('the store has uncommitted changes; commit or discard them first');
  const loaded = loadStore(store);
  const date = localDate();
  const at = nowIso();
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
  let changes = 0;
  let decisions = 0;
  const inGit = toplevel(root) !== null;
  for (const r of loaded.records) {
    if (!r.valid || !unmigrated(r)) continue;
    const data: Record<string, unknown> = { ...r.data };
    const sections = new Map(r.sections);
    const made = (lead: string): string => {
      const from = [
        str(r.data.created) ? `created ${str(r.data.created)}` : '',
        str(r.data.writer) ? `by ${str(r.data.writer)}` : '',
        str(r.data.session) ? `in ${str(r.data.session)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `${lead}, ${date}.${from ? ` ${from[0].toUpperCase()}${from.slice(1)}.` : ''}`;
    };
    if (r.type === 'change') {
      const title = str(data.title);
      if (title) data.gist = oneLine(title);
      delete data.title;
      const notes: string[] = [];
      const summary = sections.get('Summary');
      if (summary?.trim()) sections.set('Intent', summary.trim());
      sections.delete('Summary');
      const plan = sections.get('Plan');
      if (plan?.trim()) {
        const { steps } = planSteps(plan, data.status === 'done', at);
        if (steps) data.plan = steps;
        else notes.push(noteLine(at, `plan (before the foundation): ${plan.trim()}`));
      }
      sections.delete('Plan');
      const planFile = r.abs.replace(/change\.md$/, 'plan.md');
      if (fs.existsSync(planFile)) {
        const text = fs.readFileSync(planFile, 'utf8').trim();
        if (text) {
          const { steps } = planSteps(text, data.status === 'done', at);
          if (steps && !data.plan) data.plan = steps;
          else notes.push(noteLine(at, `plan.md (before the foundation): ${text}`));
        }
        if (inGit && isTracked(root, path.relative(root, planFile)))
          git(root, ['rm', '-q', '--', path.relative(root, planFile)]);
        else fs.rmSync(planFile, { force: true });
      }
      const next = str(data.next);
      if (next?.trim()) notes.push(noteLine(at, `next (before the foundation): ${next.trim()}`));
      delete data.next;
      if (notes.length)
        sections.set('Notes', [sections.get('Notes')?.trim() ?? '', ...notes].filter(Boolean).join('\n'));
      sections.set(
        'Origin',
        made('Mapped from the record as it stood before the foundation (a title, a summary, a next)'),
      );
      changes++;
    } else {
      const title = str(data.title);
      if (title) data.gist = oneLine(title);
      delete data.title;
      const decision = sections.get('Decision')?.trim();
      const why = sections.get('Why')?.trim();
      sections.delete('Decision');
      sections.delete('Why');
      const thread: Record<string, unknown>[] = [
        ...(Array.isArray(data.thread) ? (data.thread as Record<string, unknown>[]) : []),
      ];
      const createdAt = str(data.created) ? `${str(data.created)}T12:00:00.000Z` : at;
      const by = str(data.writer);
      if (decision || why)
        thread.push({
          type: 'option',
          at: createdAt,
          by,
          id: 'chosen',
          text: decision || why,
          case: decision ? why : undefined,
        });
      const decidedBy = str(data.decided_by);
      if (data.status !== 'proposed' && decidedBy?.startsWith('person:') && (decision || why)) {
        thread.push({
          type: 'accept',
          at: str(data.decided_on) ? `${str(data.decided_on)}T12:00:00.000Z` : createdAt,
          by: decidedBy,
          option: 'chosen',
        });
      } else if (decision || why) thread.push({ type: 'recommendation', at: createdAt, by, option: 'chosen' });
      if (thread.length) data.thread = thread;
      if (data.status === 'decided' && !decidedBy?.startsWith('person:')) {
        // a decided decision nobody accepted (an agent's, or hand-written): it stays decided as the field says, with no
        // acceptance to show; the validator only checks a thread that holds one
        delete data.thread;
        sections.set(
          'Notes',
          [
            sections.get('Notes')?.trim() ?? '',
            noteLine(at, `decision (before the foundation): ${decision ?? ''}${why ? ` Why: ${why}` : ''}`),
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
      decisions++;
    }
    const order = r.type === 'change' ? [...CHANGE_SECTIONS] : ['Notes'];
    const rest = [...sections.keys()].filter((k) => k && !order.includes(k));
    const body = [...order, ...rest]
      .filter((k) => sections.get(k)?.trim())
      .map((k) => `## ${k}\n\n${sections.get(k)!.trim()}\n`)
      .join('\n');
    data.migrated = date;
    data.rungs_from = foundationHash(foundationOf(r.type, data, parseSections(body)));
    fs.writeFileSync(r.abs, render(r.type, data, body));
  }
  const problems = validate(loadStore(store)).filter((p) => p.level === 'error');
  if (problems.length) {
    if (inGit) {
      git(root, ['reset', '-q', '--hard', 'HEAD']);
      git(root, ['clean', '-qfd', '--', '.']);
    }
    throw new CliError(
      `refused: the migrated store would not validate; nothing was written\n${formatProblems(problems)}`,
    );
  }
  const env = envelope(opts);
  const commit =
    store.mode === 'standalone'
      ? commitAll(root, 'pjman: migrate changes and decisions into the foundation', env.session)
      : null;
  emit(
    store,
    [
      {
        op: 'migrated',
        key: 'store',
        type: 'store',
        path: 'pjman.yaml',
        fields: [`${changes} changes`, `${decisions} decisions`],
        writer: env.writer,
        session: env.session,
      },
    ],
    commit,
  );
  return {
    kind: 'foundation',
    since: '0.2.0',
    products: 0,
    moved: 0,
    rewritten: changes + decisions,
    changes,
    decisions,
    commit,
  };
}

/** The valid changes other valid changes name as parent that are not milestones by their kind: what the kinds move
 *  promotes (decision milestone-kind/kind-not-children). */
export function parentsToPromote(loaded: ReturnType<typeof loadStore>): Rec[] {
  const named = new Set<string>();
  for (const c of loaded.records) {
    if (c.type !== 'change' || !c.valid || typeof c.data.parent !== 'string') continue;
    const res = resolve(loaded, c.data.parent, c.productSlug ?? undefined);
    if (res.status === 'ok' || res.status === 'alias') named.add(res.rec.key);
  }
  return loaded.records.filter(
    (r) => r.type === 'change' && r.valid && named.has(r.key) && r.data.kind !== 'milestone',
  );
}

/** The kinds: every change another change names as parent becomes a milestone by its kind. Steps it carried go to
 *  its Notes as text, dated, since a milestone's plan is its children; a bug's severity goes the same way. One
 *  commit, one event; the store must validate afterwards or nothing is written. */
export function migrateKinds(store: Store, opts: { session?: string; writer?: string } = {}): MigrateResult {
  const root = store.root;
  if (store.mode === 'standalone' && git(root, ['status', '--porcelain', '--', '.']))
    throw new CliError('the store has uncommitted changes; commit or discard them first');
  const loaded = loadStore(store);
  const at = nowIso();
  const inGit = toplevel(root) !== null;
  const promoted = parentsToPromote(loaded);
  for (const r of promoted) {
    const data: Record<string, unknown> = { ...r.data, kind: 'milestone' };
    const sections = new Map(r.sections);
    const notes: string[] = [];
    const steps = stepsOf(r.data);
    if (steps.length) {
      const mark = (s: string) => (s === 'done' ? 'x' : s === 'dropped' ? '-' : s === 'active' ? '>' : ' ');
      notes.push(
        noteLine(
          at,
          `plan (before the milestone kind; a milestone's plan is its children): ${steps.map((s, i) => `${i + 1}. [${mark(s.state)}] ${s.text}${s.note ? ` (${s.note})` : ''}`).join(' · ')}`,
        ),
      );
    }
    delete data.plan;
    if (typeof data.severity === 'string') {
      notes.push(noteLine(at, `severity (before the milestone kind): ${data.severity}`));
      delete data.severity;
    }
    if (notes.length) sections.set('Notes', [sections.get('Notes')?.trim() ?? '', ...notes].filter(Boolean).join('\n'));
    const order = [...CHANGE_SECTIONS];
    const rest = [...sections.keys()].filter((k) => k && !(order as string[]).includes(k));
    const body = [...order, ...rest]
      .filter((k) => sections.get(k)?.trim())
      .map((k) => `## ${k}\n\n${sections.get(k)!.trim()}\n`)
      .join('\n');
    fs.writeFileSync(r.abs, render('change', data, body));
  }
  const problems = validate(loadStore(store)).filter((p) => p.level === 'error');
  if (problems.length) {
    if (inGit) {
      git(root, ['reset', '-q', '--hard', 'HEAD']);
      git(root, ['clean', '-qfd', '--', '.']);
    }
    throw new CliError(
      `refused: the migrated store would not validate; nothing was written\n${formatProblems(problems)}`,
    );
  }
  const env = envelope(opts);
  const commit =
    store.mode === 'standalone'
      ? commitAll(root, 'pjman: migrate parent changes into the milestone kind', env.session)
      : null;
  emit(
    store,
    [
      {
        op: 'migrated',
        key: 'store',
        type: 'store',
        path: 'pjman.yaml',
        fields: [`${promoted.length} milestones`],
        writer: env.writer,
        session: env.session,
      },
    ],
    commit,
  );
  return {
    kind: 'kinds',
    since: '0.3.0',
    products: 0,
    moved: 0,
    rewritten: promoted.length,
    changes: promoted.length,
    commit,
  };
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole flat key (`change:<slug>`, `feature:<slug>`) → its key under the product. */
const rewriteFlat = (text: string, kind: string, slug: string, product: string): string =>
  text.replace(
    new RegExp(`(^|[^A-Za-z0-9_/:-])${kind}:${esc(slug)}(?![A-Za-z0-9_/-])`, 'g'),
    `$1${kind}:${product}/${slug}`,
  );
/** `decision:<change>/` → `decision:<product>/<change>/`. */
const rewriteDecisions = (text: string, change: string, product: string): string =>
  text.replace(new RegExp(`(^|[^A-Za-z0-9_/:-])decision:${esc(change)}/`, 'g'), `$1decision:${product}/${change}/`);

export function migrateLayout(store: Store, opts: { session?: string; writer?: string } = {}): MigrateResult {
  noteReshaping(store);
  const root = store.root;
  if (!isLegacyLayout(root)) throw new CliError('nothing to migrate: every record is already keyed under its product');
  if (store.mode === 'standalone' && git(root, ['status', '--porcelain', '--', '.']))
    throw new CliError('the store has uncommitted changes; commit or discard them first');
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
  for (const r of records)
    if (r.type === 'decision' && r.changeSlug) {
      const p = home.get(`change:${r.changeSlug}`);
      if (p) home.set(r.key, p);
    }
  if (homeless.length) {
    throw new CliError(
      `${homeless.length} record${homeless.length === 1 ? ' belongs' : 's belong'} to no product, and every feature and change is keyed under one:\n${homeless.map((k) => `  ${k}`).join('\n')}\nGive each project a product (pjman new product <slug> --title …; pjman set project:<slug> product=product:<slug>) and run the migration again`,
    );
  }

  // moves: product files into folders, feature and change folders under their product
  const moves: [string, string][] = [];
  const pathAfter = new Map<string, string>();
  for (const r of records) {
    if (r.type === 'product' && !r.path.endsWith('/product.md'))
      moves.push([r.path, path.join('products', r.productSlug!, 'product.md')]);
    if (r.type === 'feature' || r.type === 'change') {
      const p = home.get(r.key)!;
      moves.push([
        path.dirname(r.path),
        path.join('products', p, r.type === 'feature' ? 'features' : 'changes', path.basename(path.dirname(r.path))),
      ]);
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
    if (fs.existsSync(abs) && fs.readdirSync(abs).every((n) => n === '.gitkeep'))
      fs.rmSync(abs, { recursive: true, force: true });
  }

  // rewrites: every flat key in every record, longest slugs first so a slug that prefixes another is never clipped
  const features = records
    .filter((r) => r.type === 'feature')
    .toSorted((a, b) => b.featureSlug!.length - a.featureSlug!.length);
  const changes = records
    .filter((r) => r.type === 'change')
    .toSorted((a, b) => b.changeSlug!.length - a.changeSlug!.length);
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
    throw new CliError(
      `refused: the migrated store would not validate; nothing was written\n${formatProblems(problems)}`,
    );
  }
  const env = envelope(opts);
  const commit =
    store.mode === 'standalone' ? commitAll(root, 'pjman: migrate keys under the product', env.session) : null;
  emit(
    store,
    [
      {
        op: 'migrated',
        key: 'store',
        type: 'store',
        path: 'pjman.yaml',
        fields: [`${moves.length} moved`, `${rewritten} rewritten`],
        writer: env.writer,
        session: env.session,
      },
    ],
    commit,
  );
  return {
    kind: 'layout',
    since: '0.2.0',
    products: records.filter((r) => r.type === 'product').length,
    moved: moves.length,
    rewritten,
    commit,
  };
}
