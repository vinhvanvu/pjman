// A change becomes a milestone where it stands (change:promote-to-milestone). A milestone's plan is its children
// (decision milestone-kind/kind-not-children), so the steps it carries are settled by the write that promotes it:
// each open step is filed as a child change (decision steps-on-a-milestone, to-children) and is left on the plan
// dropped, its note naming the child (decision step-once-filed); the steps it finished or dropped stay as its earlier
// steps. Work already on its branch goes with one child, which links the branch and takes its Trail (decision
// work-on-the-branch); a status that followed the plan goes back to open (decision status-at-promotion). The whole
// promotion is one write: `pjman undo <commit>` puts the plan back and takes the children out.
import path from 'node:path';
import type { Store } from '../store/config.js';
import type { Loaded, Rec } from '../store/records.js';
import { slugify } from '../store/keys.js';
import { CliError, nowIso, today } from '../store/util.js';
import { git } from '../store/git.js';
import { TRAIL_KIND } from '../entire/trail.js';
import { branchNameFor, worktreeNameFor } from '../model/branch.js';
import { sections as parseSections } from '../store/frontmatter.js';
import { foundationHash, foundationOf, stepIsOpen, stepsOf } from '../model/foundation.js';
import { branchOf, observedBranches, ownBranches } from '../model/view.js';
import { baseBranch, localHeads, mergedInto } from '../store/merged.js';
import { render } from './write.js';

/** The statuses that follow a plan by themselves (ops/lift): on a milestone they would follow a plan it has not. */
export const FOLLOWS_PLAN = new Set(['planning', 'active', 'review']);

export interface Promotion {
  /** The child changes to write, one per open step, in the plan's order. */
  children: { key: string; rel: string; text: string }[];
  /** What the promotion did, one line each, for the command to say. */
  notes: string[];
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A slug for the child a step becomes: the step's first words, free in the product. */
function childSlug(text: string, taken: (slug: string) => boolean, fallback: string): string {
  const words = slugify(text).split('-').filter(Boolean);
  let base = '';
  for (const w of words.slice(0, 6)) {
    if (base && base.length + w.length + 1 > 48) break;
    base = base ? `${base}-${w}` : w;
  }
  if (!/^[a-z]/.test(base)) base = fallback;
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** The branch the change's work is on, and whether it holds commits not yet merged. Inside the project's repository
 *  the repository says; elsewhere only a branch a session was seen on, or one the change links, is known, and what it
 *  holds is not. */
export function branchAt(
  store: Store,
  loaded: Loaded,
  rec: Rec,
): { name: string; unmerged: boolean | undefined } | undefined {
  const seen = branchOf(rec, observedBranches(loaded));
  const dir = store.projectDir;
  if (!dir || rec.data.project !== store.project) {
    const linked = [...list(rec.data.binds), ...list(rec.data.links)].some((k) => k.startsWith('branch:'));
    return seen.observed || linked ? { name: seen.name, unmerged: undefined } : undefined;
  }
  try {
    const base = baseBranch(dir);
    const local = git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n');
    // the branch the views name, then its own among the repository's branches by its name, before a name to look for
    // (change:branch-line-own-branch; the order branchesOf in sync/git.ts gives)
    const heads = localHeads(dir);
    const shown = branchOf(rec, observedBranches(loaded), undefined, () => heads).name;
    const mine = ownBranches(loaded, rec, heads).map((l) => l.name);
    const name = [...new Set([shown, ...mine, branchNameFor(rec.key, undefined), worktreeNameFor(rec.key)])].find(
      (b) => b !== base && local.includes(b),
    );
    if (!name) return undefined;
    const ahead = Number(git(dir, ['rev-list', '--count', `${base}..${name}`]).trim()) > 0;
    const unmerged = ahead && !mergedInto(dir, name, { base, named: `change:${rec.changeSlug}` });
    return { name, unmerged };
  } catch {
    return undefined; // the repository did not answer: nothing is known of a branch, and nothing is refused on a guess
  }
}

/** Promote `rec`, whose data as it will be written is `data` (its kind already milestone): settles its plan and its
 *  status in place on `data`, and answers the children to write beside it. Refused where work would be stranded. */
export function promote(
  store: Store,
  loaded: Loaded,
  rec: Rec,
  data: Record<string, unknown>,
  env: { writer?: string; session?: string },
  opts: { statusGiven: boolean },
): Promotion {
  const notes: string[] = [];
  const steps = stepsOf(data);
  const open = steps.map((step, i) => ({ step, n: i + 1 })).filter((s) => stepIsOpen(s.step));
  const branch = branchAt(store, loaded, rec);
  // a milestone merges nothing: with no step left to become a child, unmerged work would have no change to land it
  if (!open.length && branch?.unmerged)
    throw new CliError(
      `${rec.key} is not made a milestone: its branch ${branch.name} holds work that is not merged, a milestone merges nothing, and it has no open step to carry the branch on as a child; merge it first (pjman merge ${rec.key}), then set kind=milestone`,
    );

  const product = rec.productSlug!;
  const used = new Set<string>();
  const taken = (slug: string) => {
    const key = `change:${product}/${slug}`;
    return used.has(slug) || loaded.byKey.has(key) || loaded.aliases.has(key);
  };
  // the work in progress goes on in the child it belongs to: the step in work, else the first still to do
  const carrier = open.find((s) => s.step.state === 'active') ?? open[0];
  const trails = list(data.binds).filter((k) => k.startsWith(`${TRAIL_KIND}:`));
  const created = today();
  const at = nowIso();
  const children: Promotion['children'] = [];
  const plan = Array.isArray(data.plan) ? (data.plan as Record<string, unknown>[]).map((s) => ({ ...s })) : [];
  // the plan as stored may hold a malformed entry stepsOf leaves out: a step is found again by its place among the read ones
  const stored = plan.filter((s) => typeof s?.text === 'string' && s.text);

  for (const { step, n } of open) {
    const slug = childSlug(step.text, taken, `${rec.changeSlug}-step-${n}`);
    used.add(slug);
    const key = `change:${product}/${slug}`;
    // a branch whose work is already merged has nothing to carry on: it is left where it is, with its Trail
    const takes = carrier?.n === n && !!branch && branch.unmerged !== false;
    const who = [env.session, created].filter(Boolean).join(', ');
    const body =
      `## Origin\n\nfrom ${rec.key}, step ${n} of its plan when it became a milestone\n\n— ${who}\n` +
      (step.note
        ? `\n## Notes\n\nThe step's note, as it stood${step.state === 'active' ? ' (the step was in work)' : ''}: ${step.note}\n`
        : '');
    const child: Record<string, unknown> = {
      gist: step.text.split('\n')[0].trim(),
      status: 'open',
      project: data.project,
      parent: rec.key,
      binds: takes && trails.length ? trails : undefined,
      links: takes ? [`branch:${branch.name}`] : undefined,
      rungs_from: foundationHash(foundationOf('change', {}, parseSections(body))),
      writer: env.writer,
      session: env.session,
      created,
    };
    children.push({
      key,
      rel: path.join('products', product, 'changes', slug, 'change.md'),
      text: render('change', child, body),
    });
    const s = stored[n - 1];
    s.state = 'dropped';
    s.note = `became ${key}`;
    s.at = at;
    notes.push(`step ${n} filed as ${key}; it needs its name, intent and done-when before it is worked`);
    if (takes)
      notes.push(
        `${key} takes the branch ${branch.name}${trails.length ? ' and its Trail' : ''}: the work on it goes on there and merges with that change`,
      );
  }
  if (open.length) {
    data.plan = plan;
    if (trails.length && carrier && branch && branch.unmerged !== false) {
      const rest = list(data.binds).filter((k) => !trails.includes(k));
      if (rest.length) data.binds = rest;
      else delete data.binds;
    }
  }
  if (!opts.statusGiven && FOLLOWS_PLAN.has(String(data.status))) {
    notes.push(`status back to open from ${String(data.status)}: it followed a plan the milestone no longer has`);
    data.status = 'open';
  }
  return { children, notes };
}
