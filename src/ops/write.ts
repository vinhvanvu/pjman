import fs from 'node:fs';
import path from 'node:path';
import { readUserConfig, type Store } from '../store/config.js';
import { stringifyRecord } from '../store/frontmatter.js';
import { emit, type EventInput } from '../store/events.js';
import { commitAll } from '../store/git.js';
import { FIELD_ORDER, fullKey, loadStore, type Loaded, type Problem, type RecordType } from '../store/records.js';
import { CliError } from '../store/util.js';
import { formatProblems, validate } from '../model/validate.js';
import { liftAfter } from './lift.js';
import { indexedEntries, notePending } from '../store/store-index.js';

export interface Envelope {
  writer?: string;
  session?: string;
}

/** The writer and session the tool stamps on records it creates: flags, then environment, then the user config. */
export function envelope(flags: { writer?: string; session?: string }): Envelope {
  const writer = flags.writer || process.env.PJMAN_WRITER || readUserConfig().actor;
  const session = flags.session || process.env.PJMAN_SESSION;
  return { writer: writer || undefined, session: session || undefined };
}

export function render(type: RecordType, data: Record<string, unknown>, body: string): string {
  return stringifyRecord(data, body, FIELD_ORDER[type]);
}

export function writeFile(store: Store, rel: string, text: string): void {
  const abs = path.join(store.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** Validate the whole store and return the errors that touch the given paths. */
export function errorsAt(store: Store, rels: string[]): Problem[] {
  // written and not yet in the stream: the index reads them again whatever it holds
  notePending(store, rels);
  const loaded = loadStore(store);
  const set = new Set(rels);
  return validate(loaded, { only: set }).filter((p) => p.level === 'error');
}

/** The text of each existing path, taken before a write so a refusal can put it back. */
export function snapshot(store: Store, rels: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of rels) {
    const abs = path.join(store.root, rel);
    if (fs.existsSync(abs)) out.set(rel, fs.readFileSync(abs, 'utf8'));
  }
  return out;
}

/** Validate after a write; on errors undo the listed new paths, put the snapshotted ones back, and throw. */
export function validateOrUndo(store: Store, rels: string[], created: string[], prior: Map<string, string> = new Map()): void {
  const errors = errorsAt(store, rels);
  if (errors.length === 0) return;
  for (const [rel, text] of prior) fs.writeFileSync(path.join(store.root, rel), text);
  for (const rel of created) {
    const abs = path.join(store.root, rel);
    fs.rmSync(abs, { force: true });
    let dir = path.dirname(abs);
    while (dir !== store.root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  settleIndex(store, [...rels, ...created, ...prior.keys()]);
  throw new CliError(`refused: the record would not validate\n${formatProblems(errors)}`);
}

/** Bring the index back to the files a refusal put back (change:refused-write-leaves-index-entry). Validating read
 *  the written files into the index; the undo leaves no event and no commit, so another process would trust what the
 *  index holds and read a record that is not there, or one as the refused write had it. Naming the paths (or a
 *  process that noted it reshapes, which compares every file) makes this read compare them and drop what is gone. */
export function settleIndex(store: Store, rels: Iterable<string> = []): void {
  if (process.env.PJMAN_INDEX === '0') return;
  notePending(store, rels);
  try {
    indexedEntries(store);
  } catch {
    // an index that cannot be opened is not read either: the files answer
  }
}

let batch: EventInput[] | null = null;

/** Hold every commit and event from here until endBatch: the writes of one batch land in one commit (pjman apply). */
export function beginBatch(): void {
  batch = [];
}

/** The events held since beginBatch, in order; the batch ends. */
export function endBatch(): EventInput[] {
  const held = batch ?? [];
  batch = null;
  return held;
}

/** In standalone mode the tool commits after every write it makes; in-project, the project's workflow does. */
export function commitIfStandalone(store: Store, message: string, session?: string): string | null {
  if (store.mode !== 'standalone') return null;
  return commitAll(store.root, message, session);
}

/** The end of every write: commit (standalone), then one event per record written, carrying the commit, then the status
 *  lift those events call for. */
export function finishWrite(store: Store, message: string, session: string | undefined, events: EventInput[]): string | null {
  if (batch) {
    notePending(store, events.map((e) => e.path));
    batch.push(...events.map((e) => ({ ...e, session: e.session ?? session })));
    liftAfter(store, events, session);
    return null;
  }
  const commit = commitIfStandalone(store, message, session);
  emit(store, events.map((e) => ({ ...e, session: e.session ?? session })), commit);
  // the status lift: a write that moves a change's plan or its work forward moves its status, as writes of its own
  liftAfter(store, events, session);
  return commit;
}

/** The fields of each record type that hold keys of records (sources stay as written). */
const KEY_FIELDS: Record<RecordType, string[]> = {
  product: ['sequence', 'owners'],
  feature: ['product', 'parent', 'owners'],
  aspect: ['parent', 'owners'],
  place: ['feature'],
  project: ['product', 'parent', 'owners'],
  change: ['project', 'parent', 'depends_on', 'features', 'aspects', 'owners'],
  decision: ['supersedes', 'decided_by'],
  release: ['ships'],
  source: [],
  session: ['changes', 'parent', 'project', 'agent', 'on_behalf_of', 'kind'],
  'session-kind': [],
  actor: [],
};

/** Rewrite the keys in `field` (or every key field when none is named) to their full form, resolved in `scope`: the
 *  store holds full keys; the short form is for people and the places that show them. A key that resolves to nothing
 *  is left as written, for validation to refuse. */
export function fullKeys(loaded: Loaded, type: RecordType, data: Record<string, unknown>, field: string | undefined, scope: string | null): void {
  const full = (raw: string): string => {
    const m = /^(adds|changes|removes)\s+(\S+)$/.exec(raw);
    if (m) return `${m[1]} ${fullKey(loaded, m[2], scope)}`;
    return fullKey(loaded, raw, scope);
  };
  for (const f of KEY_FIELDS[type]) {
    if (field && f !== field) continue;
    const v = data[f];
    if (typeof v === 'string') data[f] = full(v);
    else if (Array.isArray(v)) data[f] = v.map((x) => (typeof x === 'string' ? full(x) : x));
  }
}
