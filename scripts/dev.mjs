// Development: this checkout's own server and app, each at a stable name under portless, never a port picked by hand
// (decisions worktree-urls/one-dev-script-two-names and worktree-urls/proxy-plain-http-1355). Builds the tool, then
// runs `pjman serve` from this checkout at api.pjman and the ui's vite at pjman, vite proxying /api to that server.
// In a linked worktree portless puts the branch in front: live-sessions.pjman.localhost. The proxy is plain HTTP on
// 1355, so it needs no root and no trusted certificate; it starts itself on first use. The installed tool (pjman
// start, ~/.pjman/serve.json) is untouched: a server run from a checkout claims nothing.
//
//   npm run dev        prints both URLs; ctrl-c stops both
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portless = path.join(root, 'node_modules', '.bin', 'portless');
const env = { ...process.env, PORTLESS_PORT: '1355', PORTLESS_HTTPS: '0' };
const url = (name) => execFileSync(portless, ['get', name], { cwd: root, env, encoding: 'utf8' }).trim();

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
// the proxy once, before both servers, so they do not race to start it; a running proxy is left as it is
execFileSync(portless, ['proxy', 'start'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });

const api = url('api.pjman');
const children = [
  spawn(portless, ['run', '--name', 'api.pjman', 'node', path.join(root, 'bin', 'pjman.js'), 'serve'], {
    cwd: root,
    env,
    stdio: 'inherit',
  }),
  spawn(portless, ['run', '--name', 'pjman', path.join(root, 'ui', 'node_modules', '.bin', 'vite')], {
    cwd: path.join(root, 'ui'),
    env: { ...env, PJMAN_SERVE: api },
    stdio: 'inherit',
  }),
];
process.stdout.write(`dashboard ${url('pjman')}\napi       ${api}\n`);

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGINT');
  process.exitCode = code;
};
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
