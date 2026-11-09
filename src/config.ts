import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { CliError } from './util.js';

export const CANONICAL_STATUSES = ['open', 'planning', 'active', 'blocked', 'review', 'done', 'dropped'] as const;
export const DECISION_STATUSES = ['proposed', 'decided', 'superseded', 'reverted'] as const;
export const ACTOR_KINDS = ['person', 'agent'] as const;
/** A change is work unless it says otherwise; a bug is a change against something live. */
export const CHANGE_KINDS = ['work', 'bug'] as const;
/** A bug's severity: where on the tree the behaviour is lost (the first three are levels), else a nuisance with a
 *  workaround, else cosmetic. In order from worst. */
/** A project's answer to the map question: the first session proposes a product map, or not. */
export const MAP_ANSWERS = ['propose', 'skip'] as const;
/** What a project's repository holds, as `pjman init` inventoried it: documentation, code, both, or nothing yet. The
 *  map comes to the product by this: docs give the sentences, code the split, bare grows from the work. */
export const HOLDS = ['bare', 'docs', 'code', 'docs+code'] as const;
export type Holds = (typeof HOLDS)[number];
export const SEVERITIES = ['product', 'feature', 'capability', 'nuisance', 'cosmetic'] as const;
export const LAYERS = ['core', 'sources', 'work'] as const;
export const DEFAULT_SOURCE_KINDS = [
  'file', 'url', 'doc', 'git-repo', 'branch', 'github-pr', 'github-issue', 'linear', 'jira', 'thread',
  ...['github-user', 'linear-user', 'email', 'git-author'],
];
/** The accounts a person holds, keyed as the outside world keys them; a person record links them. */
export const IDENTITY_KINDS = ['github-user', 'linear-user', 'email', 'git-author'];

/** The product tree's level labels below the root, pjman's template; a product may name its own. */
export const DEFAULT_TREE_LEVELS = ['feature', 'capability'];

export interface StoreConfig {
  name: string;
  layers: string[];
  vocabulary: Record<string, string>;
  source_kinds: string[];
  tree_levels: string[];
  /** The format the store is in: the pjman version that last initialised or migrated it, stamped by init and by
   *  `pjman migrate`, never by an ordinary write. Absent on a store from before the field (read as 0.1.0). */
  version?: string;
}

export type StoreMode = 'in-project' | 'standalone';

export interface Store {
  root: string;
  mode: StoreMode;
  config: StoreConfig;
  /** The project the working directory maps to, when the store was found through the user map. */
  project?: string;
  /** The directory `file:` keys are relative to: the mapped repository, or the repository holding an in-project store. */
  projectDir?: string;
}

/** A directory on this machine → the project record it belongs to. */
export interface ProjectBinding {
  path: string;
  project?: string;
}

export interface UserStore {
  name: string;
  path: string;
  projects: ProjectBinding[];
}

export interface UserConfig {
  actor?: string;
  /** A session in an unregistered git repository registers it (default true). */
  auto_register?: boolean;
  /** The person's branch prefix (`vinh`): the recommended branch for a change is `<prefix>/<slug>`. */
  branch_prefix?: string;
  stores: UserStore[];
}

export function userDir(): string {
  return process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman');
}

export function userConfigPath(): string {
  return path.join(userDir(), 'config.yaml');
}

/** The one global store: `~/.pjman/store`. */
export function globalStorePath(): string {
  return path.join(userDir(), 'store');
}

export function readUserConfig(): UserConfig {
  const p = userConfigPath();
  if (!fs.existsSync(p)) return { stores: [] };
  const raw = parse(fs.readFileSync(p, 'utf8')) as Partial<UserConfig> | null;
  const stores = (Array.isArray(raw?.stores) ? raw!.stores : []).map((s) => {
    const st = s as { name?: string; path?: string; projects?: unknown };
    const projects = (Array.isArray(st.projects) ? st.projects : []).map((p): ProjectBinding =>
      typeof p === 'string' ? { path: p } : { path: String((p as ProjectBinding).path), project: (p as ProjectBinding).project },
    );
    return { name: String(st.name ?? ''), path: String(st.path ?? ''), projects };
  });
  return { actor: typeof raw?.actor === 'string' ? raw.actor : undefined, stores, auto_register: raw?.auto_register, branch_prefix: typeof raw?.branch_prefix === 'string' ? raw.branch_prefix : undefined };
}

export function writeUserConfig(cfg: UserConfig): void {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(userConfigPath(), stringify(cfg, { lineWidth: 0 }));
}

export function loadStoreConfig(root: string): StoreConfig {
  const p = path.join(root, 'pjman.yaml');
  if (!fs.existsSync(p)) throw new CliError(`not a store: ${root} has no pjman.yaml`);
  const raw = (parse(fs.readFileSync(p, 'utf8')) ?? {}) as Record<string, unknown>;
  const layers = Array.isArray(raw.layers) ? raw.layers.map(String) : ['core'];
  const vocabulary: Record<string, string> = {};
  if (raw.vocabulary && typeof raw.vocabulary === 'object') {
    for (const [k, v] of Object.entries(raw.vocabulary as Record<string, unknown>)) vocabulary[k] = String(v);
  }
  const source_kinds = Array.isArray(raw.source_kinds) ? raw.source_kinds.map(String) : [...DEFAULT_SOURCE_KINDS];
  const tree_levels = Array.isArray(raw.tree_levels) && raw.tree_levels.length ? raw.tree_levels.map(String) : [...DEFAULT_TREE_LEVELS];
  // kept as written, even when YAML read it as a number: validate refuses a stamp that is not semver
  const version = raw.version === undefined || raw.version === null ? undefined : String(raw.version);
  return { name: typeof raw.name === 'string' ? raw.name : path.basename(root), layers, vocabulary, source_kinds, tree_levels, ...(version ? { version } : {}) };
}

export function writeStoreConfig(root: string, cfg: StoreConfig): void {
  fs.writeFileSync(path.join(root, 'pjman.yaml'), stringify(cfg, { lineWidth: 0 }));
}

/** Standalone when the store's folder is the top of its own repository: its .git is there (a folder, or a worktree's
 *  file). Read from the folder, so naming a store spawns nothing. */
export function modeOf(root: string): StoreMode {
  return fs.existsSync(path.join(root, '.git')) ? 'standalone' : 'in-project';
}

export function openStore(root: string): Store {
  const abs = path.resolve(root);
  return { root: abs, mode: modeOf(abs), config: loadStoreConfig(abs) };
}

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolution: `--store` or PJMAN_STORE; else a `.pjman/` walking up; else the user map; else null. */
export function findStore(cwd: string, override?: string): Store | null {
  const explicit = override || process.env.PJMAN_STORE;
  if (explicit) return openStore(explicit);
  let dir = path.resolve(cwd);
  for (;;) {
    // inside a store itself (the global store, or any store opened by path; `changes/` is the layout before products held them)
    if (fs.existsSync(path.join(dir, 'pjman.yaml')) && (fs.existsSync(path.join(dir, 'products')) || fs.existsSync(path.join(dir, 'changes')))) return openStore(dir);
    const candidate = path.join(dir, '.pjman');
    if (fs.existsSync(path.join(candidate, 'pjman.yaml'))) {
      // an in-project store holds its own project record: the one it has is the current project
      const projects = (() => { try { return fs.readdirSync(path.join(candidate, 'projects')).filter((f) => f.endsWith('.md')); } catch { return []; } })();
      return { ...openStore(candidate), projectDir: dir, project: projects.length === 1 ? `project:${projects[0].slice(0, -3)}` : undefined };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const user = readUserConfig();
  let best: { store: UserStore; binding: ProjectBinding; depth: number } | null = null;
  for (const s of user.stores) {
    for (const b of s.projects ?? []) {
      const abs = path.resolve(b.path);
      if (isWithin(abs, path.resolve(cwd))) {
        const depth = abs.split(path.sep).length;
        if (!best || depth > best.depth) best = { store: s, binding: b, depth };
      }
    }
  }
  if (best && fs.existsSync(path.join(best.store.path, 'pjman.yaml'))) return { ...openStore(best.store.path), project: best.binding.project, projectDir: path.resolve(best.binding.path) };
  return null;
}

/** The global store on its own, for commands that serve every project. */
export function globalStore(): Store | null {
  const root = globalStorePath();
  return fs.existsSync(path.join(root, 'pjman.yaml')) ? openStore(root) : null;
}

export function requireStore(cwd: string, override?: string): Store {
  const s = findStore(cwd, override);
  if (!s) throw new CliError('no store found: run `pjman init` in the project, or pass --store <path>');
  return s;
}
