// The scope: what one page of the dashboard shows. A lens (project, feature, milestone, roadmap) decides the structure the
// same changes group under; a node narrows to a subtree; a view (tree, lanes) is the client's business. The result is
// one tree of structure nodes with change rows, the flat list of the same changes for lanes, and the health, owners,
// live sessions and activity of the node stood on. Everything here is derived from the records and the event stream.
import type { Store } from './config.js';
import { readEvents, type StoreEvent } from './events.js';
import { eventKeysOf, resolve, type Loaded, type Rec } from './records.js';
import { bugOrder, changeContext, progressOf, row, type ChangeContext, type Row } from './commands/view.js';
import { ahead, productOf } from './commands/order.js';
import { violations, worstSeverity, type RoadmapRow, type Violation } from './roadmap.js';
import { ancestorsOf, depthOf, derivedStatus, effectiveOwners, effectsOf, levelOf, live, rootProductOf, structuralParent, type EffectName } from './tree.js';
import { CliError, localDate } from './util.js';
import { aspectKeysOf, aspectsForFeatures, aspectWhole, featureOfPlace, type AspectAt, type AspectWhole } from './aspects.js';
import { decisionState, lineOf, needsOf, nextStep, planProgress, rungsOf, stepsOf, threadOf, type DecisionState } from './foundation.js';
import { nextLine } from './commands/view.js';

/** The roadmap lens draws the feature tree too: its rows are the features; its columns come from the sequence. */
export const LENSES = ['project', 'feature', 'milestone', 'roadmap'] as const;
export type Lens = (typeof LENSES)[number];
export const IN_FLIGHT = ['active', 'review', 'blocked'];
/** A session is live while something it did reached the stream inside this window. */
export const LIVE_MINUTES = 30;
const DAY = 86_400_000;

export interface Health {
  days: number;
  /** When the subtree last moved, and how many days ago; null when it never has. */
  last: string | null;
  staleDays: number | null;
  /** Events inside the window. */
  moved: number;
  /** Changes that reached done inside the window; changes created inside it. */
  done: number;
  created: number;
  /** As they stand now: changes blocked, decisions waiting on a person. */
  blocked: number;
  waiting: number;
}

export interface ChangeRow {
  key: string;
  /** The change's gist: what it is and why, in a line (the-ladder). */
  title?: string;
  /** The change's name: which one in a crowd, one to four words. */
  name?: string;
  status?: string;
  created?: string;
  project?: string;
  parent?: string;
  /** The first tracker ticket the change binds, as people write it, with its page when known. */
  ticket?: { key: string; label: string; url?: string };
  /** The next step of the plan, as a line: its number, text and note. Derived from the steps, never written. */
  next?: string;
  /** The plan's progress: steps done over steps not dropped. */
  plan?: { done: number; total: number };
  /** What the record still needs before it is worked: name, gist, intent, done when. */
  needs: string[];
  /** The name and gist were written from an earlier foundation. */
  stale: boolean;
  /** A parent change is a milestone: done children over children not dropped. */
  progress?: { done: number; total: number };
  /** The features it names, then the features of the places it names (`viaPlace`), where the dashboard files it too. */
  features: { effect: EffectName; key: string; title?: string; viaPlace?: boolean }[];
  /** Proposed decisions on it: what waits on a person. */
  waiting: number;
  /** Decisions on it decided; superseded and reverted ones are history and count in neither. */
  decided: number;
  /** A session bound to it moved inside the live window. */
  live: boolean;
  children: number;
  /** When the change itself last moved: its last event, under any of its keys. */
  moved?: string;
  /** `bug` for a reported fault against something live; absent for work. */
  kind?: string;
  /** A bug's severity: where on the tree the behaviour is lost. */
  severity?: string;
  /** A bug's home: the node on its path at the severity's level, where it is listed once. */
  home?: string;
  /** A milestone's target date, a person's. */
  target?: string;
  /** What must land before it, live keys. */
  dependsOn: string[];
  /** The aspects and places it names, live keys: the work it does on an aspect. */
  aspects: string[];
  /** Its place in the product's sequence: its own index, else its nearest sequenced ancestor's; absent is later. */
  position?: number;
  /** When it first moved out of open (its first status change), and when it reached done. */
  began?: string;
  finished?: string;
}

export interface ScopeNode {
  key: string;
  type: 'product' | 'feature' | 'project' | 'change' | 'unassigned';
  title?: string;
  /** A feature's or a change's short name, what trees and chips show; the title is the sentence (a change's gist). */
  name?: string;
  level?: string;
  /** A feature's authored status, a change's status. */
  status?: string;
  /** A feature's derived state. */
  derived?: string;
  owners: string[];
  ownersFrom?: string;
  /** Open changes beneath (not done, not dropped) and how many of those are in flight. */
  open: number;
  inFlight: number;
  /** Projects the open changes beneath live in. */
  projects: string[];
  /** Structure nodes beneath, whatever is shown. */
  childCount: number;
  health?: Health;
  /** On a project: done over not dropped, every change beneath. */
  progress?: { done: number; total: number };
  /** Open bugs: listed here (their home is this node), beneath (home here or below), and the worst among those. */
  bugs?: { here: number; beneath: number; worst?: string };
  row?: ChangeRow;
  children: ScopeNode[];
}

export interface LiveSession {
  key: string;
  agent?: string;
  onBehalfOf?: string;
  started?: string;
  /** The last instant it reached the stream. */
  last: string;
  /** The change it was last bound to. */
  on?: string;
  lastLine?: string;
}

/** A proposed decision beneath a node: what waits on a person, read in the order they want it (the-ladder,
 *  change:decision-card): the name, the gist, then the options with the recommended one marked and its case as points. */
export interface WaitingDecision {
  key: string;
  name?: string;
  /** The gist. */
  title?: string;
  change: string;
  /** The thread's state: the options, which is recommended and why; what accepting from a card chooses among. */
  state: DecisionState;
  needs: string[];
  stale: boolean;
  created?: string;
}

/** The proposed decisions that pass `keep`, oldest first: what waits on a person. One derivation for the inbox, the
 *  scope and the bridge. */
export function proposedDecisions(loaded: Loaded, keep: (d: Rec) => boolean = () => true): WaitingDecision[] {
  return loaded.records
    .filter((d) => d.type === 'decision' && d.valid && d.data.status === 'proposed' && !!d.changeKey && keep(d))
    .map((d) => {
      return { key: d.key, name: str(d.data.name), title: lineOf(d.data), change: d.changeKey!, state: decisionState(threadOf(d.data)), needs: needsOf(d), stale: rungsOf(d).stale, created: str(d.data.created) };
    })
    .sort((a, b) => (a.created ?? '').localeCompare(b.created ?? '') || a.key.localeCompare(b.key));
}

export interface Scope {
  lens: Lens;
  days: number;
  /** The node stood on; null at the store root. */
  node: (Row & { name?: string; level?: string; derived?: string; summary?: string; progress?: { done: number; total: number } }) | null;
  /** The container whose tree is drawn: the node when it is one, else the nearest above it in this lens; null at the root. */
  container: string | null;
  crumbs: { key: string; title?: string; name?: string }[];
  products: Row[];
  tree: ScopeNode[];
  /** Every change in the container's scope, creation order: the lanes view draws these. */
  changes: ChangeRow[];
  /** Projects those changes live in; a row shows its project only when there are several. */
  projects: string[];
  /** Changes left out: done unless asked for; features retired unless asked for. */
  doneHidden: number;
  retiredHidden: number;
  health: Health;
  owners: { owners: string[]; from?: string };
  sessions: LiveSession[];
  /** Proposed decisions beneath the node, oldest first: the inbox. */
  waitingOn: WaitingDecision[];
  /** The last events beneath the node, oldest first. */
  recent: StoreEvent[];
  /** The change's full context when the node is one. */
  change?: ChangeContext;
  /** Open bugs beneath the node, worst first then oldest: the bugs view. */
  bugs: ChangeRow[];
  /** The roadmap: the product's sequence as it falls in this scope, what comes after it, and where the order
   *  contradicts a dependency or a date. */
  roadmap: { product: string | null; sequence: string[]; later: string[]; violations: Violation[] };
  /** The aspects of the product the scope is in (every product's at the store root), each read whole: the base and
   *  every place with its fork. The map's aspect picker and lens, and the aspect's pane, read these (change:aspects-dashboard). */
  aspects: ScopeAspect[];
  /** On a feature: each aspect that applies there, read there, the base then the forks above it then its own. */
  aspectsHere: AspectAt[];
}

export interface ScopeAspect extends AspectWhole {
  name?: string;
  /** The parent aspect, when it nests under one. */
  parent?: string;
}

export interface ScopeOpts {
  lens?: string;
  node?: string;
  days?: number;
  /** Include done changes; include retired features. */
  done?: boolean;
  retired?: boolean;
  now?: number;
  /** Read as of this event: the stream is cut after it. */
  until?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const TRACKER_KINDS = new Set(['github-issue', 'linear', 'jira']);

function ticketOf(loaded: Loaded, rec: Rec): ChangeRow['ticket'] {
  for (const k of list(rec.data.binds)) {
    const i = k.indexOf(':');
    const kind = k.slice(0, i);
    const rest = k.slice(i + 1);
    if (!TRACKER_KINDS.has(kind)) continue;
    const gh = kind === 'github-issue' ? /^(.+)#(\d+)$/.exec(rest) : null;
    const url = str(live(loaded, k)?.data.url) ?? (gh ? `https://github.com/${gh[1]}/issues/${gh[2]}` : undefined);
    return { key: k, label: gh ? `#${gh[2]}` : rest, url };
  }
  return undefined;
}

/** Everything computed once per request and shared by every node. */
class Index {
  readonly changes: Rec[];
  readonly ancestors = new Map<string, string[]>();
  readonly childrenOf = new Map<string, Rec[]>();
  readonly waiting = new Map<string, number>();
  readonly decided = new Map<string, number>();
  readonly events: StoreEvent[];
  readonly now: number;
  readonly liveSessions = new Map<string, string>();

  constructor(readonly store: Store, readonly loaded: Loaded, now: number, until?: number) {
    this.now = now;
    this.events = until === undefined ? readEvents(store) : readEvents(store).filter((e) => e.seq <= until);
    // creation order: the day the record names, then its place in the stream (a renamed change keeps its first place)
    const firstSeq = new Map<string, number>();
    for (const e of this.events) if (e.op === 'created' && !firstSeq.has(e.key)) firstSeq.set(e.key, e.seq);
    const seqOf = (c: Rec) => Math.min(...eventKeysOf(c).map((k) => firstSeq.get(k) ?? Infinity));
    this.changes = loaded.records
      .filter((r) => r.type === 'change' && r.valid)
      .sort((a, b) => (str(a.data.created) ?? '').localeCompare(str(b.data.created) ?? '') || seqOf(a) - seqOf(b) || a.key.localeCompare(b.key));
    for (const r of loaded.records) {
      if (!r.valid || r.type === 'source' || r.type === 'session' || r.type === 'actor') continue;
      this.ancestors.set(r.key, ancestorsOf(loaded, r.key));
    }
    for (const c of this.changes) {
      const p = live(loaded, c.data.parent);
      if (p) this.childrenOf.set(p.key, [...(this.childrenOf.get(p.key) ?? []), c]);
    }
    for (const d of loaded.records) {
      if (d.type !== 'decision' || !d.valid || !d.changeKey) continue;
      const tally = d.data.status === 'proposed' ? this.waiting : d.data.status === 'decided' ? this.decided : undefined;
      const c = tally && live(loaded, d.changeKey);
      if (c) tally.set(c.key, (tally.get(c.key) ?? 0) + 1);
    }
    const liveSince = new Date(now - LIVE_MINUTES * 60_000).toISOString();
    for (const e of this.events) {
      const s = e.session ?? (e.type === 'session' ? e.key : undefined);
      if (s && e.at >= liveSince) this.liveSessions.set(s, e.at);
    }
  }

  parentOf(c: Rec): string | undefined {
    return live(this.loaded, c.data.parent)?.key;
  }

  private readonly products = new Map<string, Rec | undefined>();
  productOf(c: Rec): Rec | undefined {
    if (!this.products.has(c.key)) this.products.set(c.key, productOf(this.loaded, c));
    return this.products.get(c.key);
  }

  private readonly sequences = new Map<string, Map<string, number>>();
  /** change key → index in the product's sequence. */
  sequenceIndex(product: Rec): Map<string, number> {
    let m = this.sequences.get(product.key);
    if (!m) {
      m = new Map(ahead(this.loaded, product).map((k, i) => [k, i]));
      this.sequences.set(product.key, m);
    }
    return m;
  }

  /** The change's own place in the sequence, else its nearest sequenced ancestor's. */
  positionOf(c: Rec): number | undefined {
    const product = this.productOf(c);
    if (!product) return undefined;
    const ix = this.sequenceIndex(product);
    const seen = new Set<string>();
    for (let cur: Rec | undefined = c; cur && !seen.has(cur.key); cur = live(this.loaded, cur.data.parent)) {
      seen.add(cur.key);
      const i = ix.get(cur.key);
      if (i !== undefined) return i;
    }
    return undefined;
  }

  /** A bug's home: the node on its path at the severity's level. Product severity lands on the product; feature
   *  severity on the top-level feature above the node it names; anything else on the node itself. */
  homeOf(c: Rec): string | undefined {
    if (c.data.kind !== 'bug') return undefined;
    const named = effectsOf(c).map((e) => live(this.loaded, e.key)).find((f) => f);
    const sev = str(c.data.severity);
    if (sev === 'product') return (named && rootProductOf(this.loaded, named))?.key ?? this.productOf(c)?.key;
    if (!named) return undefined;
    if (sev === 'feature') {
      let cur: Rec = named;
      while (depthOf(this.loaded, cur) > 1) {
        const up = structuralParent(this.loaded, cur);
        if (!up || up.type !== 'feature') break;
        cur = up;
      }
      return cur.key;
    }
    return named.key;
  }

  /** The first status change (when it began) and, for a done change, the last one (when it finished). */
  span(c: Rec): { began?: string; finished?: string } {
    const keys = new Set<string>(eventKeysOf(c));
    let began: string | undefined;
    let last: string | undefined;
    for (const e of this.events) {
      if (!keys.has(e.key) || e.op !== 'set' || !e.fields?.includes('status')) continue;
      began ??= e.at;
      last = e.at;
    }
    const done = c.data.status === 'done';
    return { began, finished: done ? last ?? (str(c.data.created) ? `${str(c.data.created)}T00:00:00.000Z` : undefined) : undefined };
  }

  private readonly placed = new Map<string, Rec[]>();
  /** The features of the places a change names (change:aspect-work-on-the-roadmap). The dashboard files the change there
   *  as if it named them, on the map, on the roadmap and in a lane; the store's ancestry never does, so aspect work
   *  counts toward no feature's progress or status. */
  placeFeatures(c: Rec): Rec[] {
    let out = this.placed.get(c.key);
    if (!out) {
      out = aspectKeysOf(this.loaded, c)
        .map((k) => live(this.loaded, k))
        .filter((p): p is Rec => p?.type === 'place')
        .map((p) => featureOfPlace(this.loaded, p))
        .filter((f): f is Rec => !!f);
      this.placed.set(c.key, out);
    }
    return out;
  }

  /** The changes filed beneath a feature through a place: the place's feature is the feature or below it. */
  placedBeneath(key: string): string[] {
    return this.changes
      .filter((c) => this.placeFeatures(c).some((f) => f.key === key || (this.ancestors.get(f.key) ?? []).includes(key)))
      .map((c) => c.key);
  }

  /** The keys beneath a node, the node included; every key when the node is the root. */
  beneath(key: string | null): Set<string> {
    if (key === null) return new Set(this.ancestors.keys());
    const out = new Set<string>([key]);
    for (const [k, anc] of this.ancestors) if (anc.includes(key)) out.add(k);
    return out;
  }

  health(keys: Set<string>, days: number): Health {
    const loaded = this.loaded;
    const all = new Set(keys);
    for (const k of keys) {
      const r = live(loaded, k);
      if (r?.type === 'change') for (const k of eventKeysOf(r)) all.add(k);
    }
    const since = new Date(this.now - days * DAY).toISOString();
    const mine = this.events.filter((e) => all.has(e.key));
    const inWindow = mine.filter((e) => e.at >= since);
    const last = mine.length ? mine[mine.length - 1].at : null;
    const isDone = (k: string) => live(loaded, k)?.data.status === 'done';
    const done = new Set(inWindow.filter((e) => e.type === 'change' && e.op === 'set' && e.fields?.includes('status') && isDone(e.key)).map((e) => live(loaded, e.key)!.key));
    const created = new Set(inWindow.filter((e) => e.type === 'change' && e.op === 'created').map((e) => e.key));
    let blocked = 0;
    let waiting = 0;
    for (const k of keys) {
      const r = live(loaded, k);
      if (r?.type === 'change' && r.data.status === 'blocked') blocked++;
      if (r?.type === 'decision' && r.data.status === 'proposed') waiting++;
    }
    return { days, last, staleDays: last ? Math.floor((this.now - Date.parse(last)) / DAY) : null, moved: inWindow.length, done: done.size, created: created.size, blocked, waiting };
  }

  row(c: Rec): ChangeRow {
    const kids = this.childrenOf.get(c.key) ?? [];
    const sessions = this.loaded.records.filter((s) => s.type === 'session' && this.liveSessions.has(s.key) && list(s.data.changes).some((k) => live(this.loaded, k)?.key === c.key));
    const steps = stepsOf(c.data);
    return {
      key: c.key, title: lineOf(c.data), name: str(c.data.name), status: str(c.data.status), created: str(c.data.created),
      project: live(this.loaded, c.data.project)?.key, parent: this.parentOf(c), ticket: ticketOf(this.loaded, c),
      next: nextLine(nextStep(steps)), plan: planProgress(steps), needs: needsOf(c), stale: rungsOf(c).stale,
      progress: progressOf(kids.map((k) => ({ status: str(k.data.status) }))),
      features: [
        ...effectsOf(c).map((e) => ({ effect: e.effect, key: e.key, title: str(live(this.loaded, e.key)?.data.title) })),
        ...this.placeFeatures(c).map((f) => ({ effect: 'changes' as const, key: f.key, title: str(f.data.title), viaPlace: true })),
      ],
      waiting: this.waiting.get(c.key) ?? 0, decided: this.decided.get(c.key) ?? 0, live: sessions.length > 0, children: kids.length,
      moved: this.lastMoved(c),
      kind: str(c.data.kind), severity: str(c.data.severity), home: this.homeOf(c), target: str(c.data.target),
      dependsOn: list(c.data.depends_on).map((k) => live(this.loaded, k)?.key).filter((k): k is string => !!k),
      aspects: aspectKeysOf(this.loaded, c),
      position: this.positionOf(c),
      ...this.span(c),
    };
  }

  /** The instant of the change's last event, under its key or any alias; undefined when it never moved. */
  lastMoved(c: Rec): string | undefined {
    const keys = new Set<string>(eventKeysOf(c));
    for (let i = this.events.length - 1; i >= 0; i--) if (keys.has(this.events[i].key)) return this.events[i].at;
    return undefined;
  }
}

const isOpen = (c: Rec) => c.data.status !== 'done' && c.data.status !== 'dropped';

/** What one page shows. */
export function scope(store: Store, loaded: Loaded, opts: ScopeOpts = {}): Scope {
  const lens = (opts.lens ?? 'feature') as Lens;
  if (!LENSES.includes(lens)) throw new CliError(`lens must be one of ${LENSES.join(', ')}`);
  const days = opts.days && opts.days > 0 ? opts.days : 14;
  const ix = new Index(store, loaded, opts.now ?? Date.now(), opts.until);

  let node: Rec | undefined;
  if (opts.node) {
    const res = resolve(loaded, opts.node);
    if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`${opts.node} has no record`);
    node = res.rec;
    if (!['product', 'feature', 'project', 'change'].includes(node.type)) throw new CliError(`${node.key} is not a node of the tree (product, feature, project or change)`);
  }

  // the container: the node when it holds things, else the nearest holder above it in this lens
  const hasChildren = (c: Rec) => (ix.childrenOf.get(c.key) ?? []).length > 0;
  /** The first feature a change names, else the first its nearest parent names: where the feature lens files it. */
  const nearestFeature = (c: Rec): Rec | undefined => {
    const seen = new Set<string>();
    for (let cur: Rec | undefined = c; cur && !seen.has(cur.key); cur = live(loaded, cur.data.parent)) {
      seen.add(cur.key);
      const f = effectsOf(cur).map((e) => live(loaded, e.key)).find((x) => x) ?? ix.placeFeatures(cur)[0];
      if (f) return f;
    }
    return undefined;
  };
  let container: Rec | undefined = node;
  if (node?.type === 'change' && !hasChildren(node)) {
    const project = live(loaded, node.data.project);
    const parent = live(loaded, node.data.parent);
    const top = project && (rootProductOf(loaded, project) ?? project);
    container = lens === 'project' ? project : lens === 'feature' || lens === 'roadmap' ? nearestFeature(node) ?? top : parent ?? top;
  }

  const beneath = ix.beneath(container?.key ?? null);
  if (container?.type === 'feature') for (const k of ix.placedBeneath(container.key)) beneath.add(k);
  const inScope = ix.changes.filter((c) => beneath.has(c.key) && c.key !== container?.key);
  const shown = inScope.filter((c) => (opts.done ? c.data.status !== 'dropped' : isOpen(c)));
  const shownKeys = new Set(shown.map((c) => c.key));
  const doneHidden = inScope.length - shown.length - inScope.filter((c) => c.data.status === 'dropped').length;

  // structure nodes
  let retiredHidden = 0;
  const placed = new Set<string>();
  const changeNode = (c: Rec, canNest: (k: Rec) => boolean): ScopeNode => {
    placed.add(c.key);
    const kids = (ix.childrenOf.get(c.key) ?? []).filter((k) => shownKeys.has(k.key) && !placed.has(k.key) && canNest(k));
    const r = ix.row(c);
    return { key: c.key, type: 'change', title: r.title, name: r.name, status: r.status, owners: [], open: 0, inFlight: 0, projects: [], childCount: 0, row: r, children: kids.map((k) => changeNode(k, canNest)) };
  };
  /** Rows for the changes `here`, nested by parent among those that `canNest`. A change already placed is not placed
   *  twice, except where `again` says a change belongs under every node that lists it (a change naming two features). */
  const rows = (here: Rec[], canNest: (k: Rec) => boolean, again = false): ScopeNode[] => {
    const keys = new Set(here.filter((c) => again || !placed.has(c.key)).map((c) => c.key));
    const top = here.filter((c) => keys.has(c.key) && !(ix.parentOf(c) && keys.has(ix.parentOf(c)!) && canNest(c)));
    return top.map((c) => changeNode(c, canNest));
  };
  const openBugs = ix.changes.filter((c) => isOpen(c) && c.data.kind === 'bug');
  const facts = (rec: Rec): Pick<ScopeNode, 'owners' | 'ownersFrom' | 'open' | 'inFlight' | 'projects' | 'health' | 'progress' | 'bugs'> => {
    const keys = ix.beneath(rec.key);
    const mine = ix.changes.filter((c) => keys.has(c.key) && c.key !== rec.key);
    const open = mine.filter(isOpen);
    const eo = effectiveOwners(loaded, rec.key);
    const counted = mine.filter((c) => c.data.status !== 'dropped');
    const homed = openBugs.filter((b) => { const h = ix.homeOf(b); return h !== undefined && keys.has(h); });
    const bugs = rec.type === 'product' || rec.type === 'feature'
      ? { here: homed.filter((b) => ix.homeOf(b) === rec.key).length, beneath: homed.length, worst: homed.reduce<string | undefined>((w, b) => worstSeverity(w, str(b.data.severity)), undefined) }
      : undefined;
    return {
      owners: eo.owners, ownersFrom: eo.from, open: open.length, inFlight: open.filter((c) => IN_FLIGHT.includes(String(c.data.status))).length,
      projects: [...new Set(open.map((c) => live(loaded, c.data.project)?.key).filter((p): p is string => !!p))].sort(),
      health: ix.health(keys, days),
      progress: rec.type === 'project' && counted.length ? { done: counted.filter((c) => c.data.status === 'done').length, total: counted.length } : undefined,
      bugs,
    };
  };
  // a place a change names files it at the place's feature, as if it named that feature
  const names = (c: Rec, key: string) =>
    effectsOf(c).some((e) => live(loaded, e.key)?.key === key) || ix.placeFeatures(c).some((f) => f.key === key);
  const namesNothing = (c: Rec) => effectsOf(c).length === 0 && ix.placeFeatures(c).length === 0;
  const featureChildren = (key: string) => loaded.records.filter((f) => f.type === 'feature' && f.valid && structuralParent(loaded, f)?.key === key);
  const featureNode = (f: Rec): ScopeNode | null => {
    const d = derivedStatus(loaded, f.key);
    const state = str(f.data.status) ?? d.status;
    if (state === 'retired' && !opts.retired) {
      retiredHidden++;
      return null;
    }
    const children = featureChildren(f.key).map(featureNode).filter((n): n is ScopeNode => n !== null);
    const here = shown.filter((c) => names(c, f.key));
    const kids = rows(here, (k) => names(k, f.key) || namesNothing(k), true);
    return { key: f.key, type: 'feature', title: str(f.data.title), name: str(f.data.name), level: levelOf(loaded, f), status: str(f.data.status), derived: d.status, childCount: children.length, ...facts(f), children: [...children, ...kids] };
  };
  const projectChildren = (key: string) => loaded.records.filter((p) => p.type === 'project' && p.valid && structuralParent(loaded, p)?.key === key);
  const projectNode = (p: Rec): ScopeNode => {
    const children = projectChildren(p.key).map(projectNode);
    const here = shown.filter((c) => live(loaded, c.data.project)?.key === p.key);
    const kids = rows(here, (k) => live(loaded, k.data.project)?.key === p.key);
    return { key: p.key, type: 'project', title: str(p.data.title), level: 'project', childCount: children.length, ...facts(p), children: [...children, ...kids] };
  };
  const productNode = (p: Rec, lensOf: 'feature' | 'project'): ScopeNode => {
    const children = lensOf === 'feature' ? featureChildren(p.key).map(featureNode).filter((n): n is ScopeNode => n !== null) : projectChildren(p.key).map(projectNode);
    return { key: p.key, type: 'product', title: str(p.data.title), name: str(p.data.name), level: 'product', childCount: children.length, ...facts(p), children };
  };
  const flat = <T extends Rec>(recs: T[], node: (r: T) => ScopeNode | null): ScopeNode[] =>
    [...new Map(recs.map((r) => [r.key, r])).values()].sort((a, b) => a.key.localeCompare(b.key)).map(node).filter((n): n is ScopeNode => n !== null);

  let tree: ScopeNode[] = [];
  const products = loaded.records.filter((r) => r.type === 'product' && r.valid);
  if (lens === 'feature' || lens === 'roadmap') {
    if (!container) tree = products.map((p) => productNode(p, 'feature'));
    else if (container.type === 'product' || container.type === 'feature') {
      const children = featureChildren(container.key).map(featureNode).filter((n): n is ScopeNode => n !== null);
      tree = [...children, ...rows(shown.filter((c) => names(c, container!.key)), (k) => names(k, container!.key) || namesNothing(k), true)];
    } else {
      // a project or a milestone: the features its changes name, flat
      tree = flat(shown.flatMap((c) => [...effectsOf(c).map((e) => live(loaded, e.key)).filter((f): f is Rec => !!f), ...ix.placeFeatures(c)]), featureNode);
    }
  } else if (lens === 'project') {
    if (!container) tree = [...products.map((p) => productNode(p, 'project')), ...loaded.records.filter((p) => p.type === 'project' && p.valid && !structuralParent(loaded, p)).map(projectNode)];
    else if (container.type === 'product') tree = projectChildren(container.key).map(projectNode);
    else if (container.type === 'project') tree = [...projectChildren(container.key).map(projectNode), ...rows(shown.filter((c) => live(loaded, c.data.project)?.key === container!.key), (k) => live(loaded, k.data.project)?.key === container!.key)];
    else tree = flat(shown.map((c) => live(loaded, c.data.project)).filter((p): p is Rec => !!p), projectNode);
  } else {
    // milestones: the parent changes in scope whose parent is not, nested all the way down
    if (container?.type === 'change') tree = rows(shown.filter((c) => ix.parentOf(c) === container!.key), () => true);
    else {
      const roots = shown.filter((c) => (ix.childrenOf.get(c.key) ?? []).some((k) => shownKeys.has(k.key)) && !(ix.parentOf(c) && shownKeys.has(ix.parentOf(c)!)));
      tree = roots.map((c) => changeNode(c, () => true));
    }
  }
  // whatever the lens did not place closes the list
  const left = shown.filter((c) => !placed.has(c.key));
  if (left.length) {
    const kids = rows(left, (k) => !placed.has(k.key));
    tree.push({ key: 'unassigned', type: 'unassigned', title: lens === 'milestone' ? 'No milestone' : lens === 'project' ? 'In other projects' : 'No feature named', owners: [], open: left.filter(isOpen).length, inFlight: left.filter((c) => IN_FLIGHT.includes(String(c.data.status))).length, projects: [], childCount: 0, children: kids });
  }

  // the node's own facts
  const nodeKeys = ix.beneath(node?.key ?? null);
  const health = ix.health(nodeKeys, days);
  const owners = node ? effectiveOwners(loaded, node.key) : { owners: [] as string[] };
  const sessions: LiveSession[] = loaded.records
    .filter((s) => s.type === 'session' && s.valid && ix.liveSessions.has(s.key))
    .map((s) => {
      const bound = list(s.data.changes).map((k) => live(loaded, k)?.key).filter((k): k is string => !!k);
      const on = bound[bound.length - 1];
      const log = (s.sections.get('Log') ?? '').split('\n').filter((l) => l.trim());
      return { key: s.key, agent: str(s.data.agent), onBehalfOf: str(s.data.on_behalf_of), started: str(s.data.started), last: ix.liveSessions.get(s.key)!, on, lastLine: log.length ? log[log.length - 1].replace(/^-\s*/, '').replace(/^\S+Z\s+—\s+/, '') : undefined };
    })
    .filter((s) => !node || (s.on && nodeKeys.has(s.on)))
    .sort((a, b) => b.last.localeCompare(a.last));
  const aliasKeys = new Set(nodeKeys);
  for (const k of nodeKeys) { const r = live(loaded, k); if (r) for (const e of eventKeysOf(r)) aliasKeys.add(e); }
  const recent = ix.events.filter((e) => aliasKeys.has(e.key) && e.op !== 'write' && e.op !== 'formatted').slice(-60);
  const waitingOn = proposedDecisions(loaded, (d) => nodeKeys.has(d.key));

  // crumbs: the chain above the node in this lens, product first
  const crumbs: Scope['crumbs'] = [];
  const crumb = (r: Rec | undefined) => r && crumbs.unshift({ key: r.key, title: str(r.data.title), name: str(r.data.name) });
  const climb = (r: Rec | undefined) => {
    const seen = new Set<string>();
    while (r && !seen.has(r.key)) {
      seen.add(r.key);
      crumb(r);
      r = structuralParent(loaded, r);
    }
  };
  if (node?.type === 'change') {
    let cur: Rec | undefined = live(loaded, node.data.parent);
    const seen = new Set<string>([node.key]);
    while (cur && !seen.has(cur.key)) {
      seen.add(cur.key);
      crumb(cur);
      cur = live(loaded, cur.data.parent);
    }
    const project = live(loaded, node.data.project);
    const top = project && (rootProductOf(loaded, project) ?? project);
    climb(lens === 'project' ? project : lens === 'feature' || lens === 'roadmap' ? nearestFeature(node) ?? top : top);
  } else if (node) {
    climb(structuralParent(loaded, node));
  }

  const changes = shown.map((c) => ix.row(c));

  // bugs beneath the node, the queue's order
  const bugs = openBugs.filter((c) => nodeKeys.has(c.key)).map((c) => ix.row(c)).sort(bugOrder);

  // the roadmap: the product's sequence as it falls in this scope, what comes after, and the checks
  let product: Rec | undefined;
  if (node?.type === 'product') product = node;
  else if (node?.type === 'feature' || node?.type === 'project') product = rootProductOf(loaded, node);
  else if (node?.type === 'change') product = ix.productOf(node);
  else if (products.length === 1) product = products[0];
  const inScopeKeys = new Set(inScope.map((c) => c.key));
  const sequence = product ? ahead(loaded, product).filter((k) => inScopeKeys.has(k)) : [];
  const loose = new Set(shown.filter((c) => isOpen(c) && c.data.kind !== 'bug' && ix.positionOf(c) === undefined).map((c) => c.key));
  const later = [...loose].filter((k) => { const p = ix.parentOf(loaded.byKey.get(k)![0]); return !p || !loose.has(p); });
  const roadmapRows: RoadmapRow[] = inScope.map((c) => ({
    key: c.key, status: str(c.data.status), parent: ix.parentOf(c), target: str(c.data.target), position: ix.positionOf(c),
    dependsOn: list(c.data.depends_on).map((k) => live(loaded, k)?.key).filter((k): k is string => !!k),
  }));
  const roadmap = { product: product?.key ?? null, sequence, later, violations: violations(roadmapRows, localDate(new Date(ix.now))) };

  // the aspects: the product's, whole; and on a feature, those that apply there, read there
  const aspects: ScopeAspect[] = loaded.records
    .filter((a) => a.type === 'aspect' && a.valid && (!product || a.productSlug === product.productSlug))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((a) => ({ ...aspectWhole(loaded, a), name: str(a.data.name), parent: live(loaded, a.data.parent)?.key }));
  const aspectsHere = node?.type === 'feature' ? aspectsForFeatures(loaded, [node]).at : [];
  return {
    lens, days,
    node: node
      ? { ...row(node), name: str(node.data.name), level: node.type === 'change' ? undefined : levelOf(loaded, node), derived: node.type === 'feature' ? derivedStatus(loaded, node.key).status : undefined, summary: node.sections.get('Summary') ?? node.sections.get('Intent'), progress: node.type === 'project' ? facts(node).progress : undefined }
      : null,
    container: container?.key ?? null,
    crumbs, products: products.map(row), tree, changes,
    projects: [...new Set(changes.map((c) => c.project).filter((p): p is string => !!p))].sort(),
    doneHidden, retiredHidden, health, owners, sessions, waitingOn, recent,
    change: node?.type === 'change' ? changeContext(store, node.key, loaded) : undefined,
    bugs, roadmap, aspects, aspectsHere,
  };
}
