// History: what came before on a part of the product (change:branch-sources). The changes naming a node, their
// decisions and their sources, read for one node or for the node and every parent up the map, indexed by node with the
// nearest first. Reached for on demand; a change's context carries none of it (decision branch-sources/level-cut). It
// answers as an index (aspect:index-then-getter): the counts of every kind, the changes a line each, the decisions and
// the sources only when asked for, narrowed by words; the depth of a record is its getter's.
import { CliError, plural } from '../store/util.js';
import type { Loaded, Rec } from '../store/records.js';
import { effectsOf, levelOf, live, treeIndex } from './tree.js';
import { decisionsOf, nameAndLine, row, sourcesOf } from './view.js';

export const HISTORY_KINDS = ['changes', 'decisions', 'sources'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export interface HistoryDecision {
  key: string;
  name?: string;
  gist?: string;
  status?: string;
}

export interface HistorySource {
  key: string;
  relation: 'binds' | 'links';
  title?: string;
  url?: string;
}

export interface HistoryChange {
  key: string;
  name?: string;
  gist?: string;
  status?: string;
  created?: string;
  /** How the change names this node: adds, changes or removes. */
  effect: string;
  /** Present when decisions were asked for. */
  decisions?: HistoryDecision[];
  /** Present when sources were asked for. */
  sources?: HistorySource[];
}

export interface HistoryNode {
  key: string;
  name?: string;
  title?: string;
  level: string;
  /** Everything on the node, whatever was asked for or matched: its changes, their decisions, their distinct sources. */
  counts: Record<HistoryKind, number>;
  /** The changes naming this node itself (never one beneath it), newest first: each that is shown, or that carries a
   *  decision or a source that is. */
  changes: HistoryChange[];
}

export interface History {
  /** The change or the node asked about. */
  of: string;
  /** The node alone, or the node and every parent up the map. */
  reach: 'node' | 'branch';
  /** The kinds printed: the changes alone unless others were asked for. */
  kinds: HistoryKind[];
  /** The words every record shown carries, when the read was narrowed. */
  match?: string;
  /** Nearest first: the node (for a change, each node it names), then each parent. Empty for a change naming none. */
  nodes: HistoryNode[];
}

/** The nodes a reference stands for: a feature is itself; a change is the nodes it names, once each. */
function namedNodes(loaded: Loaded, rec: Rec): Rec[] {
  if (rec.type === 'feature') return [rec];
  const out: Rec[] = [];
  for (const e of effectsOf(rec)) {
    const f = live(loaded, e.key);
    if (f?.type === 'feature' && !out.some((o) => o.key === f.key)) out.push(f);
  }
  return out;
}

/** The nodes and every parent feature above them, nearest first, each once. The product is no level: a change names
 *  features, never the product. */
function branchOfNodes(loaded: Loaded, start: Rec[]): Rec[] {
  const out: Rec[] = [];
  const seen = new Set<string>();
  let level = start;
  while (level.length) {
    const next: Rec[] = [];
    for (const f of level) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      out.push(f);
      const parent = live(loaded, f.data.parent);
      if (parent?.type === 'feature') next.push(parent);
    }
    level = next;
  }
  return out;
}

export interface HistoryOpts {
  /** The node alone, without its parents. */
  node?: boolean;
  /** The kinds to print; none: the changes. */
  kinds?: HistoryKind[];
  /** Words a record must all carry (in its key, name, gist or title) to be shown. */
  match?: string;
}

export function history(loaded: Loaded, key: string, opts: HistoryOpts = {}): History {
  const rec = live(loaded, key);
  if (!rec || (rec.type !== 'change' && rec.type !== 'feature'))
    throw new CliError(
      `pjman history reads a change or a node of the map; ${key} is ${rec ? `a ${rec.type}` : 'neither'}`,
    );
  const kinds: HistoryKind[] = opts.kinds?.length ? HISTORY_KINDS.filter((k) => opts.kinds!.includes(k)) : ['changes'];
  const words = (opts.match ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (...texts: (string | undefined)[]): boolean => {
    const hay = texts.filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const named = namedNodes(loaded, rec);
  const nodes = opts.node ? named : branchOfNodes(loaded, named);
  const naming = treeIndex(loaded).naming;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    of: rec.key,
    reach: opts.node ? 'node' : 'branch',
    kinds,
    ...(words.length ? { match: words.join(' ') } : {}),
    nodes: nodes.map((f) => {
      const counts = { changes: 0, decisions: 0, sources: 0 };
      const distinct = new Set<string>();
      const changes: HistoryChange[] = [];
      const on = (naming.get(f.key) ?? [])
        // a change asking about its own branch is not its own history
        .filter((c) => c.key !== rec.key)
        .toSorted((a, b) => (str(b.data.created) ?? '').localeCompare(str(a.data.created) ?? ''));
      for (const c of on) {
        const r = row(c);
        const all = {
          decisions: decisionsOf(loaded, c.key).map((d): HistoryDecision => {
            const dr = row(d);
            return { key: d.key, name: dr.name, gist: dr.gist, status: dr.status };
          }),
          sources: sourcesOf(loaded, c).map((s): HistorySource => ({
            key: s.key,
            relation: s.relation,
            title: s.record?.title,
            url: s.url,
          })),
        };
        counts.changes++;
        counts.decisions += all.decisions.length;
        for (const s of all.sources) distinct.add(s.key);
        // a change that carries the words is shown with all that was asked for beneath it; one that does not is shown
        // for what beneath it does
        const own = kinds.includes('changes') && hit(c.key, r.name, r.gist);
        const decisions = kinds.includes('decisions')
          ? all.decisions.filter((d) => own || hit(d.key, d.name, d.gist))
          : undefined;
        const sources = kinds.includes('sources') ? all.sources.filter((s) => own || hit(s.key, s.title)) : undefined;
        if (words.length && !own && !decisions?.length && !sources?.length) continue;
        changes.push({
          key: c.key,
          name: r.name,
          gist: r.gist,
          status: r.status,
          created: r.created,
          effect: effectsOf(c).find((e) => live(loaded, e.key)?.key === f.key)?.effect ?? 'changes',
          ...(decisions ? { decisions } : {}),
          ...(sources ? { sources } : {}),
        });
      }
      counts.sources = distinct.size;
      return {
        key: f.key,
        name: str(f.data.name),
        title: str(f.data.title),
        level: levelOf(loaded, f),
        counts,
        changes,
      };
    }),
  };
}

const sourceLine = (s: HistorySource): string =>
  `${s.key}${s.title ? ` — ${s.title}` : ''}${s.url && s.url !== s.key.slice('url:'.length) ? ` (${s.url})` : ''}`;

export function formatHistory(h: History): string {
  const has = (k: HistoryKind) => h.kinds.includes(k);
  if (!h.nodes.length)
    return `# history of ${h.of}\n\n${h.of} names no node on the map, so there is no history to read for it (pjman set ${h.of} features+=feature:<slug> names one)\n`;
  const reach =
    h.reach === 'node'
      ? h.nodes.length === 1
        ? 'the node alone'
        : `the ${h.nodes.length} nodes it names, each alone`
      : `${plural(h.nodes.length, 'node')}, nearest first`;
  const out = [`# history of ${h.of} — ${reach}${h.match ? `, matching "${h.match}"` : ''}`];
  for (const n of h.nodes) {
    const label = n.name && n.title && n.name !== n.title ? `${n.name}: ${n.title}` : (n.title ?? n.name ?? '');
    out.push(`\n## ${n.key} (${n.level})${label ? ` — ${label}` : ''}`);
    if (!n.counts.changes) {
      out.push(h.of.startsWith('change:') ? 'no other change names it' : 'no change names it');
      continue;
    }
    // everything on the node counted, and what was not asked for named by the flag that prints it
    const count = (k: HistoryKind, word: string) =>
      `${plural(n.counts[k], word)}${!has(k) && n.counts[k] ? ` (--${k})` : ''}`;
    out.push([count('changes', 'change'), count('decisions', 'decision'), count('sources', 'source')].join(', '));
    const before = out.length;
    if (has('changes')) {
      // each change a line, what was asked for of its decisions and sources beneath it
      for (const c of n.changes) {
        out.push(
          `- ${c.key} [${c.status ?? '?'}]${c.created ? ` ${c.created}` : ''} ${c.effect} — ${nameAndLine({ name: c.name, gist: c.gist })}`,
        );
        for (const d of c.decisions ?? [])
          out.push(`  - ${d.key} [${d.status ?? '?'}] — ${nameAndLine({ name: d.name, gist: d.gist })}`);
        for (const s of c.sources ?? []) out.push(`  - ${s.relation} ${sourceLine(s)}`);
      }
    } else {
      // without the changes, each kind is a flat list: a decision's key names its change, a source says which link it
      for (const c of n.changes)
        for (const d of c.decisions ?? [])
          out.push(`- ${d.key} [${d.status ?? '?'}] — ${nameAndLine({ name: d.name, gist: d.gist })}`);
      const by = new Map<string, { source: HistorySource; changes: string[] }>();
      for (const c of n.changes)
        for (const s of c.sources ?? []) {
          const e = by.get(s.key) ?? { source: s, changes: [] };
          e.changes.push(c.key);
          by.set(s.key, e);
        }
      for (const { source, changes } of by.values()) out.push(`- ${sourceLine(source)} · ${changes.join(', ')}`);
    }
    if (h.match && out.length === before) out.push('nothing here matches');
  }
  out.push('\nthe depth of one: pjman context <change> · pjman show <decision>');
  return out.join('\n') + '\n';
}
