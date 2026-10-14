import './quiet.js';
import { parseArgs } from 'node:util';
import { findStore, requireStore } from './config.js';
import { buildIndex, query } from './indexdb.js';
import { loadStore } from './records.js';
import { CliError, plural } from './util.js';
import { formatProblems, summarise, validate } from './validate.js';
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
  { name: 'init', about: 'create a store: standalone (its own git repository, bound to this project) or in-project (<repo>/.pjman/)',
    usage: ['pjman init [--in-project] [--dir <path>] [--name <name>]'] },
  { name: 'new', about: 'create a record; refused if it would not validate',
    usage: [
      'pjman new change <slug> --title <t> [--status open] [--summary <s>] [--plan <p>] [--next <n>] [--binds <key>]... [--links <key>]...',
      'pjman new decision <change>/<slug> | /<slug> --title <t> [--decided-by <person>] [--decided-on <date>] [--supersedes <decision>]',
      '                                             [--decision <text>] [--why <text>] [--links <key>]...   (status: proposed unless decided)',
      'pjman new source <kind>:<key> [--title <t>] [--url <u>] [--links <key>]...',
      'pjman new actor person:<handle> | agent:<handle> [--name <n>] [--url <u>]',
      'pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>] [--started <ts>]',
    ] },
  { name: 'set', about: 'change authored fields on a record (a list is comma-separated; an empty value removes the field)',
    usage: ['pjman set <key> <field>=<value>...'] },
  { name: 'session', about: 'append to a session record: a log line, a change it worked on, an observed edge',
    usage: ['pjman session log <id> <text>', 'pjman session bind <id> <change>', 'pjman session observe <id> <edge> <from> <to>'] },
  { name: 'context', about: 'what an agent reads first: the open changes, or one change with its decisions, sources and sessions',
    usage: ['pjman context [<change>] [--json]'] },
  { name: 'ls', about: 'list records, by type and status', usage: ['pjman ls [change|decision|source|session|actor] [--status <s>] [--json]'] },
  { name: 'show', about: 'print one record by key', usage: ['pjman show <key> [--json]'] },
  { name: 'validate', about: 'check every record and every reference; errors are reported, never dropped (exit 1 on errors)',
    usage: ['pjman validate [--json]'] },
  { name: 'fmt', about: 'rewrite records in canonical form: field order, the YAML rule, repaired quoting (--check reports only)',
    usage: ['pjman fmt [--check]'] },
  { name: 'mv', about: 'rename a change: move the folder, leave an alias, rewrite every reference',
    usage: ['pjman mv change:<old> change:<new>'] },
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
    dir: { type: 'string' },
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
      for (const line of init({ cwd, inProject: v['in-project'], dir: v.dir, name: v.name })) out(line);
      return 0;
    }
    case 'new': {
      const store = requireStore(cwd, v.store);
      const [, type, ident] = pos;
      if (!type || !ident) throw new CliError('usage: pjman new <change|decision|source|actor|session> <ident> [flags]');
      const flags: NewFlags = {
        title: v.title, status: v.status, summary: v.summary, plan: v.plan, next: v.next,
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
      const rows = ls(store, { type: pos[1], status: v.status });
      v.json ? json(rows) : out(formatLs(rows));
      return 0;
    }
    case 'context': {
      const store = requireStore(cwd, v.store);
      if (pos[1]) {
        const c = changeContext(store, pos[1]);
        v.json ? json(c) : out(formatChangeContext(c));
      } else {
        const c = storeContext(store);
        v.json ? json(c) : out(formatStoreContext(c));
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
      v.json ? json({ root: store.root, mode: store.mode, name: store.config.name }) : out(`${store.root} (${store.mode})`);
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
