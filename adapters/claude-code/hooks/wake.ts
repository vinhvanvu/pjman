// pjman's waking module: an idle session is woken when the store has something that asks it to act (decision
// messages/module-asks-the-server). For the session's life it reads one follower, `pjman wakes --session <id> --follow`,
// which prints a line for each event that wakes this session: a decision on its bound change set decided, a note on
// that change or on the session itself. On a line it submits one line naming what woke it, as a turn of its own that
// the harness runs once the session is idle; the plugin's prompt hook then briefs as on any prompt, which carries the
// decision or the note and moves the watermark. Everything else waits for the person's next prompt.
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code';

const PAUSE_MS = 5_000;
const PAUSE_MAX_MS = 300_000;
/** A follower that ran this long was working; one that exits sooner counts toward giving up. */
const HEALTHY_MS = 60_000;
const QUICK_EXITS = 5;

// one follower at a time: a new session (after a /clear) starts the next generation, and ending one kills its child
let generation = 0;
let follower: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined;

function stop(): void {
  generation++;
  void follower?.return({ code: null, signal: null });
  follower = undefined;
}

async function start($: EngineInterface): Promise<void> {
  stop();
  const mine = generation;
  const sid = await $.session.id();
  // the tool beside the plugin, as the command hook uses it; `pjman` on PATH otherwise
  const bin = `${$.plugin.root}/../../bin/pjman.js`;
  let argv: string[];
  try {
    await $.fs.read(bin);
    argv = ['node', bin];
  } catch {
    argv = ['pjman'];
  }

  let queued: string[] = [];
  let submitting = false;
  const submit = async (): Promise<void> => {
    if (submitting || !queued.length || mine !== generation) return;
    submitting = true;
    const why = [...new Set(queued)];
    queued = [];
    try {
      // resolves as the turn starts: the prompt hook has briefed by then, so a later line is a new wake
      await $.prompt.submit({
        text: `pjman: ${why.join('; ')}. The pjman brief with this turn carries it; act on it as the record now says.`,
      });
    } catch (err) {
      $.ui.log(`pjman: the wake was not submitted (${String(err)})`, { to: 'debug' });
    } finally {
      submitting = false;
      if (queued.length) void submit();
    }
  };

  let pause = PAUSE_MS;
  let quick = 0;
  while (mine === generation && quick < QUICK_EXITS) {
    const began = await $.clock.now();
    let pending = '';
    try {
      const child = $.process.spawn({
        argv: [...argv, 'wakes', '--session', sid, '--follow', '--json'],
        env: { PJMAN_SESSION: `session:${sid}` },
      });
      follower = child;
      for await (const chunk of child) {
        if (mine !== generation) break;
        if (chunk.stream !== 'stdout') continue;
        pending += chunk.text;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const w = JSON.parse(line) as { why?: string };
            if (w.why) queued.push(w.why);
          } catch {
            // not a wake line
          }
        }
        void submit();
      }
    } catch (err) {
      $.ui.log(`pjman: the follower did not start (${String(err)})`, { to: 'debug' });
    }
    if (mine !== generation) break;
    // the follower ended: start it again after a pause that doubles, and give up after a run of quick exits
    if ((await $.clock.now()) - began >= HEALTHY_MS) {
      pause = PAUSE_MS;
      quick = 0;
    } else quick++;
    await $.clock.sleep(pause);
    pause = Math.min(pause * 2, PAUSE_MAX_MS);
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    // interactive sessions only: a headless run has nobody to wake it for
    if (e.isInteractive) void start($);
    return started;
  });

  on('session.end', async ($, e, next) => {
    const ended = await next(e);
    // a /clear ends the session with no start after it: the next session's follower begins here
    if (e.reason === 'clear') void start($);
    else stop();
    return ended;
  });
};
