// The change tree's model (change:change-detail; decisions mirror-the-session-page, one-tree-two-variables): what the
// one tree reads at either width, on the change's own page, in the map's side panel and on the session page, as pure
// derivations. The change bar is the session bar read from the change's axis: who is on it now, how many sessions over
// how long, when it was last touched, what waits. The plan's head and bar, the wide plan's fold of what is behind it,
// the path line's facts, the sources' rows and their one-line sum.
import type { ChangeContext, ScopeNode } from '@/data/contract';
import { agoWords, durationWords, plural } from '@/lib/format';
import { short } from '@/lib/keys';

/** 'nothing waits on you', '1 waits on you', 'N wait on you'. */
export function waitsLine(n: number): string {
  if (n === 0) return 'nothing waits on you';
  return n === 1 ? '1 waits on you' : `${n} wait on you`;
}

type Step = ChangeContext['plan'][number];
export type Segment = 'done' | 'on' | 'open' | 'dropped';

/** The bar's order (change:step-bar-in-order): done first, then the one on, then open, dropped last and faint, whatever
 *  order the steps were worked in. */
const SEGMENT_ORDER: readonly Segment[] = ['done', 'on', 'open', 'dropped'];
export const sortSegments = (segments: readonly Segment[]): Segment[] =>
  segments.toSorted((a, b) => SEGMENT_ORDER.indexOf(a) - SEGMENT_ORDER.indexOf(b));

/** The plan's head and bar: "step 2 of 4", the dropped counted apart; a segment a step, in the bar's order; the row
 *  docked shows. */
export function planView(plan: readonly Step[]): { sum: string; segments: Segment[]; row?: Step } {
  const counted = plan.filter((s) => s.state !== 'dropped');
  const dropped = plan.length - counted.length;
  const active = counted.find((s) => s.state === 'active');
  const next = active ?? counted.find((s) => s.state === 'open');
  const n = next ? counted.indexOf(next) + 1 : undefined;
  const sum = !plan.length
    ? 'no steps yet'
    : n
      ? `step ${n} of ${counted.length}`
      : counted.length
        ? `all ${counted.length} steps done`
        : 'every step dropped';
  const segments = sortSegments(
    plan.map((s) => (s.state === 'done' ? 'done' : s === active ? 'on' : s.state === 'dropped' ? 'dropped' : 'open')),
  );
  return { sum: dropped ? `${sum} · ${dropped} dropped` : sum, segments, row: next ?? counted.at(-1) };
}

/** The wide plan's fold (decision mirror-the-session-page): what is behind the work folds to one line above it, the
 *  steps done and dropped, so the step the work is on leads; the last done step stays out as the way in. A short plan
 *  folds nothing. */
export function planFold(plan: readonly Step[], keep = 3): { folded: Step[]; shown: Step[]; sum?: string } {
  const behind = plan.filter((s) => s.state === 'done' || s.state === 'dropped');
  if (plan.length <= keep + 1 || behind.length < 2) return { folded: [], shown: [...plan], sum: undefined };
  const lastDone = behind.findLast((s) => s.state === 'done');
  const folded = behind.filter((s) => s !== lastDone);
  const done = folded.filter((s) => s.state === 'done').length;
  const dropped = folded.length - done;
  const sum = [done ? `${done} done` : '', dropped ? `${dropped} dropped` : ''].filter(Boolean).join(' · ');
  return { folded, shown: plan.filter((s) => !folded.includes(s)), sum };
}

/** A feature effect as written: "adds feature:x" → adds x; a bare key changes it. */
export function effectsOf(features: unknown): { effect: string; key: string }[] {
  if (!Array.isArray(features)) return [];
  return features
    .filter((f): f is string => typeof f === 'string')
    .map((f) => {
      const i = f.indexOf(' ');
      return i > 0 ? { effect: f.slice(0, i), key: f.slice(i + 1) } : { effect: 'changes', key: f };
    });
}

/** The feature names the map knows, by key: the path line names features by them. */
export function featureNames(tree: readonly ScopeNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (nodes: readonly ScopeNode[]) => {
    for (const n of nodes) {
      if (n.name ?? n.title) out.set(n.key, n.name ?? n.title!);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The release a change shipped in, as the path line says it: in full once it is done, in part while it is not. */
export function shippedWords(ctx: Pick<ChangeContext, 'releases' | 'change'>): string | undefined {
  const last = ctx.releases?.at(-1);
  if (!last) return undefined;
  const v = `v${last.version.replace(/^v/, '')}`;
  return ctx.change.status === 'done' ? `shipped in ${v}` : `shipped in part in ${v}`;
}

type Source = ChangeContext['sources'][number];

/** The sources as rows: the branch and whether a session was seen on it, the links, the files; and the one-line sum
 *  the head says. */
export function sourcesView(ctx: Pick<ChangeContext, 'sources' | 'branch'>): {
  branch?: { name: string; observed: boolean };
  links: Source[];
  files: Source[];
  sum: string;
} {
  const files = ctx.sources.filter((s) => s.key.startsWith('file:'));
  const links = ctx.sources.filter((s) => !s.key.startsWith('file:'));
  const sum = [
    ctx.branch ? `branch ${ctx.branch.name}` : '',
    links.length ? plural(links.length, 'link') : '',
    files.length ? plural(files.length, 'file') : 'no files yet',
  ]
    .filter(Boolean)
    .join(' · ');
  return { branch: ctx.branch, links, files, sum };
}

/** The identity row's label: where the session is now, or what the person is viewing instead. */
export const identityLabel = (isViewing: boolean, kind: 'change' | 'bug' | 'milestone' = 'change'): string =>
  `${isViewing ? 'viewing' : 'on now'} · ${kind}`;

/** A session is working the change now (change:alive-step-bars): one of the scope's live sessions is on this change
 *  itself, not a child beneath it, and works by the bridge's rule; a stopped or waiting session leaves the bar still. */
export const workingOn = (sessions: readonly { on?: string; state: string }[], key: string): boolean =>
  sessions.some((s) => s.on === key && s.state === 'working');

interface LiveOne {
  key: string;
  agent?: string;
  onBehalfOf?: string;
}

/** The change bar's parts, in order (decision mirror-the-session-page): who is on it now; how many sessions touched it
 *  over how long, from the first one's first event; when it was last touched; what waits, the last part, in the waits
 *  colour when something does. */
export function changeBar(
  o: { sessions: readonly { key: string; first?: string }[]; live: readonly LiveOne[]; last?: string; waits: number },
  now = Date.now(),
): { parts: string[]; live: boolean; waits: string; alarm: boolean } {
  const parts: string[] = [];
  const [one] = o.live;
  if (o.live.length === 1 && one) {
    const who = one.agent ? short(one.agent) : 'a session';
    parts.push(`${who} on it now${one.onBehalfOf ? `, for ${short(one.onBehalfOf)}` : ''}`);
  } else if (o.live.length > 1) parts.push(`${o.live.length} sessions on it now`);
  const n = o.sessions.length;
  const first = o.sessions
    .map((s) => s.first)
    .filter((t): t is string => !!t)
    .toSorted()[0];
  if (n === 0) parts.push('no session yet');
  else if (n === 1 || !first) parts.push(plural(n, 'session'));
  else parts.push(`${plural(n, 'session')} over ${durationWords(first, o.last ? Date.parse(o.last) : now)}`);
  if (o.last) parts.push(`last touched ${agoWords(o.last, now)}`);
  return { parts, live: o.live.length > 0, waits: waitsLine(o.waits), alarm: o.waits > 0 };
}
