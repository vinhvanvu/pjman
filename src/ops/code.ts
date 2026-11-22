// The writes that keep a capability's code true (change:capability-code-paths; decisions capability-code-paths/code-field
// and capability-code-paths/upkeep). `pjman code link` and `unlink` are the agent's and the person's: a file found by
// search is linked where it was found, a wrong one taken off. `pjman code mv` follows a file that moved. The merge keeps
// the rest: once a change's branch is on the base, its diff is read and every capability the change names learns from
// it (a touched file joins or counts once more, a renamed one follows, a deleted one goes, and a link an agent or a
// merge wrote that QUIET_LIMIT merged changes to its capability passed without touching drops). `pjman code seed` gives
// a store its first links from the commits that name their changes. Each write is one commit with one event per record,
// so `pjman undo` puts any of them back.
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import { sourceFileSlug } from '../store/keys.js';
import { baseBranch, mergedInto, tryGit, type Merged } from '../store/merged.js';
import { toplevel } from '../store/git.js';
import { loadStore, type Loaded, type Rec } from '../store/records.js';
import { CliError, localDate } from '../store/util.js';
import {
  CODE_KIND,
  codeKey,
  codeRecords,
  implementsOf,
  isLeaf,
  QUIET_LIMIT,
  splitCodeKey,
  type Implements,
  type Linker,
} from '../model/code.js';
import { effectsOf, live } from '../model/tree.js';
import { envelope, finishWrite, render, settleIndex, writeFile } from './write.js';
import { formatProblems, validate } from '../model/validate.js';

export interface CodeOpts {
  cwd?: string;
  writer?: string;
  session?: string;
}

export interface CodeWrite {
  created: string[];
  updated: string[];
  removed: string[];
  commit: string | null;
}

/** Files no capability is built from, which a merge or a seed never links (a person or an agent still may): lock files,
 *  build output and generated files, the harness's own folders, and the documentation at the root and under docs/,
 *  which nearly every change touches. */
const NOISE = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)[^/]*\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /^\.claude\//,
  /(^|\/)dist\//,
  /\.gen\.[a-z]+$/,
  /^[^/]+\.md$/,
  /^docs\//,
  /(^|\/)\.gitignore$/,
];
export const isNoise = (p: string): boolean => NOISE.some((re) => re.test(p));

const projectSlugOf = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.startsWith('project:') ? raw.slice('project:'.length) : null;

/** The repository the command stands in, and the project's checkout: where a path is read from. */
function roots(store: Store, cwd: string): string[] {
  const here = toplevel(cwd);
  return [...new Set([here, store.projectDir].filter((d): d is string => !!d))];
}

/** A path as the store keeps it: relative to the repository's root, from a path given relative to where the command
 *  runs, a repository-relative one, or a code key. */
function repoPath(store: Store, cwd: string, raw: string): { project: string; path: string } {
  const keyed = splitCodeKey(raw.startsWith(`${CODE_KIND}:`) ? raw : '');
  if (keyed) return keyed;
  const project = projectSlugOf(store.project);
  if (!project) throw new CliError('code paths are kept per project: run it inside a registered project');
  const glob = /[*?[]/.test(raw);
  for (const root of roots(store, cwd)) {
    const abs = path.resolve(cwd, raw);
    const rel = path.relative(root, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && (glob || fs.existsSync(abs)))
      return { project, path: rel.split(path.sep).join('/') };
    if (glob || fs.existsSync(path.join(root, raw))) return { project, path: raw.replace(/^\.\//, '') };
  }
  throw new CliError(`${raw}: no such file in this repository (a path relative to here or to its root, or a glob)`);
}

/** The capability a link names: a feature, live, and a leaf (a node with children shows theirs, holding none). */
function capabilityOf(loaded: Loaded, raw: string, leaf = true): Rec {
  const f = live(loaded, raw.startsWith('feature:') ? raw : `feature:${raw}`);
  if (!f || f.type !== 'feature') throw new CliError(`${raw} is not a feature`);
  if (leaf && !isLeaf(loaded, f.key))
    throw new CliError(
      `${f.key} has capabilities beneath it, and shows their files rolled up: link the file to the one it implements`,
    );
  return f;
}

/** The state each touched code key is left in: its entries, or null when it goes. */
type Plan = Map<string, Implements[] | null>;

/** Write a plan: create, rewrite or remove each code record, validate what was written (put back on refusal), and
 *  commit once. */
function writePlan(store: Store, loaded: Loaded, plan: Plan, message: string, opts: CodeOpts): CodeWrite {
  const env = envelope(opts);
  const out: CodeWrite = { created: [], updated: [], removed: [], commit: null };
  if (!plan.size) return out;
  const prior = new Map<string, string>();
  const createdRels: string[] = [];
  const events: EventInput[] = [];
  const rels: string[] = [];
  for (const [key, entries] of plan) {
    const rec = loaded.byKey.get(key)?.find((r) => r.type === 'source');
    const rest = key.slice(CODE_KIND.length + 1);
    const rel = rec?.path ?? path.join('sources', CODE_KIND, `${sourceFileSlug(CODE_KIND, rest)}.md`);
    const abs = path.join(store.root, rel);
    if (fs.existsSync(abs)) prior.set(rel, fs.readFileSync(abs, 'utf8'));
    if (!entries || !entries.length) {
      if (!rec) continue;
      fs.rmSync(abs, { force: true });
      out.removed.push(key);
      events.push({ op: 'removed', key, type: 'source', path: rel, writer: env.writer });
      continue;
    }
    const data: Record<string, unknown> = rec
      ? { ...rec.data, implements: entries }
      : {
          kind: CODE_KIND,
          key: rest,
          implements: entries,
          writer: env.writer,
          session: env.session,
          created: localDate(),
        };
    writeFile(store, rel, render('source', data, rec?.body ?? ''));
    rels.push(rel);
    if (rec) {
      out.updated.push(key);
      events.push({ op: 'set', key, type: 'source', path: rel, fields: ['implements'], writer: env.writer });
    } else {
      createdRels.push(rel);
      out.created.push(key);
      events.push({ op: 'created', key, type: 'source', path: rel, writer: env.writer });
    }
  }
  if (!events.length) return out;
  // validated together: one refusal puts every file back
  settleIndex(store, [...rels, ...prior.keys()]);
  const errors = validate(loadStore(store), { only: new Set(rels) }).filter((p) => p.level === 'error');
  if (errors.length) {
    for (const [rel, text] of prior) writeFile(store, rel, text);
    for (const rel of createdRels) fs.rmSync(path.join(store.root, rel), { force: true });
    settleIndex(store, [...rels, ...prior.keys()]);
    throw new CliError(`refused: the code links would not validate\n${formatProblems(errors)}`);
  }
  out.commit = finishWrite(store, message, env.session, events);
  return out;
}

const entriesOf = (loaded: Loaded, key: string): Implements[] => {
  const rec = loaded.byKey.get(key)?.find((r) => r.type === 'source');
  return rec ? implementsOf(rec) : [];
};

/** Link files to a capability. A person's link is pinned (it never decays); an agent's counts as found. A file already
 *  linked keeps its counts, and a person linking it pins it. */
export function codeLink(store: Store, featureRaw: string, raws: string[], opts: CodeOpts = {}): CodeWrite {
  if (!raws.length) throw new CliError('name the files: pjman code link <capability> <path>…');
  const loaded = loadStore(store);
  const f = capabilityOf(loaded, featureRaw);
  const by: Linker = envelope(opts).writer?.startsWith('person:') ? 'person' : 'agent';
  const plan: Plan = new Map();
  for (const raw of raws) {
    const p = repoPath(store, opts.cwd ?? process.cwd(), raw);
    const key = codeKey(p.project, p.path);
    const entries = plan.get(key) ?? entriesOf(loaded, key);
    const had = entries.find((e) => live(loaded, e.feature)?.key === f.key);
    if (had) {
      if (by === 'person' && had.by !== 'person') had.by = 'person';
      else continue;
    } else entries.push({ feature: f.key, by, n: 0 });
    plan.set(key, entries);
  }
  return writePlan(store, loaded, plan, `pjman: code link ${f.key} (${raws.length})`, opts);
}

/** Take files off a capability; a file that implements nothing else goes. */
export function codeUnlink(store: Store, featureRaw: string, raws: string[], opts: CodeOpts = {}): CodeWrite {
  if (!raws.length) throw new CliError('name the files: pjman code unlink <capability> <path>…');
  const loaded = loadStore(store);
  // a link may be taken off any node, a leaf or one that has grown children since
  const f = capabilityOf(loaded, featureRaw, false);
  const project = projectSlugOf(store.project);
  const plan: Plan = new Map();
  for (const raw of raws) {
    const keyed = splitCodeKey(raw);
    const key = keyed ? raw : project ? codeKey(project, raw.replace(/^\.\//, '')) : null;
    if (!key) throw new CliError('run it inside a registered project, or name the file by its code key');
    const entries = entriesOf(loaded, key);
    const kept = entries.filter((e) => live(loaded, e.feature)?.key !== f.key);
    if (kept.length === entries.length) throw new CliError(`${key} is not linked to ${f.key}`);
    plan.set(key, kept.length ? kept : null);
  }
  return writePlan(store, loaded, plan, `pjman: code unlink ${f.key} (${raws.length})`, opts);
}

/** Merge two lists of entries: one per capability, counts summed, the stronger linker kept. */
function mergeEntries(a: Implements[], b: Implements[], loaded: Loaded): Implements[] {
  const out = a.map((e) => ({ ...e }));
  for (const e of b) {
    const had = out.find(
      (x) => (live(loaded, x.feature)?.key ?? x.feature) === (live(loaded, e.feature)?.key ?? e.feature),
    );
    if (!had) {
      out.push({ ...e });
      continue;
    }
    had.n += e.n;
    if (e.by === 'person' || (e.by === 'agent' && had.by === 'merge')) had.by = e.by;
    had.quiet = Math.min(had.quiet ?? 0, e.quiet ?? 0) || undefined;
    if (!had.quiet) delete had.quiet;
  }
  return out;
}

/** A file moved: its links follow it to the new path (joining any it already had there). */
export function codeMove(store: Store, fromRaw: string, toRaw: string, opts: CodeOpts = {}): CodeWrite {
  const loaded = loadStore(store);
  const project = projectSlugOf(store.project);
  const fromKey = splitCodeKey(fromRaw) ? fromRaw : project ? codeKey(project, fromRaw.replace(/^\.\//, '')) : null;
  if (!fromKey) throw new CliError('run it inside a registered project, or name the file by its code key');
  const from = entriesOf(loaded, fromKey);
  if (!from.length) throw new CliError(`${fromKey} is not linked to any capability`);
  const to = repoPath(store, opts.cwd ?? process.cwd(), toRaw);
  const toKey = codeKey(to.project, to.path);
  if (toKey === fromKey) throw new CliError('the file is already there');
  const plan: Plan = new Map([
    [fromKey, null],
    [toKey, mergeEntries(entriesOf(loaded, toKey), from, loaded)],
  ]);
  return writePlan(store, loaded, plan, `pjman: code mv ${fromKey} → ${toKey}`, opts);
}

// --- the merge ------------------------------------------------------------------------------------------------------

export interface DiffEntry {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
  /** On a rename: where it was. */
  from?: string;
}

/** `git diff --name-status -M` lines → entries. */
export function parseNameStatus(text: string): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [st, a, b] = line.split('\t');
    const s = st[0];
    if (s === 'R' && b) out.push({ status: 'R', path: b, from: a });
    else if (s === 'C' && b) out.push({ status: 'A', path: b });
    else if (s === 'A' || s === 'M' || s === 'D') out.push({ status: s, path: a });
    else if (s === 'T' && a) out.push({ status: 'M', path: a });
  }
  return out;
}

/** What a merged branch brought to the base, read from git: the whole diff of its own commits from where it forked. A
 *  merge commit's first parent is the base before it; a squash or a rebase forks where the base and the tip meet; a
 *  fast-forward is read from the commits on the base that name the change. */
export function mergedDiff(dir: string, branch: string, m: Merged, named: string): DiffEntry[] {
  const tip = tryGit(dir, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]);
  if (m.how === 'merge' && m.commit && tip) {
    const fork = tryGit(dir, ['merge-base', `${m.commit}^1`, tip]);
    if (fork) return parseNameStatus(tryGit(dir, ['diff', '-M', '--name-status', fork, tip]));
  }
  if ((m.how === 'squash' || m.how === 'rebase') && tip) {
    const fork = tryGit(dir, ['merge-base', m.on, tip]);
    if (fork) return parseNameStatus(tryGit(dir, ['diff', '-M', '--name-status', fork, tip]));
  }
  // forward (and anything unread above): the commits on the base that name the change, oldest first
  const shas = tryGit(dir, ['log', '--reverse', '--format=%H', '-E', `--grep=${named}`, m.on])
    .split('\n')
    .filter(Boolean);
  if (!shas.length) return [];
  const first = shas[0];
  const last = shas[shas.length - 1];
  const parent = tryGit(dir, ['rev-parse', '--verify', '--quiet', `${first}^`]);
  return parent ? parseNameStatus(tryGit(dir, ['diff', '-M', '--name-status', parent, last])) : [];
}

export interface UpkeepResult extends CodeWrite {
  change: string;
  capabilities: string[];
  /** Why nothing was read, when nothing was. */
  skipped?: string;
}

/** What one merged change teaches the capabilities it names. Run once a change's branch is on the base (pjman merge,
 *  pjman sync git); a change already learned from is passed over. `diff` is given in tests and by callers that read it. */
export function codeUpkeep(
  store: Store,
  changeRaw: string,
  opts: CodeOpts & { diff?: DiffEntry[]; branch?: string; merged?: Merged } = {},
): UpkeepResult {
  const loaded = loadStore(store);
  const rec = live(loaded, changeRaw.startsWith('change:') ? changeRaw : `change:${changeRaw}`);
  if (!rec || rec.type !== 'change') throw new CliError(`${changeRaw} is not a change`);
  const empty = (skipped: string, capabilities: string[] = []): UpkeepResult => ({
    change: rec.key,
    capabilities,
    created: [],
    updated: [],
    removed: [],
    commit: null,
    skipped,
  });
  const caps = [
    ...new Set(
      effectsOf(rec)
        .filter((e) => e.effect !== 'removes')
        .map((e) => live(loaded, e.key))
        .filter((f): f is Rec => f?.type === 'feature' && isLeaf(loaded, f.key))
        .map((f) => f.key),
    ),
  ];
  const project = projectSlugOf(rec.data.project);
  if (!project) return empty('the change names no project');
  let diff = opts.diff;
  if (!diff) {
    const dir = store.projectDir;
    if (!dir || store.project !== rec.data.project) return empty(`run it inside project:${project}'s repository`);
    const named = `change:${rec.changeSlug}`;
    const branch = opts.branch;
    const m = opts.merged ?? (branch ? mergedInto(dir, branch, { base: baseBranch(dir), named }) : null);
    if (!branch || !m) return empty('its branch is not merged');
    diff = mergedDiff(dir, branch, m, named);
  }
  // learned from already: a link that names it as the last change touching it
  if (codeRecords(loaded).some((r) => implementsOf(r).some((e) => e.last === rec.key)))
    return empty('already learned from', caps);
  const plan: Plan = new Map();
  const get = (key: string): Implements[] | null =>
    plan.has(key) ? plan.get(key)! : entriesOf(loaded, key).map((e) => ({ ...e }));
  // the repository moved: renamed files carry their links, deleted ones go, whatever capability they implement
  for (const d of diff) {
    if (d.status === 'R' && d.from) {
      const fromKey = codeKey(project, d.from);
      const from = get(fromKey);
      if (from?.length) {
        plan.set(fromKey, null);
        plan.set(codeKey(project, d.path), mergeEntries(get(codeKey(project, d.path)) ?? [], from, loaded));
      }
    } else if (d.status === 'D') {
      const key = codeKey(project, d.path);
      if (get(key)?.length) plan.set(key, null);
    }
  }
  const touched = new Set(
    diff.filter((d) => d.status !== 'D' && !isNoise(d.path)).map((d) => codeKey(project, d.path)),
  );
  if (caps.length) {
    // each capability: what was touched counts once more (or joins), what was not grows quieter, and a link no person
    // wrote that QUIET_LIMIT merged changes passed by drops
    const linked = new Map<string, string[]>();
    for (const r of codeRecords(loaded))
      for (const e of implementsOf(r)) {
        const f = live(loaded, e.feature)?.key;
        if (f && caps.includes(f)) linked.set(f, [...(linked.get(f) ?? []), r.key]);
      }
    for (const f of caps) {
      const keys = new Set([...(linked.get(f) ?? []), ...touched]);
      for (const key of keys) {
        // a link that moved with a rename above is read at its new key
        const entries = get(key);
        if (entries === null) continue;
        const e = entries.find((x) => (live(loaded, x.feature)?.key ?? x.feature) === f);
        if (touched.has(key)) {
          if (e) {
            e.n += 1;
            e.last = rec.key;
            delete e.quiet;
          } else entries.push({ feature: f, by: 'merge', n: 1, last: rec.key });
          plan.set(key, entries);
        } else if (e && e.by !== 'person') {
          e.quiet = (e.quiet ?? 0) + 1;
          const kept = e.quiet >= QUIET_LIMIT ? entries.filter((x) => x !== e) : entries;
          plan.set(key, kept.length ? kept : null);
        }
      }
    }
  }
  const w = writePlan(store, loaded, plan, `pjman: code learned from ${rec.key}`, opts);
  return { change: rec.key, capabilities: caps, ...w };
}

/** The upkeep a merge runs, said in a line, or nothing when there was nothing to learn. Never throws: a merge stands
 *  whatever its code links do. */
export function learnCode(store: Store, change: string, branch: string, session?: string): string | null {
  try {
    const r = codeUpkeep(store, change, { branch, session });
    return upkeepLine(r);
  } catch (e) {
    return `code links not learned from the merge (${(e as Error).message.split('\n')[0]})`;
  }
}

/** One line for what an upkeep wrote; null when it wrote nothing. */
export function upkeepLine(r: UpkeepResult): string | null {
  const parts = [
    r.created.length ? `${r.created.length} linked` : '',
    r.updated.length ? `${r.updated.length} counted` : '',
    r.removed.length ? `${r.removed.length} dropped` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return `code: ${parts.join(', ')} on ${r.capabilities.join(', ') || 'the files it moved'}${r.commit ? ` (committed ${r.commit})` : ''}`;
}

// --- the first links ------------------------------------------------------------------------------------------------

export interface SeedResult extends CodeWrite {
  /** Per capability, the files it was given, most touched first. */
  capabilities: { feature: string; files: { path: string; n: number }[] }[];
}

/** A store's first links, read from the project's history: each commit that names exactly one change, and touches no
 *  more than `maxFiles` files, gives the files it touched (that still exist and are not noise) to the capabilities that
 *  change names, counted once per change. Links already there are kept; their counts are not touched. `write: false`
 *  only says what it would give. */
export function codeSeed(store: Store, opts: CodeOpts & { write?: boolean; maxFiles?: number } = {}): SeedResult {
  const loaded = loadStore(store);
  const dir = store.projectDir;
  const project = projectSlugOf(store.project);
  if (!dir || !project) throw new CliError('seed reads a project: run it inside a registered project');
  const maxFiles = opts.maxFiles ?? 15;
  const log = tryGit(dir, ['log', '--no-merges', '--name-only', '--format=@@%H %s', baseBranch(dir)]);
  // change key → file → touched
  const byChange = new Map<string, { files: Set<string>; first: number }>();
  let i = 0;
  let cur: { changes: string[]; files: string[] } | null = null;
  const flush = () => {
    if (!cur || cur.changes.length !== 1 || !cur.files.length || cur.files.length > maxFiles) return;
    const c = live(loaded, `change:${cur.changes[0]}`);
    if (!c || c.type !== 'change' || c.data.project !== store.project) return;
    const had = byChange.get(c.key) ?? { files: new Set<string>(), first: i };
    for (const f of cur.files) had.files.add(f);
    byChange.set(c.key, had);
  };
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      i++;
      cur = { changes: [...new Set([...line.matchAll(/change:([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]))], files: [] };
    } else if (line.trim() && cur) cur.files.push(line.trim());
  }
  flush();
  // the log runs newest first: the smallest index is the latest change
  const perCap = new Map<string, Map<string, { n: number; last: string; at: number }>>();
  for (const [changeKey, { files, first }] of byChange) {
    const c = live(loaded, changeKey)!;
    for (const e of effectsOf(c)) {
      if (e.effect === 'removes') continue;
      const f = live(loaded, e.key);
      if (f?.type !== 'feature' || !isLeaf(loaded, f.key)) continue;
      const m = perCap.get(f.key) ?? new Map<string, { n: number; last: string; at: number }>();
      for (const p of files) {
        if (isNoise(p) || !fs.existsSync(path.join(dir, p))) continue;
        const had = m.get(p);
        if (had) {
          had.n++;
          if (first < had.at) Object.assign(had, { last: changeKey, at: first });
        } else m.set(p, { n: 1, last: changeKey, at: first });
      }
      if (m.size) perCap.set(f.key, m);
    }
  }
  const plan: Plan = new Map();
  const capabilities: SeedResult['capabilities'] = [];
  for (const [f, files] of [...perCap].toSorted(([a], [b]) => a.localeCompare(b))) {
    const listed = [...files].toSorted(([pa, a], [pb, b]) => b.n - a.n || pa.localeCompare(pb));
    capabilities.push({ feature: f, files: listed.map(([p, x]) => ({ path: p, n: x.n })) });
    for (const [p, x] of listed) {
      const key = codeKey(project, p);
      const entries = plan.get(key) ?? entriesOf(loaded, key);
      if (entries.some((e) => (live(loaded, e.feature)?.key ?? e.feature) === f)) continue;
      entries.push({ feature: f, by: 'merge', n: x.n, last: x.last });
      plan.set(key, entries);
    }
  }
  if (opts.write === false) return { created: [], updated: [], removed: [], commit: null, capabilities };
  return { ...writePlan(store, loaded, plan, `pjman: code seed from ${project}'s history`, opts), capabilities };
}
