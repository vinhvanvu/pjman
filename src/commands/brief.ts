// The brief: what an agent needs in front of it every session. The tool owns the words; adapters decide where they go.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BRIEF = `# pjman — the project's record, kept by agents

pjman is a context graph for product development: changes (units of work), decisions (what was chosen and why),
sources (tickets, PRs, branches, docs, files), sessions (runs like this one) and actors, as records in one store per
person. Every write goes through the \`pjman\` command; never edit a store file directly. This session is already a
record: what it binds, touches and logs is recorded by the harness.

A change and a decision read as a ladder: a name (one to four words), a gist (one line), then the foundation in full. A change's foundation is its sections in order of depth (Origin: where it came from, as it was said; Intent; Done when; then Scope, the plan as steps, Open questions, Blocked on, Notes); a decision's is an append-only thread (question, criteria, options with their case, the recommendation, the person's comments, rejections, the acceptance). Status, the next step, progress and what waits are derived: never write them as text. No title, summary or next.

Rules
1. Read before acting. \`pjman context change:<slug>\` for a named change; \`pjman get <anything>\` for a ticket id, a URL, a file or a key: the record and every change in reach. A record that says what it needs (name, gist, intent, done when) or that its rungs are stale gets those written first, in the same write as any foundation you change.
2. Before a choice that forecloses options, open a decision with its options laid out and one recommended: \`pjman decision <change>/<slug> --name "…" --gist "<what is decided, one line>" --question "…" --option <id>="<one line>" --option <id>="…" --case <id>="<points, one per line>" --recommend <id>="why"\`. The views draw the options with the recommended one marked once and its case as bullets, so the gist never restates the recommendation. It is created proposed; the same command adds to it later (--question, --option, the same --option <id> again to restate it, --comment "…" --by person:<handle>, with --on <id> when it is about one option, --reject <id>="why"). Never accept one on your own judgment; say it is open and what you recommend. When the person decides in chat, record it (\`pjman decision <change>/<slug> --accept <id>="their words" --by person:<handle>\`) and do what the agreement implies (merge once reviewed, cleanup, status) without asking again; hand them no command to run.
3. New work is a change, filed through intake: \`pjman intake "<the request>"\` first (duplicates, the nodes it may alter, the milestones, the order's tail; on a product with no map, how the map comes with this change), then \`pjman new change <slug> --name "…" --gist "…" --origin "<the request in the person's words, or the key it came from>" --intent "…" --done-when "…"\`; name it in your reply as change:<slug>. A bug is \`--kind bug --severity <product|feature|capability|nuisance|cosmetic>\` on the live node it breaks; when the behaviour exists and no node has it, the honest search first, then the live node is created under the feature it correlates to.
4. Keep the plan true: \`pjman step <change> add "…" | start <n> | done <n> --note "…" | drop <n> | note <n> "where the work stands" | move <n> --before <m>\`. Before you stop on a change, leave the plan where the work stands and the status if it moved to blocked, review, done or dropped (planning and active follow the plan by themselves); an outside blocker is \`blocked-on=…\`.
5. Things outside the store are sources, linked by key: \`--links file:<path>\`, \`github-pr:<owner>/<repo>#<n>\`, \`url:<https://…>\`; a record for a source is optional.
6. Nothing harness-specific in a record: no tool, model or session mechanics in names, gists, sections or decisions.
7. Keys are paths under the product (\`change:<product>/<slug>\`); inside this project the slug alone names a record, as the context prints them; the product segment is for another product's record.

Tickets
The project may name a tracker (\`pjman where --json\` shows it). Read tickets with the tracker's own tools (Linear's MCP: get_issue, list_issues; GitHub: \`pjman sync github\` with no --from prints the gh command to run) and hand pjman the answer as JSON: \`pjman sync linear --from - <<'EOF' … EOF\` or \`<that gh command> | pjman sync github --from -\`. The ticket becomes a source and, when none binds it, a change with the ticket linked in its Origin and a draft gist; pjman is the source of truth, the ticket one more input to read before writing the change's name, intent and done-when. A ticket named in a prompt (its id, owner/repo#n or its URL; a bare #n never binds) binds its change when the store has one; otherwise you are told to read it and sync, which creates the change. \`pjman refs <text>\` shows what a text refers to.

The product tree
A product is the root; features nest beneath it; projects attach to it. Levels are defined by the question each answers:
a feature is what the product does for a person, nameable in a sentence a user would recognise; a capability is a distinct
behaviour a change can add, change or remove, the most specific node a change names (capabilities may nest).
A change names the features it adds, changes or removes: \`--features "adds feature:<slug>"\` (a bare key means changes);
name the most specific node. A parent change is a milestone; goals are milestones, not features. \`pjman tree\` shows the product by features with derived status, owners and backlog; \`pjman activity
<key>\` the motion beneath any node. Create a feature only when the person names a capability, never from a ticket label.
A product with no map is said so at the top of the context, with what the repository holds. The map comes with the first change
filed, in the same breath: with docs or code, the change is filed with no feature and the map skill proposes the whole tree in a
proposed decision naming it, applied only on the go as one batch (\`pjman apply\`; \`pjman undo\` reverts it); a bare repository grows
its map through intake, a capability under a feature per change. A map that has outgrown its shape ("map outgrown") is regrouped the same way, only when asked.
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
