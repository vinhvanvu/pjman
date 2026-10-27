// The API's types come from the tool itself (its emitted declarations under dist), type-only, so the contract has one
// definition. Build the tool first (`npm run build` at the root). The constants are repeated on purpose: a value import
// would pull server code into the bundle.
export type { ChangeRow, Health, Lens, LiveSession, Scope, ScopeNode, WaitingDecision } from '@contract/scope';
export type { ChangeContext, Row } from '@contract/commands/view';
export type { StoreEvent } from '@contract/events';
export type { RecordType } from '@contract/records';

import type { Row } from '@contract/commands/view';
import type { Lens } from '@contract/scope';

/** The lenses the dashboard shows: what the product does, and toward what. The server also answers `project`;
 *  the dashboard treats a project as a chip on cards and a record on the getter page, never a place to stand. */
export const LENSES = ['feature', 'milestone'] as const satisfies readonly Lens[];
export const IN_FLIGHT = ['active', 'review', 'blocked'] as const;
/** How the structure pane draws the scope. */
export const VIEWS = ['tree', 'lanes', 'inbox'] as const;
export type View = (typeof VIEWS)[number];
/** The record pane's tabs, for the selected entity. */
export const TABS = ['overview', 'activity', 'decisions'] as const;
export type Tab = (typeof TABS)[number];
/** How the lanes group. */
export const GROUPINGS = ['status', 'milestone', 'actor'] as const;
export type Grouping = (typeof GROUPINGS)[number];

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
  products: Row[];
}

/** What a session's view shows, as /sessions/:id/view answers. */
export interface SessionView {
  showing: { key?: string; session?: string; board?: string | null };
}

/** The getter's answer, the part the app uses. */
export interface Resolution {
  input: string;
  resolution: { status: 'record' | 'alias' | 'invalid' | 'key' | 'none'; key?: string; tried: string[] };
  changes: { change: Row }[];
}

export interface ScopeQuery {
  lens: Lens;
  node?: string;
  days?: number;
  done?: boolean;
  retired?: boolean;
}
