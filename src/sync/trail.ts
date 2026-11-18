// A change's Trail follows the change (change:trail-lifecycle; decisions entire-opt-in/trail-granularity,
// trail-per-change, and entire-opt-in/trail-start, at-work). In a project that opted in to Entire, one pjman change is
// one Trail: created when work starts on it (the change is active and its branch exists), its title and body kept to
// the change's name, intent, done-when and accepted decisions, marked ready when the plan has run to its end, closed
// when the change is done or dropped. What Entire holds is read back onto the Trail's source record
// (`entire-trail:<forge>/<owner>/<number>`, bound by the change): its phase, the branch's state, the gates and the open
// findings. Every call to Entire may be left pending; the next reconcile takes it up again. Approving and forcing a
// merge are never done here.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { entireOn, runEntire, type EntireOpts, type EntireResult } from '../entire/entire.js';
import { TRAIL_KIND, trailLine, type TrailGate, type TrailState } from '../entire/trail.js';

export { TRAIL_KIND, trailLine, type TrailGate, type TrailState };
import { decisionState, threadOf } from '../model/foundation.js';
import { repoOf } from '../model/refs.js';
import { observedBranches } from '../model/view.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo, writeFile } from '../ops/write.js';
import { set } from '../ops/set.js';
import type { Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import { git } from '../store/git.js';
import { sourceFileSlug } from '../store/keys.js';
import { loadStore, type Loaded, type Rec } from '../store/records.js';
import { localDate, nowIso } from '../store/util.js';
import { baseBranch, branchesOf } from './git.js';

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The Trail a change binds: its source key and what was last read of it. */
export function trailOf(loaded: Loaded, rec: Rec): { key: string; src?: Rec; state?: TrailState } | undefined {
  const key = arr(rec.data.binds).find((k): k is string => typeof k === 'string' && k.startsWith(`${TRAIL_KIND}:`));
  if (!key) return undefined;
  const src = loaded.byKey.get(key)?.[0];
  const state = obj(obj(src?.data.ext)?.entire) as TrailState | undefined;
  return { key, src, state: state && typeof state.number === 'number' ? state : undefined };
}

/** The Trail's title and body, from the change: its name; its gist, intent, done-when and the decisions accepted on
 *  it. The body is the change's foundation as a reviewer on Entire needs it, and names the change it follows. */
export function trailText(loaded: Loaded, rec: Rec): { title: string; body: string; type: string } {
  const title = str(rec.data.name) ?? rec.changeSlug ?? rec.key;
  const parts: string[] = [];
  if (str(rec.data.gist)) parts.push(str(rec.data.gist)!);
  for (const section of ['Intent', 'Done when'] as const) {
    const text = rec.sections.get(section)?.trim();
    if (text) parts.push(`## ${section}\n\n${text}`);
  }
  const decided: string[] = [];
  for (const d of loaded.records) {
    if (d.type !== 'decision' || !d.valid || d.changeKey !== rec.key || d.data.status !== 'decided') continue;
    const s = decisionState(threadOf(d.data));
    const option = s.options.find((o) => o.id === s.accepted?.option);
    if (!option) continue;
    decided.push(`- **${str(d.data.name) ?? d.key}**: ${option.text.replace(/\s+/g, ' ')}`);
  }
  if (decided.length) parts.push(`## Decisions\n\n${decided.join('\n')}`);
  parts.push(`pjman: ${rec.key}`);
  return {
    title,
    body: parts.join('\n\n'),
    type: rec.data.kind === 'bug' ? 'bug' : arr(rec.data.features).length ? 'feature' : 'task',
  };
}

const hashOf = (t: { title: string; body: string }): string =>
  createHash('sha256').update(`${t.title}\n${t.body}`).digest('hex').slice(0, 16);

/** A Trail as `entire trail show|create|update --json` prints it, read into what pjman keeps. `branch` picks the
 *  change among the Trail's. */
export function readTrail(data: Record<string, unknown>, branch?: string): TrailState | null {
  const id = str(data.id);
  if (!id || typeof data.number !== 'number') return null;
  const changes = arr(data.changes)
    .map(obj)
    .filter((c): c is Record<string, unknown> => !!c);
  const change =
    changes.find((c) => branch && c.branch === branch) ??
    changes.find((c) => c.current === true) ??
    (changes.length === 1 ? changes[0] : undefined);
  const m = obj(change?.mergeability);
  const gates = arr(m?.gates)
    .map(obj)
    .filter((g): g is Record<string, unknown> => !!g && g.state !== 'disabled')
    .map((g): TrailGate => ({
      key: str(g.gate_key) ?? str(g.gate_type) ?? '?',
      status: str(g.status) ?? '?',
      blocking: g.blocking === true,
      ...(str(g.rationale) ? { rationale: str(g.rationale)!.slice(0, 200) } : {}),
    }));
  return {
    id,
    number: data.number,
    ...(str(data.url) ? { url: str(data.url) } : {}),
    status: str(data.status) ?? 'open',
    ...(str(data.phase) ? { phase: str(data.phase) } : {}),
    ...(str(change?.branch) ? { branch: str(change?.branch) } : branch ? { branch } : {}),
    ...(change && typeof change.number === 'number'
      ? {
          change: {
            number: change.number,
            status: str(change.status) ?? '?',
            ...(str(change.url) ? { url: str(change.url) } : {}),
          },
        }
      : {}),
    ...(m ? { mergeable: m.mergeable === true } : {}),
    gates,
  };
}

/** What moved on a Trail between two reads, in a person's words: what a waiting session is woken for. */
export function trailMoves(before: TrailState | undefined, after: TrailState): string[] {
  const out: string[] = [];
  if (!before) return out;
  if (after.change?.status === 'merged' && before.change?.status !== 'merged') out.push('its branch was merged');
  else if (after.status === 'closed' && before.status !== 'closed') out.push('the Trail was closed');
  const was = new Map(before.gates.map((g) => [g.key, g.status]));
  for (const g of after.gates) {
    const prior = was.get(g.key);
    if (prior === undefined || prior === g.status) continue;
    if (g.status === 'passed') out.push(`the ${g.key} gate passed`);
    else if (g.status === 'failed' || g.status === 'error')
      out.push(`the ${g.key} gate failed${g.rationale ? ` (${g.rationale})` : ''}`);
  }
  const opened = (after.findings?.open ?? 0) - (before.findings?.open ?? 0);
  if (opened > 0) out.push(`${opened} new finding${opened === 1 ? '' : 's'} (${after.findings!.open} open)`);
  else if (opened < 0 && after.findings?.open === 0) out.push('every finding is resolved');
  return out;
}

export interface TrailReconcile {
  change: string;
  trail?: string;
  state?: TrailState;
  /** What this run did on Entire: created, adopted, updated, readied, closed. */
  acts: string[];
  /** What moved on the Trail since it was last read. */
  moved: string[];
  /** What Entire did not answer; the next reconcile takes it up. */
  pending: string[];
  /** The store commit, when the record changed. */
  commit: string | null;
  /** The change was set done here because its branch was merged on Entire. */
  done?: boolean;
  /** Entire did not come back (no binary, no answer in time): the caller asks it nothing more in this run. */
  down?: boolean;
  /** The branch this run published to origin: creating a Trail pushes it. */
  pushed?: string;
  /** The branch that has no Trail and was not given one: the caller did not ask for it to be started (the sweep). */
  unstarted?: string;
}

/** Bring one change's Trail to where the change stands, and read it back. Nothing is done for a project that has not
 *  opted in, a milestone, or a change whose work has not started. */
export function reconcileTrail(
  store: Store,
  changeKey: string,
  /** `budget`: the milliseconds Entire may take in all; past it, and after a call that did not come back, no more is asked. */
  /** `create: false`: a Trail that does not exist is not started, since starting one pushes the branch; the branch is
   *  named as `unstarted` (decision entire-follow-ups/unasked-push: the sweep only follows). */
  opts: { session?: string; writer?: string; entire?: EntireOpts; budget?: number; create?: boolean } = {},
): TrailReconcile | null {
  let loaded = loadStore(store);
  const rec = loaded.byKey.get(changeKey)?.[0];
  const dir = store.projectDir;
  if (!rec || rec.type !== 'change' || !rec.valid || !dir) return null;
  if (!entireOn(loaded, store.project) || rec.data.project !== store.project || rec.data.kind === 'milestone')
    return null;
  if (!store.config.source_kinds.includes(TRAIL_KIND)) return null;
  const status = str(rec.data.status) ?? 'open';
  const bound = trailOf(loaded, rec);
  const result: TrailReconcile = { change: rec.key, trail: bound?.key, acts: [], moved: [], pending: [], commit: null };
  // every call to Entire goes through here: within the caller's budget, and none after one has not come back (no
  // binary, no answer in time), so a command that wrote the store is never held by an Entire that hangs
  const deadline = opts.budget ? Date.now() + opts.budget : Infinity;
  let down = false;
  const call = <T = Record<string, unknown>>(args: string[], text = false, quiet = false): EntireResult<T> => {
    const left = deadline - Date.now();
    const r: EntireResult<T> =
      down || left <= 0
        ? { ok: false, pending: true, kind: 'timeout', reason: 'Entire was not asked again: it did not answer in time' }
        : runEntire<T>(args, { ...opts.entire, cwd: dir, timeout: Math.min(90_000, left), text });
    if (!r.ok && (r.kind === 'timeout' || r.kind === 'missing')) down = true;
    if (!r.ok && !quiet && !result.pending.includes(r.reason)) result.pending.push(r.reason);
    return r;
  };
  const run = <T = Record<string, unknown>>(args: string[], text = false) => call<T>(args, text);
  const text = trailText(loaded, rec);
  const sent = hashOf(text);
  const before = bound?.state;
  let state: TrailState | undefined = before ? { ...before } : undefined;
  let branch = before?.branch;

  /** A create was asked of Entire before and did not answer (the mark is on the change, cleared once it has a Trail). */
  const unanswered = !!obj(obj(rec.data.ext)?.entire)?.create_unanswered;
  if (!state) {
    // the Trail starts with the work: the change is in motion and its branch exists (decision trail-start, at-work)
    if (status !== 'active' && status !== 'review') return null;
    const base = baseBranch(dir);
    let local: string[] = [];
    try {
      local = git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n');
    } catch {
      return null;
    }
    branch = branchesOf(rec, observedBranches(loaded)).find((b) => b !== base && local.includes(b));
    if (!branch) return null;
    // a Trail already on the branch (made by hand, or by a run whose answer was lost) is adopted, never doubled
    const shown = call(['trail', 'show', '--branch', branch], false, true);
    const adopted = shown.ok ? readTrail(shown.data, branch) : null;
    if (adopted?.status === 'closed') {
      // a Trail from an earlier life of the branch: not taken up, since nothing more would be sent to it
      result.pending.push(
        `Trail #${adopted.number} on ${branch} is closed: reopen it on Entire (entire trail update ${adopted.number} --status open) or work on a new branch`,
      );
      return result;
    } else if (adopted) {
      state = adopted;
      result.acts.push('adopted');
    } else if (shown.ok || !/no discoverable project trail/i.test(shown.reason)) {
      // a Trail is made only when Entire says in its own words that the branch has none: an answer that cannot be
      // read, or any other failure, may hide one, and a second Trail on the branch is worse than a later try
      result.pending.push(
        shown.ok ? `entire trail show --branch ${branch} answered a Trail that cannot be read` : shown.reason,
      );
      return result;
    } else if (opts.create === false) {
      result.unstarted = branch;
      return result;
    } else if (
      // a create that did not answer may have made the Trail all the same, without its branch (change:trail-doubled:
      // Entire creates the Trail, then links the branch). The change remembers such a create; the next run looks among
      // the person's own open Trails for one that carries this change's key and has no branch yet, and links the
      // branch to it. Entire's own word: "retry with trail link rather than creating another"
      (() => {
        if (!unanswered) return false;
        const listed = call(['trail', 'list', '--mine', '--limit', '100'], false, true);
        if (!listed.ok) {
          // a list that cannot be read may hide that Trail: none is made on a guess, and the next run asks again
          if (!result.pending.includes(listed.reason)) result.pending.push(listed.reason);
          return true;
        }
        const mark = `pjman: ${rec.key}`;
        const mine = arr(listed.data.items)
          .map(obj)
          .filter((t): t is Record<string, unknown> => !!t && typeof t.number === 'number' && t.status === 'open')
          .filter((t) => (str(t.body) ?? '').trimEnd().endsWith(mark))
          .toSorted((a, b) => (b.number as number) - (a.number as number));
        for (const t of mine) {
          const n = String(t.number);
          // only one with no branch yet is the half-made one: a Trail of this change that holds another branch is left
          const whole = call(['trail', 'show', n], false, true);
          if (!whole.ok) {
            if (!result.pending.includes(whole.reason)) result.pending.push(whole.reason);
            return true;
          }
          if (arr(whole.data.changes).some((c) => str(obj(c)?.branch))) continue;
          const linked = call(['trail', 'link', n, '--branch', branch, '--base', base], false, true);
          if (!linked.ok) {
            // the way out is said: the link takes a branch that is on origin, and the Trail can be closed instead
            result.pending.push(
              `Trail #${n} was made for ${rec.key} without its branch, and linking ${branch} to it failed (${linked.reason}): push the branch (git push origin ${branch}) and run pjman sync entire --start ${rec.key}, or close that Trail (entire trail update ${n} --status closed) and a new one is created`,
            );
            return true;
          }
          const shownNow = call(['trail', 'show', '--branch', branch], false, true);
          const taken = (shownNow.ok ? readTrail(shownNow.data, branch) : null) ?? readTrail(linked.data, branch);
          if (!taken) {
            result.pending.push(`Trail #${n} was linked to ${branch} and could not be read back`);
            return true;
          }
          state = taken;
          result.acts.push('linked');
          return true;
        }
        return false;
      })()
    ) {
      if (!state) return result;
    } else {
      const made = run([
        'trail',
        'create',
        '--title',
        text.title,
        '--body',
        text.body,
        '--type',
        text.type,
        '--branch',
        branch,
        '--base',
        base,
      ]);
      const created = made.ok ? readTrail(made.data, branch) : null;
      if (!created) {
        // the create may have made the Trail all the same: the change remembers it asked, so the next run looks for
        // that Trail before it makes another
        // (a create that was never sent, Entire being down before it, is not one)
        if (!made.ok && !unanswered && !made.reason.startsWith('Entire was not asked again')) {
          try {
            set(store, rec.key, [`ext.entire.create_unanswered=${nowIso()}`], {
              session: opts.session,
              because: 'entire trail create did not answer',
            });
          } catch {
            // the change stands without the mark: the next run looks all the same
          }
        }
        return result;
      }
      state = { ...created, sent };
      result.acts.push('created');
      result.pushed = branch;
    }
  }

  // the body follows the change, while the Trail is open
  if (state.status !== 'closed' && state.sent !== sent) {
    if (run(['trail', 'update', String(state.number), '--title', text.title, '--body', text.body]).ok) {
      state.sent = sent;
      if (!result.acts.includes('created')) result.acts.push('updated');
    }
  }
  // the plan has run to its end: ready for review
  if (status === 'review' && !state.ready && state.status !== 'closed' && branch) {
    const r = call<string>(['trail', 'ready', '--branch', branch], true, true);
    // a repository with no approval gate tracks no readiness: nothing to mark, and nothing to try again
    if (r.ok || /readiness is only tracked/i.test(r.reason)) {
      state.ready = true;
      if (r.ok) result.acts.push('readied');
    } else result.pending.push(r.reason);
  }
  // back at work after review: the ready mark is taken back, so the next review marks it again
  if (status === 'active' && state.ready && state.status !== 'closed' && branch && state.change?.status !== 'merged') {
    const r = call<string>(['trail', 'ready', '--branch', branch, '--undo'], true, true);
    if (r.ok || /readiness is only tracked/i.test(r.reason)) {
      state.ready = false;
      if (r.ok) result.acts.push('returned to draft');
    } else result.pending.push(r.reason);
  }
  // done or dropped: the Trail closes with its change
  if ((status === 'done' || status === 'dropped') && state.status !== 'closed') {
    if (run(['trail', 'update', String(state.number), '--status', 'closed']).ok) {
      state.status = 'closed';
      result.acts.push('closed');
    }
  }
  // read back: the phase, the branch's change, its gates, and the open findings
  const shown = run(['trail', 'show', String(state.number)]);
  const read = shown.ok ? readTrail(shown.data, branch) : null;
  if (read) state = { ...state, ...read, ready: state.ready, sent: state.sent, findings: state.findings };
  if (read && branch && state.change && (state.change.status === 'open' || state.change.status === 'draft')) {
    const f = run(['trail', 'finding', 'list', '--branch', branch]);
    const counts = f.ok ? obj(f.data.counts) : undefined;
    if (counts) {
      const n = (k: string) => (typeof counts[k] === 'number' ? counts[k] : 0);
      state.findings = { open: n('Open'), high: n('OpenHigh'), medium: n('OpenMedium'), low: n('OpenLow') };
    }
  }
  // the merge has ended the change (set done below, on an earlier run): marked once the change is seen done, so a
  // failed write is tried again and a change reopened later is left to the person
  if (state.change?.status === 'merged' && (status === 'done' || before?.ended)) state.ended = true;
  result.state = state;
  result.down = down;
  result.moved = trailMoves(before, state);

  // the record: the Trail's source, bound by the change
  const repo = repoOf(loaded, store.project);
  // the Trail's own address names its project (entire.com/<forge>/<project>/-/trails/<n>): the key follows it, and
  // only a Trail with no address falls back on the repository the project recorded
  const at = /^https?:\/\/[^/]+\/([a-z]+)\/([^/]+)\/-\/trails\/\d+/.exec(state.url ?? '');
  const key =
    bound?.key ??
    `${TRAIL_KIND}:${at ? `${at[1]}/${at[2]}` : repo ? `gh/${repo.split('/')[0]}` : 'trail'}/${state.number}`;
  result.trail = key;
  const rest = key.slice(TRAIL_KIND.length + 1);
  const src = loaded.byKey.get(key)?.[0];
  const env = envelope({ session: opts.session, writer: opts.writer });
  const kept = { ...state };
  const same = (a: TrailState | undefined) =>
    !!a && JSON.stringify({ ...a, synced_at: undefined }) === JSON.stringify({ ...kept, synced_at: undefined });
  const events: EventInput[] = [];
  const writes = new Map<string, string>();
  const created: string[] = [];
  if (!src || !same(before) || src.data.title !== text.title) {
    const rel = src?.path ?? path.join('sources', TRAIL_KIND, `${sourceFileSlug(TRAIL_KIND, rest)}.md`);
    writes.set(
      rel,
      render(
        'source',
        {
          ...src?.data,
          kind: TRAIL_KIND,
          key: rest,
          title: text.title,
          url: state.url ?? src?.data.url,
          ...(src ? {} : { writer: env.writer, session: env.session, created: localDate() }),
          ext: { ...obj(src?.data.ext), entire: { ...kept, synced_at: nowIso() } },
        },
        src?.body ?? '',
      ),
    );
    if (!src) created.push(rel);
    events.push(
      src
        ? { op: 'set', key, type: 'source', path: rel, fields: ['ext'], writer: env.writer }
        : { op: 'created', key, type: 'source', path: rel, writer: env.writer },
    );
  }
  if (!bound) {
    // the change as it stands now: Entire was asked in between, and a write made meanwhile is kept
    const now = loadStore(store).byKey.get(changeKey)?.[0] ?? rec;
    const binds = arr(now.data.binds).filter((k): k is string => typeof k === 'string');
    // (the change has its Trail: the mark of a create that went unanswered has done its work)
    const ext = { ...obj(now.data.ext) };
    const mine = { ...obj(ext.entire) };
    delete mine.create_unanswered;
    if (Object.keys(mine).length) ext.entire = mine;
    else delete ext.entire;
    if (!binds.includes(key))
      writes.set(
        now.path,
        render(
          'change',
          { ...now.data, binds: [...binds, key], ext: Object.keys(ext).length ? ext : undefined },
          now.body,
        ),
      );
    if (!binds.includes(key))
      events.push({ op: 'set', key: rec.key, type: 'change', path: rec.path, fields: ['binds'], writer: env.writer });
  }
  if (writes.size) {
    const touched = [...writes.keys()];
    const prior = snapshot(
      store,
      touched.filter((r) => !created.includes(r)),
    );
    for (const [rel, t] of writes) writeFile(store, rel, t);
    validateOrUndo(store, touched, created, prior);
    result.commit = finishWrite(
      store,
      `pjman: trail ${rec.key} (${result.acts.join(', ') || 'read'})`,
      env.session,
      events,
    );
  }
  // merged on Entire: the person's merge, wherever they made it, ends the change
  // (a merge read in this run and not known before: a change reopened after its merge is not ended a second time by
  // the same merge)
  if (state.change?.status === 'merged' && !state.ended && status === 'review') {
    loaded = loadStore(store);
    set(store, rec.key, ['status=done'], {
      session: opts.session,
      because: `its branch was merged through Trail #${state.number} on Entire`,
    });
    result.done = true;
    const closing = reconcileTrail(store, changeKey, opts);
    if (closing) {
      result.acts.push(...closing.acts);
      result.state = closing.state ?? result.state;
      result.pending.push(...closing.pending.filter((p) => !result.pending.includes(p)));
    }
  }
  return result;
}

/** The changes of the project whose Trail may need work: in motion, or bound to a Trail that is not closed. */
export function trailCandidates(loaded: Loaded, project: string): Rec[] {
  return loaded.records.filter((r) => {
    if (r.type !== 'change' || !r.valid || r.data.project !== project || r.data.kind === 'milestone') return false;
    const t = trailOf(loaded, r);
    if (t) return t.state?.status !== 'closed';
    return r.data.status === 'active' || r.data.status === 'review';
  });
}

/** What one reconcile did, in the lines a command prints. */
export function trailLines(r: TrailReconcile, printed: (key: string) => string = (k) => k): string[] {
  const out: string[] = [];
  if (r.state)
    out.push(
      `entire: ${printed(r.change)} ${r.acts.length ? `${r.acts.join(', ')} · ` : ''}${trailLine(r.state)}${r.state.url ? ` (${r.state.url})` : ''}`,
    );
  if (r.pushed) out.push(`entire: pushed ${r.pushed} to origin (a Trail is created with its branch)`);
  if (r.unstarted)
    out.push(
      `entire: ${printed(r.change)} has no Trail: starting one pushes ${r.unstarted} to origin (pjman sync entire --start ${printed(r.change)})`,
    );
  for (const m of r.moved) out.push(`entire: ${m}`);
  if (r.done) out.push(`entire: ${printed(r.change)} is done (merged on Entire)`);
  for (const p of r.pending) out.push(`entire: pending (${p})`);
  return out;
}
