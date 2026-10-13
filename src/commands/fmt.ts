import fs from 'node:fs';
import type { Store } from '../config.js';
import { FIELD_ORDER, loadStore } from '../records.js';
import { parseRecord, stringifyRecord } from '../frontmatter.js';
import { commitIfStandalone } from '../write.js';

export interface FmtResult {
  changed: string[];
  skipped: { path: string; reason: string }[];
  commit: string | null;
}

/** Rewrite every record in canonical form: field order, the YAML rule, trimmed body. */
export function fmt(store: Store, opts: { check?: boolean; session?: string }): FmtResult {
  const loaded = loadStore(store);
  const changed: string[] = [];
  const skipped: FmtResult['skipped'] = [];
  for (const r of loaded.records) {
    const current = fs.readFileSync(r.abs, 'utf8');
    let data = r.data;
    if (!r.valid) {
      const repaired = r.parsed.repaired ? parseRecord(`---\n${r.parsed.repaired}\n---\n${r.body}`) : null;
      if (!repaired || repaired.errors.length) {
        skipped.push({ path: r.path, reason: r.parsed.errors[0] ?? 'invalid' });
        continue;
      }
      data = repaired.data;
    }
    const next = stringifyRecord(data, r.body, FIELD_ORDER[r.type]);
    if (next === current) continue;
    changed.push(r.path);
    if (!opts.check) fs.writeFileSync(r.abs, next);
  }
  const commit = !opts.check && changed.length ? commitIfStandalone(store, 'pjman: fmt', opts.session) : null;
  return { changed, skipped, commit };
}
