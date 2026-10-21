import { Document, Scalar, isMap, isPair, isScalar, parseDocument, visit } from 'yaml';

export interface Parsed {
  hasFrontmatter: boolean;
  isMapping: boolean;
  data: Record<string, unknown>;
  body: string;
  errors: string[];
  /** Plain scalars that the YAML rule says must be quoted: "<path>: <reason>". */
  unquoted: string[];
  /** When the frontmatter fails to parse but quoting offending scalars makes it parse: the repaired text. */
  repaired?: string;
}

const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;

export function splitFrontmatter(text: string): { fm: string; body: string } | null {
  const m = FM_RE.exec(text);
  if (!m) return null;
  return { fm: m[1] ?? '', body: text.slice(m[0].length) };
}

/** The YAML rule: any scalar containing `: ` or `#`, or starting with a special character, is quoted. */
export function violatesRule(s: string): string | null {
  if (s.includes(': ')) return "contains ': '";
  if (s.includes('#')) return "contains '#'";
  if (/^[-?:,[\]{}&*!|>'"%@`]/.test(s)) return `starts with '${s[0]}'`;
  return null;
}

/** Everything the rule says, plus what a round-trip would otherwise change the type of. */
export function needsQuote(s: string): boolean {
  if (s === '' || violatesRule(s)) return true;
  if (/^\s|\s$/.test(s) || s.endsWith(':')) return true;
  if (/^(true|false|null|~|yes|no|on|off|y|n)$/i.test(s)) return true;
  if (/^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return true;
  if (/^0[xob][0-9a-f_]+$/i.test(s) || /^[-+]?\.(inf|nan)$/i.test(s)) return true;
  return false;
}

function pathOf(path: readonly unknown[]): string {
  const parts: string[] = [];
  for (const p of path) {
    if (isPair(p) && isScalar(p.key)) parts.push(String(p.key.value));
  }
  return parts.join('.') || '(root)';
}

/**
 * The common fault: a plain scalar with `: ` or `#` (or a special leading character) that was not quoted.
 * Quote such values line by line; return the repaired text when it parses, else null.
 */
export function repairFrontmatter(fm: string): string | null {
  let changed = false;
  const fix = (value: string): string => {
    const v = value.trimEnd();
    if (v === '' || /^["'[{|>]/.test(v)) return value;
    if (!violatesRule(v)) return value;
    changed = true;
    return JSON.stringify(v);
  };
  const lines = fm.split('\n').map((line) => {
    let m = /^(\s*[A-Za-z_][\w-]*:\s+)(.*)$/.exec(line);
    if (m) return m[1] + fix(m[2]);
    m = /^(\s*-\s+)(.*)$/.exec(line);
    if (m && !/^[A-Za-z_][\w-]*:\s/.test(m[2])) return m[1] + fix(m[2]);
    return line;
  });
  if (!changed) return null;
  const repaired = lines.join('\n');
  const doc = parseDocument(repaired, { prettyErrors: false });
  return doc.errors.length === 0 && (doc.contents === null || isMap(doc.contents)) ? repaired : null;
}

export function parseRecord(text: string): Parsed {
  const split = splitFrontmatter(text);
  if (!split) {
    return {
      hasFrontmatter: false,
      isMapping: false,
      data: {},
      body: text,
      errors: ['frontmatter missing: the file must start with --- and close with ---'],
      unquoted: [],
    };
  }
  const doc = parseDocument(split.fm, { prettyErrors: false });
  const errors = doc.errors.map((e) => `yaml: ${e.message.split('\n')[0]}`);
  const unquoted: string[] = [];
  visit(doc, {
    Scalar(key, node, path) {
      if (key === 'key') return;
      if (node.type === Scalar.PLAIN && typeof node.value === 'string') {
        const r = violatesRule(node.value);
        if (r) unquoted.push(`${pathOf(path)}: unquoted scalar ${r}`);
      }
    },
  });
  const empty = doc.contents === null || doc.contents === undefined;
  const isMapping = empty || isMap(doc.contents);
  if (!isMapping) errors.push('frontmatter is not a mapping');
  let data: Record<string, unknown> = {};
  if (isMapping && !empty && errors.length === 0) {
    const js = doc.toJS({ mapAsMap: false });
    if (js && typeof js === 'object') data = js as Record<string, unknown>;
  }
  const out: Parsed = { hasFrontmatter: true, isMapping, data, body: split.body, errors, unquoted };
  if (errors.length > 0) {
    const repaired = repairFrontmatter(split.fm);
    if (repaired) {
      out.repaired = repaired;
      out.errors.push("a scalar containing ': ' or '#' is not quoted; `pjman fmt` quotes it");
    }
  }
  return out;
}

function orderFields(data: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) if (k !== 'ext' && data[k] !== undefined && data[k] !== null) out[k] = data[k];
  for (const k of Object.keys(data)) {
    if (k === 'ext' || k in out || data[k] === undefined || data[k] === null) continue;
    out[k] = data[k];
  }
  if (data.ext !== undefined && data.ext !== null) out.ext = data.ext;
  return out;
}

/** Serialise a record: fields in schema order, the YAML rule applied, body trimmed, one trailing newline. */
export function stringifyRecord(data: Record<string, unknown>, body: string, order: readonly string[]): string {
  const ordered = orderFields(data, order);
  let fm = '';
  if (Object.keys(ordered).length > 0) {
    const doc = new Document(ordered);
    visit(doc, {
      Scalar(key, node) {
        if (key === 'key') return;
        if (typeof node.value !== 'string') return;
        if (node.value.includes('\n')) node.type = Scalar.BLOCK_LITERAL;
        else if (needsQuote(node.value)) node.type = Scalar.QUOTE_DOUBLE;
        else node.type = Scalar.PLAIN;
      },
    });
    fm = doc.toString({ lineWidth: 0, indent: 2 }).replace(/\n+$/, '') + '\n';
  }
  const b = body.replace(/^\s*\n/, '').replace(/\s+$/, '');
  return `---\n${fm}---\n` + (b ? `\n${b}\n` : '');
}

/** Split a markdown body on `## ` headings. The text before the first heading is under "". */
/** The body with one `## <name>` section replaced (or appended; an empty text removes it). Other sections are untouched. */
export function replaceSection(body: string, name: string, text: string): string {
  const lines = body.split(/\r?\n/);
  const isHeading = (l: string) => /^## /.test(l);
  const start = lines.findIndex((l) => new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l));
  const block = text.trim() ? [`## ${name}`, '', text.trim(), ''] : [];
  if (start < 0) {
    if (!block.length) return body;
    const head = body.replace(/\s+$/, '');
    return (head ? head + '\n\n' : '') + block.join('\n');
  }
  let end = start + 1;
  while (end < lines.length && !isHeading(lines[end])) end++;
  const before = lines.slice(0, start).join('\n').replace(/\s+$/, '');
  const after = lines.slice(end).join('\n').replace(/^\s+/, '');
  const parts = [before, block.join('\n').replace(/\s+$/, ''), after].filter((s) => s.length > 0);
  return parts.join('\n\n') + '\n';
}

export function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let name = '';
  let buf: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) {
      out.set(name, buf.join('\n').trim());
      name = m[1];
      buf = [];
    } else {
      buf.push(line);
    }
  }
  out.set(name, buf.join('\n').trim());
  if (out.get('') === '') out.delete('');
  return out;
}
