// pjman apply: many writes as one commit. The commands come one per line, as they would be typed after `pjman`; the
// tool runs them in order with every commit and event held, then commits once and emits the held events with that
// commit, closed by one `applied` event naming what the batch was for. A line that fails refuses the whole batch:
// the store is put back as it was. pjman undo reverts a batch as one commit, refused while a later write touched a
// record the batch changed.
import type { Store } from '../store/config.js';
import { emit, keyOfPath, typeOfPath, type EventInput } from '../store/events.js';
import { commitAll, git } from '../store/git.js';
import { loadStore, resolve, type RecordType } from '../store/records.js';
import { CliError, notFound } from '../store/util.js';
import { beginBatch, endBatch, envelope, settleIndex } from './write.js';
import { noteReshaping } from '../store/store-index.js';

/** The commands a batch may hold: writes to records, nothing that starts a server, reads, or nests. */
export const BATCH_COMMANDS = ['new', 'set', 'decision', 'step', 'mv', 'rm', 'order', 'session', 'note'] as const;

export interface ApplyResult {
  lines: number;
  writes: number;
  for?: string;
  commit: string | null;
}

export interface UndoResult {
  reverted: string;
  subject: string;
  for?: string;
  files: number;
  commit: string | null;
}

/** Split one line as a shell would: whitespace separates, single and double quotes group, a backslash escapes; inside
 *  double quotes `\n` is a line break. */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      // inside double quotes \n is a line break, so one line can carry a multi-line text (an aspect's base, a fork)
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i] === 'n' ? '\n' : line[i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (quote) throw new CliError(`unclosed ${quote} quote`);
  if (has || cur) out.push(cur);
  return out;
}

/** The lines of a batch as argv lists: blank lines and # comments dropped, a leading `pjman` dropped. */
export function parseBatch(text: string): { line: number; argv: string[] }[] {
  const out: { line: number; argv: string[] }[] = [];
  text.split('\n').forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith('#')) return;
    let argv: string[];
    try {
      argv = splitLine(s);
    } catch (e) {
      throw new CliError(`line ${i + 1}: ${(e as Error).message}`);
    }
    if (argv[0] === 'pjman') argv.shift();
    if (!argv.length) return;
    if (!(BATCH_COMMANDS as readonly string[]).includes(argv[0]!)) {
      throw new CliError(`line ${i + 1}: '${argv[0]}' does not go in a batch (${BATCH_COMMANDS.join(', ')} do)`);
    }
    out.push({ line: i + 1, argv });
  });
  return out;
}

function requireStandalone(store: Store, what: string): void {
  if (store.mode !== 'standalone') throw new CliError(`${what} needs a store the tool commits (the global store); an in-project store takes the commands one by one`);
}

function requireClean(store: Store): void {
  const dirty = git(store.root, ['status', '--porcelain', '--', '.']);
  if (dirty) throw new CliError(`the store has uncommitted changes; commit or discard them first:\n${dirty}`);
}

const forOf = (store: Store, key: string | undefined): { key: string; type: RecordType | 'store' } => {
  if (!key) return { key: 'store', type: 'store' };
  const res = resolve(loadStore(store), key);
  if (res.status !== 'ok' && res.status !== 'alias') throw notFound(`--for ${key}`);
  return { key: res.rec.key, type: res.rec.type };
};

/** Run every line through `run` (the CLI's own dispatcher) with commits held; one commit and the events at the end. */
export function apply(store: Store, text: string, run: (argv: string[]) => void, opts: { for?: string; session?: string; writer?: string } = {}): ApplyResult {
  return applyLines(store, parseBatch(text), run, opts);
}

/** A batch already split into argv lists: one commit, as apply makes one. A bulk set or rm builds its lines here. */
export function applyLines(store: Store, lines: { line: number; argv: string[] }[], run: (argv: string[]) => void, opts: { for?: string; session?: string; writer?: string } = {}): ApplyResult {
  noteReshaping(store);
  requireStandalone(store, 'apply');
  requireClean(store);
  if (!lines.length) throw new CliError('the batch is empty');
  const target = forOf(store, opts.for);
  const env = envelope(opts);
  const head = git(store.root, ['rev-parse', 'HEAD']);
  beginBatch();
  for (const { line, argv } of lines) {
    try {
      run(argv);
    } catch (e) {
      endBatch();
      git(store.root, ['reset', '-q', '--hard', head]);
      git(store.root, ['clean', '-qfd', '--', '.']);
      settleIndex(store);
      throw new CliError(`refused at line ${line} (${argv.join(' ')}): ${(e as Error).message}\nnothing was written`);
    }
  }
  const held = endBatch();
  if (!held.length) return { lines: lines.length, writes: 0, for: opts.for ? target.key : undefined, commit: null };
  const subject = `pjman: apply ${held.length} writes${opts.for ? ` for ${target.key}` : ''}`;
  const commit = commitAll(store.root, subject, env.session, opts.for ? { 'Pjman-For': target.key } : {});
  const closing: EventInput = { op: 'applied', key: target.key, type: target.type, path: 'pjman.yaml', fields: [`${held.length} writes`], writer: env.writer, session: env.session };
  emit(store, [...held, closing], commit);
  return { lines: lines.length, writes: held.length, for: opts.for ? target.key : undefined, commit };
}

/** Revert one batch (the last, or the commit named) as one commit; refused while a later commit touched its records. */
export function undo(store: Store, opts: { commit?: string; session?: string; writer?: string } = {}): UndoResult {
  noteReshaping(store);
  requireStandalone(store, 'undo');
  requireClean(store);
  const root = store.root;
  let sha: string;
  if (opts.commit) {
    try {
      sha = git(root, ['rev-parse', '--verify', `${opts.commit}^{commit}`]);
    } catch {
      throw new CliError(`${opts.commit} is not a commit of the store`);
    }
  } else {
    // the last batch not already undone: an undo names what it reverted in its Pjman-Undoes trailer
    const undone = new Set(git(root, ['log', '--format=%(trailers:key=Pjman-Undoes,valueonly)', '--grep=^pjman: undo ']).split('\n').map((l) => l.trim()).filter(Boolean));
    const batches = git(root, ['log', '--format=%H', '--grep=^pjman: apply ']).split('\n').filter(Boolean);
    sha = batches.find((b) => !undone.has(b)) ?? '';
    if (!sha) throw new CliError('no batch left to undo (pjman undo <commit> reverts any one write)');
  }
  const subject = git(root, ['log', '-1', '--format=%s', sha]);
  const forKey = git(root, ['log', '-1', '--format=%(trailers:key=Pjman-For,valueonly)', sha]).trim() || undefined;
  const files = git(root, ['show', '--name-only', '--format=', sha]).split('\n').filter(Boolean);
  const later = git(root, ['log', '--format=%h %s', `${sha}..HEAD`, '--', ...files]).split('\n').filter(Boolean);
  if (later.length) {
    throw new CliError(`refused: ${later.length} later write${later.length === 1 ? '' : 's'} touched a record of ${sha.slice(0, 7)} (${subject}); undo those first, or set the records by hand\n${later.map((l) => `  ${l}`).join('\n')}`);
  }
  try {
    git(root, ['revert', '--no-commit', sha]);
  } catch (e) {
    try {
      git(root, ['revert', '--abort']);
    } catch {
      // nothing to abort
    }
    throw new CliError(`the revert does not apply cleanly: ${(e as Error).message.split('\n')[0]}`);
  }
  const env = envelope(opts);
  const short = sha.slice(0, 7);
  const commit = commitAll(root, `pjman: undo ${short} (${subject})`, env.session, forKey ? { 'Pjman-For': forKey, 'Pjman-Undoes': sha } : { 'Pjman-Undoes': sha });
  const rows = git(root, ['show', '--name-status', '--format=', 'HEAD']).split('\n').filter(Boolean).map((r) => r.split('\t')).map(([status, a, b]) => ({ status: status!, p: b ?? a! }));
  const events: EventInput[] = [];
  for (const { status, p } of rows) {
    const type = typeOfPath(p);
    if (!type) continue;
    const key = keyOfPath(p, type, root, status.startsWith('D') ? 'HEAD^' : 'HEAD');
    events.push({ op: status.startsWith('D') ? 'removed' : status.startsWith('A') ? 'created' : 'set', key, type, path: p, fields: status.startsWith('M') ? ['reverted'] : undefined, writer: env.writer, session: env.session });
  }
  const target = forOf(store, forKey);
  events.push({ op: 'reverted', key: target.key, type: target.type, path: 'pjman.yaml', fields: [short], writer: env.writer, session: env.session });
  emit(store, events, commit);
  return { reverted: short, subject, for: forKey, files: rows.length, commit };
}
