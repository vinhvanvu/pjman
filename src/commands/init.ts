import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SOURCE_KINDS, LAYERS, readUserConfig, userDir, writeStoreConfig, writeUserConfig, type StoreConfig } from '../config.js';
import { git, gitUserName, hasGit, toplevel } from '../git.js';
import { slugify } from '../keys.js';
import { CliError } from '../util.js';

export interface InitOpts {
  cwd: string;
  inProject?: boolean;
  dir?: string;
  name?: string;
}

const FOLDERS = ['changes', 'decisions', 'sources', 'sessions', 'actors'];

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

export function init(opts: InitOpts): string[] {
  const out: string[] = [];
  const project = toplevel(opts.cwd) ?? path.resolve(opts.cwd);
  const name = opts.name ?? path.basename(project);
  const cfg: StoreConfig = { name, layers: [...LAYERS], vocabulary: {}, source_kinds: [...DEFAULT_SOURCE_KINDS] };

  if (opts.inProject) {
    const root = path.join(project, '.pjman');
    scaffold(root, cfg);
    out.push(`initialised in-project store at ${root}`);
    if (!toplevel(project)) out.push(`note: ${project} is not a git repository; the store will have no history until it is`);
    out.push('the tool never commits here; commit the store with the project');
  } else {
    if (!hasGit()) throw new CliError('git is required on PATH for a standalone store');
    const root = path.resolve(opts.dir ?? path.join(userDir(), 'stores', name));
    scaffold(root, cfg);
    if (!toplevel(root) || fs.realpathSync(toplevel(root)!) !== fs.realpathSync(root)) {
      git(root, ['init', '-q']);
    }
    git(root, ['add', '-A', '--', '.']);
    git(root, ['commit', '-q', '-m', `pjman: init store ${name}`]);
    const user = readUserConfig();
    const existing = user.stores.find((s) => path.resolve(s.path) === root);
    if (existing) {
      if (!existing.projects.includes(project)) existing.projects.push(project);
    } else {
      user.stores.push({ name, path: root, projects: [project] });
    }
    writeUserConfig(user);
    out.push(`initialised standalone store '${name}' at ${root} (its own git repository)`);
    out.push(`bound to ${project} in ${path.join(userDir(), 'config.yaml')}`);
  }
  const actor = ensureActor();
  if (actor) out.push(`records the tool writes will carry writer: ${actor} (user config 'actor')`);
  else out.push(`no actor known: set 'actor: person:<handle>' in ${path.join(userDir(), 'config.yaml')} or pass --writer`);
  return out;
}
