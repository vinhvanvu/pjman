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
import { loadStore } from '../records.js';
import { validate } from '../validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, '..', '..', 'adapters', 'claude-code', 'hooks', 'hook.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-adapter-'));
const project = path.join(tmp, 'project');
const env = { ...process.env, PJMAN_HOME: path.join(tmp, 'home'), CLAUDE_PLUGIN_DATA: path.join(tmp, 'data'), CLAUDE_PROJECT_DIR: project };
delete (env as Record<string, unknown>).PJMAN_SESSION;
delete (env as Record<string, unknown>).PJMAN_STORE;

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

test('a prompt naming a change binds it and injects its context once', () => {
  assert.equal(hook('UserPromptSubmit', { prompt: 'hello' }), '');
  const ctx = context(hook('UserPromptSubmit', { prompt: 'work on the eight-week-test now' }));
  assert.match(ctx, /^# change:eight-week-test/);
  assert.equal(hook('UserPromptSubmit', { prompt: 'again change:eight-week-test' }), '');
  assert.deepEqual(loadStore(store).byKey.get('session:sess-a')![0].data.changes, ['change:eight-week-test']);
});

test('a file write records an observed edge; a store write does not; a turn that acted gets a log line', () => {
  hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(project, 'src/a.ts') } });
  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(store.root, 'changes/eight-week-test/change.md') } });
  hook('Stop', { last_assistant_message: '## Done\n\n**Wrote** the rule: E1 to E4 tallied weekly.\nMore.' });
  hook('Stop', { last_assistant_message: 'nothing happened' });
  const rec = loadStore(store).byKey.get('session:sess-a')![0];
  assert.deepEqual((rec.data.observed as { to: string }[]).map((o) => o.to), ['file:src/a.ts']);
  const log = rec.sections.get('Log')!;
  assert.match(log, /Wrote the rule: E1 to E4 tallied weekly\./);
  assert.ok(!/nothing happened/.test(log));
});

test('a subagent is a child session with parent', () => {
  hook('SubagentStart', { agent_id: 'agent-x', agent_type: 'Explore' });
  hook('PostToolUse', { agent_id: 'agent-x', tool_name: 'Bash', tool_input: { command: 'ls' } });
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
