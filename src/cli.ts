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
import { loadStore, resolve } from './records.js';
import { CliError, plural } from './util.js';
import { formatProblems, summarise, validate } from './validate.js';
import { findReferences, formatNeighbourhood, formatReferences, get } from './graph.js';
import { renderView, watchStore } from './commands/pane.js';
import { follow, formatEvent, readEvents, rebuildEvents } from './events.js';
import { installedTool, readServeAddress, startServer } from './server.js';
import { syncLinear } from './sync/linear.js';
import { syncGithub } from './sync/github.js';
import { init } from './commands/init.js';
import { newRecord, type NewFlags } from './commands/new.js';
import { sessionBind, sessionFocus, type BindReason, sessionLog, sessionObserve, sessionStart, sessionUnbind } from './commands/session.js';
import { brief, followWakes, formatBriefSize, type Wake } from './hydrate.js';
import { note } from './commands/note.js';
import { envelope } from './write.js';
import { fmt } from './commands/fmt.js';
import { mv } from './commands/mv.js';
import { rm } from './commands/rm.js';
import { apply, undo } from './commands/apply.js';
import { liftsOfStore } from './lift.js';
import { formatTree, tree } from './tree.js';
import { formatReceipt, receipt } from './receipt.js';
import { activity, formatActivity } from './activity.js';
import { set } from './commands/set.js';
import { decision, entriesFromFlags, entriesFromJson } from './commands/decision.js';
import { formatPlan, step } from './commands/step.js';
import { order } from './commands/order.js';
import { formatIntake, intake } from './intake.js';
import { changeContext, formatChangeContext, formatLs, formatStoreContext, ls, show, storeContext } from './commands/view.js';
import { describeMigration, formatMismatch, migrate, pendingMigration } from './commands/migrate.js';
import { TOOL_VERSION } from './version.js';
import { formatIdentity, identity } from './identity.js';
import { shortenText } from './keys.js';


/** One entry per command: the usage lines and a one-line purpose. `pjman <cmd> --help` prints one; `pjman --help` prints all. */
const COMMANDS: { name: string; usage: string[]; about: string }[] = [
  { name: 'init', about: 'the whole onboarding: join the global store (~/.pjman/store, its own git repository), register this repository as a project under a product (one made with its name, or --product names an existing one), set the actor (a person keyed by their handle, holding their forge login and git email as accounts), ask whether the first session should propose a product map (--map or --no-map answers without asking; the answer is the project\'s map field), set the actor, install the harness adapter found on the machine, start the dashboard, report; --in-project makes a store inside the repository instead (set aside; kept for a repository that must carry its own record)',
    usage: ['pjman init [--name <project-name>] [--product product:<slug>] [--map|--no-map] [--brief claude-md] [--no-adapter] [--no-start] [--in-project]'] },
  { name: 'start', about: 'the dashboard: install and build the app if the checkout has none, start the server detached if none is running, print its URL', usage: ['pjman start [--port <n>] [--open]'] },
  { name: 'stop', about: 'stop the dashboard server', usage: ['pjman stop'] },
  { name: 'open', about: "the dashboard brought back: started if none is running, opened at a session's page when one is named (--session, else PJMAN_SESSION), its front page otherwise; docked beside the terminal where the terminal can (cmux), in the default browser elsewhere",
    usage: ['pjman open [--session <id>]'] },
  { name: 'brief', about: "print the brief: what an agent needs in front of it every session (the adapter injects it; pjman init --brief claude-md writes it to ~/.claude/CLAUDE.md); with --session, what the store has for that session since its last brief: the bound change's context in full when the binding moved (or --full), else what changed on it, its milestone, its decisions and its dependency edges, without the session's own writes, one line per record, and the other live sessions near it; the brief records how far it reached and ends with its size",
    usage: ['pjman brief', 'pjman brief --session <id> [--full] [--json]'] },
  { name: 'new', about: 'create a record; refused if it would not validate',
    usage: [
      'pjman new product <slug> --title <t> [--name <one to three words>] [--owners <actor>]... [--levels <label>]... [--sequence <change>]... [--summary <s>]',
      'pjman new feature <slug> --title <t> [--name <one to three words>] --product <product> | --parent <feature> [--status planned|building|live|retired] [--level <label>] [--owners <actor>]... [--summary <s>]',
      '        keys are paths under the product (feature:<product>/<slug>, change:<product>/<slug>, decision:<product>/<change>/<slug>); inside a project the slug alone names a record',
      'pjman new project <slug> --title <t> [--product <product>] [--parent <project>] [--tracker <source-kind>] [--owners <actor>]... [--links <key>]...',
      'pjman new aspect <slug> --title <t> [--name <one to three words>] [--parent <aspect>] [--owners <actor>]... [--body <base>|-]   (what applies across the product; the body is the base)',
      'pjman new place <aspect>/<place> --feature feature:<slug> [--body <fork>|-] [--links <key>]...   (where the aspect applies; the body is the fork, empty for the base as it is)',
      'pjman new change <slug> --name <one to four words> --gist <one line> --origin <the request in the person\'s words, or the key it came from> --intent <the need, for whom> --done-when <the outcome that closes it>',
      '                        [--scope <in, and out>] [--open-questions <items>] [--blocked-on <an outside blocker>] [--notes <free>] [--status open] [--project <key>] [--parent <change>]',
      '                        [--features "adds feature:<slug>"]... [--aspects "changes aspect:<slug>"]... [--depends-on <change>]... [--owners <actor>]... [--binds <key>]... [--links <key>]...',
      '                        [--kind bug --severity product|feature|capability|nuisance|cosmetic] [--target <date>]   (a bug against a live node; a milestone\'s date; the plan is written with pjman step)',
      'pjman new release <version> --at <timestamp> [--tag v<version>] [--level patch|minor|major] [--commit <sha>] [--url <u>] [--ships <change>]... [--links <key>]... [--body <notes>|-]   (a version the product shipped; its creation is the event)',
      'pjman new source <kind>:<key> [--title <t>] [--url <u>] [--links <key>]...',
      'pjman new actor person:<handle> | agent:<handle> [--name <n>] [--url <u>] [--links github-user:<login>]... [--links email:<address>]...   (a person\'s accounts)',
      'pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>] [--started <ts>]',
    ] },
  { name: 'set', about: "change authored fields on a record (a list is comma-separated; an empty value removes the field; a change's sections are set by name: origin, intent, done-when, scope, open-questions, blocked-on, notes; a product's or feature's summary likewise; body sets an aspect's base or a place's fork whole, and a base written lists every place it reaches; field=- reads the value from stdin; a decision's supersedes only adds, and marks each named decision superseded in the same commit). A change's or decision's name and gist are the rungs views show; written from a changed foundation they are said to be stale until rewritten",
    usage: ['pjman set <key> <field>=<value>...', 'pjman set <key> <field>=- < file   (one value from stdin)'] },
  { name: 'decision', about: "write a decision at any size, one commit: created when it does not exist (then --name, --gist, --question and one --option are required), added to otherwise. Its foundation is a thread of entries: the question, criteria, options with their case, the recommendation with its reasoning, the person's comments in their words, rejections, the acceptance (a person's, with their words and when to revisit), a reopening. Status, decider and date follow the thread. --from - takes {name, gist, entries:[{type, text, id, case, option, by, revisit}]} as JSON on stdin",
    usage: [
      'pjman decision <change>/<slug> --name <one to four words> --gist <one line> --question <text> [--criterion <text>]... --option <id>=<text>... [--case <id>=<what it costs, what it rules out>]... [--recommend <id>[=<why>]] [--supersedes <decision>] [--links <key>]...',
      'pjman decision <key> [--question <reframed>] [--option <id>=<text>]... [--comment <the person\'s words> [--by person:<handle>]] [--reject <id>[=<why>]]... [--recommend <id>[=<why>]] [--name …] [--gist …]',
      'pjman decision <key> --accept <id>[=<their words>] --by person:<handle> [--revisit <when to look again>]   (the person decides; an agent never does)',
      'pjman decision <key> --reopen [--comment <why>]',
      'pjman decision <key> --from -   (entries as JSON on stdin)',
    ] },
  { name: 'step', about: "a change's plan, written only through commands: steps as data, each with a text, a state (open, active, done, dropped) and a note of where the work stands; every move is one commit and one event on the change. The next step (the active one, else the first open), the plan's progress and the active step's note are derived",
    usage: [
      'pjman step <change> add <text> [--before <n>|--after <n>|--first|--last] [--note <text>]',
      'pjman step <change> start|done|drop|reopen <n> [--note <where the work stands>]',
      'pjman step <change> note <n> <text>',
      'pjman step <change> move <n> --before <m>|--after <m>|--first|--last',
    ] },
  { name: 'order', about: "move a change in its product's sequence, the roadmap's order: before or after another entry, first, last, or off the sequence (later). The rest of the order is never touched",
    usage: ['pjman order <change> --before <change> | --after <change> | --first | --last | --later'] },
  { name: 'session', about: 'append to a session record: a log line, a change it worked on, an observed edge; unbind backs out a binding made in error (the change, the edges observed on it), logging that it did',
    usage: ['pjman session start <id> --agent <agent> --on-behalf-of <person> [--parent session:<id>] [--log <line>] [--branch <name>] [--full] [--json]   (the start as one write: the record unless it exists, the start line, the change the branch names bound and its edge observed, the brief; --json carries the brief)', 'pjman session log <id> <text>', 'pjman session bind <id> <change> [--reason prompt|created|branch]', 'pjman session unbind <id> <change>', 'pjman session observe <id> <edge> <from> <to>', 'pjman session focus <id> <change>   (what the session is looking at; pjman context <change> sets it for the session in PJMAN_SESSION)'] },
  { name: 'note', about: "a note to whoever works a change, or to one running session: one line under Notes on that record, given in full in the session's next brief; a session working the change, or the one addressed, is woken for it where its adapter can (pjman undo <commit> takes it back)",
    usage: ['pjman note <change|session:<id>> <text>'] },
  { name: 'wakes', about: "the events that wake a session: a decision on its bound change set decided, a note on that change or on the session, by anyone but the session; --follow keeps printing them as they land, from the stream's tail (or --since), until the session's process ends",
    usage: ['pjman wakes --session <id> [--since <seq>] [--follow] [--json]'] },
  { name: 'context', about: "what an agent reads first: this project's open changes (--all: every project; project:<slug>: that project), or one change with its decisions, sources and sessions",
    usage: ['pjman context [<change> | project:<slug>] [--all] [--json]'] },
  { name: 'ls', about: 'list records, by type, status, project and kind; bugs come worst first, then oldest', usage: ['pjman ls [project|change|decision|source|session|actor] [--status <s>] [--project <key>] [--kind bug|work] [--json]'] },
  { name: 'refs', about: "every reference in a text that resolves to something, in order, each with the change it leads to: change:<slug>, a URL, a ticket in any shape the store's source kinds know, an existing slug; the last mention is what a prompt is about. Never writes",
    usage: ['pjman refs <text> [--json]', 'pjman refs - [--json]   (text on stdin)'] },
  { name: 'intake', about: "what already exists for a request, before it is filed: open changes that share its words or are named in it (duplicates), done ones like it, the nodes of the map it may alter with their path, the milestones in flight, the order's tail. Never writes; the intake skill answers its four questions from this",
    usage: ['pjman intake <text> [--json]', 'pjman intake - [--json]   (text on stdin)'] },
  { name: 'tree', about: "the product tree: products, their features at every level (label from the template or the node), each with its authored and derived status, effective owners and the changes beneath it by status and project; a product also counts the open changes under its projects that name no feature",
    usage: ['pjman tree [product:<slug>|feature:<slug>] [--json]'] },
  { name: 'activity', about: "the activity of a subtree: every event beneath a key (a product, feature, project or change, through every chain) in a window, with what it says about health: when it last moved, what got done, what is new, what is blocked, what waits on a person",
    usage: ['pjman activity <key> [--days 14] [--since <iso>] [--json]'] },
  { name: 'get', about: 'the getter: a key, a source key, a URL, a ticket id, a file path or a slug in; the record, every edge into and out of it, and the full context of every change within two hops out (exit 1 when nothing matches)',
    usage: ['pjman get <ref> [--json]'] },
  { name: 'view', about: "one reference as a Markdown document, or the project's board without one; --out writes a file, --watch re-renders whenever the store changes. A session's view is the dashboard's: pjman open --session",
    usage: ['pjman view [<ref>] [--out <file>] [--watch]'] },
  { name: 'show', about: 'print one record by key', usage: ['pjman show <key> [--json]'] },
  { name: 'validate', about: 'check every record and every reference; errors are reported, never dropped (exit 1 on errors)',
    usage: ['pjman validate [--json]'] },
  { name: 'fmt', about: 'rewrite records in canonical form: field order, the YAML rule, repaired quoting (--check reports only)',
    usage: ['pjman fmt [--check]'] },
  { name: 'mv', about: 'rename a change or a feature (the folder moves, the old slug stays as an alias; <product>/<slug> moves it to another product), a product (every key beneath it follows), a project (directories bound to it follow), a decision (within or across changes) or a person (the old handle stays as an alias; the user config follows); every reference is rewritten in the same commit',
    usage: ['pjman mv change:<old> change:<new>', 'pjman mv feature:<old> feature:<new>', 'pjman mv product:<old> product:<new>', 'pjman mv project:<old> project:<new>', 'pjman mv decision:<change>/<old> decision:<change>/<new>', 'pjman mv person:<old> person:<new>'] },
  { name: 'migrate', about: "the one move the store still waits for, one commit, one event, pjman undo <commit> reverts it. The layout: every product becomes a folder holding its features and changes, every key gains its product segment wherever it is written, each moved record keeps its old slug as an alias. The foundation: every change and decision mapped into its shape, nothing dropped (a title becomes a draft gist, a summary the Intent, next and a prose plan go to Notes, a list plan becomes steps, a decision's text one option accepted by whoever decided it), each marked migrated until it is next written. Then the stamp: pjman.yaml names the format the store is in (the pjman version that introduced its latest move), so a store from a newer pjman is refused by an older one, and an older store is told to migrate. Each move names the version that introduced it",
    usage: ['pjman migrate'] },
  { name: 'lift', about: "move every open or planning change up to what its plan says, as one batch (pjman undo reverts it): planning once it has a step, active once a step has started. The same rule runs after every write; this is the backfill for a store written before it (--check lists the lifts only)",
    usage: ['pjman lift [--check]'] },
  { name: 'apply', about: "many writes as one commit: the commands one per line (new, set, decision, step, mv, rm, order, session, note; as typed after pjman), run in order with every commit held, then one commit and the events with it, closed by one 'applied' event on the record --for names (a decision that proposed a map, a change). A line that fails refuses the whole batch and nothing is written",
    usage: ['pjman apply [<file>|-] [--for <key>]'] },
  { name: 'undo', about: 'revert the last batch (or the commit named) as one commit, every record put back; refused while a later write touched a record of that batch',
    usage: ['pjman undo [<commit>]'] },
  { name: 'rm', about: "remove a record (a change takes its decisions with it). Refused while anything refers to it, naming each referrer; --detach drops the references that can be dropped (a key in a list, a parent, a superseded decision, an observed edge) in the same commit. A change's project, a writer or a session can never be dropped",
    usage: ['pjman rm <key> [--detach] [--json]'] },
  { name: 'events', about: "the store's event stream: one event per write (seq, at, op, key, type, path, fields, writer, session, commit); `rebuild` rewrites it from the store's git history",
    usage: ['pjman events [--since <seq>] [--session <key>] [--json]', 'pjman events --receipt [--since <seq>] [--session <key>] [--json]   what the store received, one line per record, for a person', 'pjman events rebuild'] },
  { name: 'follow', about: 'print events as they are appended, after --since (default: only new ones), until interrupted; what a view subscribes to',
    usage: ['pjman follow [--since <seq>] [--json]'] },
  { name: 'serve', about: "the store over HTTP: the library's results as JSON under /api/v1 (records by key, the getter as /resolve, a session's view, a project's board, the event stream as server-sent events) and the bundled app; writes its address to ~/.pjman/serve.json while it runs",
    usage: ['pjman serve [--port <n>] [--host <addr>] [--static <dir>] [--register|--no-register]   (PORT from the environment when --port is absent; a checkout registers only with --register)'] },
  { name: 'sync', about: "apply a tracker's tickets to the store, as observed by whoever holds the connection (the harness's MCP session): each ticket becomes a source and the change that binds it; title, status and parent follow the ticket; everything pjman adds is kept. --from takes the issues as JSON, in whatever shape the tracker's tools answered",
    usage: ['pjman sync linear --from <file|-> [--project <key>] [--team <KEY>] [--json]', 'pjman sync github --from <file|-> [--project <key>] [--repo <owner/name>] [--json]', 'pjman sync github            (no --from: prints the gh command that reads the issues)'] },
  { name: 'index', about: 'rebuild index.db: ids, reverse edges, conflicts (exit 1 on conflicts)', usage: ['pjman index [--json]'] },
  { name: 'query', about: 'run a read-only SQL query against the index', usage: ['pjman query "<sql>"'] },
  { name: 'where', about: 'print the store this directory resolves to and its mode', usage: ['pjman where [--json]'] },
  { name: 'whoami', about: "who you are: the configured person, their record and their accounts in order, the first of a handle kind as the primary one; from the store alone, no app asked. --verify asks each account kind's checker (GitHub through gh; a kind with no checker reports unchecked) and gives each account a verdict, verified, unknown or unchecked, with the answers cached for a day (--fresh asks again). What is off is said with the command that resolves it: a provisional handle (one that claims no account of a handle kind), a sign-in claimed by another person, an account the app does not know. Writes nothing",
    usage: ['pjman whoami [--verify] [--fresh] [--json]'] },
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

function parse(args: string[]) {
  try {
    return parseArgs({
  args,
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
    verify: { type: 'boolean' },
    fresh: { type: 'boolean' },
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
    gist: { type: 'string' },
    origin: { type: 'string' },
    intent: { type: 'string' },
    'done-when': { type: 'string' },
    scope: { type: 'string' },
    'open-questions': { type: 'string' },
    'blocked-on': { type: 'string' },
    notes: { type: 'string' },
    note: { type: 'string' },
    question: { type: 'string' },
    criterion: { type: 'string', multiple: true },
    option: { type: 'string', multiple: true },
    case: { type: 'string', multiple: true },
    recommend: { type: 'string' },
    comment: { type: 'string' },
    reject: { type: 'string', multiple: true },
    accept: { type: 'string' },
    revisit: { type: 'string' },
    reopen: { type: 'boolean' },
    by: { type: 'string' },
    binds: { type: 'string', multiple: true },
    links: { type: 'string', multiple: true },
    owners: { type: 'string', multiple: true },
    features: { type: 'string', multiple: true },
    aspects: { type: 'string', multiple: true },
    feature: { type: 'string' },
    'depends-on': { type: 'string', multiple: true },
    kind: { type: 'string' },
    severity: { type: 'string' },
    target: { type: 'string' },
    sequence: { type: 'string', multiple: true },
    levels: { type: 'string', multiple: true },
    level: { type: 'string' },
    tag: { type: 'string' },
    at: { type: 'string' },
    commit: { type: 'string' },
    ships: { type: 'string', multiple: true },
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
    register: { type: 'boolean' },
    'no-register': { type: 'boolean' },
    host: { type: 'string' },
    static: { type: 'string' },
    team: { type: 'string' },
    repo: { type: 'string' },
    from: { type: 'string' },
    watch: { type: 'boolean' },
    detach: { type: 'boolean' },
    full: { type: 'boolean' },
    follow: { type: 'boolean' },
    receipt: { type: 'boolean' },
    reason: { type: 'string' },
    log: { type: 'string' },
    branch: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
    first: { type: 'boolean' },
    last: { type: 'boolean' },
    later: { type: 'boolean' },
    for: { type: 'string' },
    map: { type: 'boolean' },
    'no-map': { type: 'boolean' },
  },
    });
  } catch (e) {
    throw new CliError(`${(e as Error).message.split('\n')[0]}\n(a value that starts with a dash is passed as --flag=value)`, 2);
  }
}

// Inside a product the slug alone names a record: text output drops the product segment of the current project's product
// (JSON keeps the full keys). Set once the store is known.
let scopeProduct: string | null = null;
const scoped = (store: ReturnType<typeof requireStore>) => {
  try {
    scopeProduct = loadStore(store).scope;
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
    out(usage(cmd === 'help' ? pos[1] : cmd));
    return 0;
  }
  if (!cmd) {
    out(usage());
    return 1;
  }
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
      if (!type || !ident) throw new CliError('usage: pjman new <product|feature|aspect|place|project|change|decision|release|source|actor|session> <ident> [flags]');
      if (type === 'change' && (v.plan !== undefined || v.next !== undefined)) throw new CliError(v.plan !== undefined ? 'the plan is written with pjman step <change> add "…"' : 'next is retired: the next step is the plan\'s first open step (pjman step), an outside blocker is --blocked-on');
      const flags: NewFlags = {
        title: v.title, status: v.status, project: v.project, tracker: v.tracker, summary: v.summary,
        gist: v.gist, origin: v.origin, intent: v.intent, doneWhen: v['done-when'], scope: v.scope, openQuestions: v['open-questions'], blockedOn: v['blocked-on'], notes: v.notes,
        binds: v.binds, links: v.links, decidedBy: v['decided-by'], decidedOn: v['decided-on'],
        supersedes: v.supersedes, name: v.name, url: v.url,
        agent: v.agent, onBehalfOf: v['on-behalf-of'], parent: v.parent, started: v.started,
        product: v.product, owners: v.owners, features: v.features, level: v.level, levels: v.levels,
        dependsOn: v['depends-on'], kind: v.kind, severity: v.severity, target: v.target, sequence: v.sequence,
        aspects: v.aspects, feature: v.feature,
        tag: v.tag, at: v.at, commit: v.commit, ships: v.ships,
        created: v.created, body: v.body === '-' ? fs.readFileSync(0, 'utf8') : v.body, writer: v.writer, session: v.session,
      };
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
      if (!pos[1]) throw new CliError('usage: pjman decision <change>/<slug> --name … --gist … --question … --option <id>=<text>… [--recommend <id>[=<why>]] | pjman decision <key> <entries…> | --from -');
      const writer = envelope({ writer: v.writer }).writer;
      let name = v.name;
      let gist = v.gist;
      let entries = entriesFromFlags({ question: v.question, criterion: v.criterion, option: v.option, case: v.case, recommend: v.recommend, comment: v.comment, reject: v.reject, accept: v.accept, revisit: v.revisit, reopen: v.reopen, by: v.by }, writer);
      if (v.from !== undefined) {
        if (v.from !== '-') throw new CliError('--from takes - (the entries as JSON on stdin)');
        const j = entriesFromJson(fs.readFileSync(0, 'utf8'), writer);
        name ??= j.name;
        gist ??= j.gist;
        entries = [...entries, ...j.entries];
      }
      const r = decision(store, pos[1], { name, gist, entries, supersedes: v.supersedes, links: v.links, created: v.created, session: v.session, writer: v.writer });
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
      if (!ref || !verb) throw new CliError('usage: pjman step <change> add <text> | start|done|drop|reopen <n> [--note …] | note <n> <text> | move <n> --before <m>|--after <m>|--first|--last');
      const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
      const n = verb === 'add' ? undefined : num(rest[0]);
      const text = verb === 'add' ? rest.join(' ') : verb === 'note' ? rest.slice(1).join(' ') : undefined;
      const r = step(store, ref, verb, n, { text, note: v.note, before: num(v.before), after: num(v.after), first: v.first, last: v.last, session: v.session, writer: v.writer });
      if (v.json) json(r);
      else out(`${r.key} step ${r.n} ${r.verb}${r.progress ? ` · ${r.progress.done}/${r.progress.total} done` : ''}${r.next ? ` · next: ${r.next.n}. ${r.next.step.text}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}\n${formatPlan(r.steps)}`);
      return 0;
    }
    case 'session': {
      const store = scoped(requireStore(cwd, v.store));
      const [, sub, id, ...rest] = pos;
      if (sub === 'start') {
        if (!id) throw new CliError('usage: pjman session start <id> --agent <agent> --on-behalf-of <person> [--parent session:<id>] [--log <line>] [--branch <name>] [--full] [--json]');
        const r = sessionStart(store, id, { agent: v.agent, onBehalfOf: v['on-behalf-of'], parent: v.parent, log: v.log, branch: v.branch, full: !!v.full, writer: v.writer, session: v.session });
        // the brief's text is what the agent reads, named as the context names records; the rest keeps full keys
        if (v.json) json({ ...r, brief: r.brief ? { ...r.brief, text: shortenText(r.brief.text, scopeProduct) } : null });
        else out(`${r.created ? 'created' : 'started'} ${r.key}${r.bound ? `, bound ${r.bound} (branch)` : ''}${r.brief ? `; ${formatBriefSize(r.brief)}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'log') {
        if (!id || !rest.length) throw new CliError('usage: pjman session log <id> <text>');
        const r = sessionLog(store, id, rest.join(' '));
        out(`logged to ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'bind') {
        if (!id || !rest[0]) throw new CliError('usage: pjman session bind <id> <change> [--reason prompt|created|branch]');
        const reasons = ['prompt', 'created', 'branch', 'by hand'] as const;
        const reason = (v.reason ?? 'by hand') as BindReason;
        if (!reasons.includes(reason)) throw new CliError(`--reason takes ${reasons.join(', ')}`);
        const r = sessionBind(store, id, rest[0], reason);
        out(r.added ? `bound in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}` : `already bound in ${r.path}`);
      } else if (sub === 'unbind') {
        if (!id || !rest[0]) throw new CliError('usage: pjman session unbind <id> <change>');
        const r = sessionUnbind(store, id, rest[0]);
        out(`unbound in ${r.path}${r.dropped ? `; ${r.dropped} observed edge${r.dropped === 1 ? '' : 's'} dropped` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'observe') {
        if (!id || rest.length < 3) throw new CliError('usage: pjman session observe <id> <edge> <from> <to>');
        const r = sessionObserve(store, id, rest[0], rest[1], rest[2]);
        out(`observed in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}`);
      } else if (sub === 'focus') {
        if (!id || !rest[0]) throw new CliError('usage: pjman session focus <id> <change>');
        const r = sessionFocus(store, id, rest[0]);
        out(r.moved ? `focus moved in ${r.path}${r.commit ? ` (committed ${r.commit})` : ''}` : `focus already there in ${r.path}`);
      } else throw new CliError('usage: pjman session <log|bind|unbind|observe|focus> …');
      return 0;
    }
    case 'note': {
      const store = scoped(requireStore(cwd, v.store));
      const [, ref, ...rest] = pos;
      if (!ref || !rest.length) throw new CliError('usage: pjman note <change|session:<id>> <text>');
      const r = note(store, ref, rest.join(' '), { writer: v.writer, session: v.session });
      out(`noted on ${r.key}${r.commit ? ` (committed ${r.commit}; pjman undo ${r.commit} takes it back)` : ''}`);
      return 0;
    }
    case 'wakes': {
      if (!v.session) throw new CliError('usage: pjman wakes --session <id> [--since <seq>] [--follow] [--json]');
      const store = scoped(requireStore(cwd, v.store));
      const tail = readEvents(store).at(-1)?.seq ?? 0;
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
      const rows = ls(store, { type: pos[1], status: v.status, project: v.project, kind: v.kind });
      v.json ? json(rows) : out(formatLs(rows));
      return 0;
    }
    case 'tree': {
      const store = scoped(requireStore(cwd, v.store));
      const nodes = tree(loadStore(store), pos[1]);
      if (v.json) json(nodes);
      else out(nodes.length ? formatTree(nodes) : pos[1] ? `${pos[1]} is not a product or a feature` : 'no products yet: pjman new product <slug> --title <t>');
      return 0;
    }
    case 'activity': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw new CliError('usage: pjman activity <key> [--days 14]');
      const loaded = loadStore(store);
      const res = resolve(loaded, pos[1]);
      if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`${pos[1]} does not resolve to a record`);
      const a = activity(store, loaded, res.rec.key, { days: v.days ? Number(v.days) : undefined, since: v.since });
      v.json ? json(a) : out(formatActivity(a, formatEvent));
      return 0;
    }
    case 'context': {
      const store = scoped(requireStore(cwd, v.store));
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
      if (!pos[1]) throw new CliError('usage: pjman get <ref>');
      const n = get(loadStore(store), pos[1], { cwd, projectDir: store.projectDir, project: store.project });
      v.json ? json(n) : out(formatNeighbourhood(n, formatChangeContext));
      return n.resolution.status === 'none' ? 1 : 0;
    }
    case 'intake': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw new CliError('usage: pjman intake <text> | pjman intake - (text on stdin)');
      const text = pos[1] === '-' ? fs.readFileSync(0, 'utf8') : pos.slice(1).join(' ');
      const i = intake(store, loadStore(store), text.trim(), { cwd, projectDir: store.projectDir, project: store.project });
      v.json ? json(i) : out(formatIntake(i));
      return 0;
    }
    case 'refs': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw new CliError('usage: pjman refs <text> | pjman refs - (text on stdin)');
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
      if (!pos[1]) throw new CliError('usage: pjman show <key>');
      const r = show(store, pos[1]);
      v.json ? json({ key: r.rec.key, path: r.rec.path, data: r.rec.data, body: r.rec.body }) : out(`# ${r.rec.path}\n${r.text}`);
      return 0;
    }
    case 'set': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1] || !pos[2]) throw new CliError('usage: pjman set <key> <field>=<value>...');
      // one value may come from stdin, `field=-`: a multi-line text, such as an aspect's base or a place's fork
      const pairs = pos.slice(2);
      if (pairs.filter((p) => p.endsWith('=-')).length > 1) throw new CliError('only one field=- reads stdin');
      const stdinPairs = pairs.map((p) => (p.endsWith('=-') ? `${p.slice(0, -1)}${fs.readFileSync(0, 'utf8')}` : p));
      const r = set(store, pos[1], stdinPairs, { session: v.session });
      v.json ? json(r) : out(`set ${r.changed.join(', ')} on ${r.key}${r.commit ? ` (committed ${r.commit})` : ''}${r.notes.map((n) => `\nnote: ${n}`).join('')}`);
      return 0;
    }
    case 'order': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw new CliError('usage: pjman order <change> --before <change> | --after <change> | --first | --last | --later');
      const r = order(store, pos[1], { before: v.before, after: v.after, first: v.first, last: v.last, later: v.later, session: v.session, writer: v.writer });
      v.json ? json(r) : out(`${r.product} sequence: ${r.sequence.length ? r.sequence.join(' → ') : '(empty)'}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'mv': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1] || !pos[2]) throw new CliError('usage: pjman mv <key> <new key>  (change, project or decision)');
      const r = mv(store, pos[1], pos[2], { session: v.session });
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
      else out(`reverted ${r.reverted} (${r.subject}): ${plural(r.files, 'file')} put back${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'rm': {
      const store = scoped(requireStore(cwd, v.store));
      if (!pos[1]) throw new CliError('usage: pjman rm <key> [--detach]');
      const r = rm(store, pos[1], { detach: v.detach, session: v.session, writer: v.writer });
      if (v.json) json(r);
      else out(`removed ${r.key} (${plural(r.removed.length, 'file')})${r.detached.length ? `; detached from ${r.detached.map((d) => `${d.key} ${d.fields.join(',')}`).join(', ')}` : ''}${r.commit ? ` (committed ${r.commit})` : ''}`);
      return 0;
    }
    case 'events': {
      const store = scoped(requireStore(cwd, v.store));
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
      const store = scoped(requireStore(cwd, v.store));
      const since = v.since !== undefined ? Number(v.since) : readEvents(store).at(-1)?.seq ?? 0;
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
        if (res.status !== 'ok' || res.rec.type !== 'session') throw new CliError(`${key} has no record in the store`);
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
      if (pos[1] !== 'linear' && pos[1] !== 'github') throw new CliError('usage: pjman sync linear|github --from <file|-> [--project <key>]');
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
      if (!pos[1]) throw new CliError('usage: pjman query "<sql>"');
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
    process.stderr.write(`pjman: ${e.message}\n`);
    process.exitCode = e.exitCode;
  } else {
    throw e;
  }
}
