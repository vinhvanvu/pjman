import { emit } from '../events.js';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SOURCE_KINDS, globalStorePath, LAYERS, openStore, readUserConfig, userConfigPath, userDir, writeStoreConfig, writeUserConfig, type StoreConfig, type UserStore } from '../config.js';
import { git, gitUserName, hasGit, toplevel } from '../git.js';
import { slugify } from '../keys.js';
import { loadStore } from '../records.js';
import { CliError } from '../util.js';
import { newProject } from './new.js';
import { installBrief, type BriefTarget } from './brief.js';
import { packageRoot, start } from './start.js';
import { execFileSync } from 'node:child_process';

export interface InitOpts {
  cwd: string;
  /** A store inside the repository at <repo>/.pjman/. Set aside; kept for a repository that must carry its own record. */
  inProject?: boolean;
  /** The project's name (default: the repository folder's); in-project, the store's name. */
  name?: string;
  /** Install the harness adapter found on the machine (the CLI's default; the library's is false). */
  adapter?: boolean;
  /** Run pjman start at the end (the CLI's default; the library's is false). */
  start?: boolean;
  /** Also put the brief in a harness's always-on file. */
  brief?: BriefTarget;
  port?: number;
}

/** Install the Claude Code plugin from this checkout at user scope, when `claude` is on PATH. Idempotent; never throws. */
export function installClaudeAdapter(): string {
  const run = (args: string[]) => execFileSync('claude', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  try {
    run(['--version']);
  } catch {
    return 'no harness found on PATH (claude); the adapter is not installed';
  }
  const root = packageRoot();
  const soft = (args: string[]) => {
    try {
      return run(args);
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr || (e as Error).message);
      if (/already/i.test(msg)) return msg;
      throw new Error(msg.trim().split('\n')[0]);
    }
  };
  try {
    soft(['plugin', 'marketplace', 'add', root]);
    const out = soft(['plugin', 'install', 'pjman@pjman', '--scope', 'user']);
    return /already/i.test(out) ? 'Claude Code: the pjman plugin is installed (hooks, skill, brief, Linear MCP)' : 'Claude Code: installed the pjman plugin at user scope (hooks, skill, brief, Linear MCP); it loads at the next session or /reload-plugins';
  } catch (e) {
    return `Claude Code: the plugin could not be installed (${(e as Error).message}); run: claude plugin marketplace add ${root} && claude plugin install pjman@pjman`;
  }
}

const FOLDERS = ['projects', 'changes', 'decisions', 'sources', 'sessions', 'actors'];

function scaffold(root: string, cfg: StoreConfig): void {
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(path.join(root, 'pjman.yaml'))) throw new CliError(`a store already exists at ${root}`);
  writeStoreConfig(root, cfg);
  fs.writeFileSync(path.join(root, '.gitignore'), 'index.db\nindex.db.tmp\nevents.jsonl\nevents.jsonl.tmp\n');
  for (const f of FOLDERS) {
    fs.mkdirSync(path.join(root, f), { recursive: true });
    fs.writeFileSync(path.join(root, f, '.gitkeep'), '');
  }
}

/** Make sure the user config names an actor; derive one from git when it does not. */
function ensureActor(): string | undefined {
  const user = readUserConfig();
  if (user.actor) return user.actor;
  const name = gitUserName();
  if (!name) return undefined;
  user.actor = `person:${slugify(name)}`;
  writeUserConfig(user);
  return user.actor;
}

/** `owner/name` from the repository's origin remote, when it has one. */
function originRepo(project: string): string | null {
  try {
    const url = git(project, ['remote', 'get-url', 'origin']);
    const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function init(opts: InitOpts): string[] {
  const out: string[] = [];
  const project = toplevel(opts.cwd) ?? path.resolve(opts.cwd);
  const cfg = (name: string): StoreConfig => ({ name, layers: [...LAYERS], vocabulary: {}, source_kinds: [...DEFAULT_SOURCE_KINDS] });
  const actor = ensureActor();

  if (opts.inProject) {
    const root = path.join(project, '.pjman');
    scaffold(root, cfg(opts.name ?? path.basename(project)));
    out.push(`initialised in-project store at ${root}`);
    if (!toplevel(project)) out.push(`note: ${project} is not a git repository; the store will have no history until it is`);
    out.push('the tool never commits here; commit the store with the project');
  } else {
    if (!hasGit()) throw new CliError('git is required on PATH for the global store');
    const root = globalStorePath();
    if (!fs.existsSync(path.join(root, 'pjman.yaml'))) {
      scaffold(root, cfg('global'));
      if (!toplevel(root) || fs.realpathSync(toplevel(root)!) !== fs.realpathSync(root)) git(root, ['init', '-q']);
      git(root, ['add', '-A', '--', '.']);
      git(root, ['commit', '-q', '-m', 'pjman: init store global']);
      emit(openStore(root), [{ op: 'init', key: 'store', type: 'store', path: 'pjman.yaml' }], git(root, ['rev-parse', '--short', 'HEAD']));
      out.push(`created the global store at ${root} (its own git repository)`);
    } else {
      for (const f of FOLDERS) fs.mkdirSync(path.join(root, f), { recursive: true });
      out.push(`global store at ${root}`);
    }
    const user = readUserConfig();
    let entry: UserStore | undefined = user.stores.find((s) => path.resolve(s.path) === root);
    if (!entry) {
      entry = { name: 'global', path: root, projects: [] };
      user.stores.push(entry);
    }
    const title = opts.name ?? path.basename(project);
    const slug = slugify(title);
    if (!slug) throw new CliError(`'${title}' does not make a project slug; pass --name`);
    const key = `project:${slug}`;
    const store = openStore(root);
    if (!loadStore(store).byKey.has(key)) {
      const repo = originRepo(project);
      newProject(store, slug, { title, links: repo && store.config.source_kinds.includes('git-repo') ? [`git-repo:${repo}`] : undefined, writer: actor });
      out.push(`registered ${key}${repo ? ` (git-repo:${repo})` : ''}`);
    } else {
      out.push(`${key} is already registered`);
    }
    const binding = entry.projects.find((b) => path.resolve(b.path) === project);
    if (binding) binding.project = key;
    else entry.projects.push({ path: project, project: key });
    writeUserConfig(user);
    out.push(`${project} → ${key} in ${userConfigPath()}`);
    out.push('the tool commits every write it makes here');
  }
  if (actor) out.push(`you are ${actor} (user config 'actor')`);
  else out.push(`no actor known: set 'actor: person:<handle>' in ${path.join(userDir(), 'config.yaml')} or pass --writer`);
  if (opts.adapter) out.push(installClaudeAdapter());
  if (opts.brief) {
    const b = installBrief(opts.brief);
    out.push(`${b.changed ? 'wrote' : 'kept'} the brief in ${b.path}`);
  }
  if (opts.start && !opts.inProject) {
    try {
      const s = start({ cwd: opts.cwd, port: opts.port, log: (l) => out.push(l) });
      out.push(`dashboard: ${s.address.url}${s.started ? '' : ' (already running)'}${s.ui ? '' : ' (API only: no built app)'}`);
    } catch (e) {
      out.push(`dashboard: ${(e as Error).message}`);
    }
  }
  out.push('left to do: nothing here; to read tickets, sign in to the tracker from inside a session (/mcp)');
  return out;
}
