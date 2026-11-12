// Versions: the tool's own, from its package, and the order of plain semver strings. The store's format version and
// the migrations that move it live in commands/migrate.ts (decision releases-homebrew/store-names-its-version).
import { createRequire } from 'node:module';

/** The version of this pjman, as the package declares it. */
export const TOOL_VERSION: string = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;

/** The format a store with no `version` in pjman.yaml is in: the one before the field existed. */
export const UNSTAMPED_VERSION = '0.1.0';

/** -1, 0 or 1 for plain semver strings (`0.2.0`); anything unparsable sorts first. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : [-1, -1, -1]);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
