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
import { step } from '../commands/step.js';
import { loadStore } from '../records.js';
import { validate } from '../validate.js';
import { accept, change, decisionRec } from './shape.js';

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
  change(store, 'eight-week-test', { title: 'The test', summary: 's', writer: 'person:tester' });
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

test('a prompt naming several changes binds none and says so; the turn shows the person what the brief cost', () => {
  change(store, 'other-work', { title: 'Other', summary: 's', writer: 'person:tester' });
  const at = (input: Record<string, unknown>) => hook('UserPromptSubmit', { session_id: 'sess-m', ...input });
  hook('SessionStart', { session_id: 'sess-m', source: 'startup' });
  const said = context(at({ prompt: 'compare change:eight-week-test with change:other-work' }));
  assert.match(said, /names several changes \(change:(project\/)?eight-week-test, change:(project\/)?other-work\); none was bound/);
  assert.equal(loadStore(store).byKey.get('session:sess-m')![0].data.changes, undefined);
  const full = context(at({ prompt: 'now change:other-work' }));
  assert.match(full, /^pjman brief: this session is bound to change:other-work; its context in full\./);
  const stop = JSON.parse(hook('Stop', { session_id: 'sess-m', last_assistant_message: 'ok' })) as { systemMessage: string };
  assert.match(stop.systemMessage, /^pjman briefed:\n- full context on change:other-work: \d+ lines, ~\d+ tokens/);
  // the next turn's brief starts after this one: nothing new, nothing said
  assert.equal(at({ prompt: 'carry on' }), '');
});

test('a prompt naming a PR that leads to no change observes it on the session itself and names the session review; a later bind keeps the name', () => {
  hook('SessionStart', { session_id: 'sess-r', source: 'startup' });
  assert.equal(hook('UserPromptSubmit', { session_id: 'sess-r', prompt: 'review https://github.com/acme/app/pull/5 please' }), '');
  const rec = loadStore(store).byKey.get('session:sess-r')![0];
  assert.equal(rec.data.changes, undefined);
  assert.deepEqual((rec.data.observed as { from: string; to: string }[]).map((o) => [o.from, o.to]), [['session:sess-r', 'github-pr:acme/app#5']]);
  assert.equal(rec.data.name, 'Review of acme/app#5');
  assert.equal(rec.data.kind, 'session-kind:review');
  assert.match(rec.body, /named "Review of acme\/app#5" \(review\), read from github-pr:acme\/app#5/);
  // the same PR again writes nothing more; a prompt that names nothing leaves it as it is
  const before = fs.readFileSync(rec.abs, 'utf8');
  hook('UserPromptSubmit', { session_id: 'sess-r', prompt: 'the same https://github.com/acme/app/pull/5' });
  hook('UserPromptSubmit', { session_id: 'sess-r', prompt: 'looks fine' });
  assert.equal(fs.readFileSync(rec.abs, 'utf8'), before);
  // bound later, the session keeps its name and its own edge; the branch it stands on is observed on the change from here
  hook('UserPromptSubmit', { session_id: 'sess-r', prompt: 'now change:eight-week-test' });
  const bound = loadStore(store).byKey.get('session:sess-r')![0];
  assert.deepEqual(bound.data.changes, ['change:project/eight-week-test']);
  assert.equal(bound.data.name, 'Review of acme/app#5');
  assert.equal((bound.data.observed as unknown[]).length, 1);
  assert.equal(validate(loadStore(store)).filter((p) => p.level === 'error').length, 0);
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

test('run to the end: a turn that wrote code may stop only where the change rests', () => {
  change(store, 'run-it', { title: 'Run it', summary: 's', writer: 'person:tester' });
  step(store, 'change:run-it', 'add', undefined, { text: 'first' });
  step(store, 'change:run-it', 'add', undefined, { text: 'second' });
  const at = (event: string, input: Record<string, unknown> = {}) => hook(event, { session_id: 'sess-run', ...input });
  const wrote = () => at('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(project, 'src/run.ts') } });
  const passes = (out: string, what: string) => assert.ok(!/"decision":"block"/.test(out), `${what}: ${out}`);
  at('SessionStart', { source: 'startup' });
  at('UserPromptSubmit', { prompt: 'build change:run-it' });
  // a turn that only talked, or only wrote the store, ends where it likes
  passes(at('Stop', { last_assistant_message: 'Here is what I would do.' }), 'a turn that only talked');
  at('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pjman step change:run-it start 1' } });
  passes(at('Stop', { last_assistant_message: 'Started.' }), 'a turn that wrote the store only');
  // a turn that wrote code with steps open is refused once: the change, the open steps, the ways out
  at('UserPromptSubmit', { prompt: 'go' });
  wrote();
  const refused = JSON.parse(at('Stop', { last_assistant_message: 'Wrote the first part; shall I go on?' })) as { decision: string; reason: string };
  assert.equal(refused.decision, 'block');
  assert.match(refused.reason, /^pjman: change:run-it is not at a resting point\. This turn wrote code for it and its plan still has 2 steps open:\n- 1\. first\n- 2\. second\n/);
  assert.match(refused.reason, /pjman decision change:run-it\/<slug>/);
  assert.match(refused.reason, /pjman set change:run-it blocked-on=/);
  assert.match(refused.reason, /committed on the worktree for review/);
  // the retry the harness marks passes, and the turn is logged once
  const retry = at('Stop', { last_assistant_message: 'Wrote the first part; shall I go on?', stop_hook_active: true });
  passes(retry, 'the marked retry');
  assert.match(loadStore(store).byKey.get('session:sess-run')![0].sections.get('Log') ?? '', /Wrote the first part/);
  // a decision proposed on the change is a resting point; accepted, it no longer holds
  at('UserPromptSubmit', { prompt: 'go on' });
  wrote();
  decisionRec(store, 'run-it/how', { title: 'How to cut it' });
  passes(at('Stop', { last_assistant_message: 'A decision is open.' }), 'a decision proposed');
  accept(store, 'decision:run-it/how', 'person:tester');
  at('UserPromptSubmit', { prompt: 'go on' });
  wrote();
  assert.equal((JSON.parse(at('Stop', { last_assistant_message: 'Paused.' })) as { decision?: string }).decision, 'block');
  // a blocker recorded is a resting point
  set(store, 'change:run-it', ['blocked-on=the key from ops'], {});
  passes(at('Stop', { last_assistant_message: 'Blocked on ops.', stop_hook_active: true }), 'the retry');
  at('UserPromptSubmit', { prompt: 'go on' });
  wrote();
  passes(at('Stop', { last_assistant_message: 'Still blocked.' }), 'a blocker recorded');
  set(store, 'change:run-it', ['blocked-on='], {});
  // the plan run to its end: the change reads review by itself and the turn may end
  at('UserPromptSubmit', { prompt: 'go on' });
  wrote();
  step(store, 'change:run-it', 'done', 1);
  step(store, 'change:run-it', 'done', 2);
  passes(at('Stop', { last_assistant_message: 'Done; committed for review.' }), 'the plan done');
  assert.equal(loadStore(store).byKey.get('change:project/run-it')![0].data.status, 'review');
  // a subagent that wrote code is never refused
  change(store, 'run-sub', { title: 'Run sub', summary: 's', writer: 'person:tester' });
  step(store, 'change:run-sub', 'add', undefined, { text: 'first' });
  hook('SubagentStart', { agent_id: 'sub-run', agent_type: 'general-purpose' });
  hook('UserPromptSubmit', { agent_id: 'sub-run', prompt: 'work change:run-sub' });
  hook('PostToolUse', { agent_id: 'sub-run', tool_name: 'Write', tool_input: { file_path: path.join(project, 'src/sub.ts') } });
  passes(hook('SubagentStop', { agent_id: 'sub-run', last_assistant_message: 'Wrote some.' }), 'a subagent');
});

test('questions become decisions: a reply that asks the person to choose is sent back once unless a decision was written', () => {
  change(store, 'ask-it', { title: 'Ask it', summary: 's', writer: 'person:tester' });
  const at = (event: string, input: Record<string, unknown> = {}) => hook(event, { session_id: 'sess-ask', ...input });
  const passes = (out: string, what: string) => assert.ok(!/"decision":"block"/.test(out), `${what}: ${out}`);
  const refused = (out: string, what: string) => {
    assert.match(out, /"decision":"block"/, what);
    return (JSON.parse(out) as { reason: string }).reason;
  };
  at('SessionStart', { source: 'startup' });
  at('UserPromptSubmit', { prompt: 'design change:ask-it' });
  // a proposal that ends on open questions laid out as chat: the stop is refused once, the questions named, the way to record them given
  const proposal = [
    '## The change page',
    '',
    'The page shows the ladder, then the plan. Here is how I would build it.',
    '',
    '```',
    'is this code? yes?',
    '```',
    '',
    '> you asked: can the plan go first?',
    '',
    '**Open questions**',
    '1. Does the plan sit above or below the decisions?',
    '2. Is a done step hidden, or shown struck through?',
    '3. Who sees the sessions list?',
  ].join('\n');
  let reason = refused(at('Stop', { last_assistant_message: proposal }), 'open questions in chat');
  assert.match(reason, /^pjman: this reply asks the person to choose and no decision was opened or added to this turn:\n- Does the plan sit above or below the decisions\?\n- Is a done step hidden, or shown struck through\?\n- Who sees the sessions list\?\n/);
  assert.match(reason, /pjman decision change:ask-it\/<slug>/);
  assert.ok(!/is this code/.test(reason), 'a question inside a code block is not one');
  assert.ok(!/can the plan go first/.test(reason), 'the person\'s quoted words are not one');
  assert.ok(!/not at a resting point/.test(reason), 'a turn that wrote no code is not judged on the plan');
  // the marked retry passes
  passes(at('Stop', { last_assistant_message: proposal, stop_hook_active: true }), 'the marked retry');
  // one question with alternatives in it, or one followed by options, is a choice; a lone question with none is not
  at('UserPromptSubmit', { prompt: 'go on' });
  reason = refused(at('Stop', { last_assistant_message: 'Do we keep the hook in the plugin or move the check into the tool?' }), 'alternatives in the question');
  assert.match(reason, /- Do we keep the hook in the plugin or move the check into the tool\?/);
  at('UserPromptSubmit', { prompt: 'go on' });
  reason = refused(at('Stop', { last_assistant_message: 'Which shape?\n- A: one hook\n- B: two hooks\n\nI lean A.' }), 'options listed under the question');
  assert.match(reason, /- Which shape\?/);
  at('UserPromptSubmit', { prompt: 'go on' });
  passes(at('Stop', { last_assistant_message: 'Wrote the first part. Shall I go on?' }), 'a lone question with no options');
  passes(at('Stop', { last_assistant_message: 'Done; committed for review.' }), 'no question');
  // a decision written this turn answers the questions: the stop passes
  at('UserPromptSubmit', { prompt: 'go on' });
  at('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pjman decision ask-it/plan-place --name "Plan place" --gist "g" --question "q" --option above="a" --option below="b" --recommend above="why"' } });
  passes(at('Stop', { last_assistant_message: 'A decision is open: above or below the decisions?\n- above\n- below' }), 'a decision written this turn');
  // the next turn starts clean: the same reply with no decision written is refused again
  at('UserPromptSubmit', { prompt: 'go on' });
  refused(at('Stop', { last_assistant_message: 'Above or below?\n- above\n- below' }), 'a new turn with no decision written');
  // the harness's own question prompt is a question put to the person: recorded as a decision, or sent back once
  at('UserPromptSubmit', { prompt: 'go on' });
  at('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Above or below?' }] } });
  reason = refused(at('Stop', { last_assistant_message: 'Placing the plan above, as you chose.' }), 'the question prompt with no decision');
  assert.match(reason, /put a question to the person through the prompt and no decision was opened or added to record it/);
  assert.match(reason, /--accept <id>="…" --by person:<handle>/);
  passes(at('Stop', { last_assistant_message: 'Placing the plan above, as you chose.', stop_hook_active: true }), 'the marked retry');
  at('UserPromptSubmit', { prompt: 'go on' });
  at('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Above or below?' }] } });
  at('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pjman decision ask-it/plan-place --accept above="above" --by person:tester' } });
  passes(at('Stop', { last_assistant_message: 'Recorded: the plan sits above.' }), 'the question prompt, then the decision recorded');
  // a session bound to no change, and a subagent, are left alone
  passes(hook('Stop', { session_id: 'sess-unbound', last_assistant_message: 'One or two?\n- one\n- two' }), 'no change bound');
  hook('SubagentStart', { agent_id: 'sub-ask', agent_type: 'general-purpose' });
  hook('UserPromptSubmit', { agent_id: 'sub-ask', prompt: 'work change:ask-it' });
  passes(hook('SubagentStop', { agent_id: 'sub-ask', last_assistant_message: 'One or two?\n- one\n- two' }), 'a subagent');
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
  assert.match(ctx, /pjman brief: this session is bound to change:eight-week-test; its context in full\.\n\n# change:eight-week-test/);
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
  change(g, 'abc-1234', { title: 'ABC-1234', summary: 's', project: 'project:work', binds: ['linear:ABC-1234'] });
  const ctx = context(at('continue ABC-1234'));
  assert.match(ctx, /^pjman brief: this session is bound to change:abc-1234; its context in full\.\n\n# change:abc-1234 — ABC-1234/);
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
  assert.match(context(atGh('fix acme/app#12 first')), /^pjman brief: this session is bound to change:app-12; its context in full\.\n\n# change:app-12 — Twelve/);
  const twelve = loadStore(g).byKey.get('change:work/app-12')![0];
  assert.deepEqual(twelve.data.binds, ['github-issue:acme/app#12']);
  assert.equal(twelve.data.writer, 'agent:github-sync');
  assert.equal(atGh('and https://github.com/acme/app/issues/12 again'), ''); // already hydrated: bound, no second injection
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:work/abc-1234', 'change:work/app-12']);
  assert.equal(atGh('then #1 of your list'), ''); // bare, even with a change of its own nearby
  assert.deepEqual(loadStore(g).byKey.get('session:sess-t')![0].data.changes, ['change:work/abc-1234', 'change:work/app-12']);
  assert.match(context(atGh('fix acme/app#13 too')), /acme\/app#13 is github-issue:acme\/app#13; the store has no record/); // gh knows no 13
  // the receipt at the end of the turn: what this session and the ones it spawned wrote, nothing from another session
  hook('SubagentStart', { cwd: work, session_id: 'sess-t', agent_id: 'sess-t-child', agent_type: 'Explore' });
  assert.equal(loadStore(g).byKey.get('session:sess-t-child')![0].data.parent, 'session:sess-t');
  set(g, 'change:work/abc-1234', ['notes=from the child'], { session: 'session:sess-t-child' });
  newRecord(g, 'session', 'sess-elsewhere', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  change(g, 'elsewhere', { title: 'Elsewhere', summary: 's', project: 'project:work', session: 'session:sess-elsewhere' });
  const stop =JSON.parse(execFileSync(process.execPath, [HOOK, 'Stop'], { input: JSON.stringify({ cwd: work, session_id: 'sess-t', last_assistant_message: 'done' }), encoding: 'utf8', env: withGh })) as { systemMessage?: string };
  assert.match(stop.systemMessage ?? '', /pjman recorded:/);
  assert.match(stop.systemMessage ?? '', /created change:app-12 — Twelve/);
  assert.match(stop.systemMessage ?? '', /set change:abc-1234 \(notes\)/);
  assert.ok(!/session:sess-t[:-]/.test(stop.systemMessage ?? '')); // neither its own bookkeeping nor the spawn
  assert.ok(!/elsewhere/.test(stop.systemMessage ?? ''));
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
  // a start outside any repository, with a global store: the session is recorded there with no project and told so
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain, { recursive: true });
  const loose = context(hook('SessionStart', { cwd: plain, session_id: 'sess-plain', source: 'startup' }));
  assert.match(loose, /project \(none\)\. This run is session:sess-plain/);
  assert.match(loose, /This session started outside any registered repository \(.*plain\)\. It is recorded with no project until a tool call lands in one/);
  const global = findStore(auto)!;
  const rec = () => loadStore(global).records.find((r) => r.type === 'session' && r.sessionId === 'sess-plain')!;
  assert.ok(rec(), 'the session record exists in the global store');
  assert.equal(rec().data.project, undefined);
  // a tool call that lands in a registered repository resolves the session to that project, once
  hook('PostToolUse', { cwd: plain, session_id: 'sess-plain', tool_name: 'Bash', tool_input: { command: 'ls -la' } });
  assert.equal(rec().data.project, undefined, 'a command that names no repository resolves nothing');
  hook('PostToolUse', { cwd: plain, session_id: 'sess-plain', tool_name: 'Bash', tool_input: { command: `cd ${auto} && pjman context` } });
  assert.equal(rec().data.project, 'project:auto');
  assert.match(rec().sections.get('Log') ?? '', /resolved to project:auto from the repository it works in/);
  // from here the session runs from that repository: a prompt naming nothing still gets the project's brief, and the next start is a resume there
  const back = context(hook('SessionStart', { cwd: plain, session_id: 'sess-plain', source: 'resume' }));
  assert.match(back, /project project:auto\. This run is session:sess-plain/);
  assert.doesNotMatch(back, /started outside any registered repository/);
  // a relative cd is read against the session's directory; a folder that is nobody's is asked about once
  const rel = context(hook('SessionStart', { cwd: tmp, session_id: 'sess-rel', source: 'startup' }));
  assert.match(rel, /started outside any registered repository/);
  hook('PostToolUse', { cwd: tmp, session_id: 'sess-rel', tool_name: 'Write', tool_input: { file_path: 'plain/notes.md' } });
  const relRec = () => loadStore(global).records.find((r) => r.type === 'session' && r.sessionId === 'sess-rel')!;
  assert.equal(relRec().data.project, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(env.CLAUDE_PLUGIN_DATA, 'state', 'sess-rel.json'), 'utf8')).tried, [plain]);
  hook('PostToolUse', { cwd: tmp, session_id: 'sess-rel', tool_name: 'Bash', tool_input: { command: 'cd auto && npm test' } });
  assert.equal(relRec().data.project, 'project:auto');
  assert.deepEqual(validate(loadStore(global)).filter((p) => p.level === 'error'), []);
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

test('SessionStart names the worktrees whose change is done and whose branch is merged, from the store, ahead of the board', () => {
  const trees = path.join(tmp, 'trees');
  fs.mkdirSync(trees, { recursive: true });
  const git = (args: string[], cwd = trees) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', ...args], { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['commit', '-q', '--allow-empty', '-m', 'root']);
  init({ checkers: [], cwd: trees, name: 'trees' });
  const g = findStore(trees)!;
  // three worktrees named by the harness for three changes: one done and merged (stale), one done but ahead of main, one still open
  for (const slug of ['old-thing', 'ahead-thing', 'live-thing']) {
    change(g, slug, { title: slug, summary: 's', project: 'project:trees' });
    git(['worktree', 'add', '-q', '-b', `worktree-${slug}`, path.join(trees, '.claude', 'worktrees', slug), 'main']);
  }
  set(g, 'change:trees/old-thing', ['status=done'], {});
  set(g, 'change:trees/ahead-thing', ['status=done'], {});
  git(['commit', '-q', '--allow-empty', '-m', 'ahead'], path.join(trees, '.claude', 'worktrees', 'ahead-thing'));
  // the listing carries each change's branch and worktree name, which is what the hook matches against
  const rows = JSON.parse(execFileSync(process.execPath, [path.resolve(here, '..', '..', 'bin', 'pjman.js'), 'ls', 'change', '--status', 'done', '--json'], { cwd: trees, env, encoding: 'utf8' })) as { key: string; branch?: { name: string; worktree: string; observed: boolean } }[];
  assert.deepEqual(rows.find((r) => r.key === 'change:trees/old-thing')?.branch, { name: 'old-thing', worktree: 'old-thing', observed: false });
  const ctx = context(hook('SessionStart', { cwd: trees, session_id: 'sess-trees', source: 'startup' }));
  const at = ctx.indexOf('Worktrees whose change is done and whose branch is merged');
  assert.ok(at >= 0, ctx);
  assert.ok(at < ctx.indexOf('# project:trees'), 'the stale worktrees come ahead of the board');
  const oldDir = fs.realpathSync(path.join(trees, '.claude', 'worktrees', 'old-thing')); // git prints the real path
  assert.ok(ctx.includes(`- ${oldDir} (change:trees/old-thing, worktree-old-thing): git worktree remove ${oldDir} && git branch -d worktree-old-thing`), ctx.slice(at, at + 600));
  assert.ok(!ctx.includes('ahead-thing, worktree-ahead-thing'), 'a done change whose branch is not merged is kept');
  assert.ok(!ctx.includes('live-thing, worktree-live-thing'), 'an open change is kept');
  // a subagent's start does not scan
  assert.ok(!context(hook('SessionStart', { cwd: trees, session_id: 'sess-trees', agent_id: 'sub-trees', source: 'startup' })).includes('Worktrees whose change'));
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
  execFileSync(process.execPath, [path.resolve(here, '..', '..', 'bin', 'pjman.js'), 'decision', 'eight-week-test/from-the-shell', '--name', 'T', '--gist', 'T', '--question', 'q', '--option', 'it=d', '--recommend', 'it=w'], { cwd: project, env: shellEnv, encoding: 'utf8' });
  const rec = loadStore(store).records.find((r) => r.type === 'decision' && r.key.endsWith('/from-the-shell'))!;
  assert.equal(rec.data.writer, 'agent:claude-code');
  assert.equal(rec.data.session, 'session:sess-env');
  run({ agent_id: 'sub-env' });
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'a subagent shares its parent\'s');
});

test('in cmux the pane belongs to the terminal: a start opens it on the bridge and the session takes it once it binds a change; a clear parks it again; another terminal keeps its own', () => {
  // a cmux that knows the surfaces it opened and records every call; a dashboard that is running
  const cbin = path.join(tmp, 'cmux-bin');
  const calls = path.join(tmp, 'cmux-calls');
  const open = path.join(tmp, 'cmux-open');
  const urls = path.join(tmp, 'cmux-urls'); // the page each surface shows: set by open and navigate, read by get url
  fs.mkdirSync(cbin, { recursive: true });
  fs.writeFileSync(open, '');
  fs.writeFileSync(urls, '');
  fs.writeFileSync(path.join(cbin, 'cmux'), `#!/bin/sh
echo "$*" >> '${calls}'
case "$1 $2" in
  "browser open") n=$(($(wc -l < '${open}') + 1)); echo "surface:$n" >> '${open}'; echo "surface:$n $3" >> '${urls}'; echo "OK surface=surface:$n";;
  "browser --surface") grep -qx "$3" '${open}' || { echo "Error: invalid_params" >&2; exit 1; }
    case "$4 $5" in
      "navigate "*) grep -v "^$3 " '${urls}' > '${urls}.n'; echo "$3 $5" >> '${urls}.n'; mv '${urls}.n' '${urls}';;
      "get url") grep "^$3 " '${urls}' | cut -d' ' -f2-;;
    esac;;
  "close-surface --surface") grep -vx "$3" '${open}' > '${open}.n'; mv '${open}.n' '${open}';;
esac
`, { mode: 0o755 });
  // the person browsing the pane to a page, as the dashboard's links do: no hook call, no cmux call recorded
  const browsed = (surface: string, url: string) =>
    fs.writeFileSync(urls, [...fs.readFileSync(urls, 'utf8').split('\n').filter((l) => l && !l.startsWith(`${surface} `)), `${surface} ${url}`].join('\n') + '\n');
  fs.writeFileSync(path.join(env.PJMAN_HOME, 'serve.json'), JSON.stringify({ pid: process.pid, url: 'http://dash.test' }));
  const at = (terminal: string, event: string, input: Record<string, unknown>) =>
    execFileSync(process.execPath, [HOOK, event], {
      input: JSON.stringify({ cwd: project, ...input }),
      encoding: 'utf8',
      env: { ...env, PATH: `${cbin}:${(env as Record<string, string>).PATH}`, CMUX_BUNDLE_ID: 'com.cmuxterm.app', CMUX_SURFACE_ID: terminal },
    });
  // the moves: every open, navigate and close; the reads of a pane's url (before a clear's move) are not moves
  const seen = () => fs.readFileSync(calls, 'utf8').split('\n').filter((l) => (l.startsWith('browser') && !l.endsWith(' get url')) || l.startsWith('close-surface'));
  // the product's bridge, where the pane opens at a start and is parked by a clear (change:start-on-the-bridge, change:clear-moves-the-dock)
  const scope = loadStore(store).scope;
  const bridge = scope ? `http://dash.test/bridge/product:${scope}` : 'http://dash.test/bridge';
  const git = (args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', ...args], { cwd: project, encoding: 'utf8' }).trim();
  git(['commit', '-q', '--allow-empty', '-m', 'root']); // a branch named for a change needs a commit to branch from
  const home = git(['symbolic-ref', '--short', 'HEAD']);
  try {
    // a brand new session opens the pane on the bridge; a compacted one leaves the pane as it is; the bind brings it to the session
    at('T1', 'SessionStart', { session_id: 'dock-1', source: 'startup' });
    at('T1', 'SessionStart', { session_id: 'dock-1', source: 'compact' });
    assert.deepEqual(seen(), [`browser open ${bridge}`], 'a new session opens the pane on the bridge, and a compacted one leaves it there');
    at('T1', 'UserPromptSubmit', { session_id: 'dock-1', prompt: 'work on change:eight-week-test' });
    at('T1', 'SessionStart', { session_id: 'dock-1', source: 'compact' });
    assert.deepEqual(seen().slice(1), ['browser --surface surface:1 navigate http://dash.test/session/dock-1'], 'the bind brings the pane to the session, and a compacted session keeps its page as it is');
    // /clear: the old session ends and parks the pane on the bridge; the next session leaves it there until it binds a change
    at('T1', 'SessionEnd', { session_id: 'dock-1', reason: 'clear' });
    at('T1', 'SessionStart', { session_id: 'dock-2', source: 'clear' });
    assert.deepEqual(seen().slice(2), [`browser --surface surface:1 navigate ${bridge}`], 'a session with no subject leaves the pane on the bridge');
    at('T1', 'UserPromptSubmit', { session_id: 'dock-2', prompt: 'work on change:eight-week-test' });
    assert.deepEqual(seen().slice(3), ['browser --surface surface:1 navigate http://dash.test/session/dock-2'], 'the bind brings the pane to the session');
    // a second terminal opens its own pane on the bridge, and its end closes only that one
    at('T2', 'SessionStart', { session_id: 'dock-3', source: 'startup' });
    at('T2', 'SessionEnd', { session_id: 'dock-3', reason: 'prompt_input_exit' });
    assert.deepEqual(seen().slice(4), [`browser open ${bridge}`, 'close-surface --surface surface:2']);
    // a pane the person closed while parked: the session that binds opens a new one
    at('T1', 'SessionEnd', { session_id: 'dock-2', reason: 'clear' });
    assert.deepEqual(seen().slice(6), [`browser --surface surface:1 navigate ${bridge}`]);
    fs.writeFileSync(open, '');
    at('T1', 'SessionStart', { session_id: 'dock-4', source: 'clear' });
    at('T1', 'UserPromptSubmit', { session_id: 'dock-4', prompt: 'work on change:eight-week-test' });
    assert.deepEqual(seen().slice(7), ['browser --surface surface:1 navigate http://dash.test/session/dock-4', 'browser open http://dash.test/session/dock-4']);
    // a parked pane closes with its terminal's session, as a followed one does
    at('T1', 'SessionEnd', { session_id: 'dock-4', reason: 'clear' });
    at('T1', 'SessionStart', { session_id: 'dock-5', source: 'clear' });
    at('T1', 'SessionEnd', { session_id: 'dock-5', reason: 'logout' });
    assert.deepEqual(seen().slice(9), [`browser --surface surface:1 navigate ${bridge}`, 'close-surface --surface surface:1']);
    // a start on a change's branch: the pane opens on the bridge and follows the session as soon as the start binds the change
    git(['checkout', '-q', '-b', 'eight-week-test']);
    at('T1', 'SessionStart', { session_id: 'dock-6', source: 'startup' });
    assert.deepEqual(seen().slice(11), [`browser open ${bridge}`, 'browser --surface surface:1 navigate http://dash.test/session/dock-6'], 'the branch gave the session its subject: the pane follows it');
    // a pane left on an ended session (its end never reached the hook) is pointed at the bridge by the next start
    at('T1', 'SessionStart', { session_id: 'dock-7', source: 'startup' });
    assert.deepEqual(seen().slice(13), [`browser --surface surface:1 navigate ${bridge}`, 'browser --surface surface:1 navigate http://dash.test/session/dock-7']);
    at('T1', 'SessionEnd', { session_id: 'dock-7', reason: 'logout' });
    // the agent's own bind (filing a change binds the run to it): a store write that binds nothing leaves the pane parked;
    // once the session holds a change, the next binding write brings the pane to the session (change:bind-moves-the-dock)
    git(['checkout', '-q', home]);
    at('T1', 'SessionStart', { session_id: 'dock-8', source: 'startup' });
    const pjmanBin = path.resolve(here, '..', '..', 'bin', 'pjman.js');
    const shell = (command: string) => at('T1', 'PostToolUse', { session_id: 'dock-8', tool_name: 'Bash', tool_input: { command } });
    shell('pjman session log dock-8 "looked around"');
    assert.deepEqual(seen().slice(15), ['close-surface --surface surface:1', `browser open ${bridge}`], 'an unbound session leaves the pane on the bridge');
    execFileSync(process.execPath, [pjmanBin, 'session', 'bind', 'dock-8', 'change:eight-week-test', '--reason', 'created'], { cwd: project, env });
    shell('pjman new change eight-week-test --name "…"');
    assert.deepEqual(seen().slice(17), ['browser --surface surface:1 navigate http://dash.test/session/dock-8'], 'the agent bound a change: the pane follows the session');
    shell('pjman session log dock-8 "again"');
    assert.equal(seen().length, 18, 'a binding taken up once is not taken up again');
    at('T1', 'SessionEnd', { session_id: 'dock-8', reason: 'logout' });
    // a parked pane the person browsed to another page: the clear sends it back to the bridge, since the dock records the
    // session followed and never the page shown; one already on the bridge, its pins in the url, is left as it is
    // (change:clear-returns-to-the-bridge)
    at('T1', 'SessionStart', { session_id: 'dock-9', source: 'startup' });
    const surface = fs.readFileSync(open, 'utf8').trim().split('\n').pop() as string;
    assert.deepEqual(seen().slice(19), [`browser open ${bridge}`]);
    browsed(surface, 'http://dash.test/session/dock-9?decision=decision:eight-week-test/x');
    at('T1', 'SessionEnd', { session_id: 'dock-9', reason: 'clear' });
    assert.deepEqual(seen().slice(20), [`browser --surface ${surface} navigate ${bridge}`], 'a parked pane browsed away goes back to the bridge on a clear');
    at('T1', 'SessionStart', { session_id: 'dock-10', source: 'clear' });
    browsed(surface, `${bridge}?hold=change:eight-week-test`);
    at('T1', 'SessionEnd', { session_id: 'dock-10', reason: 'clear' });
    at('T1', 'SessionStart', { session_id: 'dock-11', source: 'clear' });
    assert.equal(seen().length, 21, 'a pane already on the bridge keeps its page and its pins through a clear');
    at('T1', 'SessionEnd', { session_id: 'dock-11', reason: 'logout' });
    assert.deepEqual(seen().slice(21), [`close-surface --surface ${surface}`], 'a parked pane closes with the session that ends without binding');
  } finally {
    git(['checkout', '-q', home]);
    fs.rmSync(path.join(env.PJMAN_HOME, 'serve.json'), { force: true });
  }
});
