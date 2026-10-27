import './quiet.js';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { findStore, globalStore, readUserConfig, requireStore } from './config.js';
import { BRIEF } from './commands/brief.js';
import { start, stop } from './commands/start.js';
import { buildIndex, query } from './indexdb.js';
import { loadStore, resolve } from './records.js';
import { CliError, plural } from './util.js';
import { formatProblems, summarise, validate } from './validate.js';
import { findReferences, formatNeighbourhood, formatReferences, get } from './graph.js';
import { renderView, watchStore } from './commands/pane.js';
import { follow, formatEvent, readEvents, rebuildEvents } from './events.js';
import { readServeAddress, startServer } from './server.js';
import { syncLinear } from './sync/linear.js';
import { syncGithub } from './sync/github.js';
import { init } from './commands/init.js';
import { newRecord, type NewFlags } from './commands/new.js';
import { sessionBind, sessionLog, sessionObserve } from './commands/session.js';
import { fmt } from './commands/fmt.js';
import { mv } from './commands/mv.js';
import { rm } from './commands/rm.js';
import { formatTree, tree } from './tree.js';
import { formatReceipt, receipt } from './receipt.js';
import { activity, formatActivity } from './activity.js';
import { set } from './commands/set.js';
import { changeContext, formatChangeContext, formatLs, formatStoreContext, ls, show, storeContext } from './commands/view.js';

import { createRequire } from 'node:module';

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/** One entry per command: the usage lines and a one-line purpose. `pjman <cmd> --help` prints one; `pjman --help` prints all. */
const COMMANDS: { name: string; usage: string[]; about: string }[] = [
  { name: 'init', about: 'the whole onboarding: join the global store (~/.pjman/store, its own git repository), register this repository as a project, set the actor, install the harness adapter found on the machine, start the dashboard, report; --in-project makes a store inside the repository instead (set aside; kept for a repository that must carry its own record)',
    usage: ['pjman init [--name <project-name>] [--brief claude-md] [--no-adapter] [--no-start] [--in-project]'] },
  { name: 'start', about: 'the dashboard: install and build the app if the checkout has none, start the server detached if none is running, print its URL', usage: ['pjman start [--port <n>] [--open]'] },
  { name: 'stop', about: 'stop the dashboard server', usage: ['pjman stop'] },
  { name: 'brief', about: 'print the brief: what an agent needs in front of it every session (the adapter injects it; pjman init --brief claude-md writes it to ~/.claude/CLAUDE.md)', usage: ['pjman brief'] },
  { name: 'new', about: 'create a record; refused if it would not validate',
    usage: [
      'pjman new product <slug> --title <t> [--owners <actor>]... [--levels <label>]... [--sequence <change>]... [--summary <s>]',
      'pjman new feature <slug> --title <t> [--name <one to three words>] --product <product> | --parent <feature> [--status planned|building|live|retired] [--level <label>] [--owners <actor>]... [--summary <s>]',
      'pjman new project <slug> --title <t> [--product <product>] [--parent <project>] [--tracker <source-kind>] [--owners <actor>]... [--links <key>]...',
      'pjman new change <slug> --title <t> [--status open] [--project <key>] [--parent <change>] [--features "adds feature:<slug>"]... [--depends-on <change>]... [--owners <actor>]... [--summary <s>] [--plan <p>] [--next <n>] [--binds <key>]... [--links <key>]...',
      '                                [--kind bug --severity product|feature|capability|nuisance|cosmetic] [--target <date>]   (a bug against a live node; a milestone\'s date)',
      'pjman new decision <change>/<slug> | /<slug> --title <t> [--decided-by <person>] [--decided-on <date>] [--supersedes <decision>]',
      '                                             [--decision <text>] [--why <text>] [--links <key>]...   (status: proposed unless decided)',
      'pjman new source <kind>:<key> [--title <t>] [--url <u>] [--links <key>]...',
      'pjman new actor person:<handle> | agent:<handle> [--name <n>] [--url <u>]',
      'pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>] [--started <ts>]',
    ] },
  { name: 'set', about: 'change authored fields on a record (a list is comma-separated; an empty value removes the field; summary and plan set the body section)',
    usage: ['pjman set <key> <field>=<value>...'] },
  { name: 'session', about: 'append to a session record: a log line, a change it worked on, an observed edge',
    usage: ['pjman session log <id> <text>', 'pjman session bind <id> <change>', 'pjman session observe <id> <edge> <from> <to>'] },
  { name: 'context', about: "what an agent reads first: this project's open changes (--all: every project; project:<slug>: that project), or one change with its decisions, sources and sessions",
    usage: ['pjman context [<change> | project:<slug>] [--all] [--json]'] },
  { name: 'ls', about: 'list records, by type, status, project and kind; bugs come worst first, then oldest', usage: ['pjman ls [project|change|decision|source|session|actor] [--status <s>] [--project <key>] [--kind bug|work] [--json]'] },
  { name: 'refs', about: "every reference in a text that resolves to something, in order, each with the change it leads to: change:<slug>, a URL, a ticket in any shape the store's source kinds know, an existing slug; the last mention is what a prompt is about. Never writes",
    usage: ['pjman refs <text> [--json]', 'pjman refs - [--json]   (text on stdin)'] },
  { name: 'tree', about: "the product tree: products, their features at every level (label from the template or the node), each with its authored and derived status, effective owners and the changes beneath it by status and project; a product also counts the open changes under its projects that name no feature",
    usage: ['pjman tree [product:<slug>|feature:<slug>] [--json]'] },
  { name: 'activity', about: "the activity of a subtree: every event beneath a key (a product, feature, project or change, through every chain) in a window, with what it says about health: when it last moved, what got done, what is new, what is blocked, what waits on a person",
    usage: ['pjman activity <key> [--days 14] [--since <iso>] [--json]'] },
  { name: 'get', about: 'the getter: a key, a source key, a URL, a ticket id, a file path or a slug in; the record, every edge into and out of it, and the full context of every change within two hops out (exit 1 when nothing matches)',
    usage: ['pjman get <ref> [--json]'] },
  { name: 'view', about: "the view beside a session, as a Markdown document: one reference, or what a session is on (its last bound change, else the project's board); --out writes a file, --watch re-renders whenever the store changes",
    usage: ['pjman view [<ref>] [--session <id>] [--out <file>] [--watch]'] },
  { name: 'show', about: 'print one record by key', usage: ['pjman show <key> [--json]'] },
  { name: 'validate', about: 'check every record and every reference; errors are reported, never dropped (exit 1 on errors)',
    usage: ['pjman validate [--json]'] },
  { name: 'fmt', about: 'rewrite records in canonical form: field order, the YAML rule, repaired quoting (--check reports only)',
    usage: ['pjman fmt [--check]'] },
  { name: 'mv', about: 'rename a change (the folder moves, the old slug stays as an alias), a project (directories bound to it follow) or a decision (within or across changes); every reference is rewritten in the same commit',
    usage: ['pjman mv change:<old> change:<new>', 'pjman mv project:<old> project:<new>', 'pjman mv decision:<change>/<old> decision:<change>/<new>'] },
  { name: 'rm', about: "remove a record (a change takes its decisions with it). Refused while anything refers to it, naming each referrer; --detach drops the references that can be dropped (a key in a list, a parent, a superseded decision, an observed edge) in the same commit. A change's project, a writer or a session can never be dropped",
    usage: ['pjman rm <key> [--detach] [--json]'] },
  { name: 'events', about: "the store's event stream: one event per write (seq, at, op, key, type, path, fields, writer, session, commit); `rebuild` rewrites it from the store's git history",
    usage: ['pjman events [--since <seq>] [--session <key>] [--json]', 'pjman events --receipt [--since <seq>] [--session <key>] [--json]   what the store received, one line per record, for a person', 'pjman events rebuild'] },
  { name: 'follow', about: 'print events as they are appended, after --since (default: only new ones), until interrupted; what a view subscribes to',
    usage: ['pjman follow [--since <seq>] [--json]'] },
  { name: 'serve', about: "the store over HTTP: the library's results as JSON under /api/v1 (records by key, the getter as /resolve, a session's view, a project's board, the event stream as server-sent events) and the bundled app; writes its address to ~/.pjman/serve.json while it runs",
    usage: ['pjman serve [--port <n>] [--host <addr>] [--static <dir>]'] },
  { name: 'sync', about: "apply a tracker's tickets to the store, as observed by whoever holds the connection (the harness's MCP session): each ticket becomes a source and the change that binds it; title, status and parent follow the ticket; everything pjman adds is kept. --from takes the issues as JSON, in whatever shape the tracker's tools answered",
    usage: ['pjman sync linear --from <file|-> [--project <key>] [--team <KEY>] [--json]', 'pjman sync github --from <file|-> [--project <key>] [--repo <owner/name>] [--json]', 'pjman sync github            (no --from: prints the gh command that reads the issues)'] },
  { name: 'index', about: 'rebuild index.db: ids, reverse edges, conflicts (exit 1 on conflicts)', usage: ['pjman index [--json]'] },
  { name: 'query', about: 'run a read-only SQL query against the index', usage: ['pjman query "<sql>"'] },
  { name: 'where', about: 'print the store this directory resolves to and its mode', usage: ['pjman where [--json]'] },
];

const GLOBAL = `global flags: --store <path>  --writer <actor>  --session <session>  --created <date>  --json  --help  --version
environment:  PJMAN_STORE  PJMAN_WRITER  PJMAN_SESSION  PJMAN_HOME`;

function usage(name?: string): string {
  const cmds = name ? COMMANDS.filter((c) => c.name === name) : COMMANDS;
  if (cmds.length === 0) return usage();
  const body = cmds.map((c) => `${c.usage.map((u) => '  ' + u).join('\n')}\n      ${c.about}`).join('\n\n');
  const head = name ? '' : 'pjman — a context graph for product development\n\n';
  return `${head}usage:\n${body}\n\n${GLOBAL}\n`;
}

function parse() {
  try {
    return parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'V' },
    json: { type: 'boolean' },
    store: { type: 'string' },
    writer: { type: 'string' },
    session: { type: 'string' },
    created: { type: 'string' },
    'in-project': { type: 'boolean' },
    'no-start': { type: 'boolean' },
    'no-adapter': { type: 'boolean' },
    brief: { type: 'string' },
    open: { type: 'boolean' },
    all: { type: 'boolean' },
    project: { type: 'string' },
    tracker: { type: 'string' },
    name: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string' },
    summary: { type: 'string' },
    plan: { type: 'string' },
    next: { type: 'string' },
    binds: { type: 'string', multiple: true },
    links: { type: 'string', multiple: true },
    owners: { type: 'string', multiple: true },
    features: { type: 'string', multiple: true },
    'depends-on': { type: 'string', multiple: true },
    kind: { type: 'string' },
    severity: { type: 'string' },
    target: { type: 'string' },
    sequence: { type: 'string', multiple: true },
    levels: { type: 'string', multiple: true },
    level: { type: 'string' },
    product: { type: 'string' },
    days: { type: 'string' },
    'decided-by': { type: 'string' },
    'decided-on': { type: 'string' },
    supersedes: { type: 'string' },
    decision: { type: 'string' },
    why: { type: 'string' },
    url: { type: 'string' },
    agent: { type: 'string' },
    'on-behalf-of': { type: 'string' },
    parent: { type: 'string' },
    started: { type: 'string' },
    body: { type: 'string' },
    check: { type: 'boolean' },
    out: { type: 'string' },
    since: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    static: { type: 'string' },
    team: { type: 'string' },
    repo: { type: 'string' },
    from: { type: 'string' },
    watch: { type: 'boolean' },
    detach: { type: 'boolean' },
    receipt: { type: 'boolean' },
  },
    });
  } catch (e) {
    process.stderr.write(`pjman: ${(e as Error).message.split('\n')[0]}\n(a value that starts with a dash is passed as --flag=value)\n`);
    process.exit(2);
  }
}

const { values: v, positionals: pos } = parse();

const out = (s: string) => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
const json = (x: unknown) => out(JSON.stringify(x, null, 2));

/** The current project's tracker (its ticket source kind), or null. */
function trackerOf(store: ReturnType<typeof requireStore>): string | null {
  if (!store.project) return null;
  const rec = loadStore(store).byKey.get(store.project)?.[0];
  return rec && typeof rec.data.tracker === 'string' ? rec.data.tracker : null;
}

function main(): number {
  const cmd = pos[0];
  if (v.version) {
    out(`pjman ${VERSION}`);
    return 0;
  }
  if (v.help || cmd === 'help') {
    out(usage(cmd === 'help' ? pos[1] : cmd));
    return 0;
  }
  if (!cmd) {
    out(usage());
    return 1;
  }
  const cwd = process.cwd();
  switch (cmd) {
    case 'init': {
      if (v.brief && v.brief !== 'claude-md') throw new CliError('--brief takes claude-md');
      for (const line of init({ cwd, inProject: v['in-project'], name: v.name, adapter: !v['no-adapter'], start: !v['no-start'], brief: v.brief as 'claude-md' | undefined, port: v.port ? Number(v.port) : undefined })) out(line);
      return 0;
    }
    case 'new': {
      const store = requireStore(cwd, v.store);
      const [, type, ident] = pos;
      if (!type || !ident) throw new CliError('usage: pjman new <product|feature|project|change|decision|source|actor|session> <ident> [flags]');
      const flags: NewFlags = {
        title: v.title, status: v.status, project: v.project, tracker: v.tracker, summary: v.summary, plan: v.plan, next: v.next,
        binds: v.binds, links: v.links, decidedBy: v['decided-by'], decidedOn: v['decided-on'],
        supersedes: v.supersedes, decision: v.decision, why: v.why, name: v.name, url: v.url,
        agent: v.agent, onBehalfOf: v['on-behalf-of'], parent: v.parent, started: v.started,
        product: v.product, owners: v.owners, features: v.features, level: v.level, levels: v.levels,
        dependsOn: v['depends-on'], kind: v.kind, severity: v.severity, target: v.target, sequence: v.sequence,
        created: v.created, body: v.body, writer: v.writer, session: v.session,
      };
      const r = newRecord(store, type, ident, flags);
      if (v.json) json(r);
      else {
        out(`created ${r.key} at ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
        for (const n of r.notes) out(`note: ${n}`);
      }
      return 0;
    }
    case 'session': {
      const store = requireStore(cwd, v.store);
      const [, sub, id, ...rest] = pos;
      if (sub === 'log') {
        if (!id || !rest.length) throw new CliError('usage: pjman session log <id> <text>');
        const r = sessionLog(store, id, rest.join(' '));
        out(`logged to ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'bind') {
        if (!id || !rest[0]) throw new CliError('usage: pjman session bind <id> <change>');
        const r = sessionBind(store, id, rest[0]);
        out(r.added ? `bound in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}` : `already bound in ${r.path}`);
      } else if (sub === 'observe') {
        if (!id || rest.length < 3) throw new CliError('usage: pjman session observe <id> <edge> <from> <to>');
        const r = sessionObserve(store, id, rest[0], rest[1], rest[2]);
        out(`observed in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else throw new CliError('usage: pjman session <log|bind|observe> …');
      return 0;
    }
    case 'validate': {
      const store = requireStore(cwd, v.store);
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
      const store = requireStore(cwd, v.store);
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
      const store = requireStore(cwd, v.store);
      const rows = ls(store, { type: pos[1], status: v.status, project: v.project, kind: v.kind });
      v.json ? json(rows) : out(formatLs(rows));
      return 0;
    }
    case 'tree': {
      const store = requireStore(cwd, v.store);
      const nodes = tree(loadStore(store), pos[1]);
      if (v.json) json(nodes);
      else out(nodes.length ? formatTree(nodes) : pos[1] ? `${pos[1]} is not a product or a feature` : 'no products yet: pjman new product <slug> --title <t>');
      return 0;
    }
    case 'activity': {
      const store = requireStore(cwd, v.store);
      if (!pos[1]) throw new CliError('usage: pjman activity <key> [--days 14]');
      const loaded = loadStore(store);
      const res = resolve(loaded, pos[1]);
      if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`${pos[1]} does not resolve to a record`);
      const a = activity(store, loaded, res.rec.key, { days: v.days ? Number(v.days) : undefined, since: v.since });
      v.json ? json(a) : out(formatActivity(a, formatEvent));
      return 0;
    }
    case 'context': {
      const store = requireStore(cwd, v.store);
      if (pos[1] && (pos[1].startsWith('product:') || pos[1].startsWith('feature:'))) {
        const loaded = loadStore(store);
        const nodes = tree(loaded, pos[1]);
        if (!nodes.length) throw new CliError(`${pos[1]} does not resolve to a product or a feature`);
        const a = activity(store, loaded, nodes[0].key, {});
        v.json ? json({ tree: nodes[0], activity: a }) : out(formatTree(nodes) + '\n' + formatActivity(a, formatEvent));
        return 0;
      }
      if (pos[1] && !pos[1].startsWith('project:')) {
        const c = changeContext(store, pos[1]);
        v.json ? json(c) : out(formatChangeContext(c));
      } else {
        const c = storeContext(store, { project: v.all ? null : (pos[1] ?? v.project ?? store.project ?? null) });
        v.json ? json(c) : out(formatStoreContext(c));
      }
      return 0;
    }
    case 'get': {
      const store = requireStore(cwd, v.store);
      if (!pos[1]) throw new CliError('usage: pjman get <ref>');
      const n = get(loadStore(store), pos[1], { cwd, projectDir: store.projectDir, project: store.project });
      v.json ? json(n) : out(formatNeighbourhood(n, formatChangeContext));
      return n.resolution.status === 'none' ? 1 : 0;
    }
    case 'refs': {
      const store = requireStore(cwd, v.store);
      if (!pos[1]) throw new CliError('usage: pjman refs <text> | pjman refs - (text on stdin)');
      const text = pos[1] === '-' ? fs.readFileSync(0, 'utf8') : pos.slice(1).join(' ');
      const refs = findReferences(loadStore(store), text, { cwd, projectDir: store.projectDir, project: store.project });
      v.json ? json(refs) : out(formatReferences(refs));
      return 0;
    }
    case 'view': {
      const store = requireStore(cwd, v.store);
      const opts = { ref: pos[1], session: v.session, cwd, projectDir: store.projectDir, project: store.project };
      const render = () => {
        const view = renderView(store, opts);
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
      const store = requireStore(cwd, v.store);
      if (!pos[1]) throw new CliError('usage: pjman show <key>');
      const r = show(store, pos[1]);
      v.json ? json({ key: r.rec.key, path: r.rec.path, data: r.rec.data, body: r.rec.body }) : out(`# ${r.rec.path}\n${r.text}`);
      return 0;
    }
    case 'set': {
      const store = requireStore(cwd, v.store);
      if (!pos[1] || !pos[2]) throw new CliError('usage: pjman set <key> <field>=<value>...');
      const r = set(store, pos[1], pos.slice(2), { session: v.session });
      v.json ? json(r) : out(`set ${r.changed.join(', ')} on ${r.key}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'mv': {
      const store = requireStore(cwd, v.store);
      if (!pos[1] || !pos[2]) throw new CliError('usage: pjman mv <key> <new key>  (change, project or decision)');
      const r = mv(store, pos[1], pos[2], { session: v.session });
      if (v.json) json(r);
      else {
        out(`moved ${r.from} → ${r.to}; rewrote ${plural(r.rewritten.length, 'file')}${r.commit ? ` (committed ${r.commit})` : ''}`);
      }
      return 0;
    }
    case 'rm': {
      const store = requireStore(cwd, v.store);
      if (!pos[1]) throw new CliError('usage: pjman rm <key> [--detach]');
      const r = rm(store, pos[1], { detach: v.detach, session: v.session, writer: v.writer });
      if (v.json) json(r);
      else out(`removed ${r.key} (${plural(r.removed.length, 'file')})${r.detached.length ? `; detached from ${r.detached.map((d) => `${d.key} ${d.fields.join(',')}`).join(', ')}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'events': {
      const store = requireStore(cwd, v.store);
      if (pos[1] === 'rebuild') {
        const r = rebuildEvents(store);
        out(`rebuilt ${plural(r.events, 'event')} from ${plural(r.commits, 'commit')}`);
        return 0;
      }
      if (pos[1]) throw new CliError('usage: pjman events [--since <seq>] [--session <key>] [--receipt] | pjman events rebuild');
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
      const store = requireStore(cwd, v.store);
      const since = v.since !== undefined ? Number(v.since) : readEvents(store).at(-1)?.seq ?? 0;
      follow(store, since, (e) => out(v.json ? JSON.stringify(e) : formatEvent(e)));
      return 0; // the watcher keeps the process alive until it is interrupted
    }
    case 'start': {
      const s = start({ cwd, port: v.port ? Number(v.port) : undefined, log: out });
      out(`dashboard: ${s.address.url}${s.started ? '' : ' (already running)'}${s.ui ? '' : ' (API only: no built app)'}`);
      if (v.open) {
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        import('node:child_process').then((cp) => cp.spawn(cmd, [s.address.url], { detached: true, stdio: 'ignore' }).unref());
      }
      return 0;
    }
    case 'stop': {
      const a = stop();
      out(a ? `stopped the dashboard at ${a.url} (pid ${a.pid})` : 'no dashboard was running');
      return 0;
    }
    case 'brief': {
      out(BRIEF);
      return 0;
    }
    case 'serve': {
      const store = findStore(cwd, v.store) ?? globalStore();
      if (!store) throw new CliError('no store: run `pjman init` in a repository first');
      const running = readServeAddress();
      if (running && !v.port) throw new CliError(`a server is already running at ${running.url} (pid ${running.pid}); pass --port to start another`);
      startServer(store, { port: v.port ? Number(v.port) : undefined, host: v.host, staticDir: v.static })
        .then(({ address }) => out(`pjman serve: ${address.url} (store ${store.root}; api ${address.url}/api/v1; ctrl-c to stop)`))
        .catch((e: Error) => {
          process.stderr.write(`pjman: ${e.message}\n`);
          process.exit(1);
        });
      return 0;
    }
    case 'sync': {
      if (pos[1] !== 'linear' && pos[1] !== 'github') throw new CliError('usage: pjman sync linear|github --from <file|-> [--project <key>]');
      const store = requireStore(cwd, v.store);
      const r = pos[1] === 'linear'
        ? syncLinear(store, { project: v.project, team: v.team, from: v.from, session: v.session })
        : syncGithub(store, { project: v.project, repo: v.repo, from: v.from, session: v.session });
      if (v.json) json(r);
      else out(`${pos[1]} ${r.team} → ${r.project}: ${plural(r.issues, 'issue')}; ${plural(r.created.length, 'change')} created, ${r.updated.length} updated, ${r.unchanged.length} unchanged${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'index': {
      const store = requireStore(cwd, v.store);
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
      const store = requireStore(cwd, v.store);
      if (!pos[1]) throw new CliError('usage: pjman query "<sql>"');
      json(query(store, pos[1]));
      return 0;
    }
    case 'where': {
      const store = findStore(cwd, v.store);
      if (!store) throw new CliError('no store found');
      v.json
        ? json({ root: store.root, mode: store.mode, name: store.config.name, project: store.project ?? null, project_dir: store.projectDir ?? null, tracker: trackerOf(store), actor: readUserConfig().actor ?? null, source_kinds: store.config.source_kinds })
        : out(`${store.root} (${store.mode})${store.project ? ` ${store.project}` : ''}`);
      return 0;
    }
    default:
      throw new CliError(`unknown command '${cmd}'; run pjman --help`);
  }
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof CliError) {
    process.stderr.write(`pjman: ${e.message}\n`);
    process.exitCode = e.exitCode;
  } else {
    throw e;
  }
}
