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

before(() => {
  process.env.PJMAN_HOME = env.PJMAN_HOME;
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ cwd: project, inProject: true });
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
});

test('the view file follows the session: the board before a bind, the change after', () => {
  const file = path.join(env.CLAUDE_PLUGIN_DATA, 'view', 'sess-a.md');
  const before = fs.readFileSync(file, 'utf8');
  assert.match(before, /^# project\n/);
  assert.match(before, /change:eight-week-test/);
  hook('UserPromptSubmit', { prompt: 'work on change:eight-week-test' });
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /^# change:eight-week-test\n## The test\n\*\*open\*\*/);
  assert.match(after, /following session:sess-a/);
});

test('a prompt naming a change binds it and injects its context once', () => {
  assert.equal(hook('UserPromptSubmit', { prompt: 'hello' }), '');
  assert.equal(hook('UserPromptSubmit', { prompt: 'work on the eight-week-test now' }), '');
  assert.equal(hook('UserPromptSubmit', { prompt: 'again change:eight-week-test' }), '');
  assert.deepEqual(loadStore(store).byKey.get('session:sess-a')![0].data.changes, ['change:eight-week-test']);
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
  init({ cwd: work, name: 'work' });
  const g = findStore(work)!;
  const at = (prompt: string) => hook('UserPromptSubmit', { cwd: work, session_id: 'sess-t', prompt });
  hook('SessionStart', { cwd: work, session_id: 'sess-t', source: 'startup' });
  assert.equal(at('look at ABC-1234 and UTF-8'), '');
  assert.ok(!loadStore(g).byKey.has('change:abc-1234'));
  set(g, 'project:work', ['tracker=linear'], {});
  // a ticket of the tracker with no record: nothing is created from the pattern; the agent is told to read and sync it
  const hint = context(at('start ABC-1234 please, mind UTF-8'));
  assert.match(hint, /ABC-1234 is linear:ABC-1234; the store has no record/);
  assert.match(hint, /pjman sync linear --from -/);
  assert.ok(!loadStore(g).byKey.has('change:abc-1234'));
  assert.ok(!loadStore(g).byKey.has('change:utf-8'));
  // once the sync (here: the record) exists, the id binds it
  newRecord(g, 'change', 'abc-1234', { title: 'ABC-1234', summary: 's', project: 'project:work', binds: ['linear:ABC-1234'] });
  const ctx = context(at('continue ABC-1234'));
  assert.match(ctx, /^# change:abc-1234 — ABC-1234/);
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:abc-1234']);
  assert.equal(at('see https://linear.app/acme/issue/ABC-1234/the-title.'), '');
  assert.equal(loadStore(g).records.filter((r) => r.type === 'change' && r.data.project === 'project:work').length, 1);
  // a GitHub project: #12 in the prompt is an issue of its repository; the hook reads it with gh and the sync creates the change
  assert.equal(at('fix #12 first'), '');
  set(g, 'project:work', ['tracker=github-issue', 'ext.github.repo=acme/app'], {});
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncase "$*" in *"issue view 12"*) echo \'{"number":12,"title":"Twelve","url":"https://github.com/acme/app/issues/12","state":"OPEN","labels":[{"name":"in progress"}],"milestone":null}\';; *) exit 1;; esac\n', { mode: 0o755 });
  const withGh = { ...env, PATH: `${bin}:${process.env.PATH ?? ""}` };
  const atGh = (prompt: string) => execFileSync(process.execPath, [HOOK, 'UserPromptSubmit'], { input: JSON.stringify({ cwd: work, session_id: 'sess-t', prompt }), encoding: 'utf8', env: withGh });
  assert.match(context(atGh('fix #12 first')), /^# change:app-12 — Twelve/);
  const twelve = loadStore(g).byKey.get('change:app-12')![0];
  assert.deepEqual(twelve.data.binds, ['github-issue:acme/app#12']);
  assert.equal(twelve.data.writer, 'agent:github-sync');
  assert.equal(atGh('and acme/app#12 again'), ''); // already hydrated: bound, no second injection
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:abc-1234', 'change:app-12']);
  assert.match(context(atGh('fix #13 too')), /#13 is github-issue:acme\/app#13; the store has no record/); // gh knows no 13
  assert.ok(!loadStore(g).byKey.has('change:app-13'));
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
  assert.ok(observed.includes('change:abc-1234 branch:feat/login'), observed.join(', '));
  assert.deepEqual(validate(loadStore(g)).filter((p) => p.level === 'error'), []);
});
