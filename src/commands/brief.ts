// The brief: what an agent needs in front of it every session. The tool owns the words; adapters decide where they go.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BRIEF = `# pjman — the project's record, kept by agents

pjman is a context graph for product development: changes (units of work), decisions (what was chosen and why),
sources (tickets, PRs, branches, docs, files), sessions (runs like this one) and actors, as records in one store per
person. Every write goes through the \`pjman\` command; never edit a store file directly. This session is already a
record: what it binds, touches and logs is recorded by the harness.

Rules
1. Read before acting. \`pjman context change:<slug>\` for a named change; \`pjman get <anything>\` for a ticket id,
   a URL, a file or a key: the record and every change in reach.
2. Before a choice that forecloses options, open a decision:
   \`pjman new decision <change>/<slug> --title "…" --decision "…" --why "…"\`. It is created proposed. Never set one
   decided; that is the person's. Say in your reply that a decision is open and what you recommend.
3. New work is a change, filed through intake: \`pjman intake "<the request>"\` first (duplicates, the nodes it may alter,
   the milestones, the order's tail), then \`pjman new change <slug> --title "…" --summary "…"\`; name it in your reply
   as change:<slug>. A bug is \`--kind bug --severity <product|feature|capability|nuisance|cosmetic>\` on the live node it breaks.
4. Before you stop on a change, set the handoff: \`pjman set change:<slug> "next=…"\` and the status if it moved
   (open, planning, active, blocked, review, done, dropped).
5. Things outside the store are sources, linked by key: \`--links file:<path>\`, \`github-pr:<owner>/<repo>#<n>\`, \`url:<https://…>\`; a record for a source is optional.
6. Nothing harness-specific in a record: no tool, model or session mechanics in titles, summaries or decisions.

Tickets
The project may name a tracker (\`pjman where --json\` shows it). Read tickets with the tracker's own tools (Linear's MCP:
get_issue, list_issues; GitHub: \`pjman sync github\` with no --from prints the gh command to run) and hand pjman the
answer as JSON: \`pjman sync linear --from - <<'EOF' … EOF\` or \`<that gh command> | pjman sync github --from -\`. The ticket
becomes a source and the change that binds it; title, status and parent follow the ticket; next, summary, plan and
decisions stay pjman's. A ticket named in a prompt binds its change when the store has one; otherwise you are told to
read it and sync, which creates the change. \`pjman refs <text>\` shows what a text refers to.

The product tree
A product is the root; features nest beneath it; projects attach to it. Levels are defined by the question each answers:
a feature is what the product does for a person, nameable in a sentence a user would recognise; a capability is a distinct
behaviour a change can add, change or remove, the most specific node a change names (capabilities may nest).
A change names the features it adds, changes or removes: \`--features "adds feature:<slug>"\` (a bare key means changes);
name the most specific node. A parent change is a milestone; goals are milestones, not features. \`pjman tree\` shows the product by features with derived status, owners and backlog; \`pjman activity
<key>\` the motion beneath any node. Create a feature only when the person names a capability, never from a ticket label.
A product with no map is said so at the top of the context: the map skill surveys the repository, proposes the whole tree
in a proposed decision, and applies it only on the go as one batch (\`pjman apply\`; \`pjman undo\` reverts it); a map that has outgrown its shape is regrouped the same way, when asked.

Also: \`pjman ls decision --status proposed\` (what waits on a person) · \`pjman show <key>\` · \`pjman validate\` · the dashboard: \`pjman start\` prints its URL (also in ~/.pjman/serve.json).
`;

const OPEN = '<!-- pjman:brief -->';
const CLOSE = '<!-- /pjman:brief -->';

export type BriefTarget = 'claude-md';

export function briefTargetPath(target: BriefTarget): string {
  if (target === 'claude-md') return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'CLAUDE.md');
  throw new Error(`unknown brief target ${String(target)}`);
}

/** Put the brief in a harness's always-on file, between markers; a later install replaces it. Returns the path and whether it changed. */
export function installBrief(target: BriefTarget): { path: string; changed: boolean } {
  const file = briefTargetPath(target);
  const block = `${OPEN}\n${BRIEF.trim()}\n${CLOSE}\n`;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // new file
  }
  const i = text.indexOf(OPEN);
  const j = text.indexOf(CLOSE);
  let next: string;
  if (i >= 0 && j > i) next = text.slice(0, i) + block + text.slice(j + CLOSE.length).replace(/^\n/, '');
  else next = (text ? text.replace(/\n*$/, '\n\n') : '') + block;
  if (next === text) return { path: file, changed: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return { path: file, changed: true };
}
