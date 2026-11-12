// The follow window (change:follow-window): one browser window that shows the session the person is on. The server
// holds which session that is, from the person's own prompts (decision follow-window/the-signal: the session last
// prompted, posted by the harness's prompt hook, held in memory and never written to the store), and how many follow
// windows are open, from their streams. A session's start asks whether a window must be opened; one caller is told
// to open it, the others that it is open or being opened, so sessions started together never open two.

/** The session followed, and what said so. */
export interface Followed {
  session: string;
  at: string;
  /** prompt: the person typed into it; focus: the host says its block has the focus (Rex, once validated). */
  by: 'prompt' | 'focus';
}

export interface EnsureAnswer {
  /** Open a window: this caller holds the claim. */
  open: boolean;
  /** Why not: one is open, or another caller is opening one. */
  reason?: 'open' | 'opening';
  windows: number;
}

/** How long a caller that was told to open a window holds the claim while the page loads and connects. */
export const CLAIM_MS = 15_000;
/** How long after the server starts a window that was open before is given to reconnect (its stream retries in 2s). */
export const RECONNECT_MS = 4_000;

export class FollowState {
  private followed: Followed | null = null;
  private open = 0;
  private claimUntil = 0;
  private readonly started: number;

  constructor(
    private readonly onChange: (f: Followed) => void,
    now = Date.now(),
  ) {
    this.started = now;
  }

  get(): Followed | null {
    return this.followed;
  }

  get windows(): number {
    return this.open;
  }

  /** The person is on this session. Said again of the same session, only its time moves and no frame is sent. */
  set(session: string, by: Followed['by'] = 'prompt', now = Date.now()): Followed {
    const same = this.followed?.session === session;
    this.followed = { session, at: new Date(now).toISOString(), by };
    if (!same) this.onChange(this.followed);
    return this.followed;
  }

  /** A follow window connected; it holds the claim's place from now on. */
  connected(): void {
    this.open++;
    this.claimUntil = 0;
  }

  disconnected(): void {
    this.open = Math.max(0, this.open - 1);
  }

  /** How long a caller should wait before it is answered: a server just started gives an open window its reconnect. */
  waitFor(now = Date.now()): number {
    return Math.max(0, this.started + RECONNECT_MS - now);
  }

  /** Whether this caller opens a window: never while one is connected, never while another caller holds the claim. */
  ensure(now = Date.now()): EnsureAnswer {
    if (this.open > 0) return { open: false, reason: 'open', windows: this.open };
    if (now < this.claimUntil) return { open: false, reason: 'opening', windows: 0 };
    this.claimUntil = now + CLAIM_MS;
    return { open: true, windows: 0 };
  }
}
