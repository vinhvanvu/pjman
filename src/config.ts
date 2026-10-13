import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { CliError } from './util.js';
import { isOwnRepo } from './git.js';

export const CANONICAL_STATUSES = ['open', 'planning', 'active', 'blocked', 'review', 'done', 'dropped'] as const;
export const DECISION_STATUSES = ['proposed', 'decided', 'superseded', 'reverted'] as const;
export const ACTOR_KINDS = ['person', 'agent'] as const;
export const LAYERS = ['core', 'sources', 'work'] as const;
export const DEFAULT_SOURCE_KINDS = [
  'file', 'url', 'doc', 'git-repo', 'branch', 'github-pr', 'github-issue', 'linear', 'jira', 'thread',
];

export interface StoreConfig {
  name: string;
  layers: string[];
  vocabulary: Record<string, string>;
  source_kinds: string[];
}

export type StoreMode = 'in-project' | 'standalone';

export interface Store {
  root: string;
  mode: StoreMode;
  config: StoreConfig;
}

export interface UserStore {
  name: string;
  path: string;
  projects: string[];
}

export interface UserConfig {
  actor?: string;
  stores: UserStore[];
}

export function userDir(): string {
  return process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman');
}

export function userConfigPath(): string {
  return path.join(userDir(), 'config.yaml');
}

export function readUserConfig(): UserConfig {
  const p = userConfigPath();
  if (!fs.existsSync(p)) return { stores: [] };
  const raw = parse(fs.readFileSync(p, 'utf8')) as Partial<UserConfig> | null;
  const stores = Array.isArray(raw?.stores) ? raw!.stores : [];
  return { actor: typeof raw?.actor === 'string' ? raw.actor : undefined, stores };
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
  return { name: typeof raw.name === 'string' ? raw.name : path.basename(root), layers, vocabulary, source_kinds };
}

export function writeStoreConfig(root: string, cfg: StoreConfig): void {
  fs.writeFileSync(path.join(root, 'pjman.yaml'), stringify(cfg, { lineWidth: 0 }));
}

export function modeOf(root: string): StoreMode {
  return isOwnRepo(root) ? 'standalone' : 'in-project';
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
    const candidate = path.join(dir, '.pjman');
    if (fs.existsSync(path.join(candidate, 'pjman.yaml'))) return openStore(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const user = readUserConfig();
  let best: { store: UserStore; depth: number } | null = null;
  for (const s of user.stores) {
    for (const p of s.projects ?? []) {
      const abs = path.resolve(p);
      if (isWithin(abs, path.resolve(cwd))) {
        const depth = abs.split(path.sep).length;
        if (!best || depth > best.depth) best = { store: s, depth };
      }
    }
  }
  if (best && fs.existsSync(path.join(best.store.path, 'pjman.yaml'))) return openStore(best.store.path);
  return null;
}

export function requireStore(cwd: string, override?: string): Store {
  const s = findStore(cwd, override);
  if (!s) throw new CliError('no store found: run `pjman init` in the project, or pass --store <path>');
  return s;
}
