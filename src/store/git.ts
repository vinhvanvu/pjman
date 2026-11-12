import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function toplevel(cwd: string): string | null {
  try {
    return fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']));
  } catch {
    return null;
  }
}

export function gitUserName(): string | null {
  try {
    return git(process.cwd(), ['config', 'user.name']) || null;
  } catch {
    return null;
  }
}

export function gitUserEmail(): string | null {
  try {
    return git(process.cwd(), ['config', 'user.email']) || null;
  } catch {
    return null;
  }
}

/** Stage everything under `root` and commit. Returns the short sha, or null when there was nothing to commit. */
export function commitAll(
  root: string,
  message: string,
  session?: string,
  trailers: Record<string, string> = {},
): string | null {
  git(root, ['add', '-A', '--', '.']);
  const staged = git(root, ['diff', '--cached', '--name-only']);
  if (!staged) return null;
  const lines = [
    ...(session ? [`Pjman-Session: ${session}`] : []),
    ...Object.entries(trailers).map(([k, v]) => `${k}: ${v}`),
  ];
  const body = lines.length ? `${message}\n\n${lines.join('\n')}` : message;
  git(root, ['commit', '-q', '-m', body]);
  return git(root, ['rev-parse', '--short', 'HEAD']);
}

export function gitMv(root: string, from: string, to: string): void {
  git(root, ['mv', '--', from, to]);
}

export function isTracked(root: string, rel: string): boolean {
  try {
    return git(root, ['ls-files', '--error-unmatch', '--', rel]) !== '';
  } catch {
    return false;
  }
}
