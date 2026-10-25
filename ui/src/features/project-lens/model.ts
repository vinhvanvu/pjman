// The work queue's pure derivations: lanes by status, by milestone, by who moves it next; and the inbox.
import type { ChangeRow, Grouping, Scope, WaitingDecision } from '@/data/contract';

export interface Lane {
  id: string;
  label: string;
  /** The token that colours the lane's dot. */
  tone: string;
  rows: ChangeRow[];
  /** A milestone lane links to its milestone. */
  key?: string;
  progress?: { done: number; total: number };
}

const STATUS_ORDER: { id: string; label: string; tone: string }[] = [
  { id: 'active', label: 'Active', tone: 'bg-status-active' },
  { id: 'blocked', label: 'Blocked', tone: 'bg-status-blocked' },
  { id: 'review', label: 'Review', tone: 'bg-status-review' },
  { id: 'planning', label: 'Planning', tone: 'bg-status-planning' },
  { id: 'open', label: 'Open', tone: 'bg-status-open' },
  { id: 'done', label: 'Done', tone: 'bg-status-done' },
];

export function byStatus(rows: ChangeRow[]): Lane[] {
  return STATUS_ORDER.map((s) => ({ ...s, rows: rows.filter((r) => (r.status ?? 'open') === s.id) })).filter(
    (l) => l.rows.length > 0,
  );
}

/** Group by the top-most milestone within the list; a change whose parent is not in the list heads its own group. */
export function byMilestone(rows: ChangeRow[]): Lane[] {
  const inList = new Map(rows.map((r) => [r.key, r]));
  const topOf = (r: ChangeRow): ChangeRow | undefined => {
    let cur: ChangeRow | undefined = r;
    let top: ChangeRow | undefined;
    const seen = new Set<string>();
    while (cur?.parent && inList.has(cur.parent) && !seen.has(cur.parent)) {
      seen.add(cur.parent);
      cur = inList.get(cur.parent);
      top = cur;
    }
    return top;
  };
  const lanes = new Map<string, Lane>();
  const none: Lane = { id: 'none', label: 'No milestone', tone: 'bg-status-open', rows: [] };
  for (const r of rows) {
    const top = topOf(r);
    if (top) {
      const lane = lanes.get(top.key) ?? {
        id: top.key,
        key: top.key,
        label: top.title ?? top.key,
        tone: 'bg-status-planning',
        rows: [],
        progress: top.progress,
      };
      if (r.key !== top.key) lane.rows.push(r);
      lanes.set(top.key, lane);
    } else if (r.children > 0 && rows.some((x) => x.parent === r.key)) {
      if (!lanes.has(r.key))
        lanes.set(r.key, {
          id: r.key,
          key: r.key,
          label: r.title ?? r.key,
          tone: 'bg-status-planning',
          rows: [],
          progress: r.progress,
        });
    } else none.rows.push(r);
  }
  return [...lanes.values(), ...(none.rows.length ? [none] : [])];
}

/** Who moves it next: an agent is on it, a person has to, or it waits its turn. */
export function byActor(rows: ChangeRow[]): Lane[] {
  const agent: ChangeRow[] = [];
  const person: ChangeRow[] = [];
  const queued: ChangeRow[] = [];
  for (const r of rows) {
    if (r.live) agent.push(r);
    else if (r.waiting > 0 || r.status === 'review' || r.status === 'blocked') person.push(r);
    else queued.push(r);
  }
  return [
    { id: 'agent', label: 'Agent working', tone: 'bg-live', rows: agent },
    { id: 'person', label: 'Needs a person', tone: 'bg-status-review', rows: person },
    { id: 'queued', label: 'Queued', tone: 'bg-status-open', rows: queued },
  ].filter((l) => l.rows.length > 0);
}

export function lanesFor(grouping: Grouping, rows: ChangeRow[]): Lane[] {
  switch (grouping) {
    case 'milestone':
      return byMilestone(rows);
    case 'actor':
      return byActor(rows);
    default:
      return byStatus(rows);
  }
}

export interface InboxData {
  decisions: WaitingDecision[];
  reviews: ChangeRow[];
  blocked: ChangeRow[];
  total: number;
}

/** Everything only a person can move. */
export function inbox(scope: Pick<Scope, 'waitingOn' | 'changes'>): InboxData {
  const reviews = scope.changes.filter((r) => r.status === 'review');
  const blocked = scope.changes.filter((r) => r.status === 'blocked');
  return {
    decisions: scope.waitingOn,
    reviews,
    blocked,
    total: scope.waitingOn.length + reviews.length + blocked.length,
  };
}
