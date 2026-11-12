import fs from 'node:fs';
import type { Store } from '../store/config.js';
import { FIELD_ORDER, loadStore } from '../store/records.js';
import { parseRecord, stringifyRecord } from '../store/frontmatter.js';
import { envelope, finishWrite } from './write.js';

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
  const env = envelope(opts);
  const commit = !opts.check && changed.length
    ? finishWrite(store, 'pjman: fmt', env.session, changed.map((p) => { const r = loaded.records.find((x) => x.path === p)!; return { op: 'formatted' as const, key: r.key, type: r.type, path: p, writer: env.writer }; }))
    : null;
  return { changed, skipped, commit };
}
