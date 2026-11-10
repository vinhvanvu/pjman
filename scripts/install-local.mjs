// The install: the tool as a copy of a built package, never a link to this checkout (decision install-as-copy/
// copy-not-link). Builds the tool and the app, packs the package, installs it globally from the tarball, points the
// Claude Code marketplace at the installed copy and refreshes the plugin, then restarts the dashboard server when one
// was running, so the running server and the hook stop following whatever this checkout holds mid-edit.
//
//   npm run install:local        after a merge to main; then `pjman migrate` when the tool asks for it
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (line) => process.stdout.write(`${line}\n`);
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }) ?? '').trim();
const soft = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    return { failed: String(e.stderr || e.stdout || e.message).trim().split('\n')[0] };
  }
};

say('building the tool and the app…');
run('npm', ['run', 'build:ui'], { stdio: ['ignore', 'ignore', 'inherit'] });

const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-pack-'));
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dest]));
const tarball = path.join(dest, packed[0].filename);
say(`packed ${packed[0].filename} (${packed[0].entryCount} files)`);

const globalRoot = run('npm', ['root', '-g']);
// the package was named pjman before 0.3.1 (decision public/npm-name); an install under the old name is removed before the install, which would otherwise collide with its pjman bin
if (fs.existsSync(path.join(globalRoot, 'pjman'))) {
  run('npm', ['uninstall', '-g', '--no-audit', '--no-fund', 'pjman'], { stdio: ['ignore', 'ignore', 'inherit'] });
  say('removed the install under the old name pjman');
}
run('npm', ['install', '-g', '--no-audit', '--no-fund', tarball], { stdio: ['ignore', 'ignore', 'inherit'] });
fs.rmSync(dest, { recursive: true, force: true });
const installed = path.join(globalRoot, '@vinhvanvu', 'pjman');
const real = fs.realpathSync(installed);
if (real === fs.realpathSync(root)) throw new Error(`the global install still links to this checkout (${real}); run: npm unlink -g pjman, then again`);
say(`installed pjman ${packed[0].version} at ${installed}`);

// the plugin: the marketplace is the installed copy, so hooks and skills come from the same package as the tool
const claude = soft('claude', ['--version']);
if (claude.failed) say(`claude is not on PATH; the plugin is left as it is`);
else {
  const known = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins', 'known_marketplaces.json');
  let current;
  try {
    current = JSON.parse(fs.readFileSync(known, 'utf8')).pjman?.source?.path;
  } catch {}
  // a marketplace pointing at a path that is gone (the install under the old name) is replaced like one pointing elsewhere
  if (current && (!fs.existsSync(current) || fs.realpathSync(current) !== real)) {
    const r = soft('claude', ['plugin', 'marketplace', 'remove', 'pjman']);
    say(r.failed ? `marketplace pjman not removed: ${r.failed}` : `marketplace pjman no longer reads ${current}`);
    current = undefined;
  }
  if (!current) {
    const r = soft('claude', ['plugin', 'marketplace', 'add', installed]);
    say(r.failed ? `marketplace not added: ${r.failed}` : `marketplace pjman reads ${installed}`);
  }
  const upd = soft('claude', ['plugin', 'update', 'pjman@pjman']);
  if (upd.failed) {
    const inst = soft('claude', ['plugin', 'install', 'pjman@pjman', '--scope', 'user']);
    say(inst.failed ? `plugin not refreshed: ${inst.failed}` : 'plugin pjman installed from the copy; it loads at the next session or /reload-plugins');
  } else say('plugin pjman refreshed from the copy; it loads at the next session or /reload-plugins');
}

// the dashboard: a running server keeps the old code until restarted; it comes back on the same port
let port;
try {
  port = JSON.parse(fs.readFileSync(path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'serve.json'), 'utf8')).port;
} catch {}
const stopped = soft('pjman', ['stop']);
if (!stopped.failed && /stopped/.test(stopped)) {
  const started = soft('pjman', ['start', ...(port ? ['--port', String(port)] : [])]);
  say(started.failed ? `the dashboard did not restart: ${started.failed}` : started);
} else say('no dashboard server was running');
