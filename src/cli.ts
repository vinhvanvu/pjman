import './quiet.js';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { findStore, globalStore, globalStorePath, readUserConfig, requireStore } from './config.js';
import { BRIEF } from './commands/brief.js';
import { start, stop } from './commands/start.js';
import { openPage, openUrl } from './commands/open.js';
import { withStoreLock } from './lock.js';
import { branchNameFor, worktreeNameFor } from './branch.js';
import { buildIndex, query } from './indexdb.js';
import { loadStore, resolve, storeScope, unresolvedError } from './records.js';
import { ambiguous, CliError, notFound, plural, usageError } from './util.js';
import { argsFor, commandOf, FLAG_TYPES, flagsFor, GLOBAL_FLAGS, helpFor, overview, RETIRED_FLAGS } from './surface.js';
import { formatProblems, summarise, validate } from './validate.js';
import { findReferences, formatNeighbourhood, formatReferences, get, resolveArg } from './graph.js';
import { renderView, watchStore } from './commands/pane.js';
import { follow, formatEvent, lastSeq, readEvents, rebuildEvents } from './events.js';
import { installedTool, readServeAddress, startServer } from './server.js';
import { syncLinear } from './sync/linear.js';
import { syncGithub } from './sync/github.js';
import { init } from './commands/init.js';
import { newRecord, type NewFlags } from './commands/new.js';
import { sessionBind, sessionFocus, type BindReason, sessionLog, sessionObserve, sessionStart, sessionUnbind, sessionProject } from './commands/session.js';
import { brief, followWakes, formatBriefSize, type Wake } from './hydrate.js';
import { note } from './commands/note.js';
import { envelope } from './write.js';
import { fmt } from './commands/fmt.js';
import { mv } from './commands/mv.js';
import { rm } from './commands/rm.js';
import { apply, applyLines, undo } from './commands/apply.js';
import { liftsOfStore } from './lift.js';
import { formatRest, restOf } from './rest.js';
import { formatTree, tree } from './tree.js';
import { formatReceipt, receipt } from './receipt.js';
import { activity, formatActivity } from './activity.js';
import { set } from './commands/set.js';
import { decision, entriesFromFlags, entriesFromJson } from './commands/decision.js';
import { formatPlan, step } from './commands/step.js';
import { order, sequenceOf } from './commands/order.js';
import { formatIntake, intake } from './intake.js';
import { changeContext, formatChangeContext, formatLs, formatStoreContext, ls, row, show, storeContext } from './commands/view.js';
import { describeMigration, formatMismatch, migrate, pendingMigration } from './commands/migrate.js';
import { TOOL_VERSION } from './version.js';
import { formatIdentity, identity } from './identity.js';
import { fieldKind, shortenText, typedRef } from './keys.js';


const PARSE_OPTIONS = FLAG_TYPES;

/** The arguments parsed, then held to the command's own declaration (decision interface-audit/flags-per-command): a
 *  flag it does not take is refused naming the ones it does, a retired flag with where its job went, and more
 *  positionals than it takes are refused (a text with spaces is one quoted argument). */
function parse(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, strict: true, options: PARSE_OPTIONS });
  } catch (e) {
    throw usageError(`${(e as Error).message.split('\n')[0].replace(/\. To specify a positional argument.*$/, '')} (a value that starts with a dash is passed as --flag=value)`);
  }
  const { values: v, positionals: pos } = parsed;
  const cmd = commandOf(pos[0] ?? '');
  if (cmd && !v.help) {
    // flags and arity by subcommand where the declaration keys them so
    const bySub = (!Array.isArray(cmd.flags)) || (cmd.args !== undefined && typeof cmd.args === 'object');
    const sub = bySub ? pos[cmd.subAt ?? 1] : undefined;
    const allowed = flagsFor(cmd, sub);
    const label = `pjman ${cmd.name}${sub && allowed ? ` ${sub}` : ''}`;
    if (allowed) {
      for (const f of Object.keys(v)) {
        if ((GLOBAL_FLAGS as readonly string[]).includes(f) || allowed.includes(f)) continue;
        const pointer = RETIRED_FLAGS[f] ?? (sub ? cmd.retired?.[sub]?.[f] : undefined);
        if (pointer) throw usageError(`--${f} is retired here: ${pointer}`);
        // a near flag it does take (--feature for --features), or where the flag belongs
        const near = allowed.find((x) => x === `${f}s` || `${x}s` === f || x.replace(/-/g, '') === f.replace(/-/g, ''));
        const there = cmd.elsewhere?.[f];
        throw usageError(`${label} takes no --${f}${near ? ` (did you mean --${near}?)` : there ? ` (${there})` : ''}; it takes ${allowed.length ? allowed.map((x) => `--${x}`).join(' ') : 'no flags of its own'} (pjman help ${cmd.name})`);
      }
    }
    const max = argsFor(cmd, sub);
    const given = pos.length - 1 - (sub !== undefined ? 1 : 0);
    if (max !== undefined && given > max) {
      const extra = pos.slice(pos.length - (given - max));
      throw usageError(`${label} takes ${max === 0 ? 'no arguments' : max === 1 ? 'one argument' : `${max} arguments`}; got ${extra.map((x) => `'${x}'`).join(' ')} besides (quote a text with spaces as one argument; pjman help ${cmd.name})`);
    }
  }
  return parsed;
}

// Inside a product the slug alone names a record: text output drops the product segment of the current project's product
// (JSON keeps the full keys). Set once the store is known.
let scopeProduct: string | null = null;
const scoped = (store: ReturnType<typeof requireStore>) => {
  try {
    scopeProduct = storeScope(store);
  } catch {
    scopeProduct = null;
  }
  return store;
};
const out = (s: string) => {
  const t = shortenText(s, scopeProduct);
  process.stdout.write(t.endsWith('\n') ? t : t + '\n');
};
// JSON keeps the full keys: it is read by programs, and the product segment is part of the key
const json = (x: unknown) => process.stdout.write(JSON.stringify(x, null, 2) + '\n');

/** An existing decision named by its slug alone: refused when none or several have it (a new decision is keyed
 *  <change>/<slug>, which says where it lives). */
function decisionBySlug(loaded: ReturnType<typeof loadStore>, slug: string): string {
  const hits = loaded.records.filter((r) => r.type === 'decision' && r.decisionSlug === slug).map((r) => r.key);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw ambiguous(slug, hits);
  throw notFound(slug, { as: 'decision', hint: 'a new decision is keyed <change>/<slug>' });
}

/** The same act over several records as one commit and one undo (decision interface-audit/bulk-writes): the lines
 *  held as a batch, each run by `run`; in a store the tool does not commit, one by one. */
function batch(store: ReturnType<typeof requireStore>, v: { session?: string; writer?: string }, lines: string[][], run: (argv: string[]) => void): { commit: string | null } {
  if (store.mode !== 'standalone') {
    for (const l of lines) run(l);
    return { commit: null };
  }
  return applyLines(store, lines.map((argv, i) => ({ line: i + 1, argv })), run, { session: v.session, writer: v.writer });
}

/** The current project's tracker (its ticket source kind), or null. */
function trackerOf(store: ReturnType<typeof requireStore>): string | null {
  if (!store.project) return null;
  const rec = loadStore(store).byKey.get(store.project)?.[0];
  return rec && typeof rec.data.tracker === 'string' ? rec.data.tracker : null;
}

function main(argv: string[]): number {
  const { values: v, positionals: pos } = parse(argv);
  const cmd = pos[0];
  if (v.version) {
    out(`pjman ${TOOL_VERSION}`);
    return 0;
  }
  if (v.help || cmd === 'help') {
    const name = cmd === 'help' ? pos[1] : cmd;
    if (!name) {
      out(overview());
      return 0;
    }
    const text = helpFor(name);
    if (!text) throw usageError(`no entity or command '${name}'; pjman --help lists them`);
    out(text);
    return 0;
  }
  if (!cmd) {
    out(overview());
    return 2;
  }
  if (!commandOf(cmd)) throw usageError(`unknown command '${cmd}'; pjman --help lists them`);
  const cwd = process.cwd();
  // a session's brief records its watermark, and a session reading a change's context moves its focus: both write
  const writes = WRITE_COMMANDS.has(cmd) || (cmd === 'brief' && !!v.session) || (cmd === 'context' && !!pos[1] && !!process.env.PJMAN_SESSION);
  if (!writes) return dispatch(v, pos, cmd, cwd);
  // one writer at a time per store: the lock is held from before the first file is touched to after the commit
  return withStoreLock(findStore(cwd, v.store)?.root ?? globalStorePath(), () => {
    // the store names its format: a store newer than this pjman is not written, an older one is migrated first; read
    // under the lock, so a stamp landing from another writer is seen
    if (!FORMAT_EXEMPT.has(cmd)) {
      const store = findStore(cwd, v.store);
      const mismatch = store ? formatMismatch(store, TOOL_VERSION) : null;
      if (mismatch) throw new CliError(`refused: ${mismatch}`);
    }
    return dispatch(v, pos, cmd, cwd);
  });
}

/** The commands that write the store. */
const WRITE_COMMANDS = new Set(['init', 'new', 'set', 'decision', 'step', 'note', 'session', 'mv', 'rm', 'fmt', 'sync', 'order', 'apply', 'undo', 'migrate', 'lift']);
/** The writes that move a store between formats, or make one: never refused for the store's format. */
const FORMAT_EXEMPT = new Set(['init', 'migrate', 'undo']);

type Parsed = ReturnType<typeof parse>;

function dispatch(v: Parsed['values'], pos: Parsed['positionals'], cmd: string, cwd: string): number {
  switch (cmd) {
    case 'init': {
      if (v.brief && v.brief !== 'claude-md') throw new CliError('--brief takes claude-md');
      for (const line of init({ cwd, inProject: v['in-project'], name: v.name, adapter: !v['no-adapter'], start: !v['no-start'], brief: v.brief as 'claude-md' | undefined, port: v.port ? Number(v.port) : undefined, map: v['no-map'] ? false : v.map ? true : undefined, product: v.product })) out(line);
      return 0;
    }
    case 'new': {
      const store = scoped(requireStore(cwd, v.store));
      const [, type, ident] = pos;
      if (!type || !ident) throw usageError('usage: pjman new <product|feature|aspect|place|project|change|decision|release|source|actor|session> <ident> [flags]');
      const flags: NewFlags = {
        title: v.title, status: v.status, project: v.project, tracker: v.tracker, summary: v.summary,
        gist: v.gist, origin: v.origin, intent: v.intent, doneWhen: v['done-when'], scope: v.scope, openQuestions: v['open-questions'], blockedOn: v['blocked-on'], notes: v.notes,
        binds: v.binds, links: v.links, steps: v.step,
        supersedes: v.supersedes, name: v.name, url: v.url,
        agent: v.agent, onBehalfOf: v['on-behalf-of'], parent: v.parent, started: v.started,
        product: v.product, owners: v.owners, features: v.features, level: v.level, levels: v.levels,
        dependsOn: v['depends-on'], kind: v.kind, severity: v.severity, target: v.target, sequence: v.sequence,
        aspects: v.aspects, feature: v.feature,
        tag: v.tag, at: v.at, commit: v.commit, ships: v.ships,
        created: v.created, body: v.body === '-' ? fs.readFileSync(0, 'utf8') : v.body, writer: v.writer, session: v.session,
      };
      // a value naming a record takes the slug alone, as an argument does; a bare URL in --links is a url: source
      const typed = (v: string | undefined, field: string) => {
        const kind = v === undefined ? null : fieldKind(type, field);
        return kind ? typedRef(v!, kind) : v;
      };
      const typedAll = (vs: string[] | undefined, field: string) => vs?.map((x) => typed(x, field)!);
      Object.assign(flags, {
        parent: typed(flags.parent, 'parent'), project: typed(flags.project, 'project'), feature: typed(flags.feature, 'feature'),
        dependsOn: typedAll(flags.dependsOn, 'depends_on'), ships: typedAll(flags.ships, 'ships'), links: typedAll(flags.links, 'links'), binds: typedAll(flags.binds, 'binds'),
      });
      const r = newRecord(store, type, ident, flags);
      // a change the session creates is the session's work: it binds (decision hydration/binding-follows-writes). Only
      // here, where a person or an agent files it; a sync or a batch that creates changes binds nothing
      const session = envelope({ session: v.session }).session;
      if (r.type === 'change' && session) {
        try {
          if (sessionBind(store, session, r.key, 'created').added) r.notes.push(`bound ${session} (created)`);
        } catch {
          // no such session record: nothing to bind
        }
      }
      if (v.json) json(r);
      else {
        out(`created ${r.key} at ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
        if (r.type === 'change') out(`branch: ${branchNameFor(r.key, readUserConfig().branch_prefix)} (recommended; worktree ${worktreeNameFor(r.key)})`);
        for (const n of r.notes) out(`note: ${n}`);
      }
      return 0;
    }
    case 'decision': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman decision <change>/<slug> --name … --gist … --question … --option <id>=<text>… [--recommend <id>[=<why>]] | pjman decision <key> <entries…> | --from -');
      const writer = envelope({ writer: v.writer }).writer;
      let name = v.name;
      let gist = v.gist;
      let entries = entriesFromFlags({ question: v.question, criterion: v.criterion, option: v.option, case: v.case, recommend: v.recommend, comment: v.comment, on: v.on, reject: v.reject, accept: v.accept, revisit: v.revisit, reopen: v.reopen, by: v.by }, writer);
      if (v.from !== undefined) {
        if (v.from !== '-') throw new CliError('--from takes - (the entries as JSON on stdin)');
        const j = entriesFromJson(fs.readFileSync(0, 'utf8'), writer);
        name ??= j.name;
        gist ??= j.gist;
        entries = [...entries, ...j.entries];
      }
      // the slug alone names an existing decision, as it names any record; a new one is keyed <change>/<slug>
      const ref = pos[1].includes('/') || pos[1].includes(':') ? pos[1] : decisionBySlug(loadStore(store), pos[1]);
      const r = decision(store, ref, { name, gist, entries, supersedes: v.supersedes, links: v.links, created: v.created, session: v.session, writer: v.writer });
      if (v.json) json(r);
      else {
        out(`${r.created ? 'created' : 'wrote'} ${r.key}${r.appended.length ? ` (${r.appended.join(', ')})` : ''}: ${r.status}${r.state.recommendation ? `, recommended ${r.state.recommendation.option}` : ''}${r.state.accepted ? `, accepted ${r.state.accepted.option}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
        for (const n of r.notes) out(`note: ${n}`);
      }
      return 0;
    }
    case 'step': {
      const store = scoped(requireStore(cwd, v.store));
      const [, ref, verb, ...rest] = pos;
      if (!ref || !verb) throw usageError('usage: pjman step <change> add "<text>"... | start|done|drop|reopen <n>... [--note "…"] | note <n> "<text>" | edit <n> "<text>" | move <n> --before <m>|--after <m>|--first|--last');
      const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
      const n = verb === 'add' ? undefined : num(rest[0]);
      let texts: string[] | undefined;
      if (verb === 'add') {
        if (v.from !== undefined) {
          if (v.from !== '-') throw usageError('--from takes - (the steps one per line on stdin)');
          if (rest.length) throw usageError('step add takes its texts as arguments or --from -, not both');
          texts = fs.readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
        } else {
          // several texts are several steps: a one-word text among several is words left unquoted, refused before it files them apart
          if (rest.length > 1 && rest.some((t) => !/\s/.test(t.trim()))) throw usageError(`step add got ${rest.length} texts, some of one word ('${rest.find((t) => !/\s/.test(t.trim()))}'): each quoted text is a step; quote a step's words together`);
          texts = rest;
        }
      }
      const text = verb === 'note' || verb === 'edit' ? rest.slice(1).join(' ') : undefined;
      const more = ['start', 'done', 'drop', 'reopen'].includes(verb) ? rest.slice(1).map((x) => Number(x)) : undefined;
      const r = step(store, ref, verb, n, { texts, text, more, note: v.note, before: num(v.before), after: num(v.after), first: v.first, last: v.last, session: v.session, writer: v.writer });
      if (v.json) json(r);
      else out(`${r.key} step ${r.numbers.join(',')} ${r.verb}${r.progress ? ` · ${r.progress.done}/${r.progress.total} done` : ''}${r.next ? ` · next: ${r.next.n}. ${r.next.step.text}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}\n${formatPlan(r.steps)}`);
      return 0;
    }
    case 'session': {
      const store = scoped(requireStore(cwd, v.store));
      const [, sub, id, ...rest] = pos;
      if (sub === 'start') {
        if (!id) throw usageError('usage: pjman session start <id> --agent <agent> --on-behalf-of <person> [--parent session:<id>] [--log <line>] [--branch <name>] [--full] [--json]');
        const r = sessionStart(store, id, { agent: v.agent, onBehalfOf: v['on-behalf-of'], parent: v.parent, log: v.log, branch: v.branch, full: !!v.full, writer: v.writer, session: v.session });
        // the brief's text is what the agent reads, named as the context names records; the rest keeps full keys
        if (v.json) json({ ...r, brief: r.brief ? { ...r.brief, text: shortenText(r.brief.text, scopeProduct) } : null });
        else out(`${r.created ? 'created' : 'started'} ${r.key}${r.bound ? `, bound ${r.bound} (branch)` : ''}${r.brief ? `; ${formatBriefSize(r.brief)}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'log') {
        if (!id || !rest.length) throw usageError('usage: pjman session log <id> <text>');
        const r = sessionLog(store, id, rest.join(' '));
        out(`logged to ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'bind') {
        if (!id || !rest[0]) throw usageError('usage: pjman session bind <id> <change> [--reason prompt|created|branch]');
        const reasons = ['prompt', 'created', 'branch', 'by hand'] as const;
        const reason = (v.reason ?? 'by hand') as BindReason;
        if (!reasons.includes(reason)) throw new CliError(`--reason takes ${reasons.join(', ')}`);
        const r = sessionBind(store, id, rest[0], reason);
        out(r.added ? `bound in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}` : `already bound in ${r.path}`);
      } else if (sub === 'unbind') {
        if (!id || !rest[0]) throw usageError('usage: pjman session unbind <id> <change>');
        const r = sessionUnbind(store, id, rest[0]);
        out(`unbound in ${r.path}${r.dropped ? `; ${r.dropped} observed edge${r.dropped === 1 ? '' : 's'} dropped` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'observe') {
        if (!id || rest.length < 3) throw usageError('usage: pjman session observe <id> <edge> <from> <to>');
        const r = sessionObserve(store, id, rest[0], rest[1], rest[2]);
        out(`observed in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'focus') {
        if (!id || !rest[0]) throw usageError('usage: pjman session focus <id> <change>');
        const r = sessionFocus(store, id, rest[0]);
        out(r.moved ? `focus moved in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}` : `focus already there in ${r.path}`);
      } else if (sub === 'project') {
        if (!id || !rest[0]) throw usageError('usage: pjman session project <id> <project>');
        const r = sessionProject(store, id, rest[0]);
        out(r.moved ? `resolved ${r.path} to ${r.project}${r.commit ? ` (committed ${r.commit})` : ''}` : `${r.path} is already ${r.project}'s`);
      } else throw usageError('usage: pjman session start|log|bind|unbind|observe|focus|project <id> … (pjman help session)');
      return 0;
    }
    case 'note': {
      const store = scoped(requireStore(cwd, v.store));
      const [, ref, ...rest] = pos;
      if (!ref || !rest.length) throw usageError('usage: pjman note <change|session:<id>> <text>');
      const r = note(store, ref.startsWith('session:') ? ref : resolveArg(loadStore(store), ref, { cwd, projectDir: store.projectDir, project: store.project }), rest.join(' '), { writer: v.writer, session: v.session });
      out(`noted on ${r.key}${r.commit ? ` (committed ${r.commit}; pjman undo ${r.commit} takes it back)` : ''}`);
      return 0;
    }
    case 'wakes': {
      if (!v.session) throw usageError('usage: pjman wakes --session <id> [--since <seq>] [--follow] [--json]');
      const store = scoped(requireStore(cwd, v.store));
      const tail = lastSeq(store);
      const print = (w: Wake) => out(v.json ? JSON.stringify(w) : `#${w.seq} ${w.why}`);
      if (!v.follow) {
        const stop = followWakes(store, v.session, v.since !== undefined ? Number(v.since) : 0, print);
        stop();
        return 0;
      }
      followWakes(store, v.session, v.since !== undefined ? Number(v.since) : tail, print);
      // a follower outlives nothing: once the process that started it is gone, it goes too
      const parent = process.ppid;
      setInterval(() => {
        if (process.ppid !== parent) process.exit(0);
      }, 5000);
      return 0;
    }
    case 'validate': {
      const store = scoped(requireStore(cwd, v.store));
      const loaded = loadStore(store);
      const problems = validate(loaded);
      const s = summarise(problems);
      if (v.json) json({ store: store.root, mode: store.mode, records: loaded.records.length, ...s, problems });
      else {
        if (problems.length) out(formatProblems(problems));
        out(`${plural(loaded.records.length, 'record')}: ${plural(s.errors, 'error')}, ${plural(s.warnings, 'warning')}, ${plural(s.infos, 'note')}`);
      }
      return s.errors ? 1 : 0;
    }
    case 'fmt': {
      const store = scoped(requireStore(cwd, v.store));
      const r = fmt(store, { check: v.check, session: v.session });
      if (v.json) json(r);
      else {
        for (const p of r.changed) out(`${v.check ? 'would format' : 'formatted'} ${p}`);
        for (const s of r.skipped) out(`skipped ${s.path}: ${s.reason}`);
        out(`${plural(r.changed.length, 'file')} ${v.check ? 'differ' : 'formatted'}${r.commit ? ` (committed ${r.commit})` : ''}`);
      }
      return v.check && r.changed.length ? 1 : 0;
    }
    case 'ls': {
      const store = scoped(requireStore(cwd, v.store));
      const loaded = loadStore(store);
      const at = (raw: string | undefined, kinds: string[]) => (raw === undefined ? undefined : resolveArg(loaded, raw, { kinds }));
      const rows = ls(store, { type: pos[1], status: v.status, kind: v.kind, project: at(v.project, ['project']), product: at(v.product, ['product']), parent: at(v.parent, ['change', 'feature', 'product']), feature: at(v.feature, ['feature']) });
      v.json ? json(rows) : out(formatLs(rows));
      return 0;
    }
    case 'tree': {
      const store = scoped(requireStore(cwd, v.store));
      const loaded = loadStore(store);
      const root = pos[1] ? resolveArg(loaded, pos[1], { kinds: ['product', 'feature'] }) : undefined;
      const nodes = tree(loaded, root);
      if (root && !nodes.length) throw notFound(pos[1], { as: 'product or feature' });
      if (v.json) json(nodes);
      else out(nodes.length ? formatTree(nodes) : 'no products yet: pjman new product <slug> --title <t>');
      return 0;
    }
    case 'activity': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman activity <key> [--days 14]');
      const loaded = loadStore(store);
      const key = resolveArg(loaded, pos[1], { cwd, projectDir: store.projectDir, project: store.project });
      const res = resolve(loaded, key);
      if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, pos[1]);
      const a = activity(store, loaded, res.rec.key, { days: v.days ? Number(v.days) : undefined, since: v.since });
      v.json ? json(a) : out(formatActivity(a, formatEvent));
      return 0;
    }
    case 'context': {
      const store = scoped(requireStore(cwd, v.store));
      if (pos[1] && (pos[1].startsWith('product:') || pos[1].startsWith('feature:'))) {
        const loaded = loadStore(store);
        const nodes = tree(loaded, pos[1]);
        if (!nodes.length) throw notFound(pos[1], { as: 'product or feature' });
        const a = activity(store, loaded, nodes[0].key, {});
        v.json ? json({ tree: nodes[0], activity: a }) : out(formatTree(nodes) + '\n' + formatActivity(a, formatEvent));
        return 0;
      }
      if (pos[1] && !pos[1].startsWith('project:')) {
        const c = changeContext(store, pos[1]);
        v.json ? json(c) : out(formatChangeContext(c));
        // the session reading it is looking at it: its focus moves there (never its binding). A read never fails for it
        const session = process.env.PJMAN_SESSION;
        if (session) {
          try {
            sessionFocus(store, session, c.change.key);
          } catch {
            // no such session record, or a store that would not take the write: the read stands
          }
        }
      } else {
        const c = storeContext(store, { project: v.all ? null : (pos[1] ?? v.project ?? store.project ?? null) });
        v.json ? json(c) : out(formatStoreContext(c));
      }
      return 0;
    }
    case 'get': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman get <ref>');
      const n = get(loadStore(store), pos[1], { cwd, projectDir: store.projectDir, project: store.project });
      if (n.resolution.status === 'none') throw notFound(pos[1], { tried: n.resolution.tried });
      v.json ? json(n) : out(formatNeighbourhood(n, formatChangeContext));
      return 0;
    }
    case 'intake': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman intake <text> | pjman intake - (text on stdin)');
      const text = pos[1] === '-' ? fs.readFileSync(0, 'utf8') : pos.slice(1).join(' ');
      const i = intake(store, loadStore(store), text.trim(), { cwd, projectDir: store.projectDir, project: store.project });
      v.json ? json(i) : out(formatIntake(i));
      return 0;
    }
    case 'refs': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman refs <text> | pjman refs - (text on stdin)');
      const text = pos[1] === '-' ? fs.readFileSync(0, 'utf8') : pos.slice(1).join(' ');
      const refs = findReferences(loadStore(store), text, { cwd, projectDir: store.projectDir, project: store.project });
      v.json ? json(refs) : out(formatReferences(refs));
      return 0;
    }
    case 'view': {
      const store = scoped(requireStore(cwd, v.store));
      const opts = { ref: pos[1], cwd, projectDir: store.projectDir, project: store.project };
      const render = () => {
        const view = renderView(store, opts);
        view.markdown = shortenText(view.markdown, scopeProduct); // read by a person inside the project
        if (v.out) {
          const tmp = `${v.out}.tmp`;
          fs.writeFileSync(tmp, view.markdown);
          fs.renameSync(tmp, v.out);
        } else if (v.watch) {
          process.stdout.write(`\x1b[2J\x1b[H${view.markdown}`);
        } else {
          v.json ? json(view) : out(view.markdown);
        }
      };
      render();
      if (v.watch) {
        watchStore(store, () => {
          try {
            render();
          } catch (e) {
            process.stderr.write(`pjman: ${(e as Error).message}\n`);
          }
        });
        // the watchers keep the process alive until it is interrupted
      }
      return 0;
    }
    case 'show': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman show <key>');
      const r = show(store, resolveArg(loadStore(store), pos[1], { cwd, projectDir: store.projectDir, project: store.project }));
      v.json ? json({ ...row(r.rec), body: r.rec.body }) : out(`# ${r.rec.path}\n${r.text}`);
      return 0;
    }
    case 'set': {
      const store = scoped(requireStore(cwd, v.store));
      // the refs come first, then the pairs: a pair is the first argument with = in it (a key never has one)
      const at = pos.findIndex((p, i) => i > 0 && /^[a-z_][a-z0-9_.-]*[+-]?=/.test(p));
      const refs = at < 0 ? pos.slice(1) : pos.slice(1, at);
      const pairs = at < 0 ? [] : pos.slice(at);
      if (!refs.length || !pairs.length) throw usageError('usage: pjman set <ref>... <field>=<value> | <field>+=<item> | <field>-=<item> ...');
      const stray = pairs.find((p) => !/^[a-z_][a-z0-9_.-]*[+-]?=/.test(p));
      if (stray) throw usageError(`'${stray}' is not field=value; the records come first, then the fields (quote a value with spaces: gist="a longer line")`);
      // one value may come from stdin, `field=-`: a multi-line text, such as an aspect's base or a place's fork
      if (pairs.filter((p) => p.endsWith('=-')).length > 1) throw usageError('only one field=- reads stdin');
      if (refs.length > 1 && pairs.some((p) => p.endsWith('=-'))) throw usageError('field=- sets one record; name one');
      const stdinPairs = pairs.map((p) => (p.endsWith('=-') && !p.endsWith('+=-') && !p.endsWith('-=-') ? `${p.slice(0, -1)}${fs.readFileSync(0, 'utf8')}` : p));
      const loaded = loadStore(store);
      const keys = refs.map((r) => resolveArg(loaded, r, { cwd, projectDir: store.projectDir, project: store.project }));
      if (keys.length === 1) {
        const r = set(store, keys[0], stdinPairs, { session: v.session });
        v.json ? json(r) : out(`${r.changed.length ? `set ${r.changed.join(", ")} on` : "nothing to change on"} ${r.key}${r.commit ? ` (committed ${r.commit})` : ''}${r.notes.map((n) => `\nnote: ${n}`).join('')}`);
        return 0;
      }
      // several records: one batch, one commit, one undo (decision interface-audit/bulk-writes)
      const results: ReturnType<typeof set>[] = [];
      const b = batch(store, v, keys.map((k) => ['set', k, ...stdinPairs]), (line) => results.push(set(store, line[1], line.slice(2), { session: v.session })));
      v.json ? json({ results, commit: b.commit }) : out(`${results.map((r) => `set ${r.changed.join(', ')} on ${r.key}${r.notes.map((n) => `\nnote: ${n}`).join('')}`).join('\n')}\n${plural(results.length, 'record')} as one commit${b.commit ? ` (committed ${b.commit}; pjman undo reverts it)` : ''}`);
      return 0;
    }
    case 'order': {
      const store = scoped(requireStore(cwd, v.store));
      const moves = [v.before, v.after, v.first, v.last, v.later].filter((x) => x !== undefined && x !== false).length;
      if (!moves) {
        const loaded = loadStore(store);
        const o = sequenceOf(loaded, pos[1] ? resolveArg(loaded, pos[1], { kinds: ['product', 'change', 'feature'] }) : null);
        v.json ? json(o) : out(o.sequence.length ? `${o.product} order:\n${o.sequence.map((k, i) => `${String(i + 1).padStart(3)}. ${k}`).join('\n')}\nthen later: ${plural(o.later, 'open change')}` : `${o.product} has no order yet: pjman order <change> --first`);
        return 0;
      }
      if (!pos[1]) throw usageError('usage: pjman order <change> --before <change> | --after <change> | --first | --last | --later');
      const r = order(store, pos[1], { before: v.before, after: v.after, first: v.first, last: v.last, later: v.later, session: v.session, writer: v.writer });
      v.json ? json(r) : out(`${r.product} sequence: ${r.sequence.length ? r.sequence.join(' → ') : '(empty)'}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'mv': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1] || !pos[2]) throw usageError('usage: pjman mv <key> <new key>  (change, project or decision)');
      const r = mv(store, resolveArg(loadStore(store), pos[1], { cwd, projectDir: store.projectDir, project: store.project }), pos[2], { session: v.session });
      if (v.json) json(r);
      else {
        out(`moved ${r.from} → ${r.to}; rewrote ${plural(r.rewritten.length, 'file')}${r.commit ? ` (committed ${r.commit})` : ''}`);
      }
      return 0;
    }
    case 'apply': {
      const store = scoped(requireStore(cwd, v.store));
      const src = pos[1] ?? '-';
      const text = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
      const r = apply(store, text, (line) => {
        const code = main([...line, ...(v.store ? ['--store', v.store] : []), ...(v.session ? ['--session', v.session] : []), ...(v.writer ? ['--writer', v.writer] : [])]);
        if (code !== 0) throw new CliError(`exit ${code}`);
      }, { for: v.for, session: v.session, writer: v.writer });
      if (v.json) json(r);
      else out(r.writes ? `applied ${plural(r.writes, 'write')} from ${plural(r.lines, 'line')} as one commit${r.for ? ` for ${r.for}` : ''}${r.commit ? ` (committed ${r.commit}; pjman undo reverts it)` : ''}` : `nothing to write in ${plural(r.lines, 'line')}`);
      return 0;
    }
    case 'rest': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman rest <change> [--json]');
      const r = restOf(loadStore(store), pos[1]);
      v.json ? json(r) : out(formatRest(r));
      return r.rests ? 0 : 1;
    }
    case 'lift': {
      const store = scoped(requireStore(cwd, v.store));
      const lifts = liftsOfStore(loadStore(store));
      if (v.check || !lifts.length) {
        if (v.json) json({ lifts, commit: null });
        else out(lifts.length ? lifts.map((l) => `${l.key}: ${l.from} → ${l.to}`).join('\n') : 'nothing to lift: every change stands at or past what its plan says');
        return v.check && lifts.length ? 1 : 0;
      }
      const text = lifts.map((l) => `set ${l.key} status=${l.to}`).join('\n');
      const r = apply(store, text, (line) => {
        const code = main([...line, ...(v.store ? ['--store', v.store] : []), ...(v.session ? ['--session', v.session] : []), ...(v.writer ? ['--writer', v.writer] : [])]);
        if (code !== 0) throw new CliError(`exit ${code}`);
      }, { session: v.session, writer: v.writer });
      if (v.json) json({ lifts, commit: r.commit });
      else out(`${lifts.map((l) => `${l.key}: ${l.from} → ${l.to}`).join('\n')}\nlifted ${plural(lifts.length, 'change')} as one commit${r.commit ? ` (committed ${r.commit}; pjman undo reverts it)` : ''}`);
      return 0;
    }
    case 'migrate': {
      const store = scoped(requireStore(cwd, v.store));
      const r = migrate(store, { session: v.session, writer: v.writer });
      if (v.json) json(r);
      else {
        const undo = r.commit ? ` (committed ${r.commit}; pjman undo ${r.commit} reverts it)` : '';
        if (r.kind === 'stamp') out(`stamped: the store is in format ${r.version}${undo}`);
        else if (r.kind === 'foundation') out(`migrated: ${plural(r.changes ?? 0, 'change')} and ${plural(r.decisions ?? 0, 'decision')} mapped into the foundation (introduced in ${r.since}), each marked migrated until it is next written${undo}`);
        else out(`migrated: ${plural(r.products, 'product')}, ${plural(r.moved, 'record folder')} moved beneath them, ${plural(r.rewritten, 'file')} rewritten with keys under the product (introduced in ${r.since})${undo}`);
        const next = pendingMigration(store);
        if (next) out(`the store still waits for ${describeMigration(next)}: run pjman migrate again`);
      }
      return 0;
    }
    case 'undo': {
      const store = scoped(requireStore(cwd, v.store));
      const r = undo(store, { commit: pos[1], session: v.session, writer: v.writer });
      if (v.json) json(r);
      else out(`reverted ${r.reverted} (${r.subject}): ${plural(r.files, 'file')} as they were before it${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'rm': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman rm <ref>... [--detach]');
      const loaded = loadStore(store);
      const keys = pos.slice(1).map((r) => resolveArg(loaded, r, { cwd, projectDir: store.projectDir, project: store.project }));
      const said = (r: ReturnType<typeof rm>) => `removed ${r.key} (${plural(r.removed.length, 'file')})${r.detached.length ? `; detached from ${r.detached.map((d) => `${d.key} ${d.fields.join(',')}`).join(', ')}` : ''}`;
      if (keys.length === 1) {
        const r = rm(store, keys[0], { detach: v.detach, session: v.session, writer: v.writer });
        v.json ? json(r) : out(`${said(r)}${r.commit ? ` (committed ${r.commit})` : ''}`);
        return 0;
      }
      const results: ReturnType<typeof rm>[] = [];
      const b = batch(store, v, keys.map((k) => ['rm', k]), (line) => results.push(rm(store, line[1], { detach: v.detach, session: v.session, writer: v.writer })));
      v.json ? json({ results, commit: b.commit }) : out(`${results.map(said).join('\n')}\n${plural(results.length, 'record')} as one commit${b.commit ? ` (committed ${b.commit}; pjman undo reverts it)` : ''}`);
      return 0;
    }
    case 'events': {
      const store = scoped(requireStore(cwd, v.store));
      if (pos[1] === 'rebuild') {
        const r = rebuildEvents(store);
        out(`rebuilt ${plural(r.events, 'event')} from ${plural(r.commits, 'commit')}`);
        return 0;
      }
      if (pos[1]) throw usageError('usage: pjman events [--since <seq>] [--session <key>] [--receipt] | pjman events rebuild');
      if (v.receipt) {
        const r = receipt(store, { since: v.since ? Number(v.since) : 0, session: v.session });
        v.json ? json(r) : out(formatReceipt(r) || '(nothing recorded)');
        return 0;
      }
      const events = readEvents(store, v.since ? Number(v.since) : 0).filter((e) => !v.session || e.session === v.session);
      v.json ? json(events) : out(events.length ? events.map(formatEvent).join('\n') : '(no events)');
      return 0;
    }
    case 'follow': {
      const store = scoped(requireStore(cwd, v.store));
      const since = v.since !== undefined ? Number(v.since) : lastSeq(store);
      follow(store, since, (e) => out(v.json ? JSON.stringify(e) : formatEvent(e)));
      return 0; // the watcher keeps the process alive until it is interrupted
    }
    case 'start': {
      const s = start({ cwd, port: v.port ? Number(v.port) : undefined, log: out });
      out(`dashboard: ${s.address.url}${s.started ? '' : ' (already running)'}${s.ui ? '' : ' (API only: no built app)'}`);
      if (v.open) openPage(s.address.url);
      return 0;
    }
    case 'open': {
      const session = v.session || process.env.PJMAN_SESSION || undefined;
      if (session) {
        // a session the store does not hold would open an empty page: say so instead
        const store = scoped(requireStore(cwd, v.store));
        const key = session.startsWith('session:') ? session : `session:${session}`;
        const res = resolve(loadStore(store), key);
        if (res.status !== 'ok' || res.rec.type !== 'session') throw notFound(key, { as: 'session' });
      }
      const s = start({ cwd, log: out });
      const url = openUrl(s.address, session);
      const where = openPage(url);
      out(`${where === 'docked' ? 'docked' : 'opened'} ${url}${s.started ? ' (dashboard started)' : ''}`);
      return 0;
    }
    case 'stop': {
      const a = stop();
      out(a ? `stopped the dashboard at ${a.url} (pid ${a.pid})` : 'no dashboard was running');
      return 0;
    }
    case 'brief': {
      if (!v.session) {
        out(BRIEF);
        return 0;
      }
      const store = scoped(requireStore(cwd, v.store));
      const b = brief(store, v.session, { full: !!v.full });
      // the text is what the agent reads, so it names records as the context does inside the product; the rest of the
      // JSON keeps full keys
      if (v.json) json({ ...b, text: shortenText(b.text, scopeProduct) });
      else if (b.mode === 'none') out('(nothing new for this session)');
      else out(`${b.text}
(${formatBriefSize(b)})`);
      return 0;
    }
    case 'serve': {
      const store = findStore(cwd, v.store) ?? globalStore();
      if (!store) throw new CliError('no store: run `pjman init` in a repository first');
      const register = v.register ? true : v['no-register'] ? false : installedTool();
      const running = readServeAddress();
      if (register && running && !v.port) throw new CliError(`a server is already running at ${running.url} (pid ${running.pid}); pass --port to start another`);
      // the dashboard writes as the person, never as the session whose shell happened to start it: a write credited to
      // that session would not wake it, and its receipt would claim the person's act
      delete process.env.PJMAN_SESSION;
      delete process.env.PJMAN_WRITER;
      startServer(store, { port: v.port ? Number(v.port) : undefined, host: v.host, staticDir: v.static, register })
        .then(({ address, registered }) => out(`pjman serve: ${address.url} (store ${store.root}; api ${address.url}/api/v1; ctrl-c to stop)${registered ? '' : `\n  not registered: this is a checkout, so the machine's dashboard (${running?.url ?? 'none running'}) is left as it is; --register claims it`}`))
        .catch((e: Error) => {
          process.stderr.write(`pjman: ${e.message}\n`);
          process.exit(1);
        });
      return 0;
    }
    case 'sync': {
      if (pos[1] !== 'linear' && pos[1] !== 'github') throw usageError('usage: pjman sync linear|github --from <file|-> [--project <key>]');
      const store = scoped(requireStore(cwd, v.store));
      const r = pos[1] === 'linear'
        ? syncLinear(store, { project: v.project, team: v.team, from: v.from, session: v.session })
        : syncGithub(store, { project: v.project, repo: v.repo, from: v.from, session: v.session });
      if (v.json) json(r);
      else out(`${pos[1]} ${r.team} → ${r.project}: ${plural(r.issues, 'issue')}; ${plural(r.created.length, 'change')} created, ${r.updated.length} updated, ${r.unchanged.length} unchanged${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'index': {
      const store = scoped(requireStore(cwd, v.store));
      const r = buildIndex(store);
      if (v.json) json(r);
      else {
        const recs = Object.entries(r.records).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ');
        out(`indexed ${recs || 'no records'}${r.sources_as_keys ? `, ${r.sources_as_keys} source${r.sources_as_keys === 1 ? '' : 's'} as keys only` : ''}; ${plural(r.edges, 'edge')} → ${r.path}`);
        for (const c of r.conflicts) out(`conflict ${c.kind} ${c.key}: ${c.message} (${c.paths.join(', ')})`);
        if (r.problems.errors) out(`${plural(r.problems.errors, 'validation error')}; run \`pjman validate\``);
      }
      return r.conflicts.length ? 1 : 0;
    }
    case 'query': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw usageError('usage: pjman query "<sql>"');
      json(query(store, pos[1]));
      return 0;
    }
    case 'where': {
      const store = findStore(cwd, v.store);
      if (!store) throw new CliError('no store found');
      scoped(store);
      v.json
        ? json({ root: store.root, mode: store.mode, name: store.config.name, project: store.project ?? null, product: scopeProduct ? `product:${scopeProduct}` : null, project_dir: store.projectDir ?? null, tracker: trackerOf(store), actor: readUserConfig().actor ?? null, source_kinds: store.config.source_kinds })
        : out(`${store.root} (${store.mode})${store.project ? ` ${store.project}` : ''}`);
      return 0;
    }
    case 'whoami': {
      const store = globalStore() ?? requireStore(cwd, v.store);
      const id = identity(store, { verify: v.verify, fresh: v.fresh });
      if (v.json) json(id);
      else for (const line of formatIdentity(id)) out(line);
      return 0;
    }
    default:
      throw new CliError(`unknown command '${cmd}'; run pjman --help`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof CliError) {
    // one contract (decision interface-audit/error-contract): the message on stderr, or under --json the API's error
    // shape on stdout, where a program reading the answer looks
    const argv = process.argv.slice(2);
    if (argv.includes('--json')) json({ error: { code: e.code, message: e.message, ...(e.tried ? { tried: e.tried } : {}) } });
    else process.stderr.write(`pjman: ${e.message}\n`);
    process.exitCode = e.exitCode;
  } else {
    throw e;
  }
}
