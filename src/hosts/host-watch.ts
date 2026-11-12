// The host watch (change:rex-adapter): the server's view of what each hosted session's program reports, kept live.
// For every session the store holds that runs in a host and has not ended, the watch follows the host's events for it
// and asks its status once at the start; a host with no stream is asked again on a slow poll. What it holds is read by
// the bridge, the scope and the session page as a fact beside the record's own (session-state.ts): the program is
// working, blocked on a question, idle. Nothing here is stored.
import { statusAsync, type HostAdapter, type HostId, type HostStatus } from './host.js';

export interface Tracked {
  key: string;
  adapter: HostAdapter;
  id: HostId;
  status?: HostStatus;
  /** Whether the host's stream delivered anything; until it does, the status is polled. */
  streamed: boolean;
  stop: () => void;
  poll?: NodeJS.Timeout;
}

export interface HostWatchOpts {
  /** How often a host with no stream is asked, in milliseconds. */
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Called when a session's status changed: the key and what it is now. */
  onChange?: (key: string, status: HostStatus | undefined, tracked: Tracked) => void;
}

const POLL_MS = 10_000;

export class HostWatch {
  private readonly tracked = new Map<string, Tracked>();
  private readonly opts: HostWatchOpts;

  constructor(opts: HostWatchOpts = {}) {
    this.opts = opts;
  }

  /** The status of every session the watch holds one for. */
  states(): ReadonlyMap<string, HostStatus> {
    const out = new Map<string, HostStatus>();
    for (const [k, t] of this.tracked) if (t.status) out.set(k, t.status);
    return out;
  }

  status(key: string): HostStatus | undefined {
    return this.tracked.get(key)?.status;
  }

  has(key: string): boolean {
    return this.tracked.has(key);
  }

  /** Follow a session on its host; one already followed is left as it is. */
  track(key: string, adapter: HostAdapter, id: HostId): void {
    if (this.tracked.has(key)) return;
    const env = this.opts.env ?? process.env;
    const t: Tracked = { key, adapter, id, streamed: false, stop: () => {} };
    this.tracked.set(key, t);
    const set = (status: HostStatus | undefined) => {
      if (!this.tracked.has(key)) return;
      const before = t.status;
      t.status = status;
      if (before?.state !== status?.state || before?.kind !== status?.kind) this.opts.onChange?.(key, status, t);
    };
    t.stop = adapter.follow(
      id,
      (ev) => {
        t.streamed = true;
        if (ev.kind === 'status') set(ev.status);
        else set({ state: 'done', at: new Date().toISOString() });
      },
      env,
    );
    const ask = () => {
      if (!this.tracked.has(key)) return;
      void statusAsync(adapter, id, env).then((s) => {
        if (s && !t.streamed) set(s);
        else if (s && t.streamed && !t.status) set(s);
      });
    };
    ask();
    t.poll = setInterval(() => {
      if (!t.streamed) ask();
    }, this.opts.pollMs ?? POLL_MS);
    t.poll.unref?.();
  }

  untrack(key: string): void {
    const t = this.tracked.get(key);
    if (!t) return;
    this.tracked.delete(key);
    t.stop();
    if (t.poll) clearInterval(t.poll);
  }

  /** Keep exactly these sessions followed: the others are let go. */
  keep(wanted: { key: string; adapter: HostAdapter; id: HostId }[]): void {
    const keys = new Set(wanted.map((w) => w.key));
    for (const k of [...this.tracked.keys()]) if (!keys.has(k)) this.untrack(k);
    for (const w of wanted) this.track(w.key, w.adapter, w.id);
  }

  close(): void {
    for (const k of [...this.tracked.keys()]) this.untrack(k);
  }
}
