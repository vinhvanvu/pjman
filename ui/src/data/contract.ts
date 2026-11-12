// The API's types come from the tool itself: its contract module (src/server/contract.ts), read type-only from the
// emitted declarations under dist, so the contract has one definition. Build the tool first (`npm run build` at the
// root). The constants are repeated on purpose: a value import would pull server code into the bundle.
export type {
  AspectAt,
  AspectWhole,
  Bridge,
  BridgeChange,
  BridgeMotion,
  BridgeSession,
  ChangeAspects,
  ChangeContext,
  ChangeRow,
  DecisionState,
  Health,
  HostResult,
  Layer,
  LaunchResult,
  Lens,
  LiveSession,
  Moment,
  OptionState,
  OrderResult,
  PlaceLine,
  Rail,
  RailBucket,
  RailLane,
  RailRow,
  RailRowKind,
  RailSession,
  RecordType,
  Row,
  Scope,
  ScopeAspect,
  ScopeNode,
  SessionFacts,
  SessionState,
  SetResult,
  StoreEvent,
  Timeline,
  TimelineEvent,
  Violation,
  WaitingDecision,
} from '@contract';

import type { Lens, RailRowKind, Row, SessionFacts } from '@contract';

/** The lenses the dashboard shows: what the product is (the map), and in what order it comes (the roadmap). The
 *  server also answers `project` and `milestone`; the dashboard treats a project as a chip on cards and a record on
 *  the getter page, and a milestone as an entry on the roadmap. */
export const LENSES = ['feature', 'roadmap'] as const satisfies readonly Lens[];
export const IN_FLIGHT = ['active', 'review', 'blocked'] as const;
/** The record pane's tabs, for the selected entity. */
export const TABS = ['overview', 'activity', 'decisions'] as const;
export type Tab = (typeof TABS)[number];

/** The store, as /store answers. */
export interface StoreInfo {
  root: string;
  mode: string;
  name: string;
  project: string | null;
  actor: string | null;
  source_kinds: string[];
  vocabulary: Record<string, string>;
  projects: Row[];
  products: ProductRow[];
  /** The host the server's machine runs (a terminal multiplexer), on which a session can be launched; null when none. */
  host: { name: string; version: string | null; validated: boolean | null } | null;
}

/** A product as the store lists it: its short name and one line of health, for the switcher. */
export interface ProductRow extends Row {
  name?: string;
  /** Open changes under its projects. */
  open: number;
  /** Of those, active, review or blocked. */
  inFlight: number;
  /** Open bugs at product or feature severity. */
  loud: number;
}

/** What a session's view shows, as /sessions/:id/view answers. */
export interface SessionView {
  showing: { key?: string; session?: string; board?: string | null };
  /** The session followed: its log, what it is on, whether it is live. */
  session?: SessionFacts;
}

/** The getter's answer, the part the app uses. */
export interface Resolution {
  input: string;
  resolution: { status: 'record' | 'alias' | 'invalid' | 'key' | 'none'; key?: string; tried: string[] };
  changes: { change: Row }[];
}

/** Deciding a proposed decision, or reopening a decided one (decision decide-in-place/decide-route-and-reopen). Deciding
 *  names the option the person chose and carries their words, else the recommendation is accepted (decision
 *  detail-pages/decision-card). */
export interface DecideBody {
  decision: string;
  option?: string;
  words?: string;
}
/** What a card passes when it decides: the option the person picked and their words, both optional. */
export type DecideOpts = Pick<DecideBody, 'option' | 'words'>;
/** The write a decision's Accept or Reopen calls, as a surface receives it: nothing on a page held at a moment. */
export type DecideAction = (decision: string, opts?: DecideOpts) => Promise<unknown>;

/** A write: where a change goes in its product's sequence. */
export interface OrderBody {
  change: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  later?: boolean;
}

export interface ScopeQuery {
  lens: Lens;
  node?: string;
  days?: number;
  done?: boolean;
  retired?: boolean;
}

/** The rail's page and filter, as /rail takes them (change:rail-pages): the last `limit` passing rows, `before` a
 *  row when paging back, `from` a day when loading the pages down to it; only these `lanes` and `kinds`; `fold`
 *  lanes kept apart. */
export interface RailQuery {
  limit?: number;
  before?: number;
  from?: string;
  to?: string;
  lanes?: string[];
  kinds?: RailRowKind[];
  fold?: number;
}
