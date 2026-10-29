// The API's types come from the tool itself (its emitted declarations under dist), type-only, so the contract has one
// definition. Build the tool first (`npm run build` at the root). The constants are repeated on purpose: a value import
// would pull server code into the bundle.
export type { ChangeRow, Health, Lens, LiveSession, Scope, ScopeNode, WaitingDecision } from '@contract/scope';
export type { Violation } from '@contract/roadmap';
export type { Bridge, BridgeChange, BridgeSession, SessionState, WaitingChange } from '@contract/bridge';
export type { OrderResult } from '@contract/commands/order';
export type { SetResult } from '@contract/commands/set';
export type { ChangeContext, Row } from '@contract/commands/view';
export type { SessionFacts } from '@contract/commands/pane';
export type { StoreEvent } from '@contract/events';
export type { Moment } from '@contract/moment';
export type { Timeline, TimelineEvent } from '@contract/timeline';
export type { RecordType } from '@contract/records';

import type { SessionFacts } from '@contract/commands/pane';
import type { Row } from '@contract/commands/view';
import type { Lens } from '@contract/scope';

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

/** Deciding a proposed decision, or reopening a decided one (decision decide-in-place/decide-route-and-reopen). */
export interface DecideBody {
  decision: string;
}

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
