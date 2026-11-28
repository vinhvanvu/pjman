// Test helpers that file a change or a decision in the foundation's shape from the few words a test has: a title
// becomes the gist, a summary the Intent, and the rungs and sections the shape requires are filled with plain
// stand-ins. A test that cares about a field passes it in the new shape; these keep the rest short.
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Store } from '../store/config.js';
import { newRecord, type NewFlags, type NewResult } from '../ops/new.js';
import { decision as writeDecision, type DecisionResult, type EntryInput } from '../ops/decision.js';
import { step } from '../ops/step.js';

export interface ChangeFlags extends Omit<NewFlags, 'summary'> {
  /** The gist; the name is cut from the slug when none is given. */
  title?: string;
  /** The Intent. */
  summary?: string;
  /** The first step of the plan. */
  next?: string;
}

export function nameFromSlug(ident: string): string {
  const slug = ident.replace(/^change:/, '').replace(/^.*\//, '');
  return slug.split('-').filter(Boolean).slice(0, 4).join(' ') || 'it';
}

/** A name from a title when it is short enough to be one, else from the slug. */
function nameOf(title: string | undefined, ident: string): string {
  const words = title?.trim().split(/\s+/).filter(Boolean) ?? [];
  return words.length >= 1 && words.length <= 4 ? words.join(' ') : nameFromSlug(ident);
}

/** The next step of a change's plan: one step added. */
export function next(store: Store, key: string, text: string, opts: { session?: string; writer?: string } = {}): void {
  step(store, key, 'add', undefined, { text, ...opts });
}

/** A proposed decision accepted by a person. */
export function accept(store: Store, key: string, by: string, on?: string): DecisionResult {
  return writeDecision(store, key, {
    entries: [{ type: 'accept', option: 'it', by, at: on ? `${on}T12:00:00.000Z` : undefined }],
  });
}

export function change(store: Store, ident: string, flags: ChangeFlags = {}): NewResult {
  const { title, summary, next, ...rest } = flags;
  const r = newRecord(store, 'change', ident, {
    name: rest.name ?? nameOf(title, ident),
    gist: rest.gist ?? title ?? nameFromSlug(ident),
    origin: rest.origin ?? 'asked for in a test',
    intent: rest.intent ?? summary ?? title ?? 'what the test needs',
    doneWhen: rest.doneWhen ?? 'the test passes',
    ...rest,
  });
  if (next) step(store, r.key, 'add', undefined, { text: next, session: flags.session, writer: flags.writer });
  return r;
}

export interface DecisionFlags {
  title?: string;
  name?: string;
  gist?: string;
  decision?: string;
  why?: string;
  decidedBy?: string;
  decidedOn?: string;
  status?: string;
  supersedes?: string;
  links?: string[];
  created?: string;
  session?: string;
  writer?: string;
}

/** A decision with one option, recommended; accepted by `decidedBy` when given. */
export function decisionRec(store: Store, ident: string, flags: DecisionFlags = {}): DecisionResult {
  const name = flags.name ?? nameOf(flags.title, ident.replace(/^decision:/, ''));
  const gist = flags.gist ?? flags.title ?? name;
  const entries: EntryInput[] = [
    { type: 'question', text: flags.title ?? gist },
    { type: 'option', id: 'it', text: flags.decision ?? gist, case: flags.why },
    { type: 'recommendation', option: 'it', text: flags.why },
  ];
  // decided with no decider named: the writer accepts, which the tool refuses for an agent, as the old shape did
  if (flags.decidedBy || flags.status === 'decided')
    entries.push({
      type: 'accept',
      option: 'it',
      by: flags.decidedBy ?? flags.writer ?? 'person:tester',
      at: flags.decidedOn ? `${flags.decidedOn}T12:00:00.000Z` : undefined,
    });
  return writeDecision(store, ident, {
    name,
    gist,
    entries,
    supersedes: flags.supersedes,
    links: flags.links,
    created: flags.created,
    session: flags.session,
    writer: flags.writer,
  });
}

/** Another process holding the store's lock until the returned release is called; resolves once it holds it. Writes
 *  in this process give up after `waitMs` while it holds. */
export async function holdLock(root: string, waitMs = 300): Promise<() => Promise<void>> {
  const lockJs = path.resolve(import.meta.dirname, '..', 'store', 'lock.js');
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { lockStore } from ${JSON.stringify(lockJs)}; lockStore(${JSON.stringify(root)}); process.stdout.write('held\\n'); setTimeout(() => {}, 60000);`,
    ],
    { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await new Promise<void>((res) => child.stdout.once('data', () => res()));
  const was = process.env.PJMAN_LOCK_WAIT_MS;
  process.env.PJMAN_LOCK_WAIT_MS = String(waitMs);
  return async () => {
    if (was === undefined) delete process.env.PJMAN_LOCK_WAIT_MS;
    else process.env.PJMAN_LOCK_WAIT_MS = was;
    child.kill();
    await new Promise((res) => child.once('exit', res));
  };
}
