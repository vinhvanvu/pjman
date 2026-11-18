// Entire is an opt-in per project (change:entire-adapter): with the setting off nothing of Entire's is looked at or
// run; with it on, pjman reads Entire through one runner that never throws, and doctor reports what it finds and
// names (never runs) what is the person's to set up. Entire here is a fake binary that answers as the real one does.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { doctor, type Finding } from '../cli/doctor.js';
import { init } from '../cli/init.js';
import { entireBinary, entireOn, entireState, pendingLine, runEntire } from '../entire/entire.js';
import { set } from '../ops/set.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-entire-')));
const dir = path.join(tmp, 'web');
const calls = path.join(tmp, 'calls.log');
let store: Store;

/** A fake entire: logs each call, then answers by its arguments. `mode` picks how the account and repository stand. */
function fake(name: string, mode: 'fine' | 'off' | 'broken' | 'slow'): string {
  const file = path.join(tmp, name);
  const body = {
    fine: `case "$1 $2" in
  "version "*) echo "Entire CLI 9.9.9" ;;
  "status "*) echo '{"enabled":true,"agents":["Claude Code"],"checkpoint_sync_remote":"acme/web-entire"}' ;;
  "auth status") echo '{"logged_in":true,"display_name":"Tess Ter"}' ;;
  "trail list") echo '[{"number":1,"title":"One"}]' ;;
  *) echo "unknown command" >&2; exit 2 ;;
esac`,
    off: `case "$1 $2" in
  "version "*) echo "Entire CLI 9.9.9" ;;
  "status "*) echo '{"enabled":false,"agents":[]}' ;;
  "auth status") echo "not logged in" >&2; exit 1 ;;
esac`,
    broken: `case "$1" in
  version) echo "Entire CLI 9.9.9" ;;
  status) echo "this is not json" ;;
  *) echo "" >&2; echo "boom: the server said no" >&2; exit 3 ;;
esac`,
    slow: 'sleep 5',
  }[mode];
  fs.writeFileSync(file, `#!/bin/sh\necho "$@" >> ${calls}\n${body}\n`, { mode: 0o755 });
  return file;
}
const called = (): string[] => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []);
const entire = (f: Finding[]) => f.filter((x) => x.area === 'entire');
const quiet = { path: '', claudeDir: path.join(tmp, 'claude'), processes: () => [], answers: () => true };

/** Entire's hooks as `entire enable` leaves them: five git hooks, and Claude Code hooks in the project's settings. */
function installHooks(guarded = true): void {
  for (const h of ['prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite', 'pre-push'])
    fs.writeFileSync(path.join(dir, '.git', 'hooks', h), `#!/bin/sh\nentire hooks git ${h} || true\n`);
  const command = (e: string) =>
    guarded
      ? `sh -c 'if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks claude-code ${e}'`
      : `entire hooks claude-code ${e}`;
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: command('session-start') }] }],
        Stop: [{ hooks: [{ type: 'command', command: command('stop') }] }],
      },
    }),
  );
}

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  delete process.env.PJMAN_ENTIRE_BIN;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
});

test('off is the default: the project is not opted in, and doctor looks at nothing of Entire and runs nothing', () => {
  assert.equal(entireOn(loadStore(store), 'project:web'), false);
  assert.equal(entireOn(loadStore(store), undefined), false);
  const f = doctor({ ...quiet, entire: { bin: fake('entire-unused', 'fine') } });
  assert.deepEqual(entire(f), []);
  assert.deepEqual(called(), [], 'no entire command ran');
});

test('the runner reads JSON, and anything short of an answer is pending, never thrown', () => {
  const fine = { bin: fake('entire-fine', 'fine'), cwd: dir };
  assert.deepEqual(runEntire(['trail', 'list', '--project', 'gh/acme'], fine), {
    ok: true,
    data: [{ number: 1, title: 'One' }],
  });
  assert.equal(called().at(-1), 'trail list --project gh/acme --json', '--json is added');
  assert.deepEqual(runEntire(['version'], { ...fine, text: true }), { ok: true, data: 'Entire CLI 9.9.9' });

  const missing = runEntire(['status'], { bin: path.join(tmp, 'no-such-entire') });
  // the binary named and not there is said as that, not as a PATH that was never searched
  assert.deepEqual(missing, {
    ok: false,
    pending: true,
    kind: 'missing',
    reason: `no entire at ${path.join(tmp, 'no-such-entire')}`,
  });
  assert.equal(entireBinary({ path: path.join(tmp, 'empty') }), null);
  const nowhere = runEntire(['status'], { path: path.join(tmp, 'empty') });
  assert.equal(pendingLine(nowhere as { reason: string }), 'entire: pending (no entire on the PATH)');

  const broken = { bin: fake('entire-broken', 'broken'), cwd: dir };
  const failed = runEntire(['trail', 'show', '1'], broken);
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok && failed.kind === 'failed');
  assert.match(!failed.ok ? failed.reason : '', /^entire trail show 1 failed: boom: the server said no$/);
  const unreadable = runEntire(['status'], broken);
  assert.ok(!unreadable.ok && unreadable.kind === 'unreadable');

  const slow = runEntire(['status'], { bin: fake('entire-slow', 'slow'), timeout: 200 });
  assert.ok(!slow.ok && slow.kind === 'timeout');
});

test("what is the person's to run is refused before anything is spawned", () => {
  const bin = fake('entire-person', 'fine');
  const before = called().length;
  for (const args of [['login'], ['enable', '--yes'], ['disable'], ['auth', 'login'], ['trail', 'approve', '1']]) {
    const r = runEntire(args, { bin });
    assert.ok(!r.ok && r.kind === 'person', args.join(' '));
    assert.match(!r.ok ? r.reason : '', /is yours to run; pjman never runs it$/);
  }
  assert.equal(called().length, before, 'none of them ran');
  assert.equal(runEntire(['auth', 'status'], { bin }).ok, true, 'reading the login is not setup');
});

test('opted in and set up: the state reads the binary, the repository, the login and both hook sets', () => {
  set(store, 'project:web', ['ext.entire.enabled=true'], {});
  assert.equal(entireOn(loadStore(store), 'project:web'), true);
  installHooks();
  const s = entireState(dir, { bin: fake('entire-ok', 'fine') });
  assert.equal(s.version, '9.9.9');
  assert.equal(s.enabled, true);
  assert.equal(s.loggedIn, true);
  assert.equal(s.user, 'Tess Ter');
  assert.equal(s.checkpointRemote, 'acme/web-entire');
  assert.deepEqual(s.missingGitHooks, []);
  assert.deepEqual(s.claudeEvents, ['SessionStart', 'Stop']);
  assert.deepEqual(s.unguarded, []);
  const f = entire(doctor({ ...quiet, entire: { bin: fake('entire-ok', 'fine') } }));
  assert.equal(f.length, 1);
  assert.equal(f[0].level, 'ok');
  assert.match(
    f[0].message,
    /^Entire 9\.9\.9 is on for project:web \(.*\), logged in as Tess Ter, checkpoints to acme\/web-entire; its hooks run beside pjman's \(SessionStart, Stop\)$/,
  );
});

test('opted in and not set up: doctor names each thing and the command the person runs, and runs none of them', () => {
  installHooks(false);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-push'));
  fs.rmSync(calls, { force: true });
  const f = entire(doctor({ ...quiet, entire: { bin: fake('entire-off', 'off') } }));
  assert.ok(f.every((x) => x.level === 'warn' && x.fix));
  const text = f.map((x) => `${x.message} — ${x.fix}`).join('\n');
  assert.match(text, /Entire is not enabled in project:web .* — run in .*web: entire enable/);
  assert.match(text, /no Entire login is saved.* — run: entire login/);
  assert.match(text, /2 of Entire's Claude Code hooks .* fail a session where entire is not installed/);
  assert.ok(
    called().every((c) => /^(version|status|auth status)\b/.test(c)),
    `only reads ran: ${called().join('; ')}`,
  );

  const enabled = entire(doctor({ ...quiet, entire: { bin: fake('entire-ok2', 'fine') } }));
  assert.match(enabled.map((x) => x.message).join('\n'), /Entire's git hooks are missing in project:web .*: pre-push/);

  const none = entire(doctor({ ...quiet, entire: { bin: path.join(tmp, 'no-such-entire') } }));
  assert.equal(none.length, 1);
  assert.match(none[0].message, /opted in to Entire, and there is no entire on the PATH; pjman works as without it/);

  const broken = entire(doctor({ ...quiet, entire: { bin: fake('entire-broken2', 'broken') } }));
  assert.match(
    broken.map((x) => x.message).join('\n'),
    /Entire did not answer for project:web .*boom: the server said no/,
  );
});

test('opting out again leaves doctor silent about Entire', () => {
  set(store, 'project:web', ['ext.entire.enabled='], {});
  assert.equal(entireOn(loadStore(store), 'project:web'), false);
  assert.deepEqual(entire(doctor({ ...quiet, entire: { bin: fake('entire-last', 'fine') } })), []);
});
