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

/** True when `root` is itself the top of a git repository (a standalone store). */
export function isOwnRepo(root: string): boolean {
  if (!fs.existsSync(root)) return false;
  const top = toplevel(root);
  if (!top) return false;
  try {
    return fs.realpathSync(root) === top;
  } catch {
    return false;
  }
}

export function gitUserName(): string | null {
  try {
    return git(process.cwd(), ['config', 'user.name']) || null;
  } catch {
    return null;
  }
}

/** Stage everything under `root` and commit. Returns the short sha, or null when there was nothing to commit. */
export function commitAll(root: string, message: string, session?: string): string | null {
  git(root, ['add', '-A', '--', '.']);
  const staged = git(root, ['diff', '--cached', '--name-only']);
  if (!staged) return null;
  const body = session ? `${message}\n\nPjman-Session: ${session}` : message;
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
