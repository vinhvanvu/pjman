// The command line's surface, declared once (decisions interface-audit/flags-per-command, interface-audit/help-groups):
// each command's flags, usage and purpose, and the entities read with their operations in one place. The parser
// refuses a flag a command does not declare, `pjman --help` and `pjman help <entity|command>` print from here, and
// docs/reference.md's command section is generated from the same tables (npm run docs; a test keeps it in step).

/** The flags every command takes. */
export const GLOBAL_FLAGS = ['store', 'writer', 'session', 'created', 'json', 'help', 'version'] as const;

/** Every flag the parser knows, with its type. A command takes only those it declares (plus the global ones). */
export const FLAG_TYPES = {
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'V' }, json: { type: 'boolean' },
  store: { type: 'string' }, writer: { type: 'string' }, session: { type: 'string' }, created: { type: 'string' },
  'in-project': { type: 'boolean' }, 'no-start': { type: 'boolean' }, 'no-adapter': { type: 'boolean' },
  verify: { type: 'boolean' }, fresh: { type: 'boolean' }, brief: { type: 'string' }, open: { type: 'boolean' },
  all: { type: 'boolean' }, project: { type: 'string' }, tracker: { type: 'string' }, name: { type: 'string' },
  title: { type: 'string' }, status: { type: 'string' }, summary: { type: 'string' }, plan: { type: 'string' },
  next: { type: 'string' }, gist: { type: 'string' }, origin: { type: 'string' }, intent: { type: 'string' },
  'done-when': { type: 'string' }, scope: { type: 'string' }, 'open-questions': { type: 'string' },
  'blocked-on': { type: 'string' }, notes: { type: 'string' }, note: { type: 'string' }, question: { type: 'string' },
  criterion: { type: 'string', multiple: true }, option: { type: 'string', multiple: true }, case: { type: 'string', multiple: true },
  recommend: { type: 'string' }, comment: { type: 'string' }, on: { type: 'string' }, reject: { type: 'string', multiple: true },
  accept: { type: 'string' }, revisit: { type: 'string' }, reopen: { type: 'boolean' }, by: { type: 'string' },
  binds: { type: 'string', multiple: true }, links: { type: 'string', multiple: true }, owners: { type: 'string', multiple: true },
  features: { type: 'string', multiple: true }, aspects: { type: 'string', multiple: true }, feature: { type: 'string' },
  'depends-on': { type: 'string', multiple: true }, kind: { type: 'string' }, severity: { type: 'string' },
  target: { type: 'string' }, sequence: { type: 'string', multiple: true }, levels: { type: 'string', multiple: true },
  level: { type: 'string' }, tag: { type: 'string' }, at: { type: 'string' }, commit: { type: 'string' },
  ships: { type: 'string', multiple: true }, product: { type: 'string' }, days: { type: 'string' },
  'decided-by': { type: 'string' }, 'decided-on': { type: 'string' }, supersedes: { type: 'string' }, url: { type: 'string' },
  agent: { type: 'string' }, 'on-behalf-of': { type: 'string' }, parent: { type: 'string' }, started: { type: 'string' },
  body: { type: 'string' }, check: { type: 'boolean' }, out: { type: 'string' }, since: { type: 'string' },
  port: { type: 'string' }, register: { type: 'boolean' }, 'no-register': { type: 'boolean' }, host: { type: 'string' },
  static: { type: 'string' }, team: { type: 'string' }, repo: { type: 'string' }, from: { type: 'string' },
  watch: { type: 'boolean' }, detach: { type: 'boolean' }, full: { type: 'boolean' }, follow: { type: 'boolean' },
  receipt: { type: 'boolean' }, reason: { type: 'string' }, log: { type: 'string' }, branch: { type: 'string' },
  before: { type: 'string' }, after: { type: 'string' }, first: { type: 'boolean' }, last: { type: 'boolean' },
  later: { type: 'boolean' }, for: { type: 'string' }, map: { type: 'boolean' }, 'no-map': { type: 'boolean' },
  step: { type: 'string', multiple: true }, 'no-host': { type: 'boolean' }, clear: { type: 'boolean' },
} as const satisfies Record<string, { type: 'string' | 'boolean'; multiple?: boolean; short?: string }>;

/** Flags of models since replaced: refused wherever they are given, with where their job went. */
export const RETIRED_FLAGS: Record<string, string> = {
  plan: 'the plan is steps: pjman step <change> add "…" (or --step "…" on pjman new change)',
  next: "next is retired: the next step is the plan's first open step (pjman step), an outside blocker is --blocked-on",
  'decided-by': 'a decision is decided by a person in its thread: pjman decision <key> --accept <id> --by person:<handle>',
  'decided-on': 'a decision is decided by a person in its thread: pjman decision <key> --accept <id> --by person:<handle>',
};

export type Group = 'records' | 'reading' | 'session' | 'dashboard' | 'batch' | 'setup' | 'maintenance';

export interface Command {
  name: string;
  group: Group;
  /** One line: what it is for. */
  line: string;
  /** The full text `pjman help <command>` prints. */
  about: string;
  usage: string[];
  /** The flags it takes beyond the global ones; by subcommand (its first positional) where they differ. */
  flags: string[] | Record<string, string[]>;
  /** The most positionals it takes after its name, its subcommand not counted; unset: no limit. */
  args?: number | Record<string, number>;
  /** Where its subcommand stands among the positionals, when not first (step <change> <verb>). */
  subAt?: number;
  /** Flags another form of the record takes that this one does not, refused with where their job went, by subcommand. */
  retired?: Record<string, Record<string, string>>;
  /** What a flag of another command an agent reaches for here is, said where it is refused. */
  elsewhere?: Record<string, string>;
}

const CHANGE_NEW = ['name', 'gist', 'origin', 'intent', 'done-when', 'scope', 'open-questions', 'blocked-on', 'notes', 'status', 'project', 'parent', 'features', 'aspects', 'depends-on', 'owners', 'binds', 'links', 'kind', 'severity', 'target', 'step', 'body'];

export const COMMANDS: Command[] = [
  // ---- records: the generic verbs, over every entity --------------------------------------------------------------
  { name: 'new', group: 'records', line: 'create a record of any entity; refused if it would not validate',
    about: 'create a record; refused if it would not validate. Keys are paths under the product (feature:<product>/<slug>, change:<product>/<slug>, decision:<product>/<change>/<slug>); inside a project the slug alone names a record. A decision is created with pjman decision, a session with pjman session start',
    usage: [
      'pjman new product <slug> --title <sentence> [--name <one to three words>] [--owners <actor>]... [--levels <label>]... [--sequence <change>]... [--summary <s>] [--links <key>]...',
      'pjman new feature <slug> --title <sentence> [--name <one to three words>] --product <product> | --parent <feature> [--status planned|building|live|retired] [--level <label>] [--owners <actor>]... [--summary <s>] [--links <key>]...',
      'pjman new project <slug> --title <t> [--product <product>] [--parent <project>] [--tracker <source-kind>] [--owners <actor>]... [--links <key>]...',
      'pjman new aspect <slug> --title <t> [--name <one to three words>] [--parent <aspect>] [--owners <actor>]... [--body <base>|-] [--links <key>]...',
      'pjman new place <aspect>/<place> --feature <feature> [--body <fork>|-] [--links <key>]...',
      'pjman new change <slug> --name <one to four words> --gist <one line> --origin <the request in the person\'s words, or the key it came from> --intent <the need, for whom> --done-when <the outcome that closes it>',
      '        [--scope …] [--open-questions …] [--blocked-on …] [--notes …] [--status open] [--project <key>] [--parent <change>] [--step <text>]...',
      '        [--features "adds feature:<slug>"]... [--aspects "changes aspect:<slug>"]... [--depends-on <change>]... [--owners <actor>]... [--binds <key>]... [--links <key>]...',
      '        [--kind bug --severity product|feature|capability|nuisance|cosmetic] [--kind milestone] [--target <date>]',
      'pjman new release <version> --at <timestamp> [--tag v<version>] [--level patch|minor|major] [--commit <sha>] [--url <u>] [--ships <change>]... [--links <key>]... [--body <notes>|-]',
      'pjman new source <kind>:<key> [--title <t>] [--url <u>] [--links <key>]... [--body <text>]',
      'pjman new actor person:<handle> | agent:<handle> [--name <n>] [--url <u>] [--links github-user:<login>]... [--links email:<address>]...',
      'pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>] [--started <ts>] [--project <key>]   (the bare record; pjman session start is the start)',
      'pjman new session-kind <slug> [--name <one to four words>] [--gist <one line>] [--links <key>]...   (review, backlog, chat and other come with the store; pjman session name creates one it is handed)',
    ],
    flags: {
      product: ['title', 'name', 'owners', 'levels', 'sequence', 'summary', 'links', 'body'],
      feature: ['title', 'name', 'product', 'parent', 'status', 'level', 'owners', 'summary', 'links', 'body'],
      project: ['title', 'product', 'parent', 'tracker', 'owners', 'links', 'body'],
      aspect: ['title', 'name', 'parent', 'owners', 'links', 'body'],
      place: ['feature', 'links', 'body'],
      change: CHANGE_NEW,
      decision: [],
      release: ['at', 'tag', 'level', 'commit', 'url', 'ships', 'links', 'body'],
      source: ['title', 'url', 'links', 'body'],
      actor: ['name', 'url', 'links', 'body'],
      session: ['agent', 'on-behalf-of', 'parent', 'started', 'project', 'body'],
      'session-kind': ['name', 'gist', 'links', 'body'],
    },
    retired: { change: { title: 'a change has no title: --name (one to four words) and --gist (one line)', summary: 'a change has no summary: its --intent opens with the need, its --gist is the line views show' } },
    elsewhere: { feature: 'a change names a node with --features "adds feature:<slug>"', product: 'a change belongs to the product of its --project' },
    args: 1 },
  { name: 'show', group: 'records', line: 'one record as it is stored', about: 'print one record by its key or slug, as it is stored (an aspect with every place it reaches; a place read through its aspect)',
    usage: ['pjman show <ref> [--json]'], flags: [], args: 1 },
  { name: 'ls', group: 'records', line: 'list records of an entity, filtered',
    about: 'list records, by entity, status, kind and where they sit: --project for a change\'s project, --product for anything under a product, --parent for a milestone\'s children or a feature\'s nodes, --feature for the changes naming a node or anything beneath it. A status or kind outside the vocabulary is refused. Bugs come worst first, then oldest',
    usage: ['pjman ls [product|feature|aspect|place|project|change|decision|release|source|session|session-kind|actor] [--status <s>] [--kind work|bug|milestone] [--project <key>] [--product <key>] [--parent <key>] [--feature <key>] [--json]', 'pjman ls session --kind <session kind>   (the sessions with no change given that kind)'],
    flags: ['status', 'kind', 'project', 'product', 'parent', 'feature'], args: 1 },
  { name: 'set', group: 'records', line: 'change authored fields on one record or several',
    about: "change authored fields on one or several records, one commit (pjman undo reverts it). field=value replaces (an empty value removes the field); on a list field (links, owners, binds, features, aspects, depends_on, levels, sequence) field+=item adds one item when absent and field-=item removes one; field=- reads one value from stdin. A change's sections are set by name: origin, intent, done-when, scope, open-questions, blocked-on, notes; a product's or feature's summary likewise; body sets an aspect's base or a place's fork whole. A decision's supersedes only adds, and marks each named decision superseded. A change's or decision's name and gist are the rungs views show; written from a changed foundation they are said to be stale until rewritten",
    usage: ['pjman set <ref>... <field>=<value> | <field>+=<item> | <field>-=<item> ...', 'pjman set <ref> <field>=- < file   (one value from stdin)'], flags: [],
    elsewhere: { step: 'a step is added with pjman step <change> add "…"', note: 'a note is pjman note <change> "…"; a step\'s note is pjman step <change> note <n> "…"', first: 'the order is moved with pjman order <change> --first' } },
  { name: 'rm', group: 'records', line: 'remove one record or several',
    about: "remove one or several records, one commit (a change takes its decisions with it). Refused while anything refers to one, naming each referrer; --detach drops the references that can be dropped (a key in a list, a parent, a superseded decision, an observed edge) in the same commit. A change's project, a writer or a session can never be dropped",
    usage: ['pjman rm <ref>... [--detach] [--json]'], flags: ['detach'] },
  { name: 'mv', group: 'records', line: 'rename a record; every reference follows',
    about: 'rename a product (every key beneath it follows), a feature or a change (the folder moves, the old slug stays as an alias; <product>/<slug> moves it to another product), an aspect or a place, a project (directories bound to it follow), a decision (within or across changes), a person (the old handle stays as an alias; the user config follows) or a session kind (every session carrying it follows; the old slug stays as an alias); every reference is rewritten in the same commit. Sources and sessions keep their keys, which are external; a release keeps its version, which is a fact',
    usage: ['pjman mv <kind>:<old> <kind>:<new>   (product, feature, aspect, place, project, change, decision, person, agent, session-kind)'], flags: [], args: 2 },
  { name: 'decision', group: 'records', line: 'write a decision at any size: create it, add to its thread, a person accepts or reopens it',
    about: "write a decision at any size, one commit: created when it does not exist (then --name, --gist, --question and one --option are required), added to otherwise. Its foundation is a thread of entries: the question, criteria, options with their case, the recommendation with its reasoning, the person's comments in their words (--on <id> when about one option), rejections, the acceptance (a person's, with their words and when to revisit), a reopening. Status, decider and date follow the thread. --from - takes {name, gist, entries:[{type, text, id, case, option, by, revisit}]} as JSON on stdin",
    usage: [
      'pjman decision <change>/<slug> --name <one to four words> --gist <one line> --question <text> [--criterion <text>]... --option <id>=<text>... [--case <id>=<points, one per line>]... [--recommend <id>[=<why>]] [--supersedes <decision>] [--links <key>]...',
      'pjman decision <ref> [--question <reframed>] [--option <id>=<text>]... [--comment <words> [--on <option id>] [--by person:<handle>]] [--reject <id>[=<why>]]... [--recommend <id>[=<why>]] [--name …] [--gist …]   (a comment without --by is the writer\'s own)',
      'pjman decision <key> --accept <id>[=<their words>] --by person:<handle> [--revisit <when to look again>]   (the person decides; an agent never does)',
      'pjman decision <key> --reopen [--comment <why>]',
      'pjman decision <key> --from -   (entries as JSON on stdin)',
    ],
    flags: ['name', 'gist', 'question', 'criterion', 'option', 'case', 'recommend', 'comment', 'on', 'reject', 'accept', 'revisit', 'reopen', 'by', 'supersedes', 'links', 'from'], args: 1 },
  { name: 'step', group: 'records', line: "a change's plan: add, start, done, drop, reopen, note, edit, move steps",
    about: "a change's plan, written only through commands: steps as data, each with a text, a state (open, active, done, dropped) and a note of where the work stands; every write is one commit and one event on the change. add takes several texts, each its own step, in one commit (--from - reads them one per line); edit rewrites a step's text; a step added in error is dropped, never removed. The next step (the active one, else the first open), the plan's progress and the active step's note are derived",
    usage: [
      'pjman step <change> add <text>... [--before <n>|--after <n>|--first|--last] [--note <text>]   (each quoted text a step)',
      'pjman step <change> add --from - [--before <n>|…]   (one step per line on stdin)',
      'pjman step <change> start|done|drop|reopen <n>... [--note <where the work stands>]   (several numbers: one commit)',
      'pjman step <change> note <n> <text>',
      'pjman step <change> edit <n> <text>',
      'pjman step <change> move <n> --before <m>|--after <m>|--first|--last',
    ],
    flags: { add: ['before', 'after', 'first', 'last', 'note', 'from'], start: ['note'], done: ['note'], drop: ['note'], reopen: ['note'], note: [], edit: [], move: ['before', 'after', 'first', 'last'] },
    args: { move: 2 }, subAt: 2 },
  { name: 'order', group: 'records', line: "the product's order, the roadmap: print it, or move a change in it",
    about: "the product's sequence, the roadmap's order. With a product (or nothing, inside a project), print it; with a change and a move, put it before or after another entry, first, last, or off the sequence (later). The rest of the order is never touched",
    usage: ['pjman order [<product>] [--json]', 'pjman order <change> --before <change> | --after <change> | --first | --last | --later'],
    flags: ['before', 'after', 'first', 'last', 'later'], args: 1 },
  { name: 'note', group: 'records', line: 'a note to whoever works a change, or to one running session',
    about: "a note to whoever works a change, or to one running session: one line under Notes on that record, given in full in the session's next brief; a session working the change, or the one addressed, is woken for it where its adapter can (pjman undo <commit> takes it back)",
    usage: ['pjman note <change|session:<id>> <text>'], flags: [] },
  { name: 'sync', group: 'records', line: "a tracker's tickets applied to the store: sources and the changes they bind",
    about: "apply a tracker's tickets to the store, as observed by whoever holds the connection (the harness's MCP session): each ticket becomes a source and the change that binds it; title, status and parent follow the ticket; everything pjman adds is kept. --from takes the issues as JSON, in whatever shape the tracker's tools answered",
    usage: ['pjman sync linear --from <file|-> [--project <key>] [--team <KEY>] [--json]', 'pjman sync github --from <file|-> [--project <key>] [--repo <owner/name>] [--json]', 'pjman sync github            (no --from: prints the gh command that reads the issues)'],
    flags: ['from', 'project', 'team', 'repo'], args: 1 },

  // ---- reading across the store -------------------------------------------------------------------------------------
  { name: 'context', group: 'reading', line: "what an agent reads first: the board, or one change in full",
    about: "what an agent reads first: this project's open changes (--all: every project; project:<slug>: that project), or one change with its decisions, sources and sessions; a product or a feature with its tree and activity",
    usage: ['pjman context [<change> | project:<slug> | product:<slug> | feature:<slug>] [--all] [--json]'], flags: ['all', 'project'], args: 1 },
  { name: 'get', group: 'reading', line: 'anything in (key, slug, ticket, URL, file): the record, its edges, the changes in reach',
    about: 'the getter: a key, a source key, a URL, a ticket id, a file path or a slug in; the record, every edge into and out of it, and the full context of every change within two hops out',
    usage: ['pjman get <ref> [--json]'], flags: [], args: 1 },
  { name: 'tree', group: 'reading', line: 'the product by its features, with derived status, owners and backlog',
    about: "the product tree: products, their features at every level (label from the template or the node), each with its authored and derived status, effective owners and the changes beneath it by status and project; a product also counts the open changes under its projects that name no feature",
    usage: ['pjman tree [<product>|<feature>] [--json]'], flags: [], args: 1 },
  { name: 'activity', group: 'reading', line: 'the events beneath any node and what they say about health',
    about: "the activity of a subtree: every event beneath a key (a product, feature, project or change, through every chain) in a window, with what it says about health: when it last moved, what got done, what is new, what is blocked, what waits on a person. A batch (pjman apply, a bulk set or rm, several steps added) is one entry",
    usage: ['pjman activity <ref> [--days 14] [--since <iso>] [--json]'], flags: ['days', 'since'], args: 1 },
  { name: 'intake', group: 'reading', line: 'what already exists for a request, before it is filed',
    about: "what already exists for a request, before it is filed: open changes that share its words or are named in it (duplicates), done ones like it, the nodes of the map it may alter with their path, the milestones in flight, the order's tail. Never writes; the intake skill answers its four questions from this",
    usage: ['pjman intake <text> [--json]', 'pjman intake - [--json]   (text on stdin)'], flags: [] },
  { name: 'refs', group: 'reading', line: 'every reference in a text and the change it leads to',
    about: "every reference in a text that resolves to something, in order, each with the change it leads to: change:<slug>, a URL, a ticket in any shape the store's source kinds know, an existing slug; the last mention is what a prompt is about. Never writes",
    usage: ['pjman refs <text> [--json]', 'pjman refs - [--json]   (text on stdin)'], flags: [] },
  { name: 'view', group: 'reading', line: 'one reference as a Markdown document',
    about: "one reference as a Markdown document, or the project's board without one; --out writes a file, --watch re-renders whenever the store changes. A session's view is the dashboard's: pjman open --session",
    usage: ['pjman view [<ref>] [--out <file>] [--watch]'], flags: ['out', 'watch'], args: 1 },
  { name: 'rest', group: 'reading', line: 'whether a stop on a change is one the record allows (exit 1 when not)',
    about: "where a change may rest: whether a stop on it is one the record allows, and why. It rests when a decision on it is proposed, a blocker is recorded (blocked-on, a dependency not done), a person set it blocked, review, done or dropped, or its plan has run to its end; with steps still open and none of those it does not rest, and the open steps are listed (exit 1). The adapter's stop hook reads this; never writes",
    usage: ['pjman rest <change> [--json]'], flags: [], args: 1 },
  { name: 'events', group: 'reading', line: "the store's event stream, one event per write",
    about: "the store's event stream: one event per write (seq, at, op, key, type, path, fields, writer, session, commit); --receipt says what the store received, one line per record, for a person; `rebuild` rewrites the stream from the store's git history",
    usage: ['pjman events [--since <seq>] [--session <key>] [--json]', 'pjman events --receipt [--since <seq>] [--session <key>] [--json]', 'pjman events rebuild'],
    flags: ['since', 'receipt'], args: 1 },
  { name: 'follow', group: 'reading', line: 'print events as they are appended',
    about: 'print events as they are appended, after --since (default: only new ones), until interrupted; what a view subscribes to',
    usage: ['pjman follow [--since <seq>] [--json]'], flags: ['since'], args: 0 },

  // ---- sessions -------------------------------------------------------------------------------------------------------
  { name: 'session', group: 'session', line: "a session's record: start it, log to it, bind it to a change, observe an edge",
    about: 'a session is a run of an agent, its record append-only: start creates it (unless it exists) with the start line, binds the change its branch names and returns the brief; log, bind, unbind, observe, focus and project append to it. unbind backs out a binding made in error (the change, the edges observed on it), logging that it did',
    usage: [
      'pjman session start <id> --agent <agent> --on-behalf-of <person> [--parent session:<id>] [--log <line>] [--branch <name>] [--full] [--no-host] [--json]',
      'pjman session log <id> <text>',
      'pjman session bind <id> <change> [--reason prompt|created|branch]',
      'pjman session unbind <id> <change>',
      'pjman session observe <id> <edge> <from> <to>',
      'pjman session focus <id> <change>   (what the session is looking at; pjman context <change> sets it for the session in PJMAN_SESSION)',
      'pjman session project <id> <project>   (a session that started outside any project, resolved to the one whose repository it works in)',
      'pjman session name <id> ["<name>"] [--kind <session kind>] [--json]   (a session with no change: what is not given is inferred from its own record; a kind the store lacks is created)',
    ],
    flags: { start: ['agent', 'on-behalf-of', 'parent', 'log', 'branch', 'full', 'no-host'], log: [], bind: ['reason'], unbind: [], observe: [], focus: [], project: [], name: ['kind'] },
    args: { start: 1, bind: 2, unbind: 2, observe: 4, focus: 2, project: 2, name: 2 } },
  { name: 'brief', group: 'session', line: 'what an agent needs in front of it, every session or since its last brief',
    about: "print the brief: what an agent needs in front of it every session (the adapter injects it; pjman init --brief claude-md writes it to ~/.claude/CLAUDE.md); with --session, what the store has for that session since its last brief: the bound change's context in full when the binding moved (or --full), else what changed on it, its milestone, its decisions and its dependency edges, without the session's own writes, one line per record, and the other live sessions near it; the brief records how far it reached and ends with its size",
    usage: ['pjman brief', 'pjman brief --session <id> [--full] [--json]'], flags: ['full'], args: 0 },
  { name: 'host', group: 'session', line: "the host a session runs in, asked for something: a label, text typed in, its block to the front, its program's status",
    about: "where a session runs (a terminal multiplexer: Rex, cmux), through the adapter for it; the session's record says which host from the environment its start ran in. label writes the change and where the work stands onto the session's block (`Rex adapter · 4/7`, `Rex adapter · waits: Adapter versioning`; --clear takes it off); send types text into it; open brings it to the front; status asks what the program reports; launch opens a session for a change on the host this machine runs, in the project's directory with the harness in the change's worktree. With no verb: the host this machine runs, its version, and whether the adapter validated that version",
    usage: ['pjman host [--json]', 'pjman host label [<session-id>] [--clear]', 'pjman host send [<session-id>] <text>', 'pjman host open [<session-id>]', 'pjman host status [<session-id>] [--json]', 'pjman host launch <change> [--json]'], flags: ['clear'] },
  { name: 'wakes', group: 'session', line: 'the events that wake a session',
    about: "the events that wake a session: a decision on its bound change set decided, a note on that change or on the session, by anyone but the session; --follow keeps printing them as they land, from the stream's tail (or --since), until the session's process ends",
    usage: ['pjman wakes --session <id> [--since <seq>] [--follow] [--json]'], flags: ['since', 'follow'], args: 0 },

  // ---- batches and history ------------------------------------------------------------------------------------------
  { name: 'apply', group: 'batch', line: 'many writes of any kind as one commit',
    about: "many writes as one commit: the commands one per line (new, set, decision, step, mv, rm, order, session, note; as typed after pjman), run in order with every commit held, then one commit and the events with it, closed by one 'applied' event on the record --for names (a decision that proposed a map, a change). A line that fails refuses the whole batch and nothing is written",
    usage: ['pjman apply [<file>|-] [--for <ref>]'], flags: ['for'], args: 1 },
  { name: 'undo', group: 'batch', line: 'revert the last batch, or the commit named',
    about: 'revert the last batch (or the commit named) as one commit, every record put back; refused while a later write touched a record of that batch',
    usage: ['pjman undo [<commit>]'], flags: [], args: 1 },

  // ---- the dashboard ------------------------------------------------------------------------------------------------
  { name: 'start', group: 'dashboard', line: 'start the dashboard and print its URL',
    about: 'the dashboard: install and build the app if the checkout has none, start the server detached if none is running, print its URL',
    usage: ['pjman start [--port <n>] [--open]'], flags: ['port', 'open'], args: 0 },
  { name: 'open', group: 'dashboard', line: "open the dashboard, at a session's page when one is named",
    about: "the dashboard brought back: started if none is running, opened at a session's page when one is named (--session, else PJMAN_SESSION), its front page otherwise; docked beside the terminal where the terminal can (cmux), in the default browser elsewhere",
    usage: ['pjman open [--session <id>]'], flags: [], args: 0 },
  { name: 'stop', group: 'dashboard', line: 'stop the dashboard', about: 'stop the dashboard server', usage: ['pjman stop'], flags: [], args: 0 },
  { name: 'serve', group: 'dashboard', line: 'the store over HTTP: the API under /api/v1 and the app',
    about: "the store over HTTP: the library's results as JSON under /api/v1 (records by key, the getter as /resolve, a session's view, a project's board, the event stream as server-sent events) and the bundled app; writes its address to ~/.pjman/serve.json while it runs. PORT from the environment when --port is absent; a checkout registers only with --register",
    usage: ['pjman serve [--port <n>] [--host <addr>] [--static <dir>] [--register|--no-register]'], flags: ['port', 'host', 'static', 'register', 'no-register'], args: 0 },

  // ---- setup --------------------------------------------------------------------------------------------------------
  { name: 'init', group: 'setup', line: 'the whole onboarding, in one command; again, the health check',
    about: "the whole onboarding: join the global store (~/.pjman/store, its own git repository), register this repository as a project under a product (one made with its name, or --product names an existing one), set the actor (a person keyed by their handle, holding their forge login and git email as accounts), ask whether the first session should propose a product map (--map or --no-map answers without asking), install the harness adapter found on the machine, start the dashboard, report; --in-project makes a store inside the repository instead (set aside; kept for a repository that must carry its own record). Run again, it is the health check",
    usage: ['pjman init [--name <project-name>] [--product <product>] [--map|--no-map] [--brief claude-md] [--no-adapter] [--no-start] [--port <n>] [--in-project]'],
    flags: ['name', 'product', 'map', 'no-map', 'brief', 'no-adapter', 'no-start', 'port', 'in-project'], args: 0 },
  { name: 'where', group: 'setup', line: 'the store this directory resolves to, its project and product',
    about: 'print the store this directory resolves to and its mode; --json adds the project, its product, its tracker and the actor', usage: ['pjman where [--json]'], flags: [], args: 0 },
  { name: 'whoami', group: 'setup', line: 'who you are: the person, their record, their accounts',
    about: "who you are: the configured person, their record and their accounts in order, the first of a handle kind as the primary one; from the store alone, no app asked. --verify asks each account kind's checker (GitHub through gh; a kind with no checker reports unchecked) and gives each account a verdict, verified, unknown or unchecked, with the answers cached for a day (--fresh asks again). What is off is said with the command that resolves it. Writes nothing",
    usage: ['pjman whoami [--verify] [--fresh] [--json]'], flags: ['verify', 'fresh'], args: 0 },

  // ---- maintenance --------------------------------------------------------------------------------------------------
  { name: 'validate', group: 'maintenance', line: 'check every record and every reference (exit 1 on errors)',
    about: 'check every record and every reference; errors are reported, never dropped (exit 1 on errors)', usage: ['pjman validate [--json]'], flags: [], args: 0 },
  { name: 'fmt', group: 'maintenance', line: 'rewrite records in canonical form',
    about: 'rewrite records in canonical form: field order, the YAML rule, repaired quoting (--check reports only, exit 1 when any differ)', usage: ['pjman fmt [--check]'], flags: ['check'], args: 0 },
  { name: 'lift', group: 'maintenance', line: 'move every change up to what its plan says, as one batch',
    about: "move every open, planning or active change up to what its plan says, as one batch (pjman undo reverts it): planning once it has a step, active once a step has started, review once every step is done. The same rule runs after every write; this is the backfill for a store written before it (--check lists the lifts only)",
    usage: ['pjman lift [--check]'], flags: ['check'], args: 0 },
  { name: 'migrate', group: 'maintenance', line: 'the one move the store still waits for',
    about: "the one move the store still waits for, one commit, one event, pjman undo <commit> reverts it: the layout (every product a folder holding its features and changes, keys under the product), the foundation (every change and decision mapped into its shape, nothing dropped, each marked migrated until it is next written), then the stamp (pjman.yaml names the format the store is in, so a store from a newer pjman is refused by an older one)",
    usage: ['pjman migrate'], flags: [], args: 0 },
  { name: 'index', group: 'maintenance', line: 'read every file again and rebuild index.db (exit 1 on conflicts)', about: 'read every file again (the index this machine keeps of the store is thrown away and rebuilt) and rebuild index.db: ids, reverse edges, conflicts (exit 1 on conflicts)', usage: ['pjman index [--json]'], flags: [], args: 0 },
  { name: 'query', group: 'maintenance', line: 'a read-only SQL query against the index', about: 'run a read-only SQL query against the index; the answer is JSON', usage: ['pjman query "<sql>"'], flags: [], args: 1 },
];

export const GROUP_TITLES: Record<Exclude<Group, 'records'>, string> = {
  reading: 'Reading across the store',
  session: 'Sessions',
  batch: 'Batches and history',
  dashboard: 'The dashboard',
  setup: 'Setup',
  maintenance: 'Maintenance',
};

/** An entity and its operations, each the command that does it. An operation that is absent by design says why. */
export interface Entity {
  name: string;
  what: string;
  ops: [op: string, how: string][];
}

export const ENTITIES: Entity[] = [
  { name: 'product', what: 'the root: the thing with a name and users', ops: [
    ['create', 'pjman new product <slug> --title <sentence> [--name …]'],
    ['read', 'pjman show <product> · pjman tree <product> · pjman context <product> · pjman activity <product>'],
    ['list', 'pjman ls product'],
    ['update', 'pjman set <product>... <field>=… | <list>+=<item> | <list>-=<item>'],
    ['order', 'pjman order [<product>]   (print the roadmap\'s order)'],
    ['rename', 'pjman mv product:<old> product:<new>   (every key beneath it follows)'],
    ['delete', 'pjman rm <product>'],
  ] },
  { name: 'feature', what: 'what the product does for a person; a capability is a feature beneath one, nesting', ops: [
    ['create', 'pjman new feature <slug> --title <sentence> [--name <one to three words>] --product <product> | --parent <feature>'],
    ['read', 'pjman show <feature> · pjman tree <feature> · pjman context <feature> · pjman activity <feature>'],
    ['list', 'pjman ls feature [--product <p>] [--parent <feature>] [--status …]'],
    ['update', 'pjman set <feature>... <field>=… | <list>+=<item> | <list>-=<item>'],
    ['rename', 'pjman mv feature:<old> feature:<new>   (the old slug stays an alias)'],
    ['delete', 'pjman rm <feature>... [--detach]'],
  ] },
  { name: 'project', what: 'where the code lives: one or more repositories, attached to a product', ops: [
    ['create', 'pjman new project <slug> --title <t> --product <product>   (pjman init registers a repository as one)'],
    ['read', 'pjman context project:<slug> · pjman show project:<slug>'],
    ['list', 'pjman ls project [--product <p>]'],
    ['update', 'pjman set project:<slug> <field>=… | <list>+=<item> | <list>-=<item>'],
    ['rename', 'pjman mv project:<old> project:<new>'],
    ['delete', 'pjman rm project:<slug>   (refused while changes are in it)'],
  ] },
  { name: 'aspect', what: 'what applies across the product (how text reads, a shared component), with a base; a place is where it applies, with its fork', ops: [
    ['create', 'pjman new aspect <slug> --title <t> [--body -] · pjman new place <aspect>/<place> --feature <feature> [--body -]'],
    ['read', 'pjman show aspect:<slug> (the base and every place) · pjman show aspect:<aspect>/<place> (read there)'],
    ['list', 'pjman ls aspect · pjman ls place'],
    ['update', 'pjman set aspect:<slug> body=- < base.md · pjman set aspect:<aspect>/<place> body=- < fork.md'],
    ['rename', 'pjman mv aspect:<old> aspect:<new> · pjman mv aspect:<a>/<old> aspect:<a>/<new>'],
    ['delete', 'pjman rm aspect:<slug> · pjman rm aspect:<aspect>/<place>'],
  ] },
  { name: 'change', what: 'a unit of work: name, gist, sections, a plan of steps; a milestone is a change of kind milestone, whose plan is its children', ops: [
    ['create', 'pjman new change <slug> --name … --gist … --origin … --intent … --done-when … [--step <text>]...'],
    ['read', 'pjman context <change> (to work it) · pjman show <change> (as stored) · pjman get <ref> (with its neighbourhood) · pjman view <change>'],
    ['list', 'pjman ls change [--status …] [--kind bug|milestone] [--parent <milestone>] [--feature <node>] [--project <p>] · pjman context (the board)'],
    ['update', 'pjman set <change>... <field>=… | <list>+=<item> | <list>-=<item>   (sections by name: origin, intent, done-when, scope, …)'],
    ['plan', 'pjman step <change> add|start|done|drop|reopen|note|edit|move …   (see step)'],
    ['order', 'pjman order <change> --before <change> | --after <change> | --first | --last | --later'],
    ['note', 'pjman note <change> <text>   (to whoever works it)'],
    ['rename', 'pjman mv change:<old> change:<new>   (the old slug stays an alias)'],
    ['delete', 'pjman rm <change>... [--detach]   (takes its decisions with it)'],
    ['bulk', 'pjman sync linear|github --from -   (tickets to changes) · pjman apply'],
  ] },
  { name: 'step', what: "one step of a change's plan: a text, a state (open, active, done, dropped), a note", ops: [
    ['create', 'pjman step <change> add <text>... [--before <n>|--after <n>|--first|--last]   (several quoted texts, or --from -: one commit)'],
    ['read', "pjman context <change>   (the plan, with the next step)"],
    ['update', 'pjman step <change> start|done|drop|reopen <n>... [--note …] · note <n> <text> · edit <n> <text> · move <n> --before <m>'],
    ['delete', 'pjman step <change> drop <n>   (kept as dropped: the plan keeps its history)'],
  ] },
  { name: 'decision', what: 'what was chosen and why: an append-only thread a person decides', ops: [
    ['create', 'pjman decision <change>/<slug> --name … --gist … --question … --option <id>=… --recommend <id>=…'],
    ['read', 'pjman show <decision> · pjman context <change>   (its decisions in full)'],
    ['list', 'pjman ls decision [--status proposed|decided|superseded|reverted] [--parent <change>]   (--status proposed: what waits on a person)'],
    ['update', 'pjman decision <key> --option|--comment|--reject|--recommend … · --accept <id> --by person:<handle> · --reopen · pjman set <decision> name|gist|links|supersedes'],
    ['rename', 'pjman mv decision:<change>/<old> decision:<change>/<new>'],
    ['delete', 'pjman rm <decision>'],
    ['bulk', 'pjman decision <key> --from -   (entries as JSON)'],
  ] },
  { name: 'source', what: 'something outside the store, by key: a ticket, a PR, a branch, a doc, a file, a URL', ops: [
    ['create', 'pjman new source <kind>:<key> [--title …] [--url …] · pjman sync linear|github · --links <key> on any record (no record needed)'],
    ['read', 'pjman get <ref> · pjman show <kind>:<key>'],
    ['list', 'pjman ls source'],
    ['update', 'pjman set <kind>:<key> title=… url=… links+=…'],
    ['rename', '— (its key is the outside thing\'s)'],
    ['delete', 'pjman rm <kind>:<key> [--detach]'],
  ] },
  { name: 'actor', what: 'a person or an agent, with their accounts', ops: [
    ['create', 'pjman new actor person:<handle> | agent:<handle> [--links github-user:<login>]...   (pjman init makes yours)'],
    ['read', 'pjman whoami [--verify] · pjman show person:<handle>'],
    ['list', 'pjman ls actor'],
    ['update', 'pjman set person:<handle> name=… links+=email:<address>'],
    ['rename', 'pjman mv person:<old> person:<new>   (the old handle stays an alias)'],
    ['delete', 'pjman rm person:<handle>   (refused while it wrote anything)'],
  ] },
  { name: 'session', what: 'a run of an agent on behalf of a person: append-only', ops: [
    ['create', 'pjman session start <id> --agent <agent> --on-behalf-of <person>   (the adapter does it)'],
    ['read', 'pjman show session:<id> · pjman brief --session <id> · pjman open --session <id>'],
    ['list', 'pjman ls session'],
    ['update', 'pjman session log|bind|unbind|observe|focus|project <id> … · pjman session name <id> ["…"] [--kind <kind>]   (a session with no change: its name and kind, inferred from its record when not given) · pjman note session:<id> <text>'],
    ['rename', '— (its id is the harness\'s)'],
    ['delete', 'pjman rm session:<id>   (refused while anything was written in it)'],
  ] },
  { name: 'session-kind', what: 'what a session with no change is doing: review, backlog, chat, other, or one a person made', ops: [
    ['create', 'pjman new session-kind <slug> [--name …] [--gist …]   (the four come with the store; pjman session name --kind <new> creates one)'],
    ['read', 'pjman show session-kind:<slug> · pjman get session-kind:<slug>   (the sessions given it)'],
    ['list', 'pjman ls session-kind · pjman ls session --kind <slug>'],
    ['update', 'pjman set session-kind:<slug> name=… gist=… links+=…'],
    ['rename', 'pjman mv session-kind:<old> session-kind:<new>   (every session carrying it follows; the old slug stays an alias)'],
    ['delete', 'pjman rm session-kind:<slug>   (refused while a session carries it)'],
  ] },
  { name: 'release', what: 'a version the product shipped', ops: [
    ['create', 'pjman new release <version> --at <timestamp> [--ships <change>]...   (npm run release writes it)'],
    ['read', 'pjman show release:<version>'],
    ['list', 'pjman ls release [--product <p>]'],
    ['update', 'pjman set release:<version> url=… links+=…   (the version, tag and what it ships are facts)'],
    ['rename', '— (a version is a fact)'],
    ['delete', 'pjman rm release:<version>'],
  ] },
];

/** The command a name names, or undefined. */
export function commandOf(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** The flags a command takes, given its positionals (the subcommand picks them where they differ); null for a
 *  subcommand it does not have, which the command itself refuses. */
export function flagsFor(cmd: Command, sub: string | undefined): string[] | null {
  if (Array.isArray(cmd.flags)) return cmd.flags;
  if (sub === undefined) return [...new Set(Object.values(cmd.flags).flat())];
  return cmd.flags[sub] ?? null;
}

/** The most positionals a command takes after its name (and its subcommand), or undefined for no limit. */
export function argsFor(cmd: Command, sub: string | undefined): number | undefined {
  if (cmd.args === undefined || typeof cmd.args === 'number') return cmd.args;
  return sub === undefined ? undefined : cmd.args[sub];
}

const wrapOps = (e: Entity, indent: string): string[] => e.ops.map(([op, how]) => `${indent}${op.padEnd(8)}${how}`);

/** One entity's section: what it is, then a row per operation. */
export function entityHelp(e: Entity): string {
  return [`${e.name} — ${e.what}`, ...wrapOps(e, '  ')].join('\n');
}

/** The commands an entity's rows use, for the pointer to each in full. */
const commandsOf = (e: Entity): string[] => [...new Set(e.ops.flatMap(([, how]) => [...how.matchAll(/pjman ([a-z]+)/g)].map((m) => m[1]!)))].filter((c) => commandOf(c));

/** `pjman --help`: the entities with their operations, then every other command one line each. */
export function overview(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  const lines = [
    'pjman — the project\'s record, kept by agents: changes, decisions, the product tree, sessions',
    '',
    'usage: pjman <command> [<args>] [<flags>]   ·   pjman help <entity|command> for one in full',
    '',
    'Records, by entity (the verbs new, show, ls, set, rm and mv work on every one)',
    '',
    ...ENTITIES.flatMap((e) => [entityHelp(e), '']),
  ];
  for (const [group, title] of Object.entries(GROUP_TITLES)) {
    lines.push(title);
    for (const c of COMMANDS.filter((x) => x.group === group)) lines.push(`  ${c.name.padEnd(width)}${c.line}`);
    lines.push('');
  }
  lines.push(GLOBAL_HELP);
  return lines.join('\n');
}

export const GLOBAL_HELP = `global flags: --store <path>  --writer <actor>  --session <session>  --created <date>  --json  --help  --version
environment:  PJMAN_STORE  PJMAN_WRITER  PJMAN_SESSION  PJMAN_HOME
exit codes:   0 ok · 1 refused or not found · 2 usage; with --json an error is {"error":{"code","message","tried"?}} on stdout`;

/** One command in full: its usage lines and what it does. */
export function commandHelp(c: Command): string {
  return `usage:\n${c.usage.map((u) => `  ${u}`).join('\n')}\n      ${c.about}`;
}

/** `pjman help <name>`: an entity's section, a command in full, or both when the name is both. */
export function helpFor(name: string): string | null {
  const e = ENTITIES.find((x) => x.name === name || `${x.name}s` === name);
  const c = commandOf(name);
  if (!e && !c) return null;
  const more = e ? `every flag of each, in full: ${commandsOf(e).filter((x) => x !== c?.name).map((x) => `pjman help ${x}`).join(' · ')}` : null;
  return [e ? entityHelp(e) : null, c ? commandHelp(c) : null, more].filter(Boolean).join('\n\n') + `\n\n${GLOBAL_HELP}`;
}

/** The command section of docs/reference.md, generated: the entities as tables, then the other commands. */
export function referenceMarkdown(): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const out: string[] = ['Every record is one of these entities. The verbs `new`, `show`, `ls`, `set`, `rm` and `mv` work on all of them; an entity with operations of its own (a change\'s plan, a decision\'s thread, a session\'s log) has its own command. A dash says an operation is absent by design, and why.', ''];
  for (const e of ENTITIES) {
    out.push(`### ${e.name}`, '', `${e.what[0].toUpperCase()}${e.what.slice(1)}.`, '', '| operation | command |', '|---|---|');
    for (const [op, how] of e.ops) out.push(`| ${op} | \`${cell(how)}\` |`);
    out.push('');
  }
  for (const [group, title] of Object.entries(GROUP_TITLES)) {
    out.push(`### ${title}`, '');
    for (const c of COMMANDS.filter((x) => x.group === group)) out.push(`- \`pjman ${c.name}\`: ${c.line}`);
    out.push('');
  }
  out.push('### Every command in full', '', '```');
  for (const c of COMMANDS) out.push(...c.usage, `    ${c.about}`, '');
  out.push('```', '', '```', GLOBAL_HELP, '```');
  return out.join('\n');
}
