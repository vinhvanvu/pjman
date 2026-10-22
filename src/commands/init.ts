import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SOURCE_KINDS, globalStorePath, LAYERS, openStore, readUserConfig, userConfigPath, userDir, writeStoreConfig, writeUserConfig, type StoreConfig, type UserStore } from '../config.js';
import { git, gitUserName, hasGit, toplevel } from '../git.js';
import { slugify } from '../keys.js';
import { loadStore } from '../records.js';
import { CliError } from '../util.js';
import { newProject } from './new.js';

export interface InitOpts {
  cwd: string;
  /** A store inside the repository at <repo>/.pjman/. Set aside; kept for a repository that must carry its own record. */
  inProject?: boolean;
  /** The project's name (default: the repository folder's); in-project, the store's name. */
  name?: string;
}

const FOLDERS = ['projects', 'changes', 'decisions', 'sources', 'sessions', 'actors'];

function scaffold(root: string, cfg: StoreConfig): void {
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(path.join(root, 'pjman.yaml'))) throw new CliError(`a store already exists at ${root}`);
  writeStoreConfig(root, cfg);
  fs.writeFileSync(path.join(root, '.gitignore'), 'index.db\nindex.db.tmp\n');
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
  if (actor) out.push(`records the tool writes will carry writer: ${actor} (user config 'actor')`);
  else out.push(`no actor known: set 'actor: person:<handle>' in ${path.join(userDir(), 'config.yaml')} or pass --writer`);
  return out;
}
