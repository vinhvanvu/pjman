// The layout before keys were paths under the product: changes/, features/ and products/<slug>.md at the root, keys
// store-wide. Read only by `pjman migrate`, which moves every record under its product; nothing else opens a store
// laid out this way.
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { parseRecord, sections } from './frontmatter.js';
import { canonicalSourceKey } from './keys.js';
import type { Rec, RecordType } from './records.js';

function listDir(abs: string): string[] {
  try {
    return fs.readdirSync(abs).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
}

const isDir = (abs: string): boolean => {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
};

const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

function readRec(store: Store, rel: string, type: RecordType, key: string): Rec {
  const abs = path.join(store.root, rel);
  const parsed = parseRecord(fs.readFileSync(abs, 'utf8'));
  const valid = parsed.hasFrontmatter && parsed.isMapping && parsed.errors.length === 0;
  return { type, key, path: rel, abs, data: parsed.data, body: parsed.body, sections: sections(parsed.body), parsed, valid };
}

/** Every record of a store in the old layout, keyed the old way (`change:<slug>`, `feature:<slug>`, `decision:<change>/<slug>`). */
export function loadLegacy(store: Store): Rec[] {
  const root = store.root;
  const records: Rec[] = [];
  for (const f of listDir(path.join(root, 'products'))) {
    if (!f.endsWith('.md')) {
      // already a product folder of the new layout (a half-migrated store is refused by the migration itself)
      const file = path.join('products', f, 'product.md');
      if (fs.existsSync(path.join(root, file))) {
        const r = readRec(store, file, 'product', `product:${f}`);
        r.productSlug = f;
        records.push(r);
      }
      continue;
    }
    const slug = f.slice(0, -3);
    const r = readRec(store, path.join('products', f), 'product', `product:${slug}`);
    r.productSlug = slug;
    records.push(r);
  }
  for (const slug of listDir(path.join(root, 'features'))) {
    const file = path.join('features', slug, 'feature.md');
    if (!isDir(path.join(root, 'features', slug)) || !fs.existsSync(path.join(root, file))) continue;
    const r = readRec(store, file, 'feature', `feature:${slug}`);
    r.featureSlug = slug;
    records.push(r);
  }
  for (const f of listDir(path.join(root, 'projects'))) {
    if (!f.endsWith('.md')) continue;
    const r = readRec(store, path.join('projects', f), 'project', `project:${f.slice(0, -3)}`);
    r.projectSlug = f.slice(0, -3);
    records.push(r);
  }
  for (const slug of listDir(path.join(root, 'changes'))) {
    const dir = path.join('changes', slug);
    if (!isDir(path.join(root, dir))) continue;
    const file = path.join(dir, 'change.md');
    if (fs.existsSync(path.join(root, file))) {
      const r = readRec(store, file, 'change', `change:${slug}`);
      r.changeSlug = slug;
      records.push(r);
    }
    for (const f of listDir(path.join(root, dir, 'decisions'))) {
      const m = DATED.exec(f);
      if (!m) continue;
      const r = readRec(store, path.join(dir, 'decisions', f), 'decision', `decision:${slug}/${m[2]}`);
      r.changeSlug = slug;
      r.decisionSlug = m[2];
      r.fileDate = m[1];
      records.push(r);
    }
  }
  for (const f of listDir(path.join(root, 'decisions'))) {
    const m = DATED.exec(f);
    if (!m) continue;
    const r = readRec(store, path.join('decisions', f), 'decision', `decision:/${m[2]}`);
    r.decisionSlug = m[2];
    r.fileDate = m[1];
    records.push(r);
  }
  for (const kind of listDir(path.join(root, 'sources'))) {
    for (const f of listDir(path.join(root, 'sources', kind))) {
      if (!f.endsWith('.md')) continue;
      const r = readRec(store, path.join('sources', kind, f), 'source', `${kind}:?${f.slice(0, -3)}`);
      r.fileSlug = f.slice(0, -3);
      if (typeof r.data.kind === 'string' && typeof r.data.key === 'string') r.key = canonicalSourceKey(r.data.kind, r.data.key);
      records.push(r);
    }
  }
  for (const f of listDir(path.join(root, 'sessions'))) {
    const m = DATED.exec(f);
    if (!m) continue;
    const r = readRec(store, path.join('sessions', f), 'session', `session:${m[2]}`);
    r.sessionId = m[2];
    r.fileDate = m[1];
    records.push(r);
  }
  for (const f of listDir(path.join(root, 'actors'))) {
    if (!f.endsWith('.md')) continue;
    const handle = f.slice(0, -3);
    const r = readRec(store, path.join('actors', f), 'actor', `?:${handle}`);
    r.handle = handle;
    if (r.data.kind === 'person' || r.data.kind === 'agent') r.key = `${String(r.data.kind)}:${handle}`;
    records.push(r);
  }
  return records;
}
