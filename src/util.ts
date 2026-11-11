/** What a refusal is, the same codes the API answers with (decision interface-audit/error-contract): `usage` exits 2,
 *  the rest exit 1. */
export type ErrorCode = 'usage' | 'not-found' | 'ambiguous' | 'refused';

export class CliError extends Error {
  /** A usage error exits 2; anything else 1. */
  public exitCode: number;
  constructor(message: string, exitCode = 1, public code: ErrorCode = exitCode === 2 ? 'usage' : 'refused', public tried?: string[]) {
    super(message);
    this.exitCode = code === 'usage' ? 2 : exitCode;
  }
}

/** A command called the wrong way: exit 2. */
export function usageError(message: string): CliError {
  return new CliError(message, 2, 'usage');
}

/** One phrasing for a reference that names nothing: `<ref> resolves to nothing` (or `to no <type>`), with what was
 *  tried and the command that would make it, when known. */
export function notFound(ref: string, opts: { as?: string; tried?: string[]; hint?: string } = {}): CliError {
  const tried = opts.tried?.length ? `; tried: ${opts.tried.join('; ')}` : '';
  return new CliError(`${ref} resolves to ${opts.as ? `no ${opts.as}` : 'nothing'}${tried}${opts.hint ? `; ${opts.hint}` : ''}`, 1, 'not-found', opts.tried);
}

/** Two or more records answer to one reference: refused, naming them. */
export function ambiguous(ref: string, candidates: string[]): CliError {
  return new CliError(`${ref} is ambiguous: ${candidates.join(', ')} (name one by its key)`, 1, 'ambiguous', candidates);
}

/** The calendar date (yyyy-mm-dd) in local time: the day the person worked, not the UTC day. */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function today(): string {
  return localDate();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isDateString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v));
}

export function uuidv7(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ts = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
