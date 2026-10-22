import { ACTOR_KINDS, CANONICAL_STATUSES, DECISION_STATUSES } from './config.js';
import { isActorKey, parseKey, SLUG_RE, slugify, sourceFileSlug } from './keys.js';
import { FIELD_ORDER, LAYER_OF, resolve, type Loaded, type Problem, type Rec, type RecordType, type Resolution } from './records.js';
import { isDateString, isTimestamp } from './util.js';

const REQUIRED: Record<RecordType, string[]> = {
  project: ['title'],
  change: ['title', 'status'],
  decision: ['title', 'status'],
  source: ['kind', 'key'],
  session: ['agent', 'on_behalf_of', 'started'],
  actor: ['kind'],
};

const STRING_FIELDS: Record<RecordType, string[]> = {
  project: ['title', 'tracker', 'writer', 'session', 'created'],
  change: ['title', 'status', 'project', 'next', 'writer', 'session', 'created'],
  decision: ['title', 'status', 'decided_by', 'decided_on', 'supersedes', 'writer', 'session', 'created'],
  source: ['kind', 'key', 'title', 'url', 'writer', 'session', 'created'],
  session: ['agent', 'on_behalf_of', 'started', 'parent', 'writer', 'created'],
  actor: ['kind', 'name', 'url', 'writer', 'session', 'created'],
};

const LIST_FIELDS: Record<RecordType, string[]> = {
  project: ['links'],
  change: ['binds', 'links', 'aliases'],
  decision: ['links'],
  source: ['links'],
  session: ['changes'],
  actor: [],
};

const REQUIRED_SECTIONS: Partial<Record<RecordType, string[]>> = {
  change: ['Summary'],
  decision: ['Decision', 'Why'],
};

/** Edge name → [from kinds, to kinds]. 'source' stands for any source kind. */
export const EDGES: Record<string, [string[], string[]]> = {
  binds: [['change'], ['source']],
  links: [['change', 'decision', 'source'], ['source']],
  supersedes: [['decision'], ['decision']],
  parent: [['session'], ['session']],
  changes: [['session'], ['change']],
  project: [['change'], ['project']],
};

export function validate(loaded: Loaded): Problem[] {
  const problems: Problem[] = [...loaded.problems];
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


  /** Check one reference. `expect` is a list of kinds ('source' covers any source kind). Returns the key's kind class. */
  const checkRef = (r: Rec, field: string, raw: unknown, expect: string[]): void => {
    const key = parseKey(raw);
    if (!key) {
      err(r, `${field}: '${String(raw)}' is not a key (kind:rest)`);
      return;
    }
    const isRecordKind = ['person', 'agent', 'change', 'decision', 'session', 'project'].includes(key.kind);
    const cls = isRecordKind ? (isActorKey(key) ? 'actor' : key.kind) : 'source';
    if (cls === 'source' && !sourceKinds.has(key.kind)) {
      err(r, `${field}: '${key.raw}' has unknown kind '${key.kind}' (not a record kind; not in source_kinds)`);
      return;
    }
    if (!expect.includes(cls)) {
      err(r, `${field}: '${key.raw}' must be a ${expect.join(' or ')} key`);
      return;
    }
    const res = resolve(loaded, key.raw);
    switch (res.status) {
      case 'missing':
        err(r, `${field}: '${key.raw}' does not resolve`);
        break;
      case 'invalid':
        warn(r, `${field}: '${key.raw}' resolves to ${res.rec.path}, which is invalid`);
        break;
      case 'alias':
        info(r, `${field}: '${key.raw}' resolves via alias to '${res.rec.key}'`);
        break;
      default:
        break;
    }
  };

  // --- per record -----------------------------------------------------------
  for (const r of loaded.records) {
    for (const e of r.parsed.errors) err(r, e);
    for (const u of r.parsed.unquoted) err(r, u);
    if (!r.valid) continue;
    const d = r.data;

    const layer = LAYER_OF[r.type];
    if (!layers.has(layer)) err(r, `layer '${layer}' is not enabled in pjman.yaml (layers: ${[...layers].join(', ')})`);

    for (const f of REQUIRED[r.type]) if (d[f] === undefined || d[f] === null || d[f] === '') err(r, `missing required field '${f}'`);
    for (const f of STRING_FIELDS[r.type]) if (d[f] !== undefined && typeof d[f] !== 'string') err(r, `'${f}' must be a string`);
    for (const f of LIST_FIELDS[r.type]) {
      if (d[f] === undefined) continue;
      if (!Array.isArray(d[f]) || !(d[f] as unknown[]).every((x) => typeof x === 'string')) err(r, `'${f}' must be a list of keys`);
    }
    const known = new Set(FIELD_ORDER[r.type]);
    if (r.type === 'session') known.add('session');
    for (const f of Object.keys(d)) if (!known.has(f)) warn(r, `unknown field '${f}'; extensions go under ext.<owner>.<field>`);

    if (typeof d.writer === 'string') checkRef(r, 'writer', d.writer, ['actor']);
    if (typeof d.session === 'string') checkRef(r, 'session', d.session, ['session']);
    if (d.created !== undefined && !isDateString(d.created)) err(r, `'created' must be a date (yyyy-mm-dd)`);
    if (d.ext !== undefined && (typeof d.ext !== 'object' || d.ext === null || Array.isArray(d.ext))) err(r, `'ext' must be a mapping`);

    for (const s of REQUIRED_SECTIONS[r.type] ?? []) if (!r.sections.has(s)) err(r, `body is missing the '## ${s}' section`);

    switch (r.type) {
      case 'project': {
        if (r.projectSlug && !SLUG_RE.test(r.projectSlug)) err(r, `file name '${r.projectSlug}' is not a slug`);
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        if (typeof d.tracker === 'string' && !store.config.source_kinds.map((k) => k.toLowerCase()).includes(d.tracker.toLowerCase())) {
          err(r, `tracker '${d.tracker}' is not in source_kinds (${store.config.source_kinds.join(', ')})`);
        }
        break;
      }
      case 'change': {
        if (typeof d.status === 'string' && !canonical.has(d.status)) {
          const mapped = store.config.vocabulary[d.status];
          err(r, mapped
            ? `status '${d.status}' is not canonical; the vocabulary maps it to '${mapped}', which is what the file must say`
            : `status '${d.status}' is not in the vocabulary (${CANONICAL_STATUSES.join(', ')})`);
        }
        if (typeof d.project === 'string') checkRef(r, 'project', d.project, ['project']);
        for (const k of listOf(d.binds)) checkRef(r, 'binds', k, ['source']);
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        for (const a of listOf(d.aliases)) {
          if (!SLUG_RE.test(a)) err(r, `aliases: '${a}' is not a slug`);
          else if (loaded.byKey.has(`change:${a}`)) err(r, `aliases: '${a}' is also a live change slug`);
        }
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
        if (d.decided_on !== undefined && !isDateString(d.decided_on)) err(r, `'decided_on' must be a date (yyyy-mm-dd)`);
        if (typeof d.supersedes === 'string') {
          checkRef(r, 'supersedes', d.supersedes, ['decision']);
          const res = resolve(loaded, d.supersedes);
          if ((res.status === 'ok' || res.status === 'alias') && res.rec.data.status !== 'superseded') {
            err(r, `supersedes '${d.supersedes}', whose status is '${String(res.rec.data.status)}'; it must be 'superseded'`);
          }
          if (res.status === 'ok' || res.status === 'alias') {
            // cycle check
            const seen = new Set<string>([r.key]);
            let cur: Rec | undefined = res.rec;
            while (cur) {
              if (seen.has(cur.key)) {
                err(r, `supersedes forms a cycle through '${cur.key}'`);
                break;
              }
              seen.add(cur.key);
              const next: Resolution | null = typeof cur.data.supersedes === 'string' ? resolve(loaded, cur.data.supersedes) : null;
              cur = next && (next.status === 'ok' || next.status === 'alias') ? next.rec : undefined;
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
          if (!sourceKinds.has(kind.toLowerCase())) err(r, `kind '${kind}' is not in source_kinds (${store.config.source_kinds.join(', ')})`);
          if (kind.toLowerCase() !== dirKind) err(r, `kind '${kind}' does not match the folder 'sources/${dirKind}/'`);
          if (kind !== kind.toLowerCase()) err(r, `kind must be lower-case ('${kind.toLowerCase()}')`);
        }
        if (kind && typeof d.key === 'string') {
          const expected = sourceFileSlug(kind, d.key);
          if (r.fileSlug !== expected) err(r, `file name should be '${expected}.md' for key '${d.key}'`);
        }
        if (d.url !== undefined && typeof d.url === 'string' && !/^[a-z][a-z0-9+.-]*:/.test(d.url)) err(r, `'url' is not a URL`);
        for (const k of listOf(d.links)) checkRef(r, 'links', k, ['source']);
        break;
      }
      case 'session': {
        if (typeof d.agent === 'string') checkRef(r, 'agent', d.agent, ['actor']);
        if (typeof d.on_behalf_of === 'string') checkRef(r, 'on_behalf_of', d.on_behalf_of, ['actor']);
        if (d.started !== undefined && !isTimestamp(d.started)) err(r, `'started' must be a timestamp`);
        else if (typeof d.started === 'string' && r.fileDate && !d.started.startsWith(r.fileDate)) {
          warn(r, `file name date '${r.fileDate}' differs from 'started' (${d.started.slice(0, 10)})`);
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
              for (const f of Object.keys(e)) if (!['edge', 'from', 'to', 'at'].includes(f)) warn(r, `observed[${i}]: unknown field '${f}'`);
            });
          }
        }
        if (!r.sections.has('Log')) warn(r, `body has no '## Log' section`);
        break;
      }
      case 'actor': {
        if (typeof d.kind === 'string' && !(ACTOR_KINDS as readonly string[]).includes(d.kind)) err(r, `kind '${d.kind}' is not 'person' or 'agent'`);
        if (r.handle && !SLUG_RE.test(r.handle)) err(r, `file name '${r.handle}' is not a slug (${slugify(r.handle) || 'empty'})`);
        if (d.url !== undefined && typeof d.url === 'string' && !/^[a-z][a-z0-9+.-]*:/.test(d.url)) err(r, `'url' is not a URL`);
        break;
      }
    }
  }

  // --- across records -------------------------------------------------------
  for (const [key, recs] of loaded.byKey) {
    if (recs.length > 1) {
      for (const r of recs) err(r, `duplicate key '${key}'; also at ${recs.filter((x) => x !== r).map((x) => x.path).join(', ')}`);
    }
  }
  const boundBy = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (r.type !== 'change' || !r.valid) continue;
    for (const k of listOf(r.data.binds)) {
      const key = parseKey(k);
      if (!key) continue;
      const canon = key.kind === 'url' ? `url:${key.rest}` : key.raw;
      const list = boundBy.get(canon) ?? [];
      list.push(r);
      boundBy.set(canon, list);
    }
  }
  for (const [src, recs] of boundBy) {
    if (recs.length > 1) for (const r of recs) err(r, `binds '${src}', which is also bound by ${recs.filter((x) => x !== r).map((x) => x.key).join(', ')}`);
  }
  const supersededBy = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (r.type !== 'decision' || !r.valid || typeof r.data.supersedes !== 'string') continue;
    const res = resolve(loaded, r.data.supersedes);
    if (res.status === 'ok' || res.status === 'alias' || res.status === 'invalid') {
      const list = supersededBy.get(res.rec.key) ?? [];
      list.push(r);
      supersededBy.set(res.rec.key, list);
    }
  }
  for (const r of loaded.records) {
    if (r.type === 'decision' && r.valid && r.data.status === 'superseded' && !supersededBy.has(r.key)) {
      err(r, `status is 'superseded' but no decision's 'supersedes' points at it`);
    }
  }
  return problems;
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
