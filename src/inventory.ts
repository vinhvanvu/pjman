// What a repository holds, read for the map: documentation (the product described in a person's sentences), code (how
// the product is cut), both, or neither. `pjman init` records the state on the project; the brief's no-product-map
// line and `pjman intake` read it live when the repository is at hand, so a bare repository that grew code is read as
// code. Nothing here opens a file beyond its name and size.
import fs from 'node:fs';
import path from 'node:path';
import { HOLDS, type Holds } from './config.js';

export interface Inventory {
  holds: Holds;
  /** The documentation found, the README first: README.md, SPEC.md, docs/ (12 files) … */
  docs: string[];
  /** The code found, a manifest (package.json, go.mod …) first, then the top-level directories that hold source. */
  code: string[];
}

const SKIP = new Set(['.git', '.github', '.gitlab', '.circleci', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.venv', 'venv', '__pycache__', 'coverage', '.pjman', '.claude', '.idea', '.vscode']);
const DOC_DIRS = new Set(['docs', 'doc', 'documentation', 'adr', 'adrs', 'rfcs', 'specs', 'design']);
const NOT_DOCS = /^(license|licence|notice|changelog|contributing|code_of_conduct|security|authors|patents)(\.|$)/i;
const DOC_EXT = new Set(['.md', '.mdx', '.rst', '.adoc', '.txt']);
const MANIFESTS = ['package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'Cargo.toml', 'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'mix.exs', 'composer.json', 'Package.swift', 'pubspec.yaml', 'CMakeLists.txt', 'Makefile', 'deno.json', 'bun.lockb'];
/** Source in a language: one file is code. */
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.ex', '.exs', '.scala', '.clj', '.hs', '.ml', '.dart', '.lua', '.zig', '.vue', '.svelte']);
/** Scripts and schemas: a tooling folder has a few, a product of them has many. Three make a directory code. */
const AUX_EXT = new Set(['.sh', '.bash', '.zsh', '.sql', '.proto', '.ps1']);
const AUX_MIN = 3;
/** A README is documentation once it says more than a title and an install line. */
const README_MIN = 300;

function entries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !SKIP.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Files beneath a directory, to a depth, by extension; stops counting at `cap`. */
function count(dir: string, ext: Set<string>, depth: number, cap = 50): number {
  let n = 0;
  const walk = (d: string, left: number) => {
    for (const e of entries(d)) {
      if (n >= cap) return;
      if (e.isDirectory()) {
        if (left > 0) walk(path.join(d, e.name), left - 1);
      } else if (ext.has(path.extname(e.name).toLowerCase())) n += 1;
    }
  };
  walk(dir, depth);
  return n;
}

const size = (file: string): number => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

/** Survey a repository's top level and one or two levels beneath it. */
export function inventory(dir: string): Inventory {
  const docs: string[] = [];
  const code: string[] = [];
  const top = entries(dir);
  for (const e of top) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (DOC_DIRS.has(e.name.toLowerCase())) {
        const n = count(full, DOC_EXT, 3);
        if (n) docs.push(`${e.name}/ (${n} file${n === 1 ? '' : 's'})`);
      } else if (count(full, CODE_EXT, 2, 1) || count(full, AUX_EXT, 2, AUX_MIN) >= AUX_MIN) code.push(`${e.name}/`);
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (MANIFESTS.includes(e.name)) code.unshift(e.name);
    else if (/^readme(\.|$)/i.test(e.name)) {
      if (size(full) >= README_MIN) docs.unshift(e.name);
    } else if (DOC_EXT.has(ext) && !NOT_DOCS.test(e.name)) docs.push(e.name);
    else if (CODE_EXT.has(ext)) code.push(e.name);
  }
  const holds: Holds = docs.length && code.length ? 'docs+code' : docs.length ? 'docs' : code.length ? 'code' : 'bare';
  return { holds, docs, code };
}

export const isHolds = (v: unknown): v is Holds => typeof v === 'string' && (HOLDS as readonly string[]).includes(v);

/** The inventory as one phrase: `docs and code (README.md, docs/ (8 files); package.json, src/, ui/)`. */
export function describeInventory(inv: Inventory): string {
  const word = { bare: 'nothing yet', docs: 'docs', code: 'code', 'docs+code': 'docs and code' }[inv.holds];
  const detail = [inv.docs.slice(0, 4).join(', '), inv.code.slice(0, 5).join(', ')].filter(Boolean).join('; ');
  return detail ? `${word} (${detail})` : word;
}

/** How the map comes to a product whose repository holds this: the sentence init prints, the brief's line carries and
 *  intake repeats. Docs give the sentences, code the split, both the better proposal; bare grows from the work. */
export function mapGuidance(holds: Holds): string {
  switch (holds) {
    case 'bare':
      return 'there is nothing to survey, so the map grows from the work: each change through intake names the capability it needs under the feature it best correlates to, created when none exists (the map skill regroups once the shape has outgrown its first guesses)';
    case 'docs':
      return 'the map is proposed from the documentation, which names the product in sentences a person would recognise, with the status each page says (the map skill)';
    case 'code':
      return "the map is proposed from the code's split, titled as the sentences a person would recognise behind it, live by default since the code exists (the map skill)";
    case 'docs+code':
      return "the map is proposed from both: the documentation names the sentences and their status, the code names the split, which is the better proposal (the map skill)";
  }
}
