import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../config.js';
import { gitMv, isTracked, toplevel } from '../git.js';
import { parseKey, SLUG_RE } from '../keys.js';
import { loadStore, type Rec } from '../records.js';
import { CliError } from '../util.js';
import { commitIfStandalone, render, validateOrUndo } from '../write.js';

export interface MvResult {
  from: string;
  to: string;
  rewritten: string[];
  commit: string | null;
}

/** Rewrite `change:old` → `change:new` and `decision:old/` → `decision:new/` wherever they appear as whole keys. */
function rewriteKeys(text: string, oldSlug: string, newSlug: string): string {
  const esc = oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`(^|[^A-Za-z0-9_/-])change:${esc}(?![A-Za-z0-9_-])`, 'g'), `$1change:${newSlug}`)
    .replace(new RegExp(`(^|[^A-Za-z0-9_/-])decision:${esc}/`, 'g'), `$1decision:${newSlug}/`);
}

export function mv(store: Store, fromRaw: string, toRaw: string, opts: { session?: string }): MvResult {
  const from = parseKey(fromRaw);
  const to = parseKey(toRaw);
  if (!from || !to) throw new CliError('usage: pjman mv change:<old> change:<new>');
  if (from.kind !== 'change' || to.kind !== 'change') throw new CliError('mv renames changes; sources, actors and sessions are not renamed (their keys are external)');
  if (!SLUG_RE.test(to.rest)) throw new CliError(`'${to.rest}' is not a slug`);
  const loaded = loadStore(store);
  const rec = loaded.byKey.get(from.raw)?.[0];
  if (!rec || rec.type !== 'change') throw new CliError(`${from.raw} does not exist`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before renaming`);
  if (loaded.byKey.has(to.raw)) throw new CliError(`${to.raw} already exists`);
  if (loaded.aliasOf.has(to.rest)) throw new CliError(`'${to.rest}' is an alias of ${loaded.aliasOf.get(to.rest)}`);

  const oldDir = path.join('changes', from.rest);
  const newDir = path.join('changes', to.rest);
  const inGit = toplevel(store.root) !== null && isTracked(store.root, oldDir);
  if (inGit) gitMv(store.root, oldDir, newDir);
  else fs.renameSync(path.join(store.root, oldDir), path.join(store.root, newDir));

  const rewritten: string[] = [];
  for (const r of loaded.records) {
    const rel = r.path.startsWith(oldDir + '/') ? newDir + r.path.slice(oldDir.length) : r.path;
    const abs = path.join(store.root, rel);
    const text = fs.readFileSync(abs, 'utf8');
    let next = rewriteKeys(text, from.rest, to.rest);
    if (r === rec) {
      const aliases = Array.isArray(r.data.aliases) ? [...(r.data.aliases as string[])] : [];
      if (!aliases.includes(from.rest)) aliases.push(from.rest);
      const data = JSON.parse(rewriteKeys(JSON.stringify({ ...r.data, aliases }), from.rest, to.rest)) as Record<string, unknown>;
      next = render('change', data, rewriteKeys(r.body, from.rest, to.rest));
    }
    if (next !== text) {
      fs.writeFileSync(abs, next);
      rewritten.push(rel);
    }
  }
  const touched = [path.join(newDir, 'change.md'), ...rewritten];
  validateOrUndo(store, touched, []);
  const commit = commitIfStandalone(store, `pjman: mv ${from.raw} ${to.raw}`, opts.session);
  return { from: from.raw, to: to.raw, rewritten, commit };
}

export type { Rec };
