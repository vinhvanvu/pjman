import {
  ACTOR_KINDS,
  CANONICAL_STATUSES,
  CHANGE_KINDS,
  DECISION_STATUSES,
  HOLDS,
  MAP_ANSWERS,
  SEVERITIES,
} from '../store/config.js';
import { EFFECTS, FEATURE_STATUSES, parseEffect } from './tree.js';
import { isActorKey, parseKey, productOfKey, SLUG_RE, slugify, sourceFileSlug, VERSION_RE } from '../store/keys.js';
import {
  FIELD_ORDER,
  headField,
  LAYER_OF,
  resolve,
  type Loaded,
  type Problem,
  type Rec,
  type RecordType,
  type Resolution,
} from '../store/records.js';
import { supersedesOf } from './supersede.js';
import { parseAspectEffect } from './aspects.js';
import { isDateString, isTimestamp, localDate } from '../store/util.js';
import {
  CHANGE_SECTIONS,
  ENTRY_TYPES,
  gistProblem,
  nameProblem,
  STEP_STATES,
  stepsOf,
  threadOf,
  decisionState,
  unmigrated,
} from './foundation.js';

const REQUIRED: Record<RecordType, string[]> = {
  product: ['title'],
  feature: ['title'],
  aspect: ['title'],
  place: ['feature'],
  project: ['title'],
  change: ['status'],
  decision: ['status'],
  release: ['version', 'tag', 'at'],
  source: ['kind', 'key'],
  session: ['agent', 'on_behalf_of', 'started'],
  'session-kind': ['name'],
  actor: ['kind'],
};

const STRING_FIELDS: Record<RecordType, string[]> = {
  product: ['title', 'name', 'writer', 'session', 'created'],
  feature: ['title', 'name', 'status', 'level', 'product', 'parent', 'writer', 'session', 'created'],
  aspect: ['title', 'name', 'parent', 'writer', 'session', 'created'],
  place: ['feature', 'writer', 'session', 'created'],
  project: ['title', 'product', 'parent', 'tracker', 'map', 'holds', 'writer', 'session', 'created'],
  change: [
    'name',
    'gist',
    'status',
    'kind',
    'severity',
    'project',
    'parent',
    'target',
    'rungs_from',
    'migrated',
    'writer',
    'session',
    'created',
  ],
  decision: [
    'name',
    'gist',
    'status',
    'decided_by',
    'decided_on',
    'rungs_from',
    'migrated',
    'writer',
    'session',
    'created',
  ], // supersedes: a key or a list, checked below
  release: ['version', 'tag', 'level', 'at', 'commit', 'url', 'writer', 'session', 'created'],
  source: ['kind', 'key', 'title', 'url', 'writer', 'session', 'created'],
  session: ['agent', 'on_behalf_of', 'started', 'parent', 'project', 'name', 'kind', 'writer', 'created'],
  'session-kind': ['name', 'gist', 'writer', 'session', 'created'],
  actor: ['kind', 'name', 'url', 'writer', 'session', 'created'],
};

const LIST_FIELDS: Record<RecordType, string[]> = {
  product: ['owners', 'levels', 'sequence', 'links', 'aliases'],
  feature: ['owners', 'links', 'aliases'],
  aspect: ['owners', 'links'],
  place: ['links'],
  project: ['owners', 'links'],
  change: ['depends_on', 'features', 'aspects', 'owners', 'binds', 'links', 'aliases'],
  decision: ['links'],
  release: ['ships', 'links'],
  source: ['links'],
  session: ['changes'],
  'session-kind': ['links', 'aliases'],
  actor: ['links', 'aliases'],
};

/** The levels a release bumps the version by (semver). */
export const RELEASE_LEVELS = ['patch', 'minor', 'major'] as const;

/** A change's Origin is the one section every path that creates a change writes; Intent and Done when are required of
 *  a filed change by the command, and an ingested or migrated one says it needs them until it is first worked. */
const REQUIRED_SECTIONS: Partial<Record<RecordType, string[]>> = {
  change: ['Origin'],
};
/** The sections a record may hold; anything else is a warning, since the foundation is read by its sections. */
const KNOWN_SECTIONS: Partial<Record<RecordType, readonly string[]>> = {
  change: CHANGE_SECTIONS,
  decision: ['Notes'],
};

/** Edge name → [from kinds, to kinds]. 'source' stands for any source kind. */
export const EDGES: Record<string, [string[], string[]]> = {
  binds: [['change'], ['source']],
  links: [['product', 'feature', 'aspect', 'project', 'change', 'decision', 'source', 'actor', 'session'], ['source']], // a session: a source it read with no change bound (decision unbound-sessions/sources)
  supersedes: [['decision'], ['decision']],
  parent: [
    ['session', 'change', 'feature', 'aspect', 'project'],
    ['session', 'change', 'feature', 'aspect', 'project'],
  ],
  depends_on: [['change'], ['change']],
  sequence: [['product'], ['change']],
  changes: [['session'], ['change']],
  project: [['change', 'session'], ['project']],
  product: [['feature', 'project'], ['product']],
  owners: [['product', 'feature', 'aspect', 'project', 'change'], ['actor']],
  feature: [['aspect'], ['feature']],
  aspects: [['change'], ['aspect']],
  adds: [['change'], ['feature']],
  removes: [['change'], ['feature']],
  ships: [['release'], ['change']],
  kind: [['session'], ['session-kind']],
};

/** A slug alias, or `<product>/<slug>` for a key the record had in another product. */
const ALIAS_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?$/;

/** Every problem in the store; with `only`, the problems of the records at those paths, checked against the rest (a
 *  write's own validation: what it wrote, without reading every other record whole). */
export function validate(loaded: Loaded, opts: { only?: Set<string> } = {}): Problem[] {
  const only = opts.only;
  const problems: Problem[] = only ? loaded.problems.filter((p) => only.has(p.path)) : [...loaded.problems];
  const h = headField;
  const { store } = loaded;
  const sourceKinds = new Set(store.config.source_kinds.map((k) => k.toLowerCase()));
  const layers = new Set(store.config.layers);
  const canonical = new Set<string>(CANONICAL_STATUSES);

  const err = (r: Rec | string, message: string) =>
    problems.push({ level: 'error', path: typeof r === 'string' ? r : r.path, message });
  const warn = (r: Rec | string, message: string) =>
    problems.push({ level: 'warning', path: typeof r === 'string' ? r : r.path, message });
  const info = (r: Rec | string, message: string) =>
    problems.push({ level: 'info', path: typeof r === 'string' ? r : r.path, message });
  if (!store.config.version)
    info('pjman.yaml', 'the store names no format version (read as 0.1.0); pjman migrate stamps it');
  else if (!VERSION_RE.test(store.config.version))
    err(
      'pjman.yaml',
      `version '${store.config.version}' is not <major>.<minor>.<patch>; the stamp is written by pjman init and pjman migrate`,
    );

  /** The scope a record's own references resolve in: its product, or none. Never the current project's. */
  const scopeOf = (r: Rec): string | null => r.productSlug ?? null;
  const res = (r: Rec, raw: unknown): Resolution => resolve(loaded, raw, scopeOf(r));
  const liveKey = (r: Rec, raw: unknown): string | undefined => {
    const x = res(r, raw);
    return x.status === 'ok' || x.status === 'alias' ? x.rec.key : undefined;
  };

  /** Check one reference. `expect` is a list of kinds ('source' covers any source kind). */
  const checkRef = (r: Rec, field: string, raw: unknown, expect: string[]): void => {
    const key = parseKey(raw);
    if (!key) {
      err(r, `${field}: '${String(raw)}' is not a key (kind:rest)`);
      return;
    }
    const isRecordKind = [
      'person',
      'agent',
      'change',
      'decision',
      'session',
      'session-kind',
      'project',
      'product',
      'feature',
      'aspect',
      'release',
    ].includes(key.kind);
    const cls = isRecordKind ? (isActorKey(key) ? 'actor' : key.kind) : 'source';
    if (cls === 'source' && !sourceKinds.has(key.kind)) {
      err(r, `${field}: '${key.raw}' has unknown kind '${key.kind}' (not a record kind; not in source_kinds)`);
      return;
    }
    if (!expect.includes(cls)) {
      err(r, `${field}: '${key.raw}' must be a ${expect.join(' or ')} key`);
      return;
    }
    const x = res(r, key.raw);
    switch (x.status) {
      case 'missing':
        err(r, `${field}: '${key.raw}' does not resolve`);
        break;
      case 'ambiguous':
        err(r, `${field}: '${key.raw}' is ambiguous (${x.candidates.join(', ')}); write the product's key`);
        break;
      case 'invalid':
        warn(r, `${field}: '${key.raw}' resolves to ${x.rec.path}, which is invalid`);
        break;
      case 'alias':
        info(r, `${field}: '${key.raw}' resolves via alias to '${x.rec.key}'`);
        break;
      case 'ok':
        // a stored reference is the full key; a bare one still resolves inside the record's product, and fmt will not rewrite it
        if (
          (key.kind === 'change' || key.kind === 'feature' || key.kind === 'decision' || key.kind === 'aspect') &&
          x.rec.key !== key.raw
        )
          info(r, `${field}: '${key.raw}' is the short form of '${x.rec.key}'`);
        break;
      default:
        break;
    }
  };

  // --- per record -----------------------------------------------------------
  for (const r of loaded.records) {
    if (only && !only.has(r.path)) continue;
    for (const e of r.parsed.errors) err(r, e);
    for (const u of r.parsed.unquoted) err(r, u);
    if (!r.valid) continue;
    const d = r.data;

    const layer = LAYER_OF[r.type];
    if (!layers.has(layer)) err(r, `layer '${layer}' is not enabled in pjman.yaml (layers: ${[...layers].join(', ')})`);

    for (const f of REQUIRED[r.type])
      if (d[f] === undefined || d[f] === null || d[f] === '') err(r, `missing required field '${f}'`);
    for (const f of STRING_FIELDS[r.type])
      if (d[f] !== undefined && typeof d[f] !== 'string') err(r, `'${f}' must be a string`);
    for (const f of LIST_FIELDS[r.type]) {
      if (d[f] === undefined) continue;
      if (!Array.isArray(d[f]) || !(d[f] as unknown[]).every((x) => typeof x === 'string'))
        err(r, `'${f}' must be a list of keys`);
    }
    const known = new Set(FIELD_ORDER[r.type]);
    if (r.type === 'session') known.add('session');
    for (const f of Object.keys(d))
      if (!known.has(f)) warn(r, `unknown field '${f}'; extensions go under ext.<owner>.<field>`);

    if (typeof d.writer === 'string') checkRef(r, 'writer', d.writer, ['actor']);
    if (typeof d.session === 'string') checkRef(r, 'session', d.session, ['session']);
    if (d.created !== undefined && !isDateString(d.created)) err(r, `'created' must be a date (yyyy-mm-dd)`);
    if (d.ext !== undefined && (typeof d.ext !== 'object' || d.ext === null || Array.isArray(d.ext)))
      err(r, `'ext' must be a mapping`);

    if ((r.type === 'change' || r.type === 'decision') && unmigrated(r)) {
      err(
        r,
        `the record is in the shape before the foundation (a title, a Summary, a Decision section); run \`pjman migrate\` once`,
      );
      continue;
    }
    for (const s of REQUIRED_SECTIONS[r.type] ?? [])
      if (!r.sections.has(s)) err(r, `body is missing the '## ${s}' section`);
    const knownSections = KNOWN_SECTIONS[r.type];
    if (knownSections)
      for (const s of r.sections.keys())
        if (s && !knownSections.includes(s)) warn(r, `unknown section '## ${s}' (${knownSections.join(', ')})`);
    if (r.type === 'change' || r.type === 'decision') {
      if (typeof d.name === 'string') {
        const p = nameProblem(d.name);
        if (p) err(r, `name: ${p} ('${d.name}')`);
      }
      if (typeof d.gist === 'string') {
        const p = gistProblem(d.gist);
        if (p) err(r, `gist: ${p}`);
      }
      if (d.migrated !== undefined && !isDateString(d.migrated)) err(r, `'migrated' must be a date (yyyy-mm-dd)`);
    }

    // a parent chain of the record's own kind that returns to it is a cycle
    const parentCycle = (field: string): void => {
      const seen = new Set<string>([r.key]);
      let cur: Rec | undefined = r;
      for (;;) {
        const x: Resolution | null =
          cur && typeof cur.data[field] === 'string' ? resolve(loaded, cur.data[field], scopeOf(cur)) : null;
        if (!x || (x.status !== 'ok' && x.status !== 'alias')) break;
        if (seen.has(x.rec.key)) {
          err(r, `'${field}' cycles: ${[...seen, x.rec.key].join(' → ')}`);
          break;
        }
        seen.add(x.rec.key);
        cur = x.rec;
      }
    };
    /** A list of aliases: slugs, or `<product>/<slug>` for a key once held in another product; none may be live. */
    const checkAliases = (kind: string): void => {
      for (const a of listOf(d.aliases)) {
        if (!ALIAS_RE.test(a)) err(r, `aliases: '${a}' is not a slug`);
        else {
          const full = r.productSlug && !a.includes('/') ? `${kind}:${r.productSlug}/${a}` : `${kind}:${a}`;
          // an alias equal to the record's own slug says it held the flat key before keys were paths under the product
          if (full !== r.key && loaded.byKey.has(full)) err(r, `aliases: '${a}' is also a live ${kind} key`);
        }
      }
    };
    for (const k of listOf(d.owners)) checkRef(r, 'owners', k, ['actor']);

    switch (r.type) {
      case 'product': {
        if (r.productSlug && !SLUG_RE.test(r.productSlug)) err(r, `folder name '${r.productSlug}' is not a slug`);
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        for (const a of listOf(d.aliases)) {
          if (!SLUG_RE.test(a)) err(r, `aliases: '${a}' is not a slug`);
          else if (loaded.byKey.has(`product:${a}`)) err(r, `aliases: '${a}' is also a live product slug`);
        }
        {
          const seen = new Set<string>();
          for (const k of listOf(d.sequence)) {
            checkRef(r, 'sequence', k, ['change']);
            const key = liveKey(r, k) ?? k;
            if (seen.has(key)) err(r, `sequence: '${k}' appears twice`);
            seen.add(key);
            const p = productOfKey(key);
            if (p && p !== r.productSlug) err(r, `sequence: '${k}' belongs to product:${p}, not this product`);
          }
        }
        break;
      }
      case 'feature': {
        if (r.featureSlug && !SLUG_RE.test(r.featureSlug)) err(r, `folder name '${r.featureSlug}' is not a slug`);
        if (typeof d.name === 'string' && (!d.name.trim() || d.name.trim().split(/\s+/).length > 3))
          err(r, `name: one to three words, the label the tree shows ('${d.name}')`);
        if (typeof d.status === 'string' && !(FEATURE_STATUSES as readonly string[]).includes(d.status))
          err(r, `status '${d.status}' is not one of ${FEATURE_STATUSES.join(', ')}`);
        if (typeof d.product !== 'string' && typeof d.parent !== 'string')
          err(r, `a feature names its 'product' (a top-level feature) or its 'parent' (a feature)`);
        if (typeof d.product === 'string') {
          checkRef(r, 'product', d.product, ['product']);
          const p = liveKey(r, d.product);
          if (p && p !== `product:${r.productSlug}`)
            err(r, `product: '${d.product}' is not the product this feature is keyed under (product:${r.productSlug})`);
        }
        if (typeof d.parent === 'string') {
          checkRef(r, 'parent', d.parent, ['feature']);
          const p = liveKey(r, d.parent);
          if (p && productOfKey(p) !== r.productSlug)
            err(r, `parent: '${d.parent}' is in another product; a feature nests inside its own product`);
          parentCycle('parent');
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        checkAliases('feature');
        break;
      }
      case 'aspect': {
        if (r.aspectSlug && !SLUG_RE.test(r.aspectSlug)) err(r, `folder name '${r.aspectSlug}' is not a slug`);
        if (typeof d.name === 'string' && (!d.name.trim() || d.name.trim().split(/\s+/).length > 3))
          err(r, `name: one to three words ('${d.name}')`);
        if (typeof d.parent === 'string') {
          checkRef(r, 'parent', d.parent, ['aspect']);
          const p = res(r, d.parent);
          if ((p.status === 'ok' || p.status === 'alias') && p.rec.type !== 'aspect')
            err(r, `parent: '${d.parent}' is a place; an aspect nests under an aspect`);
          else if ((p.status === 'ok' || p.status === 'alias') && p.rec.productSlug !== r.productSlug)
            err(r, `parent: '${d.parent}' is in another product; an aspect nests inside its own product`);
          parentCycle('parent');
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        break;
      }
      case 'place': {
        if (r.placeSlug && !SLUG_RE.test(r.placeSlug)) err(r, `file name '${r.placeSlug}' is not a slug`);
        if (typeof d.feature === 'string') {
          checkRef(r, 'feature', d.feature, ['feature']);
          const f = liveKey(r, d.feature);
          if (f && productOfKey(f) !== r.productSlug)
            err(r, `feature: '${d.feature}' is in another product; an aspect applies inside its own product`);
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        break;
      }
      case 'release': {
        if (typeof d.version === 'string' && !VERSION_RE.test(d.version))
          err(r, `version '${d.version}' is not <major>.<minor>.<patch>`);
        if (typeof d.version === 'string' && r.releaseVersion && d.version !== r.releaseVersion)
          err(r, `version '${d.version}' is not the file's (${r.releaseVersion})`);
        if (typeof d.tag === 'string' && typeof d.version === 'string' && d.tag !== `v${d.version}`)
          err(r, `tag '${d.tag}' is not v${d.version}`);
        if (typeof d.level === 'string' && !(RELEASE_LEVELS as readonly string[]).includes(d.level))
          err(r, `level '${d.level}' is not one of ${RELEASE_LEVELS.join(', ')}`);
        if (d.at !== undefined && !isTimestamp(d.at)) err(r, `'at' must be a timestamp`);
        const seen = new Set<string>();
        for (const k of listOf(d.ships)) {
          checkRef(r, 'ships', k, ['change']);
          const c = liveKey(r, k);
          if (c && productOfKey(c) !== r.productSlug)
            err(r, `ships: '${k}' is in another product; a release ships its own product's changes`);
          if (c && seen.has(c)) err(r, `ships: '${k}' is listed twice`);
          if (c) seen.add(c);
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        break;
      }
      case 'project': {
        if (r.projectSlug && !SLUG_RE.test(r.projectSlug)) err(r, `file name '${r.projectSlug}' is not a slug`);
        if (typeof d.product === 'string') checkRef(r, 'product', d.product, ['product']);
        if (typeof d.parent === 'string') {
          checkRef(r, 'parent', d.parent, ['project']);
          parentCycle('parent');
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        if (typeof d.map === 'string' && !(MAP_ANSWERS as readonly string[]).includes(d.map))
          err(r, `map '${d.map}' is not one of ${MAP_ANSWERS.join(', ')}`);
        if (typeof d.holds === 'string' && !(HOLDS as readonly string[]).includes(d.holds))
          err(r, `holds '${d.holds}' is not one of ${HOLDS.join(', ')}`);
        if (
          typeof d.tracker === 'string' &&
          !store.config.source_kinds.map((k) => k.toLowerCase()).includes(d.tracker.toLowerCase())
        ) {
          err(r, `tracker '${d.tracker}' is not in source_kinds (${store.config.source_kinds.join(', ')})`);
        }
        break;
      }
      case 'change': {
        if (typeof d.status === 'string' && !canonical.has(d.status)) {
          const mapped = store.config.vocabulary[d.status];
          err(
            r,
            mapped
              ? `status '${d.status}' is not canonical; the vocabulary maps it to '${mapped}', which is what the file must say`
              : `status '${d.status}' is not in the vocabulary (${CANONICAL_STATUSES.join(', ')})`,
          );
        }
        if (typeof d.kind === 'string' && !(CHANGE_KINDS as readonly string[]).includes(d.kind))
          err(r, `kind '${d.kind}' is not one of ${CHANGE_KINDS.join(', ')}`);
        if (typeof d.severity === 'string') {
          if (!(SEVERITIES as readonly string[]).includes(d.severity))
            err(r, `severity '${d.severity}' is not one of ${SEVERITIES.join(', ')}`);
          if (d.kind !== 'bug')
            err(r, `severity is a bug's field; this change's kind is '${String(d.kind ?? 'work')}'`);
        }
        if (d.target !== undefined && !isDateString(d.target)) err(r, `'target' must be a date (yyyy-mm-dd)`);
        if (typeof d.project === 'string') {
          checkRef(r, 'project', d.project, ['project']);
          // the change is keyed under the product its project names
          const project = loaded.byKey.get(liveKey(r, d.project) ?? '')?.[0];
          const product =
            project && typeof project.data.product === 'string' ? liveKey(project, project.data.product) : undefined;
          if (project && !product)
            err(
              r,
              `project: ${project.key} names no product, and this change is keyed under product:${r.productSlug}; set the project's product`,
            );
          else if (product && product !== `product:${r.productSlug}`)
            err(
              r,
              `project: ${project!.key} belongs to ${product}, but this change is keyed under product:${r.productSlug}`,
            );
        }
        if (typeof d.parent === 'string') {
          checkRef(r, 'parent', d.parent, ['change']);
          parentCycle('parent');
          // a parent is a milestone by its kind, never by having children (decision milestone-kind/kind-not-children)
          const parent = loaded.byKey.get(liveKey(r, d.parent) ?? '')?.[0];
          if (parent && parent.type === 'change' && parent.valid && parent.data.kind !== 'milestone') {
            err(
              r,
              `parent: ${parent.key} is not a milestone (its kind is '${String(parent.data.kind ?? 'work')}'); pjman set ${parent.key} kind=milestone, or file this change under one`,
            );
          }
        }
        if (d.kind === 'milestone') {
          const own = stepsOf(d).length;
          if (own)
            err(
              r,
              `a milestone's plan is its children; this one carries ${own} step${own === 1 ? '' : 's'} of its own: drop them (pjman step <change> drop <n>) before setting kind=milestone`,
            );
        } else {
          // the other direction: a change other changes name as parent cannot stop being a milestone
          const children = loaded.records.filter(
            (c) =>
              c.type === 'change' &&
              c.valid &&
              typeof c.data.parent === 'string' &&
              liveKey(c, c.data.parent) === r.key,
          );
          if (children.length)
            err(
              r,
              `kind: ${children.length === 1 ? `${children[0].key} names` : `${children.length} changes name`} this change as parent, so it must be a milestone (kind=milestone)`,
            );
        }
        if (listOf(d.depends_on).length) {
          for (const k of listOf(d.depends_on)) {
            checkRef(r, 'depends_on', k, ['change']);
            if (liveKey(r, k) === r.key) err(r, `depends_on: '${k}' is the change itself`);
          }
          // a chain of dependencies that returns to this change is a cycle
          const path: string[] = [r.key];
          const visit = (rec: Rec, depth: number): boolean => {
            if (depth > 64) return false;
            for (const k of listOf(rec.data.depends_on)) {
              const x = resolve(loaded, k, scopeOf(rec));
              if (x.status !== 'ok' && x.status !== 'alias') continue;
              if (x.rec.key === r.key) {
                err(r, `depends_on cycles: ${[...path, r.key].join(' → ')}`);
                return true;
              }
              if (path.includes(x.rec.key)) continue;
              path.push(x.rec.key);
              if (visit(x.rec, depth + 1)) return true;
              path.pop();
            }
            return false;
          };
          visit(r, 0);
        }
        for (const f of listOf(d.features)) {
          const e = parseEffect(f);
          if (!e)
            err(
              r,
              `features: '${f}' must be '<effect> feature:<slug>' or 'feature:<slug>' (effects: ${EFFECTS.join(', ')})`,
            );
          else checkRef(r, 'features', e.key, ['feature']);
        }
        for (const a of listOf(d.aspects)) {
          const e = parseAspectEffect(a);
          if (!e)
            err(
              r,
              `aspects: '${a}' must be '<effect> aspect:<slug>', '<effect> aspect:<aspect>/<place>' or a bare key (effects: ${EFFECTS.join(', ')})`,
            );
          else checkRef(r, 'aspects', e.key, ['aspect']);
        }
        for (const k of listOf(d.binds)) checkRef(r, 'binds', k, ['source']);
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        // the plan: steps as data, each with its text and a state
        if (d.plan !== undefined) {
          if (!Array.isArray(d.plan)) err(r, `'plan' must be a list of steps {text, state, note, at}`);
          else {
            d.plan.forEach((s, i) => {
              if (!s || typeof s !== 'object' || Array.isArray(s)) {
                err(r, `plan[${i}] must be a mapping {text, state, note, at}`);
                return;
              }
              const step = s as Record<string, unknown>;
              if (typeof step.text !== 'string' || !step.text.trim()) err(r, `plan[${i}]: a step needs its text`);
              if (step.state !== undefined && !(STEP_STATES as readonly string[]).includes(String(step.state)))
                err(r, `plan[${i}]: state '${String(step.state)}' is not one of ${STEP_STATES.join(', ')}`);
              if (step.note !== undefined && typeof step.note !== 'string') err(r, `plan[${i}]: note must be a string`);
              if (step.at !== undefined && !isTimestamp(step.at)) err(r, `plan[${i}]: at must be a timestamp`);
              for (const f of Object.keys(step))
                if (!['text', 'state', 'note', 'at'].includes(f)) warn(r, `plan[${i}]: unknown field '${f}'`);
            });
          }
        }
        checkAliases('change');
        if (r.changeSlug && !SLUG_RE.test(r.changeSlug)) err(r, `folder name '${r.changeSlug}' is not a slug`);
        break;
      }
      case 'decision': {
        if (typeof d.status === 'string' && !(DECISION_STATUSES as readonly string[]).includes(d.status)) {
          err(r, `status '${d.status}' is not one of ${DECISION_STATUSES.join(', ')}`);
        }
        if (d.status === 'decided') {
          if (!d.decided_by) err(r, `a decided decision needs 'decided_by'`);
          if (!d.decided_on) err(r, `a decided decision needs 'decided_on'`);
        }
        if (typeof d.decided_by === 'string') checkRef(r, 'decided_by', d.decided_by, ['actor']);
        if (d.decided_on !== undefined && !isDateString(d.decided_on))
          err(r, `'decided_on' must be a date (yyyy-mm-dd)`);
        // the thread: typed entries in order; an option before anything that names it; status and decider as the thread says
        if (d.thread !== undefined) {
          if (!Array.isArray(d.thread)) err(r, `'thread' must be a list of entries {type, at, by, text, …}`);
          else {
            const ids = new Set<string>();
            d.thread.forEach((e, i) => {
              if (!e || typeof e !== 'object' || Array.isArray(e)) {
                err(r, `thread[${i}] must be a mapping {type, at, …}`);
                return;
              }
              const x = e as Record<string, unknown>;
              const type = String(x.type);
              if (!(ENTRY_TYPES as readonly string[]).includes(type)) {
                err(r, `thread[${i}]: type '${type}' is not one of ${ENTRY_TYPES.join(', ')}`);
                return;
              }
              if (!isTimestamp(x.at)) err(r, `thread[${i}]: at must be a timestamp`);
              if (x.by !== undefined) checkRef(r, `thread[${i}].by`, x.by, ['actor']);
              if (type === 'option') {
                if (typeof x.id !== 'string' || !SLUG_RE.test(x.id))
                  err(r, `thread[${i}]: an option needs an id (a slug)`);
                else ids.add(x.id); // a later entry for the same id restates the option
                if (typeof x.text !== 'string' || !x.text.trim()) err(r, `thread[${i}]: an option needs its text`);
              } else if (type === 'recommendation' || type === 'reject' || type === 'accept') {
                if (typeof x.option !== 'string' || !ids.has(x.option))
                  err(r, `thread[${i}]: ${type} names option '${String(x.option)}', which no earlier entry defines`);
                if (type === 'accept' && (typeof x.by !== 'string' || !x.by.startsWith('person:')))
                  err(r, `thread[${i}]: an acceptance is a person's (by: person:<handle>)`);
              } else if (type !== 'reopen' && (typeof x.text !== 'string' || !x.text.trim()))
                err(r, `thread[${i}]: a ${type} needs its text`);
              if (type === 'comment' && x.option !== undefined && (typeof x.option !== 'string' || !ids.has(x.option)))
                err(r, `thread[${i}]: the comment is on option '${String(x.option)}', which no earlier entry defines`);
              for (const f of Object.keys(x))
                if (!['type', 'at', 'by', 'text', 'id', 'case', 'option', 'revisit'].includes(f))
                  warn(r, `thread[${i}]: unknown field '${f}'`);
            });
            const st = decisionState(threadOf(d));
            if (d.status === 'decided' && !st.accepted)
              err(r, `status is 'decided' but the thread holds no acceptance in force`);
            if (d.status === 'proposed' && st.accepted)
              err(r, `status is 'proposed' but the thread holds an acceptance (${st.accepted.option})`);
            if (st.accepted && d.status === 'decided' && st.accepted.by && d.decided_by !== st.accepted.by)
              err(r, `decided_by '${String(d.decided_by)}' is not who accepted in the thread (${st.accepted.by})`);
          }
        }
        if (d.supersedes !== undefined && typeof d.supersedes !== 'string' && !Array.isArray(d.supersedes))
          err(r, `'supersedes' must be a decision key or a list of them`);
        for (const sup of supersedesOf(d)) {
          checkRef(r, 'supersedes', sup, ['decision']);
          const x = res(r, sup);
          if ((x.status === 'ok' || x.status === 'alias') && x.rec.data.status !== 'superseded') {
            err(r, `supersedes '${sup}', whose status is '${String(x.rec.data.status)}'; it must be 'superseded'`);
          }
          if (x.status === 'ok' || x.status === 'alias') {
            // cycle check: no path of supersedes leads back here
            const seen = new Set<string>([r.key]);
            const stack: Rec[] = [x.rec];
            let cycle = false;
            while (stack.length && !cycle) {
              const cur = stack.pop()!;
              if (seen.has(cur.key)) {
                err(r, `supersedes forms a cycle through '${cur.key}'`);
                cycle = true;
                break;
              }
              seen.add(cur.key);
              for (const k of supersedesOf(cur.data)) {
                const next: Resolution = resolve(loaded, k, scopeOf(cur));
                if (next.status === 'ok' || next.status === 'alias') stack.push(next.rec);
              }
            }
          }
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        if (r.fileDate && !isDateString(r.fileDate)) err(r, `file name date '${r.fileDate}' is not a date`);
        break;
      }
      case 'source': {
        const kind = typeof d.kind === 'string' ? d.kind : '';
        const dirKind = r.path.split('/')[1];
        if (kind) {
          if (!sourceKinds.has(kind.toLowerCase()))
            err(r, `kind '${kind}' is not in source_kinds (${store.config.source_kinds.join(', ')})`);
          if (kind.toLowerCase() !== dirKind) err(r, `kind '${kind}' does not match the folder 'sources/${dirKind}/'`);
          if (kind !== kind.toLowerCase()) err(r, `kind must be lower-case ('${kind.toLowerCase()}')`);
        }
        if (kind && typeof d.key === 'string') {
          const expected = sourceFileSlug(kind, d.key);
          if (r.fileSlug !== expected) err(r, `file name should be '${expected}.md' for key '${d.key}'`);
        }
        if (d.url !== undefined && typeof d.url === 'string' && !/^[a-z][a-z0-9+.-]*:/.test(d.url))
          err(r, `'url' is not a URL`);
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        break;
      }
      case 'session': {
        if (typeof d.agent === 'string') checkRef(r, 'agent', d.agent, ['actor']);
        if (typeof d.on_behalf_of === 'string') checkRef(r, 'on_behalf_of', d.on_behalf_of, ['actor']);
        if (d.started !== undefined && !isTimestamp(d.started)) err(r, `'started' must be a timestamp`);
        else if (typeof d.started === 'string' && r.fileDate) {
          // the file is named by the local day the session started (the day the person worked); a file named by the
          // UTC day, as older writers did, or read in another zone, is accepted too
          const local = localDate(new Date(d.started));
          if (r.fileDate !== local && !d.started.startsWith(r.fileDate)) {
            warn(r, `file name date '${r.fileDate}' differs from 'started' (${local} locally)`);
          }
        }
        if (typeof d.parent === 'string') {
          checkRef(r, 'parent', d.parent, ['session']);
          if (d.parent === r.key) err(r, `'parent' is the session itself`);
        }
        for (const k of listOf(d.changes)) checkRef(r, 'changes', k, ['change']);
        if (d.observed !== undefined) {
          if (!Array.isArray(d.observed)) err(r, `'observed' must be a list of {edge, from, to, at}`);
          else {
            d.observed.forEach((o, i) => {
              if (!o || typeof o !== 'object' || Array.isArray(o)) {
                err(r, `observed[${i}] must be a mapping {edge, from, to, at}`);
                return;
              }
              const e = o as Record<string, unknown>;
              const edge = typeof e.edge === 'string' ? e.edge : '';
              const spec = EDGES[edge];
              if (!spec) {
                err(r, `observed[${i}]: edge '${edge}' is not one of ${Object.keys(EDGES).join(', ')}`);
                return;
              }
              checkRef(r, `observed[${i}].from`, e.from, spec[0]);
              checkRef(r, `observed[${i}].to`, e.to, spec[1]);
              if (e.at !== undefined && !isTimestamp(e.at)) err(r, `observed[${i}].at must be a timestamp`);
              for (const f of Object.keys(e))
                if (!['edge', 'from', 'to', 'at'].includes(f)) warn(r, `observed[${i}]: unknown field '${f}'`);
            });
          }
        }
        // focus: the change the session last read the context of; briefed: how far its brief has reached in the stream
        for (const f of ['focus', 'briefed'] as const) {
          if (d[f] === undefined) continue;
          const m = d[f] as Record<string, unknown>;
          if (!m || typeof m !== 'object' || Array.isArray(m)) {
            err(r, `'${f}' must be a mapping {change, at${f === 'briefed' ? ', seq' : ''}}`);
            continue;
          }
          // a session briefed only with notes addressed to it, before it was bound, has a watermark on no change
          if (f === 'focus' || m.change !== undefined) checkRef(r, `${f}.change`, m.change, ['change']);
          if (!isTimestamp(m.at)) err(r, `${f}.at must be a timestamp`);
          if (f === 'briefed' && (typeof m.seq !== 'number' || !Number.isInteger(m.seq) || m.seq < 0))
            err(r, `briefed.seq must be a whole number`);
          for (const k of Object.keys(m))
            if (!['change', 'at', 'seq'].includes(k) || (f === 'focus' && k === 'seq'))
              warn(r, `${f}: unknown field '${k}'`);
        }
        // a session with no change may carry a name and a kind (decision unbound-sessions/kinds): the kind is a record
        if (typeof d.name === 'string') {
          const p = nameProblem(d.name);
          if (p) err(r, `name: `);
        }
        if (typeof d.kind === 'string') checkRef(r, 'kind', d.kind, ['session-kind']);
        // host: where the session runs (change:rex-adapter): the host's name and its own ids, the version it ran on and
        // whether the adapter had validated that version
        if (d.host !== undefined) {
          const h = d.host as Record<string, unknown>;
          if (!h || typeof h !== 'object' || Array.isArray(h))
            err(r, `'host' must be a mapping {name, session, block?, version?, validated?}`);
          else {
            if (typeof h.name !== 'string' || !h.name.trim()) err(r, `host.name must be the host's name`);
            if (typeof h.session !== 'string' || !h.session.trim())
              err(r, `host.session must be the host's id for the session`);
            if (h.block !== undefined && typeof h.block !== 'string') err(r, `host.block must be a string`);
            if (h.version !== undefined && typeof h.version !== 'string') err(r, `host.version must be a string`);
            if (h.validated !== undefined && typeof h.validated !== 'boolean')
              err(r, `host.validated must be true or false`);
            for (const k of Object.keys(h))
              if (!['name', 'session', 'block', 'version', 'validated'].includes(k))
                warn(r, `host: unknown field '${k}'`);
          }
        }
        if (!r.sections.has('Log')) warn(r, `body has no '## Log' section`);
        break;
      }
      case 'session-kind': {
        if (r.fileSlug && !SLUG_RE.test(r.fileSlug)) err(r, `file name '' is not a slug`);
        if (typeof d.name === 'string') {
          const p = nameProblem(d.name);
          if (p) err(r, `name: `);
        }
        if (typeof d.gist === 'string') {
          const p = gistProblem(d.gist);
          if (p) err(r, `gist: `);
        }
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        for (const a of listOf(d.aliases)) {
          if (!SLUG_RE.test(a)) err(r, `aliases: '' is not a slug`);
          else if (loaded.byKey.has(`session-kind:`)) err(r, `aliases: '' is also a live kind`);
        }
        break;
      }
      case 'actor': {
        if (typeof d.kind === 'string' && !(ACTOR_KINDS as readonly string[]).includes(d.kind))
          err(r, `kind '${d.kind}' is not 'person' or 'agent'`);
        if (r.handle && !SLUG_RE.test(r.handle))
          err(r, `file name '${r.handle}' is not a slug (${slugify(r.handle) || 'empty'})`);
        if (d.url !== undefined && typeof d.url === 'string' && !/^[a-z][a-z0-9+.-]*:/.test(d.url))
          err(r, `'url' is not a URL`);
        // the accounts a person holds: sources of an identity kind, each claimed by one person
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        for (const a of listOf(d.aliases)) {
          if (!SLUG_RE.test(a)) err(r, `aliases: '${a}' is not a slug`);
          else if (loaded.byKey.has(`${String(d.kind)}:${a}`)) err(r, `aliases: '${a}' is also a live handle`);
        }
        break;
      }
    }
  }

  // --- across records -------------------------------------------------------
  for (const [key, recs] of loaded.byKey) {
    if (recs.length > 1) {
      for (const r of recs)
        err(
          r,
          `duplicate key '${key}'; also at ${recs
            .filter((x) => x !== r)
            .map((x) => x.path)
            .join(', ')}`,
        );
    }
  }
  // an aspect applies at a feature once: a second place there is a second source of truth
  const placeAt = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (r.type !== 'place' || !r.valid) continue;
    const f = liveKey(r, h(r, 'feature'));
    if (f) placeAt.set(`${r.aspectKey} ${f}`, [...(placeAt.get(`${r.aspectKey} ${f}`) ?? []), r]);
  }
  for (const [, recs] of placeAt) {
    if (recs.length > 1)
      for (const r of recs)
        err(
          r,
          `${r.aspectKey} already applies at ${String(h(r, 'feature'))} through ${recs
            .filter((x) => x !== r)
            .map((x) => x.key)
            .join(', ')}; one place per feature`,
        );
  }
  const boundBy = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (r.type !== 'change' || !r.valid) continue;
    for (const k of listOf(h(r, 'binds'))) {
      const key = parseKey(k);
      if (!key) continue;
      const canon = key.kind === 'url' ? `url:${key.rest}` : key.raw;
      const list = boundBy.get(canon) ?? [];
      list.push(r);
      boundBy.set(canon, list);
    }
  }
  for (const [src, recs] of boundBy) {
    if (recs.length > 1)
      for (const r of recs)
        err(
          r,
          `binds '${src}', which is also bound by ${recs
            .filter((x) => x !== r)
            .map((x) => x.key)
            .join(', ')}`,
        );
  }
  // a flat key from before the migration is one record's: two records in two products claiming the same bare alias is an error on both
  const flatHolders = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (!r.valid || !r.productSlug || (r.type !== 'change' && r.type !== 'feature')) continue;
    for (const a of listOf(h(r, 'aliases')))
      if (!a.includes('/')) flatHolders.set(`${r.type}:${a}`, [...(flatHolders.get(`${r.type}:${a}`) ?? []), r]);
  }
  for (const [flat, recs] of flatHolders) {
    if (recs.length > 1)
      for (const r of recs)
        err(
          r,
          `aliases: '${flat}' was also held by ${recs
            .filter((x) => x !== r)
            .map((x) => x.key)
            .join(', ')}; one record keeps the old key`,
        );
  }
  // an account is one person's: two people claiming the same account is an error on both
  const claimedBy = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (r.type !== 'actor' || !r.valid || h(r, 'kind') !== 'person') continue;
    for (const k of listOf(h(r, 'links'))) claimedBy.set(k, [...(claimedBy.get(k) ?? []), r]);
  }
  for (const [account, recs] of claimedBy) {
    if (recs.length > 1)
      for (const r of recs)
        err(
          r,
          `links '${account}', an account also claimed by ${recs
            .filter((x) => x !== r)
            .map((x) => x.key)
            .join(', ')}`,
        );
  }
  const supersededBy = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (r.type !== 'decision' || !r.valid) continue;
    for (const sup of supersedesOf({ supersedes: h(r, 'supersedes') })) {
      const x = res(r, sup);
      if (x.status === 'ok' || x.status === 'alias' || x.status === 'invalid') {
        const list = supersededBy.get(x.rec.key) ?? [];
        list.push(r);
        supersededBy.set(x.rec.key, list);
      }
    }
  }
  for (const r of loaded.records) {
    if (r.type === 'decision' && r.valid && h(r, 'status') === 'superseded' && !supersededBy.has(r.key)) {
      err(r, `status is 'superseded' but no decision's 'supersedes' points at it`);
    }
  }
  return only ? problems.filter((p) => only.has(p.path)) : problems;
}

function listOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function summarise(problems: Problem[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: problems.filter((p) => p.level === 'error').length,
    warnings: problems.filter((p) => p.level === 'warning').length,
    infos: problems.filter((p) => p.level === 'info').length,
  };
}

export function formatProblems(problems: Problem[]): string {
  const order = { error: 0, warning: 1, info: 2 };
  return [...problems]
    .sort((a, b) => order[a.level] - order[b.level] || a.path.localeCompare(b.path))
    .map((p) => `${p.level.padEnd(7)} ${p.path}: ${p.message}`)
    .join('\n');
}
