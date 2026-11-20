// A change's key decision (change:key-decisions): the one the rest of the change is built on. Each decision names the
// decisions it rests on (depends_on); the key one is the first node of the change's tree whose outcome the others
// follow, the decision the most others on the change depend on (directly or through another), the earliest on a tie.
// It is derived, like status, and never written. A decision that stands alone yet plainly decides the change is not
// masked: the agent marks it key by hand (a `key` entry in its thread, with the reason against the bar), and the mark
// holds only while no decision on the change has dependents; once a tree forms the tree decides, and a hand mark it
// leaves out is said as a conflict, never dropped silently (decision key-decisions/how-key-is-found).
import { memo, ofType, resolve, type Loaded, type Rec } from '../store/records.js';
import { decisionState, threadOf } from './foundation.js';

/** How a change's key decision was found, and why it is key. */
export interface KeyDecision {
  /** The decision's key. */
  key: string;
  /** `tree`: the most others on the change rest on it; `mark`: marked by hand, standing alone. */
  how: 'tree' | 'mark';
  /** The decisions on the change that rest on it, directly or through another (none for a hand mark). */
  dependents: string[];
  /** The hand mark's reason against the bar, when it carries one. */
  why?: string;
  /** A hand mark the tree overrides: the decision marked, and its reason. */
  conflict?: { key: string; why?: string };
}

/** The keys a decision's `depends_on` names, as written. */
export function dependsOnOf(data: Record<string, unknown>): string[] {
  const v = data.depends_on;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** The decisions that count toward a change's tree: valid and in force (proposed or decided). */
function liveDecisions(loaded: Loaded): Map<string, Rec[]> {
  return memo(loaded, 'key-decision:by-change', () => {
    const by = new Map<string, Rec[]>();
    for (const d of ofType(loaded, 'decision')) {
      if (!d.valid || !d.changeKey) continue;
      if (d.data.status !== 'proposed' && d.data.status !== 'decided') continue;
      const list = by.get(d.changeKey) ?? [];
      list.push(d);
      by.set(d.changeKey, list);
    }
    return by;
  });
}

/** When a decision came to be: its creation date, then its first entry, then its key, so a tie reads the same twice. */
function order(a: Rec, b: Rec): number {
  const first = (r: Rec) => threadOf(r.data)[0]?.at ?? '';
  return (
    String(a.data.created ?? '').localeCompare(String(b.data.created ?? '')) ||
    first(a).localeCompare(first(b)) ||
    a.key.localeCompare(b.key)
  );
}

/** The hand mark in force on a decision: its reason, or undefined when it carries none. */
export function handMarkOf(rec: Rec): { why?: string } | undefined {
  return decisionState(threadOf(rec.data)).keyMark;
}

/** The change's key decision, or undefined when none clears the bar. */
export function keyDecisionOf(loaded: Loaded, changeKey: string): KeyDecision | undefined {
  return memo(loaded, `key-decision:${changeKey}`, () => derive(loaded, changeKey));
}

function derive(loaded: Loaded, changeKey: string): KeyDecision | undefined {
  const decisions = liveDecisions(loaded).get(changeKey) ?? [];
  if (!decisions.length) return undefined;
  const on = new Set(decisions.map((d) => d.key));
  // the edges inside the change: each decision to the ones it rests on
  const rests = new Map<string, string[]>();
  for (const d of decisions) {
    const to: string[] = [];
    for (const raw of dependsOnOf(d.data)) {
      const res = resolve(loaded, raw);
      if ((res.status === 'ok' || res.status === 'alias') && on.has(res.rec.key) && res.rec.key !== d.key)
        to.push(res.rec.key);
    }
    rests.set(d.key, to);
  }
  // each decision's dependents, through any path
  const dependents = new Map<string, Set<string>>();
  for (const d of decisions) {
    const seen = new Set<string>();
    const stack = [...(rests.get(d.key) ?? [])];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k) || k === d.key) continue;
      seen.add(k);
      stack.push(...(rests.get(k) ?? []));
    }
    for (const k of seen) {
      const set = dependents.get(k) ?? new Set<string>();
      set.add(d.key);
      dependents.set(k, set);
    }
  }
  const marked = decisions.filter((d) => handMarkOf(d)).toSorted(order);
  const ranked = decisions
    .filter((d) => (dependents.get(d.key)?.size ?? 0) > 0)
    .toSorted((a, b) => dependents.get(b.key)!.size - dependents.get(a.key)!.size || order(a, b));
  const root = ranked[0];
  if (root) {
    const mark = handMarkOf(root);
    const left = marked.find((d) => d.key !== root.key);
    return {
      key: root.key,
      how: 'tree',
      dependents: [...dependents.get(root.key)!].toSorted(),
      ...(mark?.why ? { why: mark.why } : {}),
      ...(left
        ? { conflict: { key: left.key, ...(handMarkOf(left)?.why ? { why: handMarkOf(left)!.why } : {}) } }
        : {}),
    };
  }
  const hand = marked[0];
  if (!hand) return undefined;
  return {
    key: hand.key,
    how: 'mark',
    dependents: [],
    ...(handMarkOf(hand)?.why ? { why: handMarkOf(hand)!.why } : {}),
  };
}

/** One line for a key decision: why it is key. */
export function keyLine(k: KeyDecision): string {
  if (k.how === 'tree')
    return `${k.dependents.length} decision${k.dependents.length === 1 ? '' : 's'} on the change rest${k.dependents.length === 1 ? 's' : ''} on it${k.why ? `; ${k.why}` : ''}`;
  return `marked key by hand, standing alone${k.why ? `: ${k.why}` : ''}`;
}

/** The conflict, said: a hand mark the tree overrides. */
export function conflictLine(k: KeyDecision): string | undefined {
  if (!k.conflict) return undefined;
  return `${k.conflict.key} is marked key by hand, but the tree names ${k.key}: name the edge (pjman decision ${k.conflict.key} --depends-on …, or the others on it) or unmark it (--unmark-key "why")`;
}
