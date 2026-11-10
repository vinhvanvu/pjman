// The release: one command that reads what main has shipped since the last tag, derives the version from the record,
// writes the changelog, stamps the version, commits, tags, builds, packs, attaches the package to a GitHub release,
// publishes it to npm and writes the Homebrew formula for it into the tap
// (decisions releases-homebrew/one-release-command, bump-from-the-record, tap-while-private).
//
//   npm run release                    derive the level from the changes and release
//   npm run release -- minor           a typed level overrides the derived one (patch | minor | major)
//   npm run release -- --dry-run       print the derivation and the changelog entry; write nothing
//
// What a release ships is read from git, never from prose: every first-parent commit on main since the last v* tag,
// resolved to a change by the trailer the merge convention writes, `(change:<slug>)`, or by the branch name of the
// merge (`worktree-<slug>`). What each change is comes from the store: a bug is a patch, a change that names a feature
// it adds, changes or removes is a minor, a change naming no node is a patch; the highest wins. A commit that resolves
// to no change is listed under Also and counts as a patch, so nothing is dropped silently. Major is typed only.
// A store migration the tool carries for a version past the current one makes the release at least a minor, and its
// version must be the release's (decision releases-homebrew/store-names-its-version).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (line) => process.stdout.write(`${line}\n`);
const fail = (line) => {
  process.stderr.write(`release: ${line}\n`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) =>
  (execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }) ?? '').trim();
const soft = (cmd, args) => {
  try {
    return run(cmd, args);
  } catch {
    return null;
  }
};
const ok = (cmd, args) => soft(cmd, args) !== null;
const git = (...args) => run('git', args);

// ---- the tool, built: the script reads versions, levels and the store's moves from the same code that runs them, and
// every store write goes through this checkout's pjman, never the installed copy, which may be the release before ----

say('building the tool…');
run('npm', ['run', 'build'], { stdio: ['ignore', 'ignore', 'inherit'] });
const { MIGRATIONS } = await import(path.join(root, 'dist', 'commands', 'migrate.js'));
const { compareVersions } = await import(path.join(root, 'dist', 'version.js'));
const { VERSION_RE } = await import(path.join(root, 'dist', 'keys.js'));
const { RELEASE_LEVELS } = await import(path.join(root, 'dist', 'validate.js'));
const pjman = (args, opts = {}) => run(process.execPath, [path.join(root, 'bin', 'pjman.js'), ...args], opts);

// ---- the Homebrew formula: scripts/pjman.rb with the version and the checksum of the package npm serves, written to the
// tap after each publish so brew install and brew upgrade follow the release ----

const TAP = 'vinhvanvu/homebrew-pjman';
const FORMULA = 'Formula/pjman.rb';
const formula = (version, sha256) =>
  fs.readFileSync(path.join(root, 'scripts', 'pjman.rb'), 'utf8').replaceAll('__VERSION__', version).replaceAll('__SHA256__', sha256);
const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Writes the formula to the tap through the GitHub API: an update when the file exists, a creation otherwise. */
const writeFormula = (version, sha256) => {
  const existing = soft('gh', ['api', `repos/${TAP}/contents/${FORMULA}`, '-q', '.sha']);
  const content = Buffer.from(formula(version, sha256)).toString('base64');
  return run('gh', [
    'api', '-X', 'PUT', `repos/${TAP}/contents/${FORMULA}`,
    '-f', `message=pjman ${version}`, '-f', `content=${content}`, ...(existing ? ['-f', `sha=${existing}`] : []),
    '-q', '.commit.html_url',
  ]);
};

// ---- arguments ------------------------------------------------------------------------------------------------------

const LEVELS = [...RELEASE_LEVELS];
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const typed = args.find((a) => LEVELS.includes(a));
const unknown = args.filter((a) => a !== '--dry-run' && !LEVELS.includes(a));
if (unknown.length) fail(`unknown argument ${unknown.join(' ')}; usage: npm run release [-- patch|minor|major] [--dry-run]`);

// ---- what main has shipped since the last tag -----------------------------------------------------------------------

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
if (!VERSION_RE.test(current)) fail(`package.json version ${current} is not a plain semver`);

const lastTag = soft('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*']);
const since = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const commits = git('log', '--first-parent', '--reverse', '--format=%H%x1f%s', since)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, subject] = line.split('\x1f');
    return { sha, short: sha.slice(0, 7), subject };
  });
if (!commits.length) fail(`nothing to release: no commit on main since ${lastTag}`);
if (lastTag && lastTag !== `v${current}`) say(`note: the last tag is ${lastTag} but package.json says ${current}; bumping from ${current}`);

// ---- the changes those commits shipped, from the store --------------------------------------------------------------

const changes = JSON.parse(pjman(['ls', 'change', '--json']));
const bySlug = new Map();
for (const c of changes) {
  const slug = c.key.replace(/^change:[^/]+\//, '');
  bySlug.set(slug, c);
  for (const alias of c.data?.aliases ?? []) bySlug.set(alias.replace(/^change:[^/]+\//, ''), c);
}
const resolve = (slug) => bySlug.get(slug) ?? bySlug.get(slug.replace(/^worktree-/, '')) ?? null;

/** The change keys a commit names: every `change:<slug>` in the parenthesised group that ends the subject (the trailer
 *  the merge convention writes, `(change:a, change:b)`, or `(decision x/y; change:a)`), else the branch a merge into
 *  main brought in. */
function keysOf(subject) {
  const trailer = /\(([^()]*\bchange:[^()]*)\)\s*$/.exec(subject);
  if (trailer) return [...trailer[1].matchAll(/change:([A-Za-z0-9_./-]+)/g)].map((m) => m[1].replace(/^[^/]+\//, ''));
  const merge = /^Merge branch '([^']+)'(?:\s+into\s+main\b)?(?!\s+into\b)/.exec(subject);
  return merge ? [merge[1]] : [];
}

const shipped = new Map(); // key -> { change, commits: [] }
const also = []; // commits that resolve to no change
for (const commit of commits) {
  const found = keysOf(commit.subject).map(resolve).filter(Boolean);
  if (!found.length) {
    also.push(commit);
    continue;
  }
  for (const change of found) {
    const entry = shipped.get(change.key) ?? { change, commits: [] };
    entry.commits.push(commit);
    shipped.set(change.key, entry);
  }
}

/** What a change says it is, and the level that implies. */
function classify(change) {
  const d = change.data ?? {};
  const features = (d.features ?? []).map(String);
  if (d.kind === 'bug') return { level: 'patch', group: 'Fixed', why: `bug${d.severity ? `, ${d.severity}` : ''}` };
  if (features.some((f) => /^removes\s/.test(f))) return { level: 'minor', group: 'Removed', why: features.join('; ') };
  if (features.some((f) => /^adds\s/.test(f))) return { level: 'minor', group: 'Added', why: features.join('; ') };
  if (features.length) return { level: 'minor', group: 'Changed', why: features.join('; ') };
  return { level: 'patch', group: 'Changed', why: 'names no node' };
}

const entries = [...shipped.values()].map((e) => ({ ...e, ...classify(e.change) }));
const higher = (a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);
let derived = entries.map((e) => e.level).reduce(higher, 'patch');

// the store's moves this release ships: a move past the current version makes the release at least a minor
const migrations = MIGRATIONS.filter((m) => compareVersions(m.since, current) > 0);
if (migrations.length) derived = higher(derived, 'minor');

const level = typed ?? derived;
const bump = (v, l) => {
  const [a, b, c] = v.split('.').map(Number);
  return l === 'major' ? `${a + 1}.0.0` : l === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
};
const next = bump(current, level);
for (const m of migrations) {
  if (m.since !== next) fail(`the ${m.name} move says it is introduced in ${m.since}, but this release is ${next}; a store move ships in the release that introduces it (its since in src/commands/migrate.ts), at least a minor`);
}
const tag = `v${next}`;
const today = new Date().toISOString().slice(0, 10);

// ---- the derivation, printed ----------------------------------------------------------------------------------------

const shortKey = (key) => key.replace(/^change:[^/]+\//, 'change:');
say(`${current} → ${next} (${level}${typed ? ', typed' : derived === 'patch' && !entries.length ? ', nothing names a change' : ''}): ${commits.length} commit${commits.length === 1 ? '' : 's'} on main since ${lastTag ?? 'the first commit'}`);
for (const e of entries) say(`  ${e.level.padEnd(5)}  ${shortKey(e.change.key)} — ${e.change.name ?? e.change.title}: ${e.change.data?.gist ?? ''}  (${e.why})`);
for (const m of migrations) say(`  minor  the ${m.name} move of the store (${m.about}), introduced in ${m.since}`);
for (const c of also) say(`  also   ${c.short} ${c.subject}`);
if (typed && typed !== derived) say(`  typed ${typed} over the derived ${derived}`);

// ---- the changelog entry --------------------------------------------------------------------------------------------

const GROUPS = ['Added', 'Changed', 'Fixed', 'Removed'];
const lines = [`## ${next} — ${today}`, ''];
for (const group of GROUPS) {
  const inGroup = entries.filter((e) => e.group === group);
  if (!inGroup.length) continue;
  lines.push(`### ${group}`, '');
  for (const e of inGroup) {
    const name = e.change.name ?? e.change.title ?? shortKey(e.change.key);
    const gist = e.change.data?.gist ? `: ${e.change.data.gist}` : '';
    lines.push(`- **${name}**${gist} (${shortKey(e.change.key)})`);
  }
  lines.push('');
}
if (migrations.length) {
  lines.push('### Store', '');
  for (const m of migrations) lines.push(`- The ${m.name} move: ${m.about}. After installing, run \`pjman migrate\` until it reports nothing to migrate (each run makes one move; the stamp comes last).`);
  lines.push('');
}
if (also.length) {
  lines.push('### Also', '');
  for (const c of also) lines.push(`- ${c.subject} (${c.short})`);
  lines.push('');
}
const entry = lines.join('\n');

if (dryRun) {
  say('');
  say(entry.trimEnd());
  say('');
  say(`the tap ${TAP} gets ${FORMULA} for ${next}:`);
  say(formula(next, '<sha256 of the package>').replace(/^#.*\n/gm, '').trimEnd());
  say('');
  say('dry run: nothing written');
  process.exit(0);
}

// ---- refusals -------------------------------------------------------------------------------------------------------

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`on ${branch}, not main; a release is cut from main`);
if (git('status', '--porcelain')) fail('the working tree is not clean; commit or set the work aside first');
if (soft('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) fail(`tag ${tag} exists; a release that stopped after its tag is finished by hand with the commands it printed`);
if (!ok('gh', ['auth', 'status'])) fail('gh is not signed in; the release is created with gh');
if (!ok('npm', ['whoami'])) fail('npm is not signed in (npm login); the release publishes the package to npm');
if (!ok('gh', ['api', `repos/${TAP}`])) fail(`the tap ${TAP} is not reachable; the release writes ${FORMULA} there`);

// ---- the build, so the commit carries the built app -----------------------------------------------------------------

say('building the app…');
run('npm', ['run', 'build:ui'], { stdio: ['ignore', 'ignore', 'inherit'] });

// ---- the version, in every file that carries one --------------------------------------------------------------------

const stamp = (file, edit) => {
  const text = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(text);
  edit(json);
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
};
stamp(pkgPath, (j) => (j.version = next));
stamp(path.join(root, 'package-lock.json'), (j) => {
  j.version = next;
  if (j.packages?.['']) j.packages[''].version = next;
});
stamp(path.join(root, 'adapters', 'claude-code', '.claude-plugin', 'plugin.json'), (j) => (j.version = next));

// ---- the changelog --------------------------------------------------------------------------------------------------

const changelogPath = path.join(root, 'CHANGELOG.md');
const head = '# Changelog\n\nEvery release, derived from the record: one line per change shipped, in the words the change was written in.\n\n';
const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
const body = existing.startsWith(head) ? existing.slice(head.length) : existing.replace(/^# Changelog\s*\n/, '').replace(/^\s+/, '');
fs.writeFileSync(changelogPath, head + entry + (body ? '\n' + body : ''));

// ---- the commit and the tag -----------------------------------------------------------------------------------------

git('add', '-A');
git('commit', '-q', '-m', `release ${next}: ${entries.length} change${entries.length === 1 ? '' : 's'}${also.length ? ` and ${also.length} other commit${also.length === 1 ? '' : 's'}` : ''} since ${lastTag ?? 'the first commit'}`);
git('tag', '-a', tag, '-m', entry);
say(`committed and tagged ${tag}`);

// ---- the package, attached to a GitHub release on the tag -----------------------------------------------------------

const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-release-'));
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dest]));
const tarball = path.join(dest, packed[0].filename);
say(`packed ${packed[0].filename} (${packed[0].entryCount} files)`);

// the product the release is of: the one the shipped changes are keyed under, else the project's
const sha = git('rev-parse', 'HEAD');
const ships = entries.map((e) => e.change.key);
const product = ships[0]?.replace(/^change:([^/]+)\/.*$/, '$1') ?? JSON.parse(pjman(['where', '--json'])).product?.replace(/^product:/, '');
if (!product) fail(`the release is of no product: nothing shipped names one and this directory maps to no project with a product`);

// from the push on, every step is outward or irreversible: a failure says exactly what is left to do by hand
const notes = path.join(dest, 'notes.md');
fs.writeFileSync(notes, entry);
const recordArgs = ['new', 'release', `${product}/${next}`, '--at', new Date().toISOString(), '--level', level, '--commit', sha, ...ships.flatMap((k) => ['--ships', k]), '--body', '-'];
const remaining = [
  `gh release create ${tag} ${tarball} --title ${tag} --notes-file ${notes} --verify-tag`,
  `npm publish ${tarball} --access public`,
  `write ${FORMULA} in ${TAP} from scripts/pjman.rb with __VERSION__ ${next} and __SHA256__ ${sha256Of(tarball)}`,
  `node bin/pjman.js ${recordArgs.join(' ')} --url <the release URL> < ${notes}`,
];
const step = (what, fn) => {
  try {
    return fn();
  } catch (e) {
    const lines = String(e.stderr || e.message).trim().split('\n').filter((l) => !/^npm notice/.test(l));
    process.stderr.write(`release: ${what} failed: ${lines.find((l) => /err|fail|refus|denied|forbidden/i.test(l)) ?? lines[0] ?? 'no output'}\n`);
    process.stderr.write(`the commit and the tag ${tag} are pushed; what is left, in order:\n${remaining.map((r) => `  ${r}`).join('\n')}\n`);
    process.exit(1);
  }
};
step('the push', () => git('push', '-q', 'origin', 'main', tag));
const url = step('the GitHub release', () => run('gh', ['release', 'create', tag, tarball, '--title', tag, '--notes-file', notes, '--verify-tag', '--latest']));
say(`released ${tag}: ${url}`);
remaining.shift();
remaining[2] = remaining[2].replace('<the release URL>', url);

// the same bits on npm: npm install -g @vinhvanvu/pjman is the install (npm refused the bare name as too close to p-map,
// decision public/npm-name), and the Homebrew formula reads the registry's tarball
// npm's two-factor step (a one-time code, or its browser flow) talks to the terminal, so this one runs in the open
step('the npm publish', () => run('npm', ['publish', tarball, '--access', 'public'], { stdio: 'inherit' }));
say(`published ${pkg.name}@${next} to npm`);
remaining.shift();

// the formula: the same package by its registry URL and checksum, so brew install and brew upgrade follow the release
const commit = step('the formula', () => writeFormula(next, sha256Of(tarball)));
say(`wrote ${FORMULA} in ${TAP} for ${next}: ${commit}`);
remaining.shift();

// the release as a record: its creation is the event (decision releases-homebrew/release-is-a-record)
const record = step('the release record', () => pjman([...recordArgs, '--url', url], { input: entry, stdio: ['pipe', 'pipe', 'pipe'] }));
fs.rmSync(dest, { recursive: true, force: true });
say(record.split('\n')[0]);
