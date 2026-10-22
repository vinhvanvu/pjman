import './quiet.js';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { findStore, readUserConfig, requireStore } from './config.js';
import { buildIndex, query } from './indexdb.js';
import { loadStore } from './records.js';
import { CliError, plural } from './util.js';
import { formatProblems, summarise, validate } from './validate.js';
import { formatNeighbourhood, get } from './graph.js';
import { renderView, watchStore } from './commands/pane.js';
import { follow, formatEvent, readEvents, rebuildEvents } from './events.js';
import { readServeAddress, startServer } from './server.js';
import { init } from './commands/init.js';
import { newRecord, type NewFlags } from './commands/new.js';
import { sessionBind, sessionLog, sessionObserve } from './commands/session.js';
import { fmt } from './commands/fmt.js';
import { mv } from './commands/mv.js';
import { set } from './commands/set.js';
import { changeContext, formatChangeContext, formatLs, formatStoreContext, ls, show, storeContext } from './commands/view.js';

import { createRequire } from 'node:module';

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/** One entry per command: the usage lines and a one-line purpose. `pjman <cmd> --help` prints one; `pjman --help` prints all. */
const COMMANDS: { name: string; usage: string[]; about: string }[] = [
  { name: 'init', about: 'join the global store (~/.pjman/store, its own git repository) and register this repository as a project; --in-project makes a store inside the repository instead (set aside; kept for a repository that must carry its own record)',
    usage: ['pjman init [--name <project-name>] [--in-project]'] },
  { name: 'new', about: 'create a record; refused if it would not validate',
    usage: [
      'pjman new project <slug> --title <t> [--tracker <source-kind>] [--links <key>]...',
      'pjman new change <slug> --title <t> [--status open] [--project <key>] [--parent <change>] [--summary <s>] [--plan <p>] [--next <n>] [--binds <key>]... [--links <key>]...',
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
  { name: 'ls', about: 'list records, by type, status and project', usage: ['pjman ls [project|change|decision|source|session|actor] [--status <s>] [--project <key>] [--json]'] },
  { name: 'get', about: 'the getter: a key, a source key, a URL, a ticket id, a file path or a slug in; the record, every edge into and out of it, and the full context of every change within two hops out (exit 1 when nothing matches)',
    usage: ['pjman get <ref> [--json]'] },
  { name: 'view', about: "the view beside a session, as a Markdown document: one reference, or what a session is on (its last bound change, else the project's board); --out writes a file, --watch re-renders whenever the store changes",
    usage: ['pjman view [<ref>] [--session <id>] [--out <file>] [--watch]'] },
  { name: 'show', about: 'print one record by key', usage: ['pjman show <key> [--json]'] },
  { name: 'validate', about: 'check every record and every reference; errors are reported, never dropped (exit 1 on errors)',
    usage: ['pjman validate [--json]'] },
  { name: 'fmt', about: 'rewrite records in canonical form: field order, the YAML rule, repaired quoting (--check reports only)',
    usage: ['pjman fmt [--check]'] },
  { name: 'mv', about: 'rename a change: move the folder, leave an alias, rewrite every reference',
    usage: ['pjman mv change:<old> change:<new>'] },
  { name: 'events', about: "the store's event stream: one event per write (seq, at, op, key, type, path, fields, writer, session, commit); `rebuild` rewrites it from the store's git history",
    usage: ['pjman events [--since <seq>] [--json]', 'pjman events rebuild'] },
  { name: 'follow', about: 'print events as they are appended, after --since (default: only new ones), until interrupted; what a view subscribes to',
    usage: ['pjman follow [--since <seq>] [--json]'] },
  { name: 'serve', about: "the store over HTTP: the library's results as JSON under /api/v1 (records by key, the getter as /resolve, a session's view, a project's board, the event stream as server-sent events) and the bundled app; writes its address to ~/.pjman/serve.json while it runs",
    usage: ['pjman serve [--port <n>] [--host <addr>] [--static <dir>]'] },
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
    watch: { type: 'boolean' },
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
      for (const line of init({ cwd, inProject: v['in-project'], name: v.name })) out(line);
      return 0;
    }
    case 'new': {
      const store = requireStore(cwd, v.store);
      const [, type, ident] = pos;
      if (!type || !ident) throw new CliError('usage: pjman new <project|change|decision|source|actor|session> <ident> [flags]');
      const flags: NewFlags = {
        title: v.title, status: v.status, project: v.project, tracker: v.tracker, summary: v.summary, plan: v.plan, next: v.next,
        binds: v.binds, links: v.links, decidedBy: v['decided-by'], decidedOn: v['decided-on'],
        supersedes: v.supersedes, decision: v.decision, why: v.why, name: v.name, url: v.url,
        agent: v.agent, onBehalfOf: v['on-behalf-of'], parent: v.parent, started: v.started,
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
      const rows = ls(store, { type: pos[1], status: v.status, project: v.project });
      v.json ? json(rows) : out(formatLs(rows));
      return 0;
    }
    case 'context': {
      const store = requireStore(cwd, v.store);
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
      if (!pos[1] || !pos[2]) throw new CliError('usage: pjman mv change:<old> change:<new>');
      const r = mv(store, pos[1], pos[2], { session: v.session });
      if (v.json) json(r);
      else {
        out(`moved ${r.from} → ${r.to}; rewrote ${plural(r.rewritten.length, 'file')}${r.commit ? ` (committed ${r.commit})` : ''}`);
      }
      return 0;
    }
    case 'events': {
      const store = requireStore(cwd, v.store);
      if (pos[1] === 'rebuild') {
        const r = rebuildEvents(store);
        out(`rebuilt ${plural(r.events, 'event')} from ${plural(r.commits, 'commit')}`);
        return 0;
      }
      if (pos[1]) throw new CliError('usage: pjman events [--since <seq>] | pjman events rebuild');
      const events = readEvents(store, v.since ? Number(v.since) : 0);
      v.json ? json(events) : out(events.length ? events.map(formatEvent).join('\n') : '(no events)');
      return 0;
    }
    case 'follow': {
      const store = requireStore(cwd, v.store);
      const since = v.since !== undefined ? Number(v.since) : readEvents(store).at(-1)?.seq ?? 0;
      follow(store, since, (e) => out(v.json ? JSON.stringify(e) : formatEvent(e)));
      return 0; // the watcher keeps the process alive until it is interrupted
    }
    case 'serve': {
      const store = requireStore(cwd, v.store);
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
