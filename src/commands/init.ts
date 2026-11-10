import { emit } from '../events.js';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SOURCE_KINDS, DEFAULT_TREE_LEVELS, globalStorePath, LAYERS, openStore, readUserConfig, userConfigPath, userDir, writeStoreConfig, writeUserConfig, type Store, type StoreConfig, type UserStore } from '../config.js';
import { git, gitUserEmail, gitUserName, hasGit, toplevel } from '../git.js';
import { slugify } from '../keys.js';
import { loadStore } from '../records.js';
import { personOf } from '../refs.js';
import { CliError, notFound } from '../util.js';
import { newActor, newProduct, newProject } from './new.js';
import { seedSessionKinds } from '../session-kinds.js';
import { set } from './set.js';
import { installBrief, type BriefTarget } from './brief.js';
import { FORMAT_VERSION } from './migrate.js';
import { packageRoot, start } from './start.js';
import { HANDLE_KINDS, checkersFor, formatIdentity, identity, machineName, type Checker } from '../identity.js';
import { describeInventory, inventory, mapGuidance } from '../inventory.js';
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
  /** Whether the first session should propose a product map: true or false answers; undefined asks on a terminal, else yes. */
  map?: boolean;
  /** The product the repository belongs to, when it already exists; else one is created with the project's name. */
  product?: string;
  /** The account checkers (tests pass fakes); the default is GitHub through gh. */
  checkers?: Checker[];
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

const FOLDERS = ['products', 'projects', 'decisions', 'sources', 'sessions', 'session-kinds', 'actors'];

/** A yes/no question on the terminal; the default when stdin is not a terminal or the answer is empty. */
export function askYesNo(question: string, dflt: boolean): boolean {
  if (!process.stdin.isTTY) return dflt;
  process.stdout.write(`${question} ${dflt ? '[Y/n]' : '[y/N]'} `);
  const buf = Buffer.alloc(256);
  let n = 0;
  try {
    n = fs.readSync(0, buf, 0, buf.length, null);
  } catch {
    return dflt;
  }
  const a = buf.toString('utf8', 0, n).trim().toLowerCase();
  if (!a) return dflt;
  return a.startsWith('y');
}

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

/** The person's login at the forge, when signed in: the first suggestion for a handle. */
function forgeLogin(checkers: Checker[]): { kind: string; login: string } | null {
  for (const c of checkers) {
    if (!HANDLE_KINDS.includes(c.kind)) continue;
    const login = c.self();
    if (login) return { kind: c.kind, login };
  }
  return null;
}

/** Make sure the user config names an actor: there is always one. The handle is the person's own, suggested in a fixed
 *  order, the forge login, else the committer name, else this machine's account name, which always exists; the accounts
 *  the fallback knew (the forge login, the committer email) are what the person record links. A handle from the
 *  committer name or the machine claims no account of a handle kind, so it reads as provisional until the person claims
 *  one or renames it (decision handle-from-the-forge/say-it-while-unclaimed). */
function ensureActor(checkers: Checker[]): { actor?: string; login?: { kind: string; login: string } | null; email?: string | null; name?: string | null } {
  const user = readUserConfig();
  const email = gitUserEmail();
  const name = gitUserName();
  // an actor already named (the config, or the environment of a run) is kept; the forge is asked only to suggest a new handle
  if (user.actor) return { actor: user.actor, email, name };
  if (process.env.PJMAN_WRITER?.startsWith('person:')) {
    user.actor = process.env.PJMAN_WRITER;
    writeUserConfig(user);
    return { actor: user.actor, email, name };
  }
  const login = forgeLogin(checkers);
  const handle = [login?.login, name, machineName()].map((s) => (s ? slugify(s) : '')).find(Boolean) ?? '';
  if (!handle) return { login, email, name };
  user.actor = `person:${handle}`;
  writeUserConfig(user);
  return { actor: user.actor, login, email, name };
}

/** The health of the person record on a re-run: a record that claims no account of a handle kind is given the forge
 *  login when the login is the handle itself (unambiguous, and what the first run would have done); when they differ
 *  nothing is claimed, so a provisional handle never turns chosen by accident, and the read below says what to do. */
function claimLogin(store: Store, actor: string, checkers: Checker[]): string | null {
  const loaded = loadStore(store);
  const rec = loaded.byKey.get(actor)?.[0];
  if (!rec) return null;
  const links = Array.isArray(rec.data.links) ? (rec.data.links as unknown[]).filter((l): l is string => typeof l === 'string') : [];
  if (links.some((l) => HANDLE_KINDS.includes(l.slice(0, l.indexOf(':'))))) return null;
  const login = forgeLogin(checkers);
  if (!login || slugify(login.login) !== actor.slice('person:'.length)) return null;
  const key = `${login.kind}:${login.login}`;
  if (!store.config.source_kinds.includes(login.kind) || personOf(loaded, key)) return null;
  set(store, actor, [`links=${[...links, key].join(',')}`], {});
  return key;
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
  const cfg = (name: string): StoreConfig => ({ name, layers: [...LAYERS], vocabulary: {}, source_kinds: [...DEFAULT_SOURCE_KINDS], tree_levels: [...DEFAULT_TREE_LEVELS], version: FORMAT_VERSION });
  // init is the person's own act, so the apps are asked afresh; the day's cache is refilled for the sessions that follow
  const checkers = checkersFor({ checkers: opts.checkers, fresh: true });
  const who = ensureActor(checkers);
  const actor = who.actor;

  if (opts.inProject) {
    const root = path.join(project, '.pjman');
    const title = opts.name ?? path.basename(project);
    scaffold(root, cfg(title));
    out.push(`initialised in-project store at ${root}`);
    // the repository is the store's one project, under a product of the same name
    const slug = slugify(title);
    if (slug) {
      const own = openStore(root);
      newProduct(own, slug, { title, name: title.length <= 24 ? title : undefined, writer: actor });
      const inv = inventory(project);
      newProject(own, slug, { title, product: `product:${slug}`, writer: actor, map: opts.map === false ? 'skip' : 'propose', holds: inv.holds });
      out.push(`registered project:${slug} under product:${slug}`);
      seedSessionKinds(own, { writer: actor });
      out.push(`the repository holds ${describeInventory(inv)}`);
      if (opts.map !== false) out.push(mapGuidance(inv.holds));
    }
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
    // the kinds a session with no change may be given come with the store (decision unbound-sessions/kinds)
    const seeded = seedSessionKinds(store, { writer: actor });
    if (seeded.length) out.push(`created ${seeded.join(', ')}`);
    let loaded = loadStore(store);
    // the person: a record keyed by their handle, holding the accounts the sources will be matched through
    if (actor && !loaded.byKey.has(actor)) {
      const links = [who.login ? `${who.login.kind}:${who.login.login}` : null, who.email ? `email:${who.email.toLowerCase()}` : null].filter((k): k is string => !!k && store.config.source_kinds.includes(k.slice(0, k.indexOf(':'))));
      newActor(store, actor, { name: who.name ?? undefined, links, writer: actor });
      out.push(`created ${actor}${links.length ? ` (${links.join(', ')})` : ''}`);
      loaded = loadStore(store);
    } else if (actor) {
      const claimed = claimLogin(store, actor, checkers);
      if (claimed) {
        out.push(`claimed ${claimed} for ${actor}: it is your handle`);
        loaded = loadStore(store);
      }
    }
    const known = loaded.byKey.get(key)?.[0];
    // what the repository holds, read now and recorded on the project: the brief's line and intake's offer read by it
    const inv = inventory(project);
    out.push(`the repository holds ${describeInventory(inv)}`);
    const wantsMap = opts.map ?? (known && typeof known.data.map === 'string' ? undefined : askYesNo('Should the first session propose a product map from this repository?', true));
    if (!known) {
      const repo = originRepo(project);
      // the product the repository builds: an existing one named by --product, else one made now with the project's name
      let product = opts.product;
      if (product && !loaded.byKey.has(product.startsWith('product:') ? product : `product:${product}`)) throw notFound(`--product ${product}`, { as: 'product' });
      if (!product) {
        if (!loaded.byKey.has(`product:${slug}`)) newProduct(store, slug, { title, name: title.length <= 24 ? title : undefined, writer: actor });
        product = `product:${slug}`;
        out.push(`created ${product}`);
      } else if (!product.startsWith('product:')) product = `product:${product}`;
      newProject(store, slug, { title, product, links: repo && store.config.source_kinds.includes('git-repo') ? [`git-repo:${repo}`] : undefined, writer: actor, map: wantsMap === false ? 'skip' : 'propose', holds: inv.holds });
      out.push(`registered ${key} under ${product}${repo ? ` (git-repo:${repo})` : ''}`);
    } else {
      out.push(`${key} is already registered`);
      const pairs = [wantsMap !== undefined && known.data.map !== (wantsMap ? 'propose' : 'skip') ? `map=${wantsMap ? 'propose' : 'skip'}` : null, known.data.holds !== inv.holds ? `holds=${inv.holds}` : null].filter((p): p is string => !!p);
      if (pairs.length) set(store, key, pairs, {});
    }
    const answer = wantsMap ?? (known?.data.map !== 'skip');
    out.push(answer ? `${inv.holds === 'bare' ? 'no map is proposed yet' : 'the first change through intake proposes a product map'} (${key} map=propose; pjman set ${key} map=skip to stop): ${mapGuidance(inv.holds)}` : `no product map will be proposed (${key} map=skip)`);
    const binding = entry.projects.find((b) => path.resolve(b.path) === project);
    if (binding) binding.project = key;
    else entry.projects.push({ path: project, project: key });
    writeUserConfig(user);
    out.push(`${project} → ${key} in ${userConfigPath()}`);
    out.push('the tool commits every write it makes here');
  }
  // who you are, as the store and the apps see it: the same read as pjman whoami --verify
  if (opts.inProject) out.push(actor ? `you are ${actor} (user config 'actor')` : `no actor known: set 'actor: person:<handle>' in ${path.join(userDir(), 'config.yaml')} or pass --writer`);
  else out.push(...formatIdentity(identity(openStore(globalStorePath()), { verify: true, checkers })));
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
