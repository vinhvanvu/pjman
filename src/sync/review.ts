// pjman review <change> (change:pjman-review): the review is pjman's own. The person's agent judges a change's branch
// against what only pjman holds, the change's done-when and the decisions accepted on it; this command hands it that
// brief and takes what it finds. A finding is data on the change (model/findings.ts). In a project that opted in to
// Entire each finding is also filed onto the change's Trail (`entire trail finding add`), where the Findings gate holds
// the merge until it is resolved, and resolving or dismissing it here is told to Entire too; with no Entire the review
// is local and the findings stand on the change alone. Filing may be left pending: the next review or sync files it.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { entireOn, runEntire, type EntireOpts } from '../entire/entire.js';
import {
  FINDING_KINDS,
  FINDING_SEVERITIES,
  findingsOf,
  formatFinding,
  holdsMerge,
  type Finding,
  type FindingKind,
  type FindingSeverity,
  type FindingState,
} from '../model/findings.js';
import { decisionState, nameProblem, stepsOf, threadOf } from '../model/foundation.js';
import {
  loopOf,
  lensesAsked,
  loopWords,
  passOf,
  REVIEW_LENSES,
  reviewMode,
  roundsOf,
  type Loop,
  type ReviewLens,
  type ReviewMode,
  type Round,
} from '../model/review.js';
import { newChange } from '../ops/new.js';
import { step } from '../ops/step.js';
import { live } from '../model/tree.js';
import { MOVED_SINCE, observedBranches } from '../model/view.js';
import { localHeads } from '../store/merged.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo } from '../ops/write.js';
import { withStoreLock } from '../store/lock.js';
import type { Store } from '../store/config.js';
import { git } from '../store/git.js';
import { loadStore, resolve, unresolvedError, type Loaded, type Rec } from '../store/records.js';
import { CliError, nowIso, usageError } from '../store/util.js';
import { baseBranch, branchesOf } from './git.js';
import { noTrailWhy, reconcileTrail, trailLines, trailOf } from './trail.js';

const tryGit = (cwd: string, args: string[]): string => {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
};

function changeOf(loaded: Loaded, key: string): Rec {
  const rec = live(loaded, key);
  if (!rec || rec.type !== 'change') throw new CliError(`${key} is not a change`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before reviewing it`);
  if (rec.data.kind === 'milestone')
    throw new CliError(`${rec.key} is a milestone: its children are reviewed, each on its own`);
  return rec;
}

/** A project that set review off is not reviewed: a brief, a finding or a round is refused, with the line that turns
 *  it on. What is already on a change can still be settled. */
function reviewed(loaded: Loaded, store: Store): ReviewMode {
  const mode = reviewMode(loaded, store.project);
  if (mode === 'off')
    throw new CliError(
      `${store.project} has review off (ext.review.mode=off): pjman set ${store.project} ext.review.mode=request turns it on when asked, =auto for every change reaching review`,
    );
  return mode;
}

/** The change's branch in this repository, when it has one. */
function branchIn(loaded: Loaded, rec: Rec, dir: string | undefined): { branch?: string; base?: string } {
  if (!dir) return {};
  const base = baseBranch(dir);
  const local = tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n');
  return {
    base,
    branch: branchesOf(rec, observedBranches(loaded), localHeads(dir)).find((b) => b !== base && local.includes(b)),
  };
}

/** A round's head as shown: the full hash is what is stored and resolved. */
export const shortHead = (head: string): string => head.slice(0, 7);
/** Whether two heads name one commit, either of them perhaps short (a round closed before heads were stored in full). */
const sameHead = (a?: string, b?: string): boolean => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/** Where the change's review loop stands, given its branch in this repository. `reviewable` says the branch holds
 *  commits the base lacks; read here when the caller has not already. */
function loopIn(rec: Rec, dir: string | undefined, branch?: string, base?: string, reviewable?: boolean): Loop {
  const at = dir && branch && base ? { dir, branch, base } : undefined;
  return loopOf(rec.data, {
    reviewable:
      reviewable ?? (!!at && Number(tryGit(at.dir, ['rev-list', '--count', `${at.base}..${at.branch}`]) || 0) > 0),
    // (a caller with no repository cannot say: the loop says the plan moved, and who can)
    newWork: dir
      ? (since) => {
          if (!at) return false;
          // a round closed with no head saw nothing it can be told from: what the branch holds that the base lacks
          if (!since) return Number(tryGit(at.dir, ['rev-list', '--count', `${at.base}..${at.branch}`]) || 0) > 0;
          // a head that no longer resolves (a rebase with the old commit pruned, another clone, a short hash grown
          // ambiguous) tells nothing of what came after it: what the branch holds is unreviewed
          if (!tryGit(at.dir, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`])) return true;
          // commits on the branch since that head which the base does not have (the base merged in is not new work)
          return (
            Number(
              tryGit(at.dir, ['rev-list', '--count', '--no-merges', `${since}..${at.branch}`, '--not', at.base]) || 0,
            ) > 0
          );
        }
      : undefined,
  });
}

/** Whether a follow-up change is over: done or dropped. */
const over = (r: Rec): boolean => ['done', 'dropped'].includes(String(r.data.status));

/** The change that what does not hold the merge goes to: `<change>-follow-ups` while it is not over; once it is, a later
 *  pass files to one of its own, `<change>-follow-ups-<pass>` (decision review-reads-ended-follow-ups/later-pass-follow-up),
 *  and when that one is over too, the next number free. A change that is over is never added to, and never refuses. */
function followUpKeyOf(loaded: Loaded, key: string, pass: number): string {
  const first = followUpKey(key);
  const open = (k: string): boolean => {
    const there = live(loaded, k);
    return !there || !over(there);
  };
  if (open(first)) return first;
  for (let n = Math.max(2, pass); ; n++) if (open(`${first}-${n}`)) return `${first}-${n}`;
}

/** The pass the rounds closed so far belong to: what is left on the change was found there, whatever pass is under way. */
const closedPass = (data: Record<string, unknown>): number => Math.max(1, ...roundsOf(data).map((r) => r.pass ?? 1));

/** What every view of the loop reads: where it stands and what says so, without the brief's decisions, log and diff. */
interface LoopRead {
  change: string;
  mode: ReviewMode;
  loop: Loop;
  findings: Finding[];
  entire: boolean;
  /** Where what does not hold the merge goes. */
  followUp: string;
  /** The round to close was handed to Entire's reviewers. */
  entireOut: boolean;
}

/** Whether the round to close was handed to Entire's reviewers: what they found is on the Trail and nowhere else, so
 *  the round is closed only once the Trail was read. */
function entireHanded(data: Record<string, unknown>, loop: Loop): boolean {
  const want: readonly string[] = loop.state === 'recheck' ? ['fix'] : loop.state === 'due' ? REVIEW_LENSES : [];
  return lensesAsked(data).some((a) => (a.pass ?? 1) === loop.pass && a.by === 'entire' && want.includes(a.lens));
}

/** What is said of a round left open because the Trail could not be read: what reads it, and the way out where it
 *  never can be. */
const unread = (k: string, why?: string): string =>
  `${k}: the round is not closed and the review is still due: Entire's reviewers post what they find on the Trail, and it could not be read${why ? ` (${why})` : ''}. \`pjman review ${k} --reviewed\` reads it and closes the round once Entire lists it; where it never will, hand the round to reviewers of the session's own (\`pjman review ${k} --lens <lens>\`, one fresh reviewer each), whose record takes the place of Entire's`;

function loopRead(store: Store, key: string): LoopRead {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const mode = reviewed(loaded, store);
  const dir = store.projectDir;
  const { branch, base } = branchIn(loaded, rec, dir);
  const loop = loopIn(rec, dir, branch, base);
  return {
    change: rec.key,
    mode,
    loop,
    findings: findingsOf(rec.data),
    entire: entireOn(loaded, store.project),
    followUp: followUpKeyOf(loaded, rec.key, closedPass(rec.data)),
    entireOut: entireHanded(rec.data, loop),
  };
}

export interface ReviewBrief {
  change: string;
  name?: string;
  gist?: string;
  doneWhen?: string;
  intent?: string;
  /** The decisions accepted on the change: what was chosen, and the options turned down. */
  decisions: { key: string; name?: string; question?: string; accepted: string; rejected: string[] }[];
  branch?: string;
  base?: string;
  /** The command that prints the branch's whole diff against where it left the base. */
  diff?: string;
  commits: string[];
  /** The files the branch changed, with their line counts, as git says them. */
  files: string[];
  findings: Finding[];
  /** Whether findings are filed onto the change's Trail. */
  entire: boolean;
  /** How the project's changes are reviewed, and where this change's review stands. */
  mode: ReviewMode;
  loop: Loop;
  /** The branch's head now, in full. */
  head?: string;
  /** Where what does not hold the merge goes. */
  followUp: string;
}

/** What a reviewer needs to judge the change's branch: what it must do, what was decided, and what it changed. */
export function reviewBrief(store: Store, key: string): ReviewBrief {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  reviewed(loaded, store);
  const dir = store.projectDir;
  const { branch, base } = branchIn(loaded, rec, dir);
  const decisions: ReviewBrief['decisions'] = [];
  for (const d of loaded.records) {
    if (d.type !== 'decision' || !d.valid || d.changeKey !== rec.key || d.data.status !== 'decided') continue;
    const s = decisionState(threadOf(d.data));
    const option = s.options.find((o) => o.id === s.accepted?.option);
    if (!option) continue;
    decisions.push({
      key: d.key,
      name: typeof d.data.name === 'string' ? d.data.name : undefined,
      question: s.question,
      accepted: `${option.id}: ${option.text}`,
      rejected: s.options.filter((o) => o !== option).map((o) => `${o.id}: ${o.text}`),
    });
  }
  const range = branch && base ? `${base}...${branch}` : undefined;
  // (in full: a short hash can grow ambiguous, and the round's head is resolved again to tell new work from old)
  const head = (dir && branch && tryGit(dir, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])) || undefined;
  // work to review: the commits on the branch that the base does not have
  const commits =
    dir && branch && base
      ? tryGit(dir, ['log', '--reverse', '--format=%h %s', `${base}..${branch}`])
          .split('\n')
          .filter(Boolean)
      : [];
  const loop = loopIn(rec, dir, branch, base, commits.length > 0);
  return {
    change: rec.key,
    name: typeof rec.data.name === 'string' ? rec.data.name : undefined,
    gist: typeof rec.data.gist === 'string' ? rec.data.gist : undefined,
    intent: rec.sections.get('Intent')?.trim(),
    doneWhen: rec.sections.get('Done when')?.trim(),
    decisions,
    branch,
    base,
    diff: range ? `git diff ${range}` : undefined,
    commits,
    files: dir && range ? tryGit(dir, ['diff', '--stat=120', range]).split('\n').filter(Boolean) : [],
    findings: findingsOf(rec.data),
    entire: entireOn(loaded, store.project),
    mode: reviewMode(loaded, store.project),
    loop,
    head,
    followUp: followUpKeyOf(loaded, rec.key, closedPass(rec.data)),
  };
}

export function formatReviewBrief(b: ReviewBrief, printed: (key: string) => string = (k) => k): string {
  const key = printed(b.change);
  const out = [`# Review ${key}${b.name ? ` — ${b.name}` : ''}`];
  if (b.gist) out.push(b.gist);
  out.push(
    '\nJudge the branch against what the change must do and what was decided on it, nothing else: a finding is a place where the code does not meet the done-when, contradicts an accepted decision, takes up an option that was turned down, or breaks. Taste is not a finding.',
  );
  if (b.intent) out.push(`\n## Intent\n\n${b.intent}`);
  out.push(`\n## Done when\n\n${b.doneWhen ?? '(the change says none: say so as a finding)'}`);
  if (b.decisions.length) {
    out.push('\n## Decisions accepted');
    for (const d of b.decisions) {
      out.push(`\n### ${d.name ?? printed(d.key)}${d.question ? `: ${d.question}` : ''}`);
      out.push(`- accepted ${d.accepted}`);
      for (const r of d.rejected) out.push(`- turned down ${r}`);
    }
  }
  out.push('\n## The branch');
  if (b.branch) {
    out.push(
      `${b.branch}, against ${b.base}: ${b.commits.length} commit${b.commits.length === 1 ? '' : 's'}. Read it with: ${b.diff}`,
    );
    if (b.commits.length) out.push(`\n${b.commits.map((c) => `- ${c}`).join('\n')}`);
    if (b.files.length) out.push(`\n${b.files.join('\n')}`);
  } else out.push('(no branch of the change in this repository: review what the change links)');
  if (b.findings.length) out.push(`\n## Findings\n\n${b.findings.map((f, i) => formatFinding(i + 1, f)).join('\n')}`);
  out.push(
    `\n## Filing\n\nOne command per finding${b.entire ? "; each is also filed onto the change's Trail on Entire, whose Findings gate holds the merge until it is resolved" : ''}:\n  pjman review ${key} --finding "<what is wrong, and what the done-when or decision says>" --severity high|medium|low --kind intent|drift|correctness [--file <path> --line <n>]\nSeverity is high only for what is wrong in normal use or loses data, medium for what is wrong at an edge, low for the rest. Kind is intent where the done-when is not met, drift where a decision or the scope is not kept, correctness where the code breaks. A high finding, or one of kind intent, holds the merge and its fix is re-reviewed. Every finding, of either sort, is handled on the change's own branch before it merges: fixed, dismissed with the reason, or deferred by a person in so many words; none goes to another change unless the person asks for one.\nWhen a finding is fixed or is not a fault:\n  pjman review ${key} --resolve <n> [--note "<what fixed it>"]\n  pjman review ${key} --dismiss <n> --note "<why it does not hold>"\nWhen the person says, in so many words, that one waits:\n  pjman review ${key} --defer <n> --note "<why, as they said it>" --by person:<handle>`,
  );
  return out.join('\n');
}

export interface ReviewWrite {
  change: string;
  /** The finding written, by its number from 1. */
  n?: number;
  findings: Finding[];
  commit: string | null;
  /** What was told to Entire: `filed #2`, `resolved #1`. */
  filed: string[];
  pending: string[];
}

function save(store: Store, rec: Rec, findings: Finding[], what: string, opts: { session?: string; writer?: string }) {
  const env = envelope(opts);
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(
    rec.abs,
    render('change', { ...rec.data, findings: findings.length ? findings : undefined }, rec.body),
  );
  validateOrUndo(store, [rec.path], [], prior);
  return finishWrite(store, `pjman: review ${rec.key} ${what}`, env.session, [
    { op: 'set', key: rec.key, type: 'change', path: rec.path, fields: ['findings', what], writer: env.writer },
  ]);
}

export interface ReviewOpts {
  session?: string;
  writer?: string;
  entire?: EntireOpts;
  /** Milliseconds one call to Entire may take (default 30s). */
  timeout?: number;
}

/** File one finding on the change. */
export function addFinding(
  store: Store,
  key: string,
  f: { text: string; severity?: string; kind?: string; file?: string; line?: number },
  opts: ReviewOpts = {},
): ReviewWrite {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  reviewed(loaded, store);
  const kind = f.kind?.toLowerCase();
  if (kind !== undefined && !(FINDING_KINDS as readonly string[]).includes(kind))
    throw usageError(`--kind ${f.kind} is not one of ${FINDING_KINDS.join(', ')}`);
  const text = f.text.trim().replace(/\s*\n\s*/g, ' ');
  if (!text) throw usageError('a finding needs its text: --finding "<what is wrong>"');
  const severity = (f.severity ?? 'medium').toLowerCase();
  if (!(FINDING_SEVERITIES as readonly string[]).includes(severity))
    throw usageError(`--severity ${f.severity} is not one of ${FINDING_SEVERITIES.join(', ')}`);
  if (f.line !== undefined && !f.file) throw usageError('--line names a line of a file: pass --file <path> with it');
  if (f.line !== undefined && !(Number.isInteger(f.line) && f.line > 0)) throw usageError('--line takes a line number');
  const env = envelope(opts);
  const held = findingsOf(rec.data);
  let id = randomBytes(4).toString('hex');
  while (held.some((x) => x.id === id)) id = randomBytes(4).toString('hex');
  const findings = [
    ...held,
    {
      id,
      text,
      severity: severity as FindingSeverity,
      ...(kind ? { kind: kind as FindingKind } : {}),
      state: 'open' as FindingState,
      ...(f.file ? { file: f.file } : {}),
      ...(f.line ? { line: f.line } : {}),
      ...(env.writer ? { by: env.writer } : {}),
      at: nowIso(),
    },
  ];
  const commit = save(store, rec, findings, `finding ${findings.length} added`, opts);
  const told = fileFindings(store, rec.key, opts);
  return {
    change: rec.key,
    n: findings.length,
    findings: told.findings,
    commit,
    filed: told.filed,
    pending: told.pending,
  };
}

/** The person a deferral or a follow-up change is asked for by, as a key: theirs to say, never an agent's. A handle
 *  with no record in the store is taken as written, as an acceptance takes it. */
function askedBy(loaded: Loaded, by: string | undefined, what: string): string {
  if (!by?.startsWith('person:'))
    throw new CliError(
      `${what} by a person, in so many words: --by person:<handle>; ${by ?? 'an agent'} does not. Fix it on this branch, or dismiss it with why it is not a fault`,
    );
  if (!by.slice('person:'.length).trim())
    throw new CliError(`${what} by a person, named: --by person:<handle>; '${by}' names no one`);
  const who = resolve(loaded, by);
  if (who.status === 'ok' || who.status === 'alias') return who.rec.key;
  // (a well-formed handle with no record is the person all the same; anything else names no one person)
  if (who.status !== 'actor-key') throw unresolvedError(who, by);
  return by;
}

/** The branch's head now, in full, when the change has a branch in this repository. */
function headOf(store: Store, loaded: Loaded, rec: Rec): string | undefined {
  const dir = store.projectDir;
  const { branch } = branchIn(loaded, rec, dir);
  return (dir && branch && tryGit(dir, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])) || undefined;
}

/** Resolve, dismiss, defer or reopen a finding by its number. A deferral is a person's, said in so many words: it
 *  names them (`by`) and why, and the finding stays on the change as deferred. */
export function settleFinding(
  store: Store,
  key: string,
  n: number,
  state: FindingState,
  note: string | undefined,
  opts: ReviewOpts & { by?: string } = {},
): ReviewWrite {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const findings = findingsOf(rec.data);
  const f = findings[n - 1];
  if (!Number.isInteger(n) || !f)
    throw new CliError(
      `${rec.key} has no finding ${n} (${findings.length ? `1 to ${findings.length}` : 'it has none'})`,
    );
  if (state === 'dismissed' && !note?.trim())
    throw usageError('dismissing a finding says why it does not hold: --note "…"');
  if (state === 'deferred') {
    if (!note?.trim()) throw usageError('deferring a finding says why, as the person said it: --note "…"');
    note = `${note.trim()} (deferred by ${askedBy(loaded, opts.by, 'a finding is deferred')})`;
  }
  if (f.state === state) {
    // already so here; Entire may not have been told (the call was left pending): told now
    const due = f.entire ? (f.filed ?? 'open') !== state : state === 'open';
    const told = due ? fileFindings(store, rec.key, opts) : undefined;
    return {
      change: rec.key,
      n,
      findings: told?.findings ?? findings,
      commit: null,
      filed: told?.filed ?? [],
      pending: told?.pending ?? [],
    };
  }
  findings[n - 1] = {
    ...f,
    state,
    settled: nowIso(),
    ...(note?.trim() ? { note: note.trim() } : state === 'open' ? { note: undefined } : {}),
    // (where the branch stood: what was committed to handle it is not new work for the review)
    head: state === 'open' ? undefined : headOf(store, loaded, rec),
  };
  const commit = save(store, rec, findings, `finding ${n} ${state === 'open' ? 'reopened' : state}`, opts);
  const told = fileFindings(store, rec.key, opts);
  return { change: rec.key, n, findings: told.findings, commit, filed: told.filed, pending: told.pending };
}

/** Tell Entire what it has not been told: each open finding not yet on the change's Trail is filed there, and each
 *  one whose state moved since is resolved, dismissed or reopened there. Nothing for a project that has not opted in,
 *  or a change with no Trail yet (its Trail is created when work starts; the next run files them). */
export function fileFindings(
  store: Store,
  key: string,
  opts: ReviewOpts = {},
): { findings: Finding[]; filed: string[]; pending: string[] } {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const findings = findingsOf(rec.data);
  const out = { findings, filed: [] as string[], pending: [] as string[] };
  const dir = store.projectDir;
  if (!dir || !entireOn(loaded, store.project)) return out;
  const due = findings.filter((f) => (f.entire ? (f.filed ?? 'open') !== f.state : f.state === 'open'));
  if (!due.length) return out;
  const trail = trailOf(loaded, rec);
  const branch = trail?.state?.branch ?? branchIn(loaded, rec, dir).branch;
  if (!trail?.state || !branch) {
    out.pending.push(
      `${rec.key} has no Trail yet: its findings are filed once it has one${startHint(store, loaded, rec)}`,
    );
    return out;
  }
  const slug = rec.key.replace(/^change:/, '');
  // what Entire answered, by the finding's place: written onto the record as it stands when the calls are over
  const told = new Map<number, Partial<Finding>>();
  // no more is asked of Entire in this run once a call has not come back
  let down = false;
  findings.forEach((f, i) => {
    const n = i + 1;
    if (down) return;
    const fail = (reason: string) => {
      if (!out.pending.includes(reason)) out.pending.push(reason);
    };
    if (!f.entire) {
      if (f.state !== 'open') return;
      const r = runEntire<Record<string, unknown>>(
        [
          'trail',
          'finding',
          'add',
          '--branch',
          branch,
          '--body',
          f.text,
          '--severity',
          f.severity,
          ...(f.file ? ['--file', f.file] : []),
          ...(f.file && f.line ? ['--line', String(f.line)] : []),
          '--client-id',
          // the finding's own id: its place moves when another writer's finding lands before it
          `pjman:${slug}#${f.id ?? n}`,
        ],
        { ...opts.entire, cwd: dir, timeout: 30_000 },
      );
      if (!r.ok) {
        down = r.kind === 'timeout' || r.kind === 'missing';
        return fail(r.reason);
      }
      if (typeof r.data.id !== 'string') return fail('entire trail finding add answered no id');
      told.set(i, { entire: r.data.id, filed: 'open' });
      findings[i] = { ...f, entire: r.data.id, filed: 'open' };
      out.filed.push(`filed #${n}`);
      return;
    }
    if ((f.filed ?? 'open') === f.state) return; // Entire already knows
    // one moved to the follow-up change leaves the Trail as a dismissal, its note naming where it went
    const verb = f.state === 'resolved' ? 'resolve' : f.state === 'open' ? 'reopen' : 'dismiss';
    const r = runEntire<string>(
      ['trail', 'finding', verb, '--branch', branch, f.entire, ...(f.note ? ['-m', f.note] : [])],
      { ...opts.entire, cwd: dir, timeout: 30_000, text: true },
    );
    if (!r.ok) {
      down = r.kind === 'timeout' || r.kind === 'missing';
      return fail(r.reason);
    }
    told.set(i, { filed: f.state });
    findings[i] = { ...f, filed: f.state };
    out.filed.push(`${f.state === 'open' ? 'reopened' : f.state} #${n}`);
  });
  // the record may have been written while Entire was asked (a status, a binding, another finding): what Entire
  // answered goes onto the record as it stands now, finding by finding, never the copy read before the calls; read and
  // written under the store's lock, so no write lands in between
  if (out.filed.length)
    withStoreLock(store.root, () => {
      const now = changeOf(loadStore(store), key);
      const current = findingsOf(now.data);
      for (const [i, patch] of told) {
        // by its id, wherever it now stands; one filed before ids, by its place and text
        const mine = findings[i];
        const at = mine.id ? current.findIndex((x) => x.id === mine.id) : current[i]?.text === mine.text ? i : -1;
        if (at >= 0) current[at] = { ...current[at], ...patch };
      }
      save(store, now, current, `told Entire (${out.filed.join(', ')})`, opts);
      out.findings = current;
    });
  return out;
}

/** The pages of a Trail's findings read in one go (a hundred findings each). */
const MAX_PAGES = 50;

const goneWords = (n: number | undefined, how: string): string =>
  `Trail${n ? ` #${n}` : ''} is ${how}: Entire no longer lists its findings`;

/** The branch a change's Trail is read by, where it can be read: with no Trail there is none, and Entire lists a
 *  Trail's findings only while its branch is open (they are read before the merge, by pjman merge and by each sync
 *  while the change is in review; what was read then is what the change keeps). */
function readableTrail(loaded: Loaded, rec: Rec, dir: string): { branch?: string; number?: number; gone?: string } {
  const trail = trailOf(loaded, rec);
  const branch = trail?.state?.branch ?? branchIn(loaded, rec, dir).branch;
  if (!trail?.state || !branch) return {};
  const status = trail.state.change?.status;
  if (status === 'merged' || status === 'closed')
    return { number: trail.state.number, gone: goneWords(trail.state.number, status) };
  return { branch, number: trail.state.number };
}

/** What the findings on the change's Trail read as on the change: Entire's own review posts there, and so may a person.
 *  A finding the change does not hold is added, with its id on Entire; one it holds follows Entire's state where it was
 *  not settled here since. The Trail is read whole each time; nothing is asked of a project that did not opt in. */
export function readFindings(
  store: Store,
  key: string,
  opts: ReviewOpts = {},
): {
  change: string;
  findings: Finding[];
  read: string[];
  pending: string[];
  commit: string | null;
  /** Entire listed the Trail's findings: what is on the change is what the Trail held. False where nothing could be
   *  read (no Trail, a Trail no longer listed, Entire not answering) and for a project that did not opt in. */
  listed: boolean;
} {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const out = {
    change: rec.key,
    findings: findingsOf(rec.data),
    read: [] as string[],
    pending: [] as string[],
    commit: null as string | null,
    listed: false,
  };
  const dir = store.projectDir;
  if (!dir || !entireOn(loaded, store.project)) return out;
  const trail = readableTrail(loaded, rec, dir);
  if (!trail.branch) {
    out.pending.push(
      trail.gone
        ? `${trail.gone}; the change keeps what was read before`
        : `${rec.key} has no Trail yet: there are no findings on Entire to read${startHint(store, loaded, rec)}`,
    );
    return out;
  }
  // the Trail is read whole, page by page: a page not read is findings not read, and says so. The time given bounds
  // the whole read, however many pages there are (a sync hands it what is left of its own)
  const listed: unknown[] = [];
  let cursor: string | undefined;
  const until = Date.now() + (opts.timeout ?? 30_000);
  for (let page = 0; ; page++) {
    const left = until - Date.now();
    if (page && left <= 0) {
      out.pending.push(
        `the Trail's findings were read in part (${listed.length} listed when the time given ran out): none is taken until all are read`,
      );
      return out;
    }
    const r = runEntire<Record<string, unknown>>(
      [
        'trail',
        'finding',
        'list',
        '--branch',
        trail.branch,
        '--status',
        'any',
        '--freshness',
        'any',
        ...(cursor ? ['--cursor', cursor] : []),
      ],
      { ...opts.entire, cwd: dir, timeout: Math.max(1_000, left) },
    );
    if (!r.ok) {
      out.pending.push(
        /has no open changes|no discoverable project trail/i.test(r.reason)
          ? `${goneWords(trail.number, 'merged')}; the change keeps what was read before`
          : page
            ? `the Trail's findings were read in part (${r.reason}): none is taken until all are read`
            : r.reason,
      );
      return out;
    }
    if (Array.isArray(r.data.findings)) listed.push(...(r.data.findings as unknown[]));
    if (r.data.has_more !== true) break;
    const next = typeof r.data.next_cursor === 'string' && r.data.next_cursor ? r.data.next_cursor : undefined;
    if (!next || next === cursor || page + 1 >= MAX_PAGES) {
      out.pending.push(
        `the Trail holds more findings than could be read (${listed.length} listed, and Entire ${next && next !== cursor ? 'has more pages' : 'names no next page'}): none is taken until all are read`,
      );
      return out;
    }
    cursor = next;
  }
  out.listed = true;
  // the record as it stands now: Entire was asked in between; read and written under the store's lock
  return withStoreLock(store.root, () => {
    const now = changeOf(loadStore(store), key);
    const findings = findingsOf(now.data);
    const asState = (v: unknown): FindingState => (v === 'resolved' || v === 'dismissed' ? v : 'open');
    for (const raw of listed) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as Record<string, unknown>;
      const id = typeof f.id === 'string' ? f.id : undefined;
      const text = [f.title, f.body].find((t): t is string => typeof t === 'string' && !!t.trim());
      if (!id || !text) continue;
      const state = asState(f.status);
      const at = findings.findIndex((x) => x.entire === id);
      if (at >= 0) {
        const mine = findings[at];
        // (one moved to the follow-up change is a dismissal on Entire, which has no word for it)
        const there = mine.state === 'deferred' && state === 'dismissed' ? 'deferred' : state;
        // settled on Entire, and not settled differently here since Entire was last told
        if ((mine.filed ?? 'open') === mine.state && mine.state !== there) {
          // (where the branch stood, as a settle here records it; none on one that stands again)
          findings[at] = {
            ...mine,
            state,
            filed: state,
            settled: nowIso(),
            head: state === 'open' ? undefined : headOf(store, loaded, rec),
          };
          out.read.push(`${state === 'open' ? 'reopened' : state} #${at + 1}`);
        }
        continue;
      }
      const loc = f.location && typeof f.location === 'object' ? (f.location as Record<string, unknown>) : {};
      const severity = (FINDING_SEVERITIES as readonly string[]).includes(String(f.severity))
        ? (f.severity as FindingSeverity)
        : 'medium';
      const said = text.replace(/\s+/g, ' ').trim();
      // Entire's reviewers mark what they judged against the brief: [intent], [drift]
      const marked = /\[(intent|drift|correctness)\]/i.exec(said)?.[1].toLowerCase() as FindingKind | undefined;
      findings.push({
        id: randomBytes(4).toString('hex'),
        text: said,
        severity,
        ...(marked ? { kind: marked } : {}),
        state,
        ...(typeof loc.filePath === 'string' ? { file: loc.filePath } : {}),
        ...(typeof loc.filePath === 'string' && typeof loc.startLine === 'number' ? { line: loc.startLine } : {}),
        by: 'entire',
        // (as pjman writes its own, so the two compare)
        at:
          typeof f.createdAt === 'string' && !Number.isNaN(Date.parse(f.createdAt))
            ? new Date(f.createdAt).toISOString()
            : nowIso(),
        entire: id,
        filed: state,
      });
      out.read.push(`read #${findings.length}`);
    }
    out.findings = findings;
    if (out.read.length)
      out.commit = save(
        store,
        now,
        findings,
        `read from Entire (${out.read.length} finding${out.read.length === 1 ? '' : 's'})`,
        opts,
      );
    return out;
  });
}

/** The checkout a branch is in: its worktree, or the project's folder when that is on the branch. */
function checkoutOf(dir: string, branch: string): string | undefined {
  let at: string | undefined;
  for (const line of tryGit(dir, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) at = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}` && at) return at;
  }
  return undefined;
}

/** What `entire review --list` names: each profile with where its verdict goes, and the one marked default. */
export function profilesOf(listing: string): {
  names: string[];
  fallback?: string;
  output: Record<string, string>;
  /** The listing said something and no profile could be read from it: not the same as none set up. */
  unread?: boolean;
} {
  const names: string[] = [];
  const output: Record<string, string> = {};
  let fallback: string | undefined;
  for (const line of listing.split('\n')) {
    // a profile is a name indented by two; its settings sit under it, indented further, as `key: value`
    const name = /^ {2}(\S+)(\s+\(default\))?\s*$/.exec(line);
    if (name) {
      names.push(name[1]);
      if (name[2]) fallback = name[1];
      continue;
    }
    const out = /^\s{3,}output:\s+(\S+)/i.exec(line);
    if (out && names.length) output[names.at(-1)!] = out[1].toLowerCase();
  }
  // no profile is taken from Entire's own words for it, or from an empty answer: a listing that says something else
  // and names none in the layout read here was not read (Entire may have changed how it lists them)
  const notRead = !names.length && !!listing.trim() && !/no review profiles configured/i.test(listing);
  return { names, fallback, output, ...(notRead ? { unread: true } : {}) };
}
type Profiles = ReturnType<typeof profilesOf>;

/** The file Entire keeps a person's own settings in, for one clone only: never committed, so a worktree has none. */
const PERSONAL = path.join('.entire', 'settings.local.json');

const realOf = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
/** Two paths to one folder, as git names it: a link to the project's folder is the folder. */
export const sameFolder = (a: string, b: string): boolean => realOf(a) === realOf(b);
const hashOf = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Bring the person's own settings file from the main checkout into the worktree a change is reviewed in, where the
 *  worktree's listing lacks the profile the review needs. Never over a file the worktree has of its own: only over a
 *  copy pjman made earlier that is still as it was copied (its hash is kept under the worktree's git directory), and
 *  then only when the person's file has changed since. Never into a tree where git would show it: where the branch
 *  does not ignore the file it is added to the repository's own exclude list first, or not copied. A copy that
 *  brings nothing the review can use is taken back, with the directory made for it. Every failure is a reason. */
function bringPersonal(
  dir: string,
  at: string,
  known: Profiles,
  list: () => ReturnType<typeof runEntire<string>>,
  usable: (k: Profiles) => boolean,
  /** The worktree's listing lacks the profile the review needs: without that, only a copy gone stale is refreshed. */
  need: boolean,
): { known: Profiles; said: string[]; pending?: string; own?: string } {
  const mine = path.join(dir, PERSONAL);
  const here = path.join(at, PERSONAL);
  const said: string[] = [];
  const markAt = tryGit(at, ['rev-parse', '--git-path', 'pjman-entire-settings']).trim();
  const mark = markAt ? path.resolve(at, markAt) : undefined;
  if (!fs.existsSync(mine)) {
    if (!fs.existsSync(here)) return { known, said };
    // yours is gone from the main checkout: a copy pjman made of it, unchanged since, goes with it, and is said
    try {
      const copied = mark && fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : undefined;
      if (!copied || hashOf(here) !== copied) return { known, said, own: ownWords(here) };
      const prior = fs.readFileSync(here);
      fs.rmSync(here);
      const again = list();
      if (!again.ok) {
        fs.writeFileSync(here, prior);
        return { known, said, pending: again.reason };
      }
      if (mark) fs.rmSync(mark, { force: true });
      said.push(
        `your own review profile is gone from the main checkout (${mine}), so the copy of it in the worktree was removed (${here})`,
      );
      return { known: profilesOf(again.data), said };
    } catch (e) {
      return {
        known,
        said,
        pending: `the copy of your own review profile in the worktree could not be removed (${here}): ${(e as Error).message.split('\n')[0]}`,
      };
    }
  }
  let undo: (() => void) | undefined;
  // the line added to the repository's exclude list, taken out again wherever the copy is not kept; and what is said
  // of it where the copy is
  let restore: (() => void) | undefined;
  let excluded: string | undefined;
  try {
    const had = fs.existsSync(here);
    if (had) {
      const copied = mark && fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : undefined;
      // the worktree's own (never copied by pjman, or changed since): left as it is, and said where it is not yours
      if (!copied || hashOf(here) !== copied)
        return { known, said, own: ownWords(here, hashOf(here) !== hashOf(mine) ? mine : undefined) };
      // pjman's copy, and yours has not changed since: nothing more to bring
      if (hashOf(mine) === copied) return { known, said };
      // (pjman's copy, and yours has changed: copied again whether or not the old copy still names a profile, so a
      // profile corrected in the main checkout is the one that runs)
    } else if (!need) return { known, said };
    // git must not show the file in the tree under review, where a later `git add -A` would commit it
    const ignored = () => {
      try {
        git(at, ['check-ignore', '-q', PERSONAL]);
        return true;
      } catch {
        return false;
      }
    };
    if (!ignored()) {
      const excludeAt = tryGit(at, ['rev-parse', '--git-path', 'info/exclude']).trim();
      // (the list is the repository's, shared by every checkout: a line that did not hide the file is taken out
      // again, and one already there is not added twice)
      if (excludeAt) {
        const exclude = path.resolve(at, excludeAt);
        const was = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : undefined;
        if (!(was ?? '').split('\n').includes(`/${PERSONAL}`)) {
          fs.mkdirSync(path.dirname(exclude), { recursive: true });
          fs.writeFileSync(exclude, `${was ?? ''}${was && !was.endsWith('\n') ? '\n' : ''}/${PERSONAL}\n`);
          restore = () => (was === undefined ? fs.rmSync(exclude, { force: true }) : fs.writeFileSync(exclude, was));
        }
      }
      if (!ignored()) {
        restore?.();
        return {
          known,
          said,
          pending: `your own review profile was not copied into the worktree: ${at} does not ignore ${PERSONAL} (its branch has no .entire/.gitignore, or tracks the file), so git would show your settings in the tree under review`,
        };
      }
      if (restore)
        excluded = `${PERSONAL} was added to this repository's exclude list (${excludeAt}): the branch does not ignore it`;
    }
    const folder = path.dirname(here);
    const madeFolder = !fs.existsSync(folder);
    const prior = had ? fs.readFileSync(here) : undefined;
    const back = () => {
      if (prior) fs.writeFileSync(here, prior);
      else fs.rmSync(here, { force: true });
      restore?.();
      if (madeFolder) fs.rmdirSync(folder);
    };
    undo = back;
    fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(mine, here);
    const again = list();
    const next = again.ok ? profilesOf(again.data) : undefined;
    // a first copy is kept where it brought something: the profile the review needs, or one the worktree did not
    // list. A copy made again is kept whatever yours now says (no default, no profile at all): it is your file as it
    // stands, and the review answers for that, never for the copy gone stale
    if (next && (had || usable(next) || next.names.some((n) => !known.names.includes(n)))) {
      if (mark) fs.writeFileSync(mark, `${hashOf(here)}\n`);
      if (excluded) said.push(excluded);
      said.push(
        had
          ? `your own review profile changed since it was copied into the worktree, and was copied again (${mine} to ${here})`
          : `your own review profile was copied into the worktree (${mine} to ${here})`,
      );
      return { known: next, said };
    }
    // it brought nothing: the worktree is left as it was
    undo = undefined;
    back();
    return { known, said, ...(again.ok ? {} : { pending: again.reason }) };
  } catch (e) {
    // (a copy cut short is taken back as far as it can be: a read-only worktree, a source that cannot be read)
    try {
      if (undo) undo();
      else restore?.();
    } catch {
      // what could not be written could not be left either
    }
    return {
      known,
      said,
      pending: `your own review profile could not be copied into the worktree (${mine} to ${here}): ${(e as Error).message.split('\n')[0]}`,
    };
  }
}
const ownWords = (here: string, differsFrom?: string): string =>
  `${here} is the worktree's own and was left as it is${differsFrom ? `; it differs from yours in ${differsFrom}` : ''}`;

/** What starts the Trail of a change that has none; nothing for a change no Trail would be started for. */
const startHint = (store: Store, loaded: Loaded, rec: Rec): string =>
  noTrailWhy(store, loaded, rec, store.project) === null
    ? ` (\`pjman sync entire --start ${rec.key}\` starts it, without asking)`
    : '';
const notStarted = (key: string, why: string): string =>
  `entire: ${key} has no Trail and one could not be started (${why})`;

/** Hand the review to Entire's own (decision pjman-review/who-reviews): several agents and a judge read the branch,
 *  with the brief only pjman holds added to their task, and post what they find onto the Trail; the findings are then
 *  read back onto the change. The review profile is the person's to set up (`entire review --configure`); with none,
 *  nothing runs and the command to run is named. Long: the agents take minutes. */
export function runReview(
  store: Store,
  key: string,
  opts: ReviewOpts & { profile?: string; timeout?: number } = {},
): {
  change: string;
  ran: boolean;
  findings: Finding[];
  read: string[];
  pending: string[];
  commit: string | null;
  /** The profile the review ran with. */
  profile?: string;
  /** What pjman did to make the review run, said so it is not done unseen. */
  said: string[];
  /** The round this review closed, and where the loop then stands. */
  round?: RoundResult;
  /** The review was due and its round is not closed: what the reviewers found was not read. */
  open?: boolean;
} {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  reviewed(loaded, store);
  const none = {
    change: rec.key,
    ran: false,
    findings: findingsOf(rec.data),
    read: [],
    pending: [] as string[],
    commit: null,
    said: [] as string[],
  };
  const dir = store.projectDir;
  if (!dir || !entireOn(loaded, store.project)) {
    none.pending.push(
      `${store.project ?? 'the project'} has not opted in to Entire: the review is the session's own (pjman review ${rec.key} prints the brief; --finding files what is found)`,
    );
    return none;
  }
  const { branch, base } = branchIn(loaded, rec, dir);
  if (!branch) {
    none.pending.push(`${rec.key} has no branch in this repository to review`);
    return none;
  }
  // the review is a command run on the change, so it starts the Trail the change lacks, as a step started does, and
  // says the branch was pushed: nobody is asked first, whatever profile there is and wherever it sends its verdict
  // (decisions entire-follow-ups/unasked-push, trail-without-asking/sweep-starts)
  let readable = readableTrail(loaded, rec, dir);
  let whyNot = '';
  /** Why no Trail is ever started for this change, where that is the reason: nothing clears it, and --start refuses. */
  let never: string | null = null;
  if (!readable.branch && !readable.gone) {
    let started: ReturnType<typeof reconcileTrail> = null;
    let threw = '';
    try {
      started = reconcileTrail(store, rec.key, {
        session: opts.session,
        writer: opts.writer,
        entire: opts.entire,
        budget: 90_000,
        whyNot: (reason) => (whyNot = reason),
      });
    } catch (e) {
      // (a start that threw is not lost to a bare error: the review says so below. Entire is asked before the store
      // is written, so the Trail may stand and the branch be on origin with nothing here to say it)
      threw = `${(e as Error).message.split('\n')[0]}; if Entire was reached before that, the Trail may have been made and ${branch} pushed to origin`;
      whyNot = threw;
    }
    const now = loadStore(store);
    readable = readableTrail(now, changeOf(now, key), dir);
    if (started) {
      // (what Entire did not answer is said as it is where the Trail stands; where it does not, it is the reason)
      const lines = trailLines(started);
      const reasoned = !readable.branch && !readable.gone;
      none.said.push(...(reasoned ? lines.filter((l) => !l.startsWith('entire: pending (')) : lines));
      whyNot ||= started.pending.join('; ');
    }
    // (a start that threw with the Trail already bound: the review goes on, and the throw is still said)
    if (threw && readable.branch)
      none.said.push(`entire: the start of ${rec.key}'s Trail did not end cleanly (${threw})`);
    if (!whyNot) {
      never = noTrailWhy(store, loaded, rec, store.project);
      whyNot = never ?? 'no Trail could be made for it';
    }
    // (said on every way out but the one whose own refusal carries it)
    if (!readable.branch && !readable.gone) none.said.push(notStarted(rec.key, whyNot));
  }
  // where the branch is checked out, Entire reviews it there; else it is asked to check the branch out itself
  const checkout = checkoutOf(dir, branch);
  const at = checkout ?? dir;
  const list = () => runEntire<string>(['review', '--list'], { ...opts.entire, cwd: at, timeout: 20_000, text: true });
  const first = list();
  if (!first.ok) {
    none.pending.push(first.reason);
    return none;
  }
  let known = profilesOf(first.data);
  // Entire runs no review without a profile named ("Specify a profile to review"): the one asked for, else the one
  // Entire marks default, else the only one there is
  const chosen = (k: Profiles): string | undefined =>
    opts.profile
      ? k.names.includes(opts.profile)
        ? opts.profile
        : undefined
      : (k.fallback ?? (k.names.length === 1 ? k.names[0] : undefined));
  // a profile saved for the person alone (entire review --configure --local) is in the main checkout's own settings
  // file, which is never committed: a worktree, where a change is worked, has none. It is brought in wherever the
  // worktree's own listing lacks the profile this review needs (none at all, the one asked for missing, several and
  // no default), and never over a file the worktree has of its own. (The two paths are compared as git knows them:
  // a project folder reached through a link is still the main checkout.)
  let own: string | undefined;
  if (!known.unread && !sameFolder(at, dir)) {
    const need = !chosen(known);
    const brought = bringPersonal(dir, at, known, list, (k) => !!chosen(k), need);
    known = brought.known;
    none.said.push(...brought.said);
    // (the worktree's own file is named only where the review found no profile to run)
    own = need ? brought.own : undefined;
    if (brought.pending) {
      none.pending.push(brought.pending);
      return none;
    }
  }
  const b = reviewBrief(store, key);
  // Entire's reviewers read through every lens, and a review that is due closes its round: only when what they found
  // can be read back. Where it cannot, nothing is run (the reviewers take minutes, and their findings would be lost)
  const due = b.loop.state === 'due' || b.loop.state === 'recheck';
  /** The way on for a due review Entire's own cannot make: the session's own reviewers take the round. */
  const ownRound = `hand the round to reviewers of the session's own, one fresh reviewer a lens (\`pjman review ${rec.key} --lens <${b.loop.state === 'recheck' ? 'fix' : REVIEW_LENSES.join('|')}>\`), then close it (\`pjman review ${rec.key} --reviewed\`)`;
  if (known.unread && (due || !opts.profile)) {
    // (nothing is copied on a listing that was not read: the profiles may be there. A review that is due is not run
    // on one either, whatever profile is named: where its verdict goes is in the listing, and findings kept local
    // could not be read back)
    none.pending.push(
      `entire review --list answered in ${at} with a listing pjman could not read, so ${
        due
          ? `where a profile's verdict goes is not known: it was not run and the review is still due; ${ownRound}`
          : `the profile to run was not found: name it (pjman review ${rec.key} --run --profile <name>)`
      }`,
    );
    return none;
  }
  if (!known.names.length && !known.unread) {
    none.pending.push(
      `no review profile in ${at}${own ? ` (${own})` : ''}: set one up, which is yours to run (entire review --configure --set-output trail)`,
    );
    return none;
  }
  // (a listing that was not read does not refuse a profile the person named: Entire is asked for it as it was said)
  const profile = known.unread ? opts.profile : (chosen(known) ?? opts.profile);
  if (!profile || (!known.unread && !known.names.includes(profile))) {
    none.pending.push(
      profile
        ? `no review profile named ${profile} in ${at}: there ${known.names.length === 1 ? 'is' : 'are'} ${known.names.join(', ')}${own ? ` (${own})` : ''}`
        : `${known.names.length} review profiles in ${at} and none is the default (${known.names.join(', ')}): name one with --profile${own ? ` (${own})` : ''}`,
    );
    return none;
  }
  if (known.output[profile] !== 'trail') {
    // (a listing that does not say is not taken for the Trail: Entire's own default is local)
    const where = known.output[profile]
      ? `the review profile ${profile} keeps its verdict local`
      : `Entire does not say where the review profile ${profile} sends its verdict`;
    if (due) {
      none.pending.push(
        `${where}: only findings posted to the Trail can be read back, so it was not run and the review is still due (entire review --configure --set-output trail)`,
      );
      return none;
    }
    none.pending.push(
      `${where}: only findings posted to the Trail are read back (entire review --configure --set-output trail)`,
    );
  } else {
    if (!readable.branch) {
      none.said = none.said.filter((l) => l !== notStarted(rec.key, whyNot));
      const still = due ? '; the review is still due' : '';
      none.pending.push(
        readable.gone
          ? `${readable.gone}, so nothing its review found could be read and it was not run${still}${due ? `: ${ownRound}` : ''}`
          : `${rec.key} has no Trail yet and one could not be started${whyNot ? ` (${whyNot})` : ''}: Entire's review posts what it finds on the Trail, so nothing it found could be read and it was not run${still}${never ? '' : `. Once what held it is cleared, run this again, or start the Trail alone (\`pjman sync entire --start ${rec.key}\`); neither needs asking for`}`,
      );
      return none;
    }
  }
  const brief = formatReviewBrief(b);
  // the one re-review reads the fix alone: what came after the full review's head
  const fixOf = b.loop.state === 'recheck' ? b.loop.full?.head : undefined;
  const prompt = [
    fixOf
      ? `This branch had one full review at ${shortHead(fixOf)}; the findings listed below as resolved held its merge and were fixed since. Judge only the fix: whether each of them is fixed, and whether the fix broke something. The rest of the branch is not yours to judge again.`
      : 'Judge the branch also against what the change was meant to do, given below. Report as findings of their own, marked [intent], where the code does not meet the Done when, and marked [drift] where it contradicts an accepted decision or does more than the change covers. Give each finding a severity: high only for what is wrong in normal use or loses data.',
    '',
    brief,
  ].join('\n');
  // when the reviewers went out: what they post is told from what stood by this time
  const wentOut = nowIso();
  const ran = runEntire<string>(
    [
      'review',
      profile,
      ...(checkout ? [] : ['--target', branch, '--cleanup-worktree']),
      '--base',
      fixOf ?? base ?? 'main',
      '--prompt',
      prompt,
    ],
    { ...opts.entire, cwd: at, timeout: opts.timeout ?? 45 * 60_000, text: true },
  );
  if (!ran.ok) {
    none.pending.push(ran.reason);
    return none;
  }
  // Entire's reviewers read through every lens: recorded once they are back, never before, so a run cut short (killed,
  // or still under way) leaves no lens that says a reviewer read the branch
  if (due)
    withStoreLock(store.root, () =>
      recordLenses(
        store,
        key,
        b.loop.state === 'recheck' ? ['fix'] : [...REVIEW_LENSES],
        'entire',
        opts,
        b.loop.pass,
        wentOut,
      ),
    );
  const back = readFindings(store, key, opts);
  // a review that was due closes its round, once what it found was read; one asked for beside the loop (before the
  // change reaches review, while fixing, or after its end) only files
  const round =
    due && back.listed ? withStoreLock(store.root, () => closeRound(store, key, { ...opts, listed: true })) : undefined;
  return {
    change: rec.key,
    ran: true,
    findings: round ? findingsOf(changeOf(loadStore(store), key).data) : back.findings,
    read: back.read,
    pending: [
      ...none.pending,
      ...back.pending,
      ...(due && !back.listed ? [unread(rec.key)] : []),
      ...(round?.pending ?? []),
    ],
    commit: back.commit,
    profile,
    said: none.said,
    round,
    open: due && !round,
  };
}

// ---- the loop (change:review-loop) ----

/** A lens a reviewer reads through: one of a full review's three, or the re-review of the fix. */
export const LENSES = [...REVIEW_LENSES, 'fix'] as const;
export type Lens = ReviewLens | 'fix';

const LENS_TASK: Record<ReviewLens, string> = {
  intent:
    'Your one question: does the branch do what the Done when says? Take the done-when clause by clause and find the code, and the test, that make each true. A clause that is not met, or is met only on paper (a stub, no test, a path nothing reaches), is a finding of --kind intent. Nothing else is yours to file.',
  drift:
    'Your one question: does the branch keep to what was decided and what was asked? A place where the code contradicts an accepted decision, takes up an option that was turned down, breaks an aspect the change works under (pjman context prints them), or does more than the intent covers is a finding of --kind drift. Nothing else is yours to file.',
  correctness:
    'Your one question: does the code break? Read the diff for what is wrong when it runs: a wrong result, lost data, a crash, a failure not handled, a race, a test that does not test what it says. Each is a finding of --kind correctness. Nothing else is yours to file.',
};

/** What one reviewer is handed: the brief, and the one question that reviewer answers. The reviewer is not the author:
 *  it judges from this text and the branch alone. */
export function lensBrief(
  store: Store,
  key: string,
  lens: string,
  printed: (key: string) => string = (k) => k,
): string {
  if (!(LENSES as readonly string[]).includes(lens))
    throw usageError(`--lens ${lens} is not one of ${LENSES.join(', ')}`);
  const b = reviewBrief(store, key);
  const k = printed(b.change);
  const head =
    'You review this change as someone who did not write it. Judge from this brief and the branch alone: the author is not asked, and their reasoning is not evidence. File each thing found with the command under Filing, one command per finding; where you find nothing, file nothing and say so.';
  if (lens !== 'fix') return [head, '', LENS_TASK[lens as ReviewLens], '', formatReviewBrief(b, printed)].join('\n');
  const full = b.loop.full;
  if (!full) throw new CliError(`${b.change} has had no full review: the fix is re-reviewed after one`);
  const fixed = b.loop.fixed.map((n) => formatFinding(n, b.findings[n - 1]));
  // (a fix committed before the round was closed is in the branch's diff, not after the round's head)
  // (a head pruned since, after a rebase, names no commit: the branch's whole diff is what there is to read)
  const resolves =
    !!full.head &&
    !!store.projectDir &&
    !!tryGit(store.projectDir, ['rev-parse', '--verify', '--quiet', `${full.head}^{commit}`]);
  const since = resolves && b.branch && !sameHead(full.head, b.head) ? `git diff ${full.head}..${b.branch}` : b.diff;
  return [
    head,
    '',
    `Your one question: do the fixes hold? ${k} had one full review${full.head ? ` at ${shortHead(full.head)}` : ''}; the findings below held its merge and were fixed since. Read only what changed since that review: ${since}`,
    `For each finding, find the change that fixes it. One that is not fixed is reopened (pjman review ${k} --reopen <n> --note "<what is still wrong>"). Something the fix itself broke is a new finding. The rest of the branch was reviewed and is not yours to judge again.`,
    '',
    '## Fixed since the full review',
    '',
    fixed.length ? fixed.join('\n') : '(none is recorded as resolved)',
    '',
    formatReviewBrief(b, printed),
  ].join('\n');
}

export interface LoopReport {
  change: string;
  mode: ReviewMode;
  state: Loop['state'];
  /** The loop in a few words; absent when there is nothing to review. */
  words?: string;
  /** What moves it on, for whoever works the change; absent once it has ended. */
  next?: string;
  rounds: Round[];
  holding: number[];
  left: number[];
  /** Whether a stop here is held by the review: the project reviews every change, and the loop has not ended. */
  due: boolean;
}

/** The change the findings that do not hold the merge go to. */
const followUpKey = (key: string): string => `${key}-follow-ups`;

function nextOf(b: LoopRead, k: string): string | undefined {
  const own = (lenses: readonly string[]): string =>
    lenses.length === 1
      ? `start one fresh agent that has no part of this conversation, told only to run \`pjman review ${k} --lens ${lenses[0]}\` and do what it says`
      : `start ${lenses.length} fresh agents that have no part of this conversation, one per lens, each told only to run \`pjman review ${k} --lens <${lenses.join('|')}>\` and do what it says`;
  const entire = b.entire
    ? `Run \`pjman review ${k} --run\` (Entire's own review: several agents and a judge, minutes long; it closes the round itself). Where it answers that no review profile is set up, `
    : '';
  // Entire's reviewers were handed the round and it is not closed: what they found was not read then
  if (b.entireOut)
    return `Entire's reviewers were back from this round, and what they posted on the Trail was not read. \`pjman review ${k} --reviewed\` reads it and closes the round; where Entire no longer lists it, hand the round to reviewers of the session's own (\`pjman review ${k} --lens <lens>\`), whose record takes the place of Entire's.`;
  switch (b.loop.state) {
    case 'due':
      return `The session that wrote the change does not review it. ${entire ? `${entire}${own(REVIEW_LENSES)}` : own(REVIEW_LENSES).replace(/^s/, 'S')}; when they are back, close the round: \`pjman review ${k} --reviewed\`.`;
    case 'fixing':
      return [
        `Fix what holds the merge, commit, and settle each: \`pjman review ${k} --resolve <n> --note "<what fixed it>"\`, or \`--dismiss <n> --note "<why it does not hold>"\`. Every other finding is fixed here too, on the same branch, before the merge.`,
        ...b.loop.holding.map((n) => formatFinding(n, b.findings[n - 1])),
      ].join('\n');
    case 'recheck':
      return `The fix is re-reviewed once, and only the fix. ${entire ? `${entire}${own(['fix'])}` : own(['fix']).replace(/^s/, 'S')}; then close the round: \`pjman review ${k} --reviewed\`.`;
    case 'closing':
      return [
        `Handle each on this branch before the merge: fix it, commit, and \`pjman review ${k} --resolve <n> --note "<what fixed it>"\`; or \`--dismiss <n> --note "<why it is not a fault>"\`. One is deferred only when the person says so in so many words: \`--defer <n> --note "<why, as they said it>" --by person:<handle>\`. No fix here is reviewed again, and nothing is moved to another change unless the person asks for one, in so many words (\`--follow-up --note "<why>" --by person:<handle>\`).`,
        ...b.loop.left.map((n) => formatFinding(n, b.findings[n - 1])),
      ].join('\n');
    default:
      return undefined;
  }
}

function reportOf(b: LoopRead, printed: (key: string) => string = (k) => k): LoopReport {
  const state = b.loop.state;
  return {
    change: b.change,
    mode: b.mode,
    state,
    words: ((w) => (w && b.loop.maybeAgain ? `${w}${MOVED_SINCE}` : w))(loopWords(b.loop)),
    next: nextOf(b, printed(b.change)),
    rounds: [b.loop.full, b.loop.fix].filter((r): r is Round => !!r),
    holding: b.loop.holding,
    left: b.loop.left,
    due: b.mode === 'auto' && state !== 'none' && state !== 'ended',
  };
}

/** Where the change's review stands and what moves it on. A project with review off has none. */
export function reviewLoop(store: Store, key: string, printed?: (key: string) => string): LoopReport {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const mode = reviewMode(loaded, store.project);
  if (mode === 'off')
    return { change: rec.key, mode, state: 'none', rounds: roundsOf(rec.data), holding: [], left: [], due: false };
  return reportOf(loopRead(store, key), printed);
}

/** The loop as lines: where it stands, then what moves it on. */
export function formatLoop(r: LoopReport, printed: (key: string) => string = (k) => k): string {
  const head = `${printed(r.change)} review (${r.mode === 'auto' ? 'auto' : r.mode === 'off' ? 'off' : 'on request'}): ${r.words ?? 'nothing to review'}`;
  return r.next ? `${head}\n${r.next}` : head;
}

export interface RoundResult {
  change: string;
  /** The round closed by this call, when one was. */
  round?: Round;
  loop: LoopReport;
  /** The findings moved to the follow-up change, and that change. */
  moved: number[];
  followUp?: string;
  commit: string | null;
  filed: string[];
  pending: string[];
}

/** The change's `reviews` as written: rounds, and the lenses handed out. */
const reviewsOf = (data: Record<string, unknown>): unknown[] => (Array.isArray(data.reviews) ? data.reviews : []);

/** The follow-up change for this pass, and its record when there is one (never one that is over). */
function followUpTarget(loaded: Loaded, rec: Rec, pass: number): { key: string; there?: Rec } {
  const key = followUpKeyOf(loaded, rec.key, pass);
  const there = live(loaded, key);
  return { key, there: there && there.type === 'change' ? there : undefined };
}

/** Record that these lenses went out to reviewers, once each. A lens handed to a reviewer of the session's own takes
 *  the place of Entire's record of it: the way out of a round whose Trail cannot be read. */
function recordLenses(
  store: Store,
  key: string,
  lenses: string[],
  by: string | undefined,
  opts: ReviewOpts,
  pass = 1,
  at = nowIso(),
): string[] {
  const rec = changeOf(loadStore(store), key);
  const lensOf = (raw: unknown): Record<string, unknown> | undefined => {
    const r = raw as Record<string, unknown> | null;
    return r && r.round === 'lens' && passOf(r) === pass ? r : undefined;
  };
  // (to a reviewer of the session's own, a lens Entire holds is not yet handed out)
  const counts = (raw: unknown): boolean => !!lensOf(raw) && (by === 'entire' || lensOf(raw)!.by !== 'entire');
  const had = new Set(
    reviewsOf(rec.data)
      .filter(counts)
      .map((raw) => String(lensOf(raw)!.lens)),
  );
  const fresh = lenses.filter((l) => !had.has(l));
  if (!fresh.length) return [];
  const env = envelope(opts);
  const who = by ?? env.writer;
  const entries = fresh.map((lens) => ({
    round: 'lens',
    lens,
    at,
    ...(who ? { by: who } : {}),
    ...(pass > 1 ? { pass } : {}),
  }));
  const kept = reviewsOf(rec.data).filter(
    (raw) => !lensOf(raw) || counts(raw) || !fresh.includes(String(lensOf(raw)!.lens)),
  );
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(rec.abs, render('change', { ...rec.data, reviews: [...kept, ...entries] }, rec.body));
  validateOrUndo(store, [rec.path], [], prior);
  finishWrite(store, `pjman: review ${rec.key} lens ${fresh.join(', ')} handed out`, env.session, [
    {
      op: 'set',
      key: rec.key,
      type: 'change',
      path: rec.path,
      fields: ['reviews', `lens ${fresh.join(', ')}`],
      writer: env.writer,
    },
  ]);
  return fresh;
}

/** Hand a reviewer its lens: the brief with the one question, and the record that it went out (a round is closed only
 *  once each of its lenses did). A lens of the full review is handed while that review is due; the fix's once what held
 *  the merge is settled. */
export function handLens(
  store: Store,
  key: string,
  lens: string,
  opts: ReviewOpts = {},
  printed: (key: string) => string = (k) => k,
): string {
  const text = lensBrief(store, key, lens, printed);
  const b = reviewBrief(store, key);
  const state = b.loop.state;
  if (lens === 'fix') {
    if (state === 'fixing')
      throw new CliError(
        `${b.change}: ${loopWords(b.loop)}; the fix is re-reviewed once they are settled\n${b.loop.holding.map((n) => formatFinding(n, b.findings[n - 1])).join('\n')}`,
      );
    if (state !== 'recheck') throw new CliError(`${b.change}: there is no fix to re-review (${loopWords(b.loop)})`);
  } else if (state !== 'due')
    throw new CliError(
      b.loop.full
        ? `${b.change} has had its full review (${loopWords(b.loop)}); a change is reviewed once and its fix once (decision review-loop/stop-rule)`
        : `${b.change} is not up for review: a lens is handed out once its plan has run to its end (status review) with work on its branch; pjman review ${b.change} prints the brief before then`,
    );
  recordLenses(store, key, [lens], undefined, opts, b.loop.pass);
  return text;
}

/** Close the round the reviewers just made: the full review when none is recorded, the re-review of the fix after it.
 *  Refused while findings hold the merge with no fix to read, and once the rounds are over. Nothing is moved by it:
 *  what is left open is handled on the change (decision review-fixes-in-place/where-findings-go). */
export function closeRound(store: Store, key: string, opts: ReviewOpts & { listed?: boolean } = {}): RoundResult {
  let b = reviewBrief(store, key);
  // Entire's reviewers post what they find on the Trail: their round is closed only once that was read (`listed`: the
  // caller just did). Where it cannot be read the round stays open and the review due
  if (b.entire && !opts.listed && entireHanded(changeOf(loadStore(store), key).data, b.loop)) {
    const back = readFindings(store, key, opts);
    if (!back.listed) throw new CliError(unread(b.change, back.pending[0]));
    if (back.commit) b = reviewBrief(store, key);
  }
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const state = b.loop.state;
  if (state === 'none')
    throw new CliError(
      `${rec.key} is not up for review: a round is closed once its plan has run to its end (status review) with work on its branch${b.loop.full ? '' : '; what is found before then is filed all the same (--finding)'}`,
    );
  if (state === 'fixing')
    throw new CliError(
      `${rec.key}: ${loopWords(b.loop)}; the fix is re-reviewed once they are settled\n${b.loop.holding.map((n) => formatFinding(n, b.findings[n - 1])).join('\n')}`,
    );
  if (state === 'closing' || state === 'ended')
    throw new CliError(
      `${rec.key}: ${state === 'ended' ? `the review has ${loopWords(b.loop)}` : loopWords(b.loop)}; a change is reviewed once and its fix once (decision review-loop/stop-rule)`,
    );
  if (!b.branch) throw new CliError(`${rec.key} has no branch in this repository: there was nothing to review`);
  // a round was made through its lenses: each handed to a reviewer (--lens), or all of them Entire's (--run)
  if (b.loop.missing.length)
    throw new CliError(
      `${rec.key}: no reviewer was handed ${b.loop.missing.map((l) => `--lens ${l}`).join(', ')}. ${state === 'recheck' ? 'The fix is re-reviewed' : 'A full review is made'} by reviewers that did not write the change, each told only to run \`pjman review ${rec.key} --lens <lens>\`; the round is closed when they are back`,
    );
  const env = envelope(opts);
  const round: Round = {
    round: state === 'recheck' ? 'fix' : 'full',
    at: nowIso(),
    ...(b.head ? { head: b.head } : {}),
    ...(env.writer ? { by: env.writer } : {}),
    ...(b.loop.pass > 1 ? { pass: b.loop.pass } : {}),
  };
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(rec.abs, render('change', { ...rec.data, reviews: [...reviewsOf(rec.data), round] }, rec.body));
  validateOrUndo(store, [rec.path], [], prior);
  const commit = finishWrite(store, `pjman: review ${rec.key} ${round.round} round closed`, env.session, [
    {
      op: 'set',
      key: rec.key,
      type: 'change',
      path: rec.path,
      fields: ['reviews', `${round.round} round`],
      writer: env.writer,
    },
  ]);
  const out: RoundResult = {
    change: rec.key,
    round,
    loop: reviewLoop(store, key),
    moved: [],
    commit,
    filed: [],
    pending: [],
  };
  return out;
}

/** Only when a person asks for a follow-up change (decision review-fixes-in-place/where-findings-go): move every open
 *  finding that does not hold the merge to the change's follow-up change, one step each, and off the Trail; the
 *  finding stays on the change as deferred, its note naming where it went.
 *  The follow-up change is filed when there is none, under the same project and features. */
export function followUp(
  store: Store,
  key: string,
  opts: ReviewOpts & { by?: string; note?: string } = {},
): RoundResult {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  reviewed(loaded, store);
  // a follow-up change defers what it takes: a person's to ask for, in so many words, as a deferral is
  const by = askedBy(loaded, opts.by, 'a follow-up change is asked for');
  const why = opts.note?.trim();
  if (!why) throw usageError('asking for a follow-up change says why, as the person said it: --note "…"');
  const findings = findingsOf(rec.data);
  const moved = findings.map((f, i) => (f.state === 'open' && !holdsMerge(f) ? i + 1 : 0)).filter((n) => n > 0);
  const none = (): RoundResult => ({
    change: rec.key,
    loop: reviewLoop(store, key),
    moved: [],
    commit: null,
    filed: [],
    pending: [],
  });
  if (!moved.length) return none();
  const pass = closedPass(rec.data);
  const { key: target, there } = followUpTarget(loaded, rec, pass);
  const texts = moved.map((n) => {
    const f = findings[n - 1];
    const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : '';
    return `${f.text}${where}`;
  });
  const who = { session: opts.session, writer: opts.writer };
  if (there) {
    // (a move cut short after this write is taken up again: a step already there is not added twice)
    const held = new Set(stepsOf(there.data).map((s) => s.text));
    const fresh = texts.filter((t) => !held.has(t));
    if (fresh.length) step(store, there.key, 'add', undefined, { texts: fresh, ...who });
  } else {
    const name = typeof rec.data.name === 'string' ? rec.data.name : rec.changeSlug!;
    // (a later pass files here only once the first pass's follow-up change is over)
    const nth = target === followUpKey(rec.key) ? '' : ` ${target.slice(followUpKey(rec.key).length + 1)}`;
    const named = `${name} follow-ups${nth}`;
    const review = nth ? `pass ${pass} of the review` : 'the review';
    newChange(store, target, {
      name: nameProblem(named) ? `Review follow-ups${nth}` : named,
      gist: `What ${review} of ${name} found that did not hold its merge`,
      origin: rec.key,
      intent: `${review[0].toUpperCase()}${review.slice(1)} of ${rec.key} found things that are wrong but did not hold its merge: none of high severity, none saying the done-when is not met (decision review-loop/stop-rule). Each is a step here.`,
      doneWhen: 'Each step is fixed, or dropped with the reason',
      features: Array.isArray(rec.data.features) ? (rec.data.features as string[]) : undefined,
      project: typeof rec.data.project === 'string' ? rec.data.project : undefined,
      steps: texts,
      ...who,
    });
  }
  // the record as it stands now: the follow-up was written in between
  const now = changeOf(loadStore(store), key);
  const current = findingsOf(now.data);
  const at = nowIso();
  for (const n of moved) {
    const mine = findings[n - 1];
    const i = mine.id ? current.findIndex((x) => x.id === mine.id) : current[n - 1]?.text === mine.text ? n - 1 : -1;
    if (i >= 0 && current[i].state === 'open')
      current[i] = {
        ...current[i],
        state: 'deferred',
        settled: at,
        note: `moved to ${target}, asked for by ${by}: ${why}`,
        head: headOf(store, loaded, rec),
      };
  }
  const commit = save(
    store,
    now,
    current,
    `${moved.length} finding${moved.length === 1 ? '' : 's'} moved to ${target}`,
    opts,
  );
  const told = fileFindings(store, rec.key, opts);
  return {
    change: rec.key,
    loop: reviewLoop(store, key),
    moved,
    followUp: target,
    commit,
    filed: told.filed,
    pending: told.pending,
  };
}
