// The code a capability is built from (change:capability-code-paths). A file is a source of kind `code`, keyed by its
// project and its path in that project's repository (`code:pjman/src/model/tree.ts`), and its record says which
// capabilities it implements (decision capability-code-paths/code-field). Each entry carries who linked it (a person, an
// agent that found it, or a merge whose diff touched it), how many merged changes to that capability touched it, the last
// of them, and how many merged changes to it have passed since without touching it. A capability lists its own files; a
// feature and the product list their children's, rolled up when read and never stored on them. Links are kept true by
// the agent that finds or fixes one and by the merge (decision capability-code-paths/upkeep): ops/code.ts.
import fs from 'node:fs';
import path from 'node:path';
import { readUserConfig, type Store } from '../store/config.js';
import { memo, ofType, push, type Loaded, type Rec } from '../store/records.js';
import { live, treeIndex } from './tree.js';

export const CODE_KIND = 'code';
export const LINKERS = ['person', 'agent', 'merge'] as const;
export type Linker = (typeof LINKERS)[number];
/** Merged changes to a capability that may pass without touching a file before a link an agent or a merge wrote drops;
 *  a person's never does. */
export const QUIET_LIMIT = 5;
/** How many files a capability shows before the rest are counted. */
export const SHOWN = 12;

export interface Implements {
  feature: string;
  by: Linker;
  /** Merged changes to the capability that touched the file. */
  n: number;
  /** The last of them. */
  last?: string;
  /** Merged changes to the capability since the file was last touched. */
  quiet?: number;
}

export interface CodeFile {
  key: string;
  project: string;
  path: string;
  by: Linker;
  n: number;
  /** What it is ranked by: n weighed by how few capabilities share the file. */
  score: number;
  last?: string;
  quiet: number;
  /** On a rollup: the capabilities beneath the node the file implements. */
  features?: string[];
  /** The path is not in any checkout of its project on this machine: relink it once found. */
  gone?: boolean;
}

export const codeKey = (project: string, file: string): string => `${CODE_KIND}:${project}/${file}`;

/** `code:<project>/<path>` → its project slug and path. */
export function splitCodeKey(key: string): { project: string; path: string } | null {
  const m = /^code:([^/]+)\/(.+)$/.exec(key);
  return m ? { project: m[1], path: m[2] } : null;
}

/** The entries a code record holds, the malformed left out (validate names them). */
export function implementsOf(rec: Rec): Implements[] {
  const raw = rec.data.implements;
  if (!Array.isArray(raw)) return [];
  const out: Implements[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    if (typeof x.feature !== 'string') continue;
    out.push({
      feature: x.feature,
      by: (LINKERS as readonly unknown[]).includes(x.by) ? (x.by as Linker) : 'agent',
      n: typeof x.n === 'number' && x.n >= 0 ? x.n : 0,
      ...(typeof x.last === 'string' ? { last: x.last } : {}),
      ...(typeof x.quiet === 'number' && x.quiet > 0 ? { quiet: x.quiet } : {}),
    });
  }
  return out;
}

interface CodeIndex {
  /** Each capability's live key → its files with the entry that links them. */
  byFeature: Map<string, { rec: Rec; entry: Implements }[]>;
  /** How specific a file is: fewer capabilities naming it weigh it more (a file every change touches weighs little). */
  weight: Map<string, number>;
}

/** Every code record by the live key of each capability it implements, with each file's weight. */
function codeIndex(loaded: Loaded): CodeIndex {
  return memo(loaded, 'code', () => {
    const byFeature = new Map<string, { rec: Rec; entry: Implements }[]>();
    const spread = new Map<string, number>();
    for (const r of ofType(loaded, 'source')) {
      if (!r.valid || r.data.kind !== CODE_KIND) continue;
      const entries = implementsOf(r);
      spread.set(r.key, entries.length);
      for (const entry of entries) {
        const f = live(loaded, entry.feature);
        if (f) push(byFeature, f.key, { rec: r, entry });
      }
    }
    const total = Math.max(byFeature.size, 1);
    const weight = new Map([...spread].map(([k, df]) => [k, Math.log((total + 1) / Math.max(df, 1))]));
    return { byFeature, weight };
  });
}

/** The code records of a store, every one. */
export function codeRecords(loaded: Loaded): Rec[] {
  return ofType(loaded, 'source').filter((r) => r.valid && r.data.kind === CODE_KIND);
}

/** The checkouts of each project on this machine, by project slug: the directories the person's config binds to it in
 *  this store, and the repository the command runs in when it is one of them (a worktree holds files main does not). */
export function projectDirs(store: Store, cwdRoot?: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (slug: string, dir: string) => {
    const list = out.get(slug) ?? [];
    if (!list.includes(dir)) list.push(dir);
    out.set(slug, list);
  };
  let cfg;
  try {
    cfg = readUserConfig();
  } catch {
    cfg = { stores: [] };
  }
  const root = path.resolve(store.root);
  for (const s of cfg.stores)
    if (path.resolve(s.path) === root)
      for (const b of s.projects ?? [])
        if (b.project?.startsWith('project:')) add(b.project.slice('project:'.length), path.resolve(b.path));
  if (store.project?.startsWith('project:') && store.projectDir) {
    const slug = store.project.slice('project:'.length);
    add(slug, store.projectDir);
    if (cwdRoot) add(slug, cwdRoot);
  }
  return out;
}

/** Whether a code path is missing from every checkout of its project on this machine; undefined when none is known. */
export function isGone(dirs: Map<string, string[]>, project: string, file: string): boolean | undefined {
  const list = dirs.get(project);
  if (!list?.length) return undefined;
  const glob = /[*?[]/.test(file);
  return !list.some((d) => (glob ? globExists(d, file) : fs.existsSync(path.join(d, file))));
}

function globExists(dir: string, pattern: string): boolean {
  const base = pattern.split('/').findIndex((s) => /[*?[]/.test(s));
  const fixed = pattern.split('/').slice(0, base).join('/');
  return fs.existsSync(path.join(dir, fixed));
}

/** A person's link first (they said so), then an agent's (it went looking and found it), then what merged work
 *  touched, by score; the quieter after, then by path. */
const TIER: Record<Linker, number> = { person: 2, agent: 1, merge: 0 };
const rank = (a: CodeFile, b: CodeFile): number =>
  TIER[b.by] - TIER[a.by] || b.score - a.score || a.quiet - b.quiet || a.path.localeCompare(b.path);

/** How strongly a link says the file is the capability's: merged changes that touched it, an agent's link counting
 *  one more and a person's three, weighed by how few capabilities share the file. */
const scoreOf = (n: number, weight: number, by: Linker): number =>
  Math.max(n + TIER[by] + (by === 'person' ? 1 : 0), 1) * Math.max(weight, 0.05);

/** A rollup ranks by score alone: across many capabilities, the files most of them lean on come first. */
const byScore = (a: CodeFile, b: CodeFile): number => b.score - a.score || a.path.localeCompare(b.path);

function fileOf(
  loaded: Loaded,
  rec: Rec,
  e: Pick<Implements, 'by' | 'n' | 'last' | 'quiet'>,
  dirs?: Map<string, string[]>,
): CodeFile {
  const k = splitCodeKey(rec.key) ?? { project: '', path: String(rec.data.key ?? rec.key) };
  const gone = dirs ? isGone(dirs, k.project, k.path) : undefined;
  return {
    key: rec.key,
    project: k.project,
    path: k.path,
    by: e.by,
    n: e.n,
    score: scoreOf(e.n, codeIndex(loaded).weight.get(rec.key) ?? 1, e.by),
    ...(e.last ? { last: e.last } : {}),
    quiet: e.quiet ?? 0,
    ...(gone ? { gone } : {}),
  };
}

/** The files a capability names itself, ranked: a person's first, then the most touched by merged work, weighed by
 *  how few other capabilities share them. */
export function codeOf(loaded: Loaded, featureKey: string, dirs?: Map<string, string[]>): CodeFile[] {
  const f = live(loaded, featureKey);
  if (!f) return [];
  return (codeIndex(loaded).byFeature.get(f.key) ?? [])
    .map(({ rec, entry }) => fileOf(loaded, rec, entry, dirs))
    .toSorted(rank);
}

/** Whether a feature is a leaf of the tree: the most specific node, the one a file is linked to. A node with children
 *  shows theirs, rolled up, and holds none of its own. */
export function isLeaf(loaded: Loaded, key: string): boolean {
  const f = live(loaded, key);
  return f?.type === 'feature' && !(treeIndex(loaded).drawn.get(f.key) ?? []).length;
}

/** The features beneath a node, every depth. */
function beneath(loaded: Loaded, key: string): string[] {
  const ix = treeIndex(loaded);
  const out: string[] = [];
  const seen = new Set<string>([key]);
  const walk = (k: string) => {
    for (const c of ix.drawn.get(k) ?? []) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c.key);
      walk(c.key);
    }
  };
  walk(key);
  return out;
}

export interface NodeCode {
  key: string;
  /** The node's own files. */
  own: CodeFile[];
  /** Its children's files, every depth, once each with the capabilities that name it; counts summed. */
  rolled: CodeFile[];
}

/** A node's code: its own files and, beneath it, its children's rolled up. */
export function nodeCode(loaded: Loaded, key: string, dirs?: Map<string, string[]>): NodeCode {
  const rec = live(loaded, key);
  if (!rec) return { key, own: [], rolled: [] };
  const own = rec.type === 'feature' ? codeOf(loaded, rec.key, dirs) : [];
  const mine = new Set(own.map((f) => f.key));
  const byFile = new Map<string, CodeFile>();
  for (const k of beneath(loaded, rec.key)) {
    for (const { rec: r, entry } of codeIndex(loaded).byFeature.get(k) ?? []) {
      if (mine.has(r.key)) continue;
      const had = byFile.get(r.key);
      const one = fileOf(loaded, r, entry, dirs);
      if (had) {
        had.n += entry.n;
        had.score += one.score;
        had.features!.push(k);
        if (entry.by === 'person') had.by = 'person';
        had.quiet = Math.min(had.quiet, entry.quiet ?? 0);
      } else byFile.set(r.key, { ...one, features: [k] });
    }
  }
  return { key: rec.key, own, rolled: [...byFile.values()].toSorted(byScore) };
}

/** The code of each capability a change names (its own files; for a feature with none, its children's rolled up). */
export function changeCode(loaded: Loaded, rec: Rec, dirs?: Map<string, string[]>): NodeCode[] {
  const raw = Array.isArray(rec.data.features) ? rec.data.features : [];
  const keys = new Set<string>();
  for (const e of raw) {
    if (typeof e !== 'string') continue;
    const f = live(loaded, e.replace(/^(adds|changes|removes)\s+/, ''));
    if (f?.type === 'feature') keys.add(f.key);
  }
  return [...keys].map((k) => nodeCode(loaded, k, dirs)).filter((n) => n.own.length || n.rolled.length);
}

const fileLine = (f: CodeFile, scoped: boolean): string => {
  const marks = [
    f.n ? `${f.n}×` : '',
    f.by === 'person' ? 'pinned' : f.by === 'agent' && !f.n ? 'found' : '',
    f.gone ? 'gone: relink it once found' : '',
  ].filter(Boolean);
  return `- ${scoped ? f.key : f.path}${marks.length ? ` (${marks.join(', ')})` : ''}`;
};

/** A list of files, the first `limit` shown and the rest counted. */
export function formatFiles(files: CodeFile[], limit = SHOWN, scoped = false): string[] {
  const out = files.slice(0, limit).map((f) => fileLine(f, scoped));
  if (files.length > limit) out.push(`- … ${files.length - limit} more (pjman code <node> --all)`);
  return out;
}

/** How a node's code reads: its own files, then its children's rolled up, each list with its project when there are several. */
export function formatNodeCode(n: NodeCode, opts: { limit?: number; heading?: string } = {}): string[] {
  const limit = opts.limit ?? SHOWN;
  const projects = new Set([...n.own, ...n.rolled].map((f) => f.project));
  const scoped = projects.size > 1;
  const out: string[] = [];
  if (opts.heading) out.push(opts.heading);
  if (n.own.length) out.push(...formatFiles(n.own, limit, scoped));
  if (n.rolled.length) {
    out.push(n.own.length ? 'beneath it:' : 'from its children:');
    out.push(...formatFiles(n.rolled, n.own.length ? Math.ceil(limit / 2) : limit, scoped));
  }
  if (!n.own.length && !n.rolled.length) out.push('(no files linked: pjman code link <capability> <path>… once found)');
  return out;
}

/** How many files a change's context shows per capability: it is read at the start of every session on the change. */
export const SHOWN_IN_CONTEXT = 8;

/** The section a change's context carries: the files of the capabilities it names, and how to keep them true. */
export function formatChangeCode(nodes: NodeCode[]): string[] {
  if (!nodes.length) return [];
  const out = ['\n## Code'];
  for (const n of nodes) out.push('', ...formatNodeCode(n, { heading: `${n.key}:`, limit: SHOWN_IN_CONTEXT }));
  out.push(
    '',
    'A file found by search that implements one of these: pjman code link <capability> <path>…; one gone or wrong: pjman code mv <old> <new>, or pjman code unlink <capability> <path>.',
  );
  return out;
}
