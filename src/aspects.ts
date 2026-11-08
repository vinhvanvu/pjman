// Aspects: what applies across a product, recorded once and linked to every place it applies (change:aspects;
// decision aspect-shape). An aspect's body is the base, the one source of truth; a place names the feature it applies
// at, and its body is the fork, only what differs there (empty: the base as it is). A place is read as the base, then
// the forks of the places above it on the tree, then its own, each marked with where it came from. The store holds no
// shape for either text: the aspect skill shapes them.
import { EFFECTS, type EffectName } from './tree.js';
import { parseKey } from './keys.js';
import { resolve, type Loaded, type Rec } from './records.js';
import { threadOf } from './foundation.js';

export interface AspectEffect {
  effect: EffectName;
  key: string;
}

/** `adds aspect:x`, `changes aspect:x/place`, `removes aspect:x`, or a bare key (changes): what a change does to an aspect. */
export function parseAspectEffect(raw: unknown): AspectEffect | null {
  if (typeof raw !== 'string') return null;
  const m = /^(?:(adds|changes|removes)\s+)?(\S+)$/.exec(raw.trim());
  if (!m) return null;
  const key = parseKey(m[2]);
  if (!key || key.kind !== 'aspect') return null;
  return { effect: (m[1] as EffectName | undefined) ?? 'changes', key: key.raw };
}

const live = (loaded: Loaded, raw: unknown, scope: string | null): Rec | undefined => {
  const r = typeof raw === 'string' ? resolve(loaded, raw, scope) : null;
  return r && (r.status === 'ok' || r.status === 'alias') ? r.rec : undefined;
};

/** The places under an aspect, in key order. */
export function placesOf(loaded: Loaded, aspect: Rec): Rec[] {
  return loaded.records.filter((r) => r.type === 'place' && r.aspectKey === aspect.key).sort((a, b) => a.key.localeCompare(b.key));
}

/** The feature a place applies at, resolved. */
export function featureOfPlace(loaded: Loaded, place: Rec): Rec | undefined {
  const f = live(loaded, place.data.feature, place.productSlug ?? null);
  return f?.type === 'feature' ? f : undefined;
}

/** A feature and every feature above it, nearest first. */
export function featureChain(loaded: Loaded, feature: Rec): Rec[] {
  const out: Rec[] = [];
  const seen = new Set<string>();
  for (let cur: Rec | undefined = feature; cur && cur.type === 'feature' && !seen.has(cur.key); ) {
    out.push(cur);
    seen.add(cur.key);
    cur = live(loaded, cur.data.parent, cur.productSlug ?? null);
  }
  return out;
}

/** True when `feature` is `ancestor` or beneath it. */
export function isWithin(loaded: Loaded, feature: Rec, ancestor: Rec): boolean {
  return featureChain(loaded, feature).some((f) => f.key === ancestor.key);
}

export interface Layer {
  /** The record the text comes from: the aspect (the base) or a place (a fork). */
  from: string;
  /** The feature a fork applies at; none for the base. */
  at?: string;
  text: string;
}

export interface AspectAt {
  aspect: string;
  title: string;
  /** The place nearest the feature, the one that covers it. */
  place: string;
  /** The feature that place applies at: the feature itself, or one above it. */
  at: string;
  /** The base, then each fork from the top of the tree down; a place with an empty body adds no layer. */
  layers: Layer[];
}

/** The aspect read at one feature: its base, then the forks of its places at or above the feature, outermost first.
 *  Undefined when no place of the aspect covers the feature. */
export function aspectAt(loaded: Loaded, aspect: Rec, feature: Rec): AspectAt | undefined {
  const chain = featureChain(loaded, feature);
  const covering = placesOf(loaded, aspect)
    .map((p) => ({ p, f: featureOfPlace(loaded, p) }))
    .filter((x): x is { p: Rec; f: Rec } => !!x.f && chain.some((c) => c.key === x.f!.key))
    .sort((a, b) => chain.findIndex((c) => c.key === b.f.key) - chain.findIndex((c) => c.key === a.f.key));
  if (!covering.length) return undefined;
  const layers: Layer[] = [];
  if (aspect.body.trim()) layers.push({ from: aspect.key, text: aspect.body.trim() });
  for (const { p, f } of covering) if (p.body.trim()) layers.push({ from: p.key, at: f.key, text: p.body.trim() });
  const nearest = covering[covering.length - 1];
  return { aspect: aspect.key, title: String(aspect.data.title ?? aspect.key), place: nearest.p.key, at: nearest.f.key, layers };
}

export interface PlaceLine {
  place: string;
  feature: string;
  forked: boolean;
}

export const placeLine = (loaded: Loaded, p: Rec): PlaceLine => ({ place: p.key, feature: featureOfPlace(loaded, p)?.key ?? String(p.data.feature ?? ''), forked: !!p.body.trim() });

/** What a change works under, from the features it names: for each feature, every aspect whose place is at that
 *  feature or above it, read in full; and the places beneath a feature it names, one line each. */
export function aspectsForFeatures(loaded: Loaded, features: Rec[]): { at: AspectAt[]; beneath: PlaceLine[] } {
  const aspects = loaded.records.filter((r) => r.type === 'aspect' && r.valid);
  const at: AspectAt[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    for (const a of aspects) {
      const x = aspectAt(loaded, a, f);
      if (!x || seen.has(`${x.aspect} ${x.place}`)) continue;
      seen.add(`${x.aspect} ${x.place}`);
      at.push(x);
    }
  }
  const covered = new Set(at.map((x) => x.place));
  const beneath: PlaceLine[] = [];
  for (const p of loaded.records.filter((r) => r.type === 'place' && r.valid)) {
    if (covered.has(p.key)) continue;
    const pf = featureOfPlace(loaded, p);
    if (pf && features.some((f) => pf.key !== f.key && isWithin(loaded, pf, f))) beneath.push(placeLine(loaded, p));
  }
  beneath.sort((a, b) => a.place.localeCompare(b.place));
  return { at, beneath };
}

/** Lines that say what a write to an aspect's base reaches: every place under it, and each fork in full. */
export function reachOfBase(loaded: Loaded, aspect: Rec): string[] {
  const places = placesOf(loaded, aspect);
  if (!places.length) return [`${aspect.key} applies nowhere yet: pjman new place ${aspect.key}/<place> --feature feature:<slug>`];
  const out = [`the base of ${aspect.key} reaches ${places.length} place${places.length === 1 ? '' : 's'}; reconcile each fork with it in the same batch:`];
  for (const p of places) {
    const l = placeLine(loaded, p);
    out.push(`  ${l.place} at ${l.feature}${l.forked ? ' (forked)' : ''}`);
    if (l.forked) for (const line of p.body.trim().split('\n')) out.push(`    | ${line}`);
  }
  return out;
}

/** An aspect's reading at a place as text: the base, then each fork, under a line naming where it comes from. */
export function formatAspectAt(x: AspectAt): string {
  const out = [`### ${x.aspect} — ${x.title}`, `applies at ${x.at} (${x.place})`];
  if (!x.layers.length) out.push('', '(the aspect has no base written yet)');
  for (const l of x.layers) {
    out.push('', l.at ? `from ${l.from}, the fork at ${l.at}:` : `from ${l.from}, the base:`, '', l.text);
  }
  return out.join('\n');
}

export interface AspectWhole {
  aspect: string;
  title: string;
  base: string;
  places: (PlaceLine & { fork?: string })[];
}

/** An aspect read whole, for a change that works on it: the base and every place with its fork. */
export function aspectWhole(loaded: Loaded, aspect: Rec): AspectWhole {
  return {
    aspect: aspect.key,
    title: String(aspect.data.title ?? aspect.key),
    base: aspect.body.trim(),
    places: placesOf(loaded, aspect).map((p) => ({ ...placeLine(loaded, p), fork: p.body.trim() || undefined })),
  };
}

export interface ChangeAspects {
  /** The aspects the change names, read whole. */
  named: AspectWhole[];
  /** The aspects over the features (and places) it names, read at each. */
  at: AspectAt[];
  /** Places beneath a feature it names, one line each. */
  beneath: PlaceLine[];
}

/** The aspects and places a change names, as live keys: the work it does on an aspect, which the roadmap narrows by
 *  (change:aspects-roadmap). */
export function aspectKeysOf(loaded: Loaded, change: Rec): string[] {
  const list = Array.isArray(change.data.aspects) ? change.data.aspects : [];
  return list.flatMap((raw) => {
    const e = parseAspectEffect(raw);
    const rec = e ? live(loaded, e.key, change.productSlug ?? null) : undefined;
    return rec?.type === 'aspect' || rec?.type === 'place' ? [rec.key] : [];
  });
}

/** What a change works under:the aspects it names, whole; the aspects at the features it names, read there; a
 *  place it names, read at its feature. Undefined when there is nothing. */
export function aspectsOfChange(loaded: Loaded, change: Rec, features: Rec[]): ChangeAspects | undefined {
  const named: AspectWhole[] = [];
  const atPlaces: Rec[] = [];
  const list = Array.isArray(change.data.aspects) ? change.data.aspects : [];
  for (const raw of list) {
    const e = parseAspectEffect(raw);
    const rec = e ? live(loaded, e.key, change.productSlug ?? null) : undefined;
    if (rec?.type === 'aspect') named.push(aspectWhole(loaded, rec));
    else if (rec?.type === 'place') {
      const f = featureOfPlace(loaded, rec);
      if (f) atPlaces.push(f);
    }
  }
  const { at, beneath } = aspectsForFeatures(loaded, [...features, ...atPlaces]);
  const whole = new Set(named.map((n) => n.aspect));
  const out = { named, at: at.filter((x) => !whole.has(x.aspect)), beneath: beneath.filter((b) => !named.some((n) => b.place.startsWith(n.aspect + '/'))) };
  return out.named.length || out.at.length || out.beneath.length ? out : undefined;
}

export function formatChangeAspects(a: ChangeAspects): string[] {
  const out: string[] = ['## Aspects', ''];
  for (const n of a.named) {
    out.push(`### ${n.aspect} — ${n.title} (named by this change: the base and every place)`, '', n.base || '(no base written yet)');
    for (const p of n.places) {
      out.push('', `- ${p.place} at ${p.feature}${p.forked ? ', forked:' : ', the base as it is'}`);
      if (p.fork) out.push('', ...p.fork.split('\n').map((l) => `  ${l}`));
    }
    out.push('');
  }
  for (const x of a.at) out.push(formatAspectAt(x), '');
  if (a.beneath.length) {
    out.push('Beneath the features this change names (pjman show <place> reads one in full):');
    for (const b of a.beneath) out.push(`- ${b.place} at ${b.feature}${b.forked ? ' (forked)' : ''}`);
    out.push('');
  }
  return out;
}

// Aspects as work goes (change:aspects-as-work-goes; decision how-it-is-caught): a decision whose thread says it holds
// across the product ("every surface", "one component", "wherever") is the evidence an aspect may be missing. The
// count on the store's own decisions found this the one signal worth reading; files touched by many features are hubs.
// It is only ever a cue for the agent to judge and propose; nothing is created from it.
const ACROSS =
  /\b(every (?:surface|view|page|screen|lens)|one (?:shared )?component|wherever (?:it|a|an|the) \w+ (?:is shown|appears|is drawn)|across (?:the )?(?:app|dashboard|product|views|surfaces)|as on every \w+|everywhere)\b/i;

/** The phrase in a text that says it applies across the product, if any. */
export function acrossCue(text: string | undefined): string | undefined {
  return text ? ACROSS.exec(text)?.[1] : undefined;
}

/** The phrase in a decision's thread (question, criteria, options and their case, comments, acceptance) or its gist
 *  that says it applies across the product, if any. */
export function acrossCueOfDecision(data: Record<string, unknown>): string | undefined {
  for (const e of threadOf(data)) {
    const hit = acrossCue(e.text) ?? acrossCue(e.case);
    if (hit) return hit;
  }
  return acrossCue(typeof data.gist === 'string' ? data.gist : undefined);
}

export interface AspectCue {
  decision: string;
  phrase: string;
}

/** True when an aspect already answers the decision: an aspect's base or a fork names it, or a change that works on an
 *  aspect names it in its sections. Keys are matched with or without their product segment. */
export function coveredByAspect(loaded: Loaded, decision: Rec): boolean {
  const full = decision.key;
  const bare = decision.productSlug ? full.replace(`decision:${decision.productSlug}/`, 'decision:') : full;
  const names = (text: string) => text.includes(full) || new RegExp(`${bare.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![\\w/-])`).test(text);
  return loaded.records.some((r) => {
    if (r.type === 'aspect' || r.type === 'place') return names(r.body);
    if (r.type === 'change' && aspectKeysOf(loaded, r).length) return [...r.sections.values()].some(names);
    return false;
  });
}

/** The decisions on a change that read as applying across the product, when the change names no aspect and no aspect
 *  answers them already: the cue to propose one, or a place on one that exists. Superseded and reverted decisions are
 *  left out. */
export function aspectCuesOf(loaded: Loaded, change: Rec): AspectCue[] {
  if (aspectKeysOf(loaded, change).length) return [];
  return loaded.records
    .filter((r) => r.type === 'decision' && r.changeKey === change.key && (r.data.status === 'proposed' || r.data.status === 'decided'))
    .filter((r) => !coveredByAspect(loaded, r))
    .flatMap((r) => {
      const phrase = acrossCueOfDecision(r.data);
      return phrase ? [{ decision: r.key, phrase }] : [];
    });
}

/** What the agent does with a cue: judge it, and propose rather than create. */
export const ASPECT_CUE_HINT =
  'What applies across the product is an aspect. Unless one covers it (pjman ls aspect), propose one, or a place on one, as a decision with the base and places drafted (the aspect skill); never create it unasked.';

/** The cue as a change's context prints it. */
export function formatAspectCues(cues: AspectCue[]): string[] {
  if (!cues.length) return [];
  return ['## May be an aspect', '', ...cues.map((c) => `- ${c.decision} says "${c.phrase}"`), '', ASPECT_CUE_HINT];
}
