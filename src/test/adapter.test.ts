import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { findStore, type Store } from '../config.js';
import { set } from '../commands/set.js';
import { loadStore } from '../records.js';
import { validate } from '../validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, '..', '..', 'adapters', 'claude-code', 'hooks', 'hook.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-adapter-'));
const project = path.join(tmp, 'project');
const env = { ...process.env, PJMAN_HOME: path.join(tmp, 'home'), CLAUDE_PLUGIN_DATA: path.join(tmp, 'data'), CLAUDE_PROJECT_DIR: project };
delete (env as Record<string, unknown>).PJMAN_SESSION;
delete (env as Record<string, unknown>).PJMAN_STORE;
for (const k of Object.keys(env)) if (k.startsWith('CMUX_')) delete (env as Record<string, unknown>)[k];

function hook(event: string, input: Record<string, unknown>): string {
  return execFileSync(process.execPath, [HOOK, event], { input: JSON.stringify({ cwd: project, session_id: 'sess-a', ...input }), encoding: 'utf8', env });
}
const context = (out: string) => (out ? (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : '');

let store: Store;

// a gh that is signed in nowhere and knows one issue: the hook's forge, so no test reaches the network
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncase "$*" in *"issue view 12"*) echo \'{"number":12,"title":"Twelve","url":"https://github.com/acme/app/issues/12","state":"OPEN","labels":[{"name":"in progress"}],"milestone":null}\';; *) echo "gh: not logged in" >&2; exit 1;; esac\n', { mode: 0o755 });
(env as Record<string, string>).PATH = `${bin}:${process.env.PATH ?? ''}`;

before(() => {
  process.env.PJMAN_HOME = env.PJMAN_HOME;
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ checkers: [], cwd: project, inProject: true });
  store = findStore(project)!;
  newRecord(store, 'change', 'eight-week-test', { title: 'The test', summary: 's', writer: 'person:tester' });
});

test('SessionStart creates the session record and injects the board', () => {
  const ctx = context(hook('SessionStart', { source: 'startup' }));
  assert.match(ctx, /This run is session:sess-a/);
  assert.match(ctx, /change:eight-week-test/);
  const rec = loadStore(store).byKey.get('session:sess-a')![0];
  assert.equal(rec.data.agent, 'agent:claude-code');
  assert.equal(rec.data.on_behalf_of, 'person:tester');
  assert.equal(rec.data.writer, 'agent:claude-code');
  // who the person is, checked once at startup: this store holds no record for the actor, so that is said, with the way out
  assert.match(ctx, /\nIdentity \(pjman whoami --verify\):\n- person:tester has no record: run pjman init.*\nOffer the command to the person and never run a rename or a claim unasked\.\n/);
  assert.ok(!/Identity \(pjman whoami/.test(context(hook('SessionStart', { source: 'resume' }))), 'resume says nothing about identity');
  assert.ok(!/Identity \(pjman whoami/.test(context(hook('SessionStart', { source: 'startup', agent_id: 'sub-1' }))), 'a subagent says nothing about identity');
});

test('a prompt that binds keeps no Markdown view beside the session: the dashboard is the view', () => {
  hook('UserPromptSubmit', { prompt: 'work on change:eight-week-test' });
  assert.equal(fs.existsSync(path.join(env.CLAUDE_PLUGIN_DATA, 'view')), false);
  const st = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_PLUGIN_DATA, 'state', 'sess-a.json'), 'utf8'));
  assert.equal(st.watcher, undefined);
});

test('a prompt naming a change binds it and injects its context once', () => {
  assert.equal(hook('UserPromptSubmit', { prompt: 'hello' }), '');
  assert.equal(hook('UserPromptSubmit', { prompt: 'work on the eight-week-test now' }), '');
  assert.equal(hook('UserPromptSubmit', { prompt: 'again change:eight-week-test' }), '');
  assert.deepEqual(loadStore(store).byKey.get('session:sess-a')![0].data.changes, ['change:project/eight-week-test']);
});

test('a file write records an observed edge; a store write does not; a turn that acted gets a log line', () => {
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'cat README.md && npm test' } });
  hook('Stop', { last_assistant_message: 'Read only.' });
  hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(project, 'src/a.ts') } });
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(store.root, 'changes/eight-week-test/change.md') } });
  hook('Stop', { last_assistant_message: '## Done\n\n**Wrote** the rule: E1 to E4 tallied weekly.\nMore.' });
  hook('Stop', { last_assistant_message: 'nothing happened' });
  const rec = loadStore(store).byKey.get('session:sess-a')![0];
  assert.deepEqual((rec.data.observed as { to: string }[]).map((o) => o.to), ['file:src/a.ts']);
  const log = rec.sections.get('Log')!;
  assert.match(log, /Wrote the rule: E1 to E4 tallied weekly\./);
  assert.ok(!/nothing happened/.test(log));
  assert.ok(!/Read only/.test(log));
});

test('a subagent is a child session with parent', () => {
  hook('SubagentStart', { agent_id: 'agent-x', agent_type: 'Explore' });
  hook('PostToolUse', { agent_id: 'agent-x', tool_name: 'Bash', tool_input: { command: 'pjman session log agent-x "looked"' } });
  hook('SubagentStop', { agent_id: 'agent-x', last_assistant_message: 'Found three files.' });
  const child = loadStore(store).byKey.get('session:agent-x')![0];
  assert.equal(child.data.parent, 'session:sess-a');
  assert.match(child.sections.get('Log')!, /Found three files/);
});

test('compaction rehydrates the bound change; the store stays valid; a non-pjman directory is silent', () => {
  const ctx = context(hook('SessionStart', { source: 'compact' }));
  assert.match(ctx, /Bound change:\n\n# change:eight-week-test/);
  hook('SessionEnd', { reason: 'other' });
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error'), []);
  assert.equal(hook('SessionStart', { cwd: os.tmpdir(), session_id: 'zzz', source: 'startup' }), '');
});

test('a ticket id or URL in the prompt binds the change that binds it; in a project with a tracker a new ticket gets a change', () => {
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: work });
  init({ checkers: [], cwd: work, name: 'work' });
  const g = findStore(work)!;
  const at = (prompt: string) => hook('UserPromptSubmit', { cwd: work, session_id: 'sess-t', prompt });
  hook('SessionStart', { cwd: work, session_id: 'sess-t', source: 'startup' });
  assert.equal(at('look at ABC-1234 and UTF-8'), '');
  assert.ok(!loadStore(g).byKey.has('change:work/abc-1234'));
  set(g, 'project:work', ['tracker=linear'], {});
  // a ticket of the tracker with no record: nothing is created from the pattern; the agent is told to read and sync it
  const hint = context(at('start ABC-1234 please, mind UTF-8'));
  assert.match(hint, /ABC-1234 is linear:ABC-1234; the store has no record/);
  assert.match(hint, /pjman sync linear --from -/);
  assert.ok(!loadStore(g).byKey.has('change:work/abc-1234'));
  assert.ok(!loadStore(g).byKey.has('change:work/utf-8'));
  // once the sync (here: the record) exists, the id binds it
  newRecord(g, 'change', 'abc-1234', { title: 'ABC-1234', summary: 's', project: 'project:work', binds: ['linear:ABC-1234'] });
  const ctx = context(at('continue ABC-1234'));
  assert.match(ctx, /^# change:abc-1234 — ABC-1234/);
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:work/abc-1234']);
  assert.equal(at('see https://linear.app/acme/issue/ABC-1234/the-title.'), '');
  assert.equal(loadStore(g).records.filter((r) => r.type === 'change' && r.data.project === 'project:work').length, 1);
  // a GitHub project: acme/app#12 or its URL in the prompt is an issue; the hook reads it with gh and the sync creates the change
  assert.equal(at('fix #12 first'), '');
  set(g, 'project:work', ['tracker=github-issue', 'ext.github.repo=acme/app'], {});
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncase "$*" in *"issue view 12"*) echo \'{"number":12,"title":"Twelve","url":"https://github.com/acme/app/issues/12","state":"OPEN","labels":[{"name":"in progress"}],"milestone":null}\';; *) exit 1;; esac\n', { mode: 0o755 });
  const withGh = { ...env, PATH: `${bin}:${process.env.PATH ?? ""}` };
  const atGh = (prompt: string) => execFileSync(process.execPath, [HOOK, 'UserPromptSubmit'], { input: JSON.stringify({ cwd: work, session_id: 'sess-t', prompt }), encoding: 'utf8', env: withGh });
  // a bare #12 is too ambiguous to act on, as is an image's placeholder: nothing is read, created or bound
  assert.equal(atGh('fix #12 first'), '');
  assert.equal(atGh('look at [Image #12]'), '');
  assert.ok(!loadStore(g).byKey.has('change:work/app-12'));
  assert.match(context(atGh('fix acme/app#12 first')), /^# change:app-12 — Twelve/);
  const twelve = loadStore(g).byKey.get('change:work/app-12')![0];
  assert.deepEqual(twelve.data.binds, ['github-issue:acme/app#12']);
  assert.equal(twelve.data.writer, 'agent:github-sync');
  assert.equal(atGh('and https://github.com/acme/app/issues/12 again'), ''); // already hydrated: bound, no second injection
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:work/abc-1234', 'change:work/app-12']);
  assert.equal(atGh('then #1 of your list'), ''); // bare, even with a change of its own nearby
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:work/abc-1234', 'change:work/app-12']);
  assert.match(context(atGh('fix acme/app#13 too')), /acme\/app#13 is github-issue:acme\/app#13; the store has no record/); // gh knows no 13
  // the receipt at the end of the turn: what the store received, for the person
  const stop = JSON.parse(execFileSync(process.execPath, [HOOK, 'Stop'], { input: JSON.stringify({ cwd: work, session_id: 'sess-t', last_assistant_message: 'done' }), encoding: 'utf8', env: withGh })) as { systemMessage?: string };
  assert.match(stop.systemMessage ?? '', /pjman recorded:/);
  assert.match(stop.systemMessage ?? '', /created change:app-12 — Twelve/);
  assert.ok(!/session:sess-t:/.test(stop.systemMessage ?? ''));
  assert.equal(execFileSync(process.execPath, [HOOK, 'Stop'], { input: JSON.stringify({ cwd: work, session_id: 'sess-t', last_assistant_message: 'nothing' }), encoding: 'utf8', env: withGh }), '');
  assert.ok(!loadStore(g).byKey.has('change:work/app-13'));
  assert.deepEqual(validate(loadStore(g)).filter((p) => p.level === 'error'), []);
});

test('a session in an unregistered git repository registers it and gets the brief; auto_register: false keeps it silent', () => {
  const auto = path.join(tmp, 'auto');
  fs.mkdirSync(auto, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: auto });
  const ctx = context(hook('SessionStart', { cwd: auto, session_id: 'sess-auto', source: 'startup' }));
  assert.match(ctx, /^# pjman — the project's record, kept by agents/);
  assert.match(ctx, /project project:auto\./);
  assert.ok(loadStore(findStore(auto)!).byKey.has('project:auto'));
  const cfg = path.join(env.PJMAN_HOME, 'config.yaml');
  const before = fs.readFileSync(cfg, 'utf8');
  fs.writeFileSync(cfg, before + 'auto_register: false\n');
  const quiet = path.join(tmp, 'quiet');
  fs.mkdirSync(quiet, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: quiet });
  assert.equal(hook('SessionStart', { cwd: quiet, session_id: 'sess-quiet', source: 'startup' }), '');
  assert.ok(!loadStore(findStore(auto)!).byKey.has('project:quiet'));
  fs.writeFileSync(cfg, before);
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain, { recursive: true });
  assert.equal(hook('SessionStart', { cwd: plain, session_id: 'sess-plain', source: 'startup' }), '');
});

test('binding observes the branch as a source of the change', () => {
  const work = path.join(tmp, 'work');
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: work });
  execFileSync('git', ['checkout', '-q', '-b', 'feat/login'], { cwd: work });
  hook('SessionStart', { cwd: work, session_id: 'sess-b', source: 'startup' });
  hook('UserPromptSubmit', { cwd: work, session_id: 'sess-b', prompt: 'continue ABC-1234' });
  const g = findStore(work)!;
  const rec = loadStore(g).byKey.get('session:sess-b')![0];
  const observed = (rec.data.observed as { from: string; to: string }[]).map((o) => `${o.from} ${o.to}`);
  assert.ok(observed.includes('change:work/abc-1234 branch:feat/login'), observed.join(', '));
  assert.deepEqual(validate(loadStore(g)).filter((p) => p.level === 'error'), []);
});

test('SessionStart exports the session and the agent as writer to the agent\'s shell; a subagent\'s start does not', () => {
  const file = path.join(tmp, 'claude-env');
  const run = (input: Record<string, unknown>) =>
    execFileSync(process.execPath, [HOOK, 'SessionStart'], {
      input: JSON.stringify({ cwd: project, session_id: 'sess-env', source: 'startup', ...input }),
      encoding: 'utf8',
      env: { ...env, CLAUDE_ENV_FILE: file },
    });
  run({});
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^export PJMAN_WRITER="agent:claude-code"$/m);
  assert.match(text, /^export PJMAN_SESSION="session:sess-env"$/m);
  // what the shell then runs carries them: a decision opened from it is stamped with the session and the agent
  const shellEnv = { ...env };
  for (const m of text.matchAll(/^export (\w+)="(.*)"$/gm)) (shellEnv as Record<string, string>)[m[1]!] = m[2]!;
  execFileSync(process.execPath, [path.resolve(here, '..', '..', 'bin', 'pjman.js'), 'new', 'decision', 'eight-week-test/from-the-shell', '--title', 'T', '--decision', 'd', '--why', 'w'], { cwd: project, env: shellEnv, encoding: 'utf8' });
  const rec = loadStore(store).records.find((r) => r.type === 'decision' && r.key.endsWith('/from-the-shell'))!;
  assert.equal(rec.data.writer, 'agent:claude-code');
  assert.equal(rec.data.session, 'session:sess-env');
  run({ agent_id: 'sub-env' });
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'a subagent shares its parent\'s');
});
