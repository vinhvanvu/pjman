// Intake: what already exists for a request, so the procedure that files it can check for duplicates first and answer
// its four questions (what on the map, one or several, where in the order, when) with the facts in front of it. The
// tool searches exactly; the judgment is the skill's. Never writes.
import type { Store } from './config.js';
import { findReferences, type GetOpts } from './graph.js';
import type { Loaded, Rec } from './records.js';
import { ahead, productOf } from './commands/order.js';
import { progressOf } from './commands/view.js';
import { derivedStatus, effectsOf, levelOf, live, structuralParent } from './tree.js';
import { lineOf } from './foundation.js';

export interface Candidate {
  key: string;
  title?: string;
  /** How much of the request's words it shares, 0..1 on the request's side; a referenced key scores 1. */
  score: number;
  /** The words that matched. */
  words: string[];
}

export interface ChangeCandidate extends Candidate {
  status?: string;
  kind?: string;
  features: string[];
  parent?: string;
  /** Named in the request itself: a ticket, a URL, a key. The duplicate, not a lookalike. */
  referenced: boolean;
}

export interface NodeCandidate extends Candidate {
  name?: string;
  level: string;
  derived: string;
  /** The chain above it, product first. */
  path: string[];
}

export interface Intake {
  text: string;
  words: string[];
  /** Open changes that may already cover the request, best first. */
  duplicates: ChangeCandidate[];
  /** Done changes that covered something like it: for a bug, a regression; for work, the old change to link. */
  done: ChangeCandidate[];
  /** Nodes of the map the request may alter, best first. */
  nodes: NodeCandidate[];
  /** Milestones in flight: parent changes not done, nearest to done first. */
  milestones: { key: string; title?: string; status?: string; progress?: { done: number; total: number }; target?: string }[];
  /** The order's tail: the product, the last entries of its sequence, and how many open changes come after it as later. */
  tail: { product: string | null; sequence: string[]; later: number };
}

const STOP = new Set(('a an the and or of to in on for with by from at as is are be was were it its this that these those we i you he she they ' +
  'our my your their do does did not no so if then than when where which who what how into over under up down out off can could should would will ' +
  'make makes made add adds added new now just also very more most some any all each every one two three please want wants need needs let lets ' +
  'change changes feature features bug bugs fix fixes issue issues work thing things way about like get got have has had').split(/\s+/));

/** The words of a text that carry meaning: lower-cased, letters and digits, three or more characters, not stop words. */
export function words(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOP.has(w)) out.add(stem(w));
  }
  return [...out];
}

/** A light stem so saving matches saves and cards matches card. */
function stem(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  return w;
}

/** Two stems match when one is the other with a trailing vowel dropped (sav / save, colour / colours). */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (s: string) => s.replace(/e$/, '');
  return strip(a) === strip(b);
}

function overlap(ask: string[], haystack: string): { score: number; words: string[] } {
  if (!ask.length) return { score: 0, words: [] };
  const have = words(haystack);
  const hit = ask.filter((w) => have.some((h) => same(w, h)));
  return { score: hit.length / ask.length, words: hit };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function intake(store: Store, loaded: Loaded, text: string, opts: GetOpts = {}): Intake {
  const ask = words(text);
  const refs = findReferences(loaded, text, opts);
  const referenced = new Set(refs.map((r) => r.change).filter((k): k is string => !!k));
  const changes = loaded.records.filter((r) => r.type === 'change' && r.valid);
  const isOpen = (c: Rec) => c.data.status !== 'done' && c.data.status !== 'dropped';

  const candidate = (c: Rec): ChangeCandidate => {
    const hay = `${(c.changeSlug ?? c.key).replace(/-/g, ' ')} ${str(c.data.name) ?? ''} ${lineOf(c.data) ?? ''} ${c.sections.get('Intent') ?? c.sections.get('Summary') ?? ''}`;
    const o = overlap(ask, hay);
    const isRef = referenced.has(c.key);
    return {
      key: c.key, title: lineOf(c.data), score: isRef ? 1 : o.score, words: o.words, status: str(c.data.status), kind: str(c.data.kind),
      features: effectsOf(c).map((e) => live(loaded, e.key)?.key).filter((k): k is string => !!k), parent: live(loaded, c.data.parent)?.key, referenced: isRef,
    };
  };
  const rank = (a: Candidate, b: Candidate) => b.score - a.score || a.key.localeCompare(b.key);
  const keep = (x: Candidate) => x.score >= 0.34 || (x as ChangeCandidate).referenced;
  const duplicates = changes.filter(isOpen).map(candidate).filter(keep).sort(rank).slice(0, 8);
  const done = changes.filter((c) => c.data.status === 'done').map(candidate).filter(keep).sort(rank).slice(0, 5);

  const features = loaded.records.filter((r) => r.type === 'feature' && r.valid);
  const pathOf = (f: Rec): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let cur = structuralParent(loaded, f); cur && !seen.has(cur.key); cur = structuralParent(loaded, cur)) {
      seen.add(cur.key);
      out.unshift(cur.key);
    }
    return out;
  };
  const nodes: NodeCandidate[] = features
    .map((f) => {
      const o = overlap(ask, `${(f.featureSlug ?? f.key).replace(/-/g, ' ')} ${str(f.data.name) ?? ''} ${str(f.data.title) ?? ''} ${f.sections.get('Summary') ?? ''}`);
      return { key: f.key, title: str(f.data.title), name: str(f.data.name), score: o.score, words: o.words, level: levelOf(loaded, f), derived: str(f.data.status) ?? derivedStatus(loaded, f.key).status, path: pathOf(f) };
    })
    .filter((n) => n.score >= 0.2)
    .sort(rank)
    .slice(0, 8);

  const childrenOf = (key: string) => changes.filter((c) => live(loaded, c.data.parent)?.key === key);
  const milestones = changes
    .filter((c) => isOpen(c) && childrenOf(c.key).length > 0)
    .map((c) => ({ key: c.key, title: lineOf(c.data), status: str(c.data.status), progress: progressOf(childrenOf(c.key).map((k) => ({ status: str(k.data.status) }))), target: str(c.data.target) }))
    .sort((a, b) => {
      const share = (p?: { done: number; total: number }) => (p?.total ? p.done / p.total : 0);
      return share(b.progress) - share(a.progress) || a.key.localeCompare(b.key);
    });

  // the tail: the project's product, else the only product
  const products = loaded.records.filter((r) => r.type === 'product' && r.valid);
  const projectRec = store.project ? live(loaded, store.project) : undefined;
  const mine = changes.find((c) => projectRec && live(loaded, c.data.project)?.key === projectRec.key);
  const product = (mine && productOf(loaded, mine)) ?? (products.length === 1 ? products[0] : undefined);
  const sequence = product ? ahead(loaded, product) : [];
  const sequenced = new Set(sequence);
  const onSequence = (c: Rec): boolean => {
    const seen = new Set<string>();
    for (let cur: Rec | undefined = c; cur && !seen.has(cur.key); cur = live(loaded, cur.data.parent)) {
      seen.add(cur.key);
      if (sequenced.has(cur.key)) return true;
    }
    return false;
  };
  const later = product ? changes.filter((c) => isOpen(c) && c.data.kind !== 'bug' && productOf(loaded, c)?.key === product.key && !onSequence(c)).length : 0;
  return { text, words: ask, duplicates, done, nodes, milestones, tail: { product: product?.key ?? null, sequence: sequence.slice(-3), later } };
}

export function formatIntake(i: Intake): string {
  const out: string[] = [`# intake — ${i.text.length > 80 ? i.text.slice(0, 77) + '…' : i.text}`];
  const line = (c: ChangeCandidate) => `- ${c.key} [${c.status ?? '?'}${c.kind === 'bug' ? ', bug' : ''}] — ${c.title ?? ''}${c.referenced ? ' · named in the request' : ` · ${c.words.join(', ')}`}${c.features.length ? ` · ${c.features.join(', ')}` : ''}${c.parent ? ` · under ${c.parent}` : ''}`;
  out.push(`\n## Duplicates (open changes that may already cover it)`);
  out.push(i.duplicates.length ? i.duplicates.map(line).join('\n') : '(none: nothing open shares its words)');
  if (i.done.length) {
    out.push(`\n## Done before (a regression for a bug; the old change to link for work)`);
    out.push(i.done.map(line).join('\n'));
  }
  out.push(`\n## Nodes (what on the map it may alter; name the most specific)`);
  out.push(i.nodes.length ? i.nodes.map((n) => `- ${n.key} (${n.level}, ${n.derived}) — ${n.name ?? n.title ?? ''}${n.path.length ? ` · under ${n.path.join(' › ')}` : ''} · ${n.words.join(', ')}`).join('\n') : '(none: no feature shares its words; a new capability only if it is a behaviour a user would recognise)');
  out.push(`\n## Milestones in flight (nearest to done first)`);
  out.push(i.milestones.length ? i.milestones.map((m) => `- ${m.key} [${m.status ?? '?'}]${m.progress ? ` ${m.progress.done}/${m.progress.total}` : ''}${m.target ? ` · target ${m.target}` : ''} — ${m.title ?? ''}`).join('\n') : '(none)');
  out.push(`\n## The order's tail${i.tail.product ? ` (${i.tail.product})` : ''}`);
  out.push(i.tail.sequence.length ? `… ${i.tail.sequence.join(' → ')}` : '(the sequence is empty)');
  out.push(`${i.tail.later} open change${i.tail.later === 1 ? '' : 's'} after it as later`);
  return out.join('\n') + '\n';
}
