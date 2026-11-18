// pjman review <change> (change:pjman-review): the review is pjman's own. The person's agent judges a change's branch
// against what only pjman holds, the change's done-when and the decisions accepted on it; this command hands it that
// brief and takes what it finds. A finding is data on the change (model/findings.ts). In a project that opted in to
// Entire each finding is also filed onto the change's Trail (`entire trail finding add`), where the Findings gate holds
// the merge until it is resolved, and resolving or dismissing it here is told to Entire too; with no Entire the review
// is local and the findings stand on the change alone. Filing may be left pending: the next review or sync files it.
import fs from 'node:fs';
import { entireOn, runEntire, type EntireOpts } from '../entire/entire.js';
import {
  FINDING_SEVERITIES,
  findingsOf,
  formatFinding,
  type Finding,
  type FindingSeverity,
  type FindingState,
} from '../model/findings.js';
import { decisionState, threadOf } from '../model/foundation.js';
import { live } from '../model/tree.js';
import { observedBranches } from '../model/view.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo } from '../ops/write.js';
import type { Store } from '../store/config.js';
import { git } from '../store/git.js';
import { loadStore, type Loaded, type Rec } from '../store/records.js';
import { CliError, nowIso, usageError } from '../store/util.js';
import { baseBranch, branchesOf } from './git.js';
import { trailOf } from './trail.js';

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

/** The change's branch in this repository, when it has one. */
function branchIn(loaded: Loaded, rec: Rec, dir: string | undefined): { branch?: string; base?: string } {
  if (!dir) return {};
  const base = baseBranch(dir);
  const local = tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n');
  return { base, branch: branchesOf(rec, observedBranches(loaded)).find((b) => b !== base && local.includes(b)) };
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
}

/** What a reviewer needs to judge the change's branch: what it must do, what was decided, and what it changed. */
export function reviewBrief(store: Store, key: string): ReviewBrief {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
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
    commits:
      dir && branch && base
        ? tryGit(dir, ['log', '--reverse', '--format=%h %s', `${base}..${branch}`])
            .split('\n')
            .filter(Boolean)
        : [],
    files: dir && range ? tryGit(dir, ['diff', '--stat=120', range]).split('\n').filter(Boolean) : [],
    findings: findingsOf(rec.data),
    entire: entireOn(loaded, store.project),
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
    `\n## Filing\n\nOne command per finding${b.entire ? "; each is also filed onto the change's Trail on Entire, whose Findings gate holds the merge until it is resolved" : ''}:\n  pjman review ${key} --finding "<what is wrong, and what the done-when or decision says>" --severity high|medium|low [--file <path> --line <n>]\nWhen a finding is fixed or does not hold:\n  pjman review ${key} --resolve <n> [--note "<what fixed it>"]\n  pjman review ${key} --dismiss <n> --note "<why it does not hold>"`,
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
}

/** File one finding on the change. */
export function addFinding(
  store: Store,
  key: string,
  f: { text: string; severity?: string; file?: string; line?: number },
  opts: ReviewOpts = {},
): ReviewWrite {
  const loaded = loadStore(store);
  const rec = changeOf(loaded, key);
  const text = f.text.trim().replace(/\s*\n\s*/g, ' ');
  if (!text) throw usageError('a finding needs its text: --finding "<what is wrong>"');
  const severity = (f.severity ?? 'medium').toLowerCase();
  if (!(FINDING_SEVERITIES as readonly string[]).includes(severity))
    throw usageError(`--severity ${f.severity} is not one of ${FINDING_SEVERITIES.join(', ')}`);
  if (f.line !== undefined && !f.file) throw usageError('--line names a line of a file: pass --file <path> with it');
  if (f.line !== undefined && !(Number.isInteger(f.line) && f.line > 0)) throw usageError('--line takes a line number');
  const env = envelope(opts);
  const findings = [
    ...findingsOf(rec.data),
    {
      text,
      severity: severity as FindingSeverity,
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

/** Resolve, dismiss or reopen a finding by its number. */
export function settleFinding(
  store: Store,
  key: string,
  n: number,
  state: FindingState,
  note: string | undefined,
  opts: ReviewOpts = {},
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
  if (f.state === state) return { change: rec.key, n, findings, commit: null, filed: [], pending: [] };
  findings[n - 1] = {
    ...f,
    state,
    ...(note?.trim() ? { note: note.trim() } : state === 'open' ? { note: undefined } : {}),
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
    out.pending.push(`${rec.key} has no Trail yet: its findings are filed once it has one`);
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
          `pjman:${slug}#${n}`,
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
    const verb = f.state === 'resolved' ? 'resolve' : f.state === 'dismissed' ? 'dismiss' : 'reopen';
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
  if (out.filed.length) {
    // the record may have been written while Entire was asked (a status, a binding, another finding): what Entire
    // answered goes onto the record as it stands now, finding by finding, never the copy read before the calls
    const now = changeOf(loadStore(store), key);
    const current = findingsOf(now.data);
    for (const [i, patch] of told)
      if (current[i] && current[i].text === findings[i].text) current[i] = { ...current[i], ...patch };
    save(store, now, current, `told Entire (${out.filed.join(', ')})`, opts);
    out.findings = current;
  }
  return out;
}
