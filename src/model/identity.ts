// Who the person is, read from the store, and what the apps say about their accounts.
//
// A person's key is a handle of their own (decision keys-under-the-product/person-key-is-the-handle); the accounts they
// hold are links on the record, keyed as each app keys them (github-user:<login>, email:<address>, …). The plain read
// here asks no app: the handle, the name, the accounts in order, the first of a handle kind as the primary one. A handle
// whose record claims no account of a handle kind is provisional: it came from the committer name or the machine, or a
// hand edit, and the person has not yet said it is theirs. Verification asks one checker per account kind (GitHub today;
// a kind with no checker reports unchecked) and gives each account a verdict; the checkers' answers are cached for a day
// so a session start never waits on the network twice in one day (decision handle-from-the-forge/one-read-command).
// Nothing here writes the store or the config: what is off is said, with the command that resolves it, and the person
// runs it (decision handle-from-the-forge/say-it-while-unclaimed).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IDENTITY_KINDS, readUserConfig, userDir, type Store } from '../store/config.js';
import { gitUserName } from '../store/git.js';
import { slugify } from '../store/keys.js';
import { loadStore, type Loaded } from '../store/records.js';
import { personOf } from './refs.js';

/** The account kinds whose id is a login a handle can be read against; the first such link on a person is their primary
 *  account. An email or a tracker's opaque id is an account too, but never what a handle is compared with. */
export const HANDLE_KINDS = ['github-user'];

/** One app's answers about the accounts of one kind. Every answer may be "cannot ask": not signed in, a scope missing,
 *  no network. A checker never throws. */
export interface Checker {
  kind: string;
  /** The app's name in a sentence. */
  app: string;
  /** The signed-in account's id; null when not signed in. */
  self(): string | null;
  /** Whether an account exists at the app; null when it cannot be asked. */
  exists(id: string): boolean | null;
  /** The emails the app vouches for on the signed-in account, or why it cannot say. */
  emails(): { list: string[] } | { reason: string };
}

export type Verdict = 'verified' | 'unknown' | 'unchecked';

export interface Account {
  key: string;
  kind: string;
  id: string;
  primary: boolean;
  verdict?: Verdict;
  note?: string;
}

export type HandleOrigin = 'forge' | 'committer' | 'machine' | 'hand';

export interface Identity {
  /** The configured actor key, or null. */
  actor: string | null;
  handle: string | null;
  name: string | null;
  /** The person record exists. */
  record: boolean;
  accounts: Account[];
  /** The first account of a handle kind, or null: then the handle is provisional. */
  primary: string | null;
  provisional: boolean;
  /** Where a provisional handle came from, read back from what the machine knows now. */
  origin: HandleOrigin | null;
  /** Each checker's signed-in account, when verified, and who claims it in the store. */
  signed_in: { kind: string; id: string; key: string; claimed_by: string | null }[];
  verified: boolean;
  /** What is off, one sentence each, with the command that resolves it. */
  notices: string[];
}

export interface IdentityOpts {
  /** Ask the checkers; else the read is the store alone. */
  verify?: boolean;
  /** The checkers to ask (tests pass fakes); the default is GitHub through gh. */
  checkers?: Checker[];
  /** Ask the apps again even when the day's cache holds an answer. */
  fresh?: boolean;
}

// --- the cache: one file under the user directory, one entry per checker, a day old at most ------------------------

interface CacheEntry {
  at: number;
  self?: string | null;
  exists?: Record<string, boolean | null>;
  emails?: { list: string[] } | { reason: string };
}

const DAY = 24 * 60 * 60 * 1000;

function cacheFile(): string {
  return path.join(userDir(), 'identity-cache.json');
}

function readCache(): Record<string, CacheEntry> {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, CacheEntry>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeCache(all: Record<string, CacheEntry>): void {
  try {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(all, null, 2) + '\n');
  } catch {
    // the cache is a convenience; a read-only home loses nothing but time
  }
}

/** A checker whose answers are remembered for a day. `fresh` asks again and overwrites. */
export function cached(inner: Checker, fresh = false): Checker {
  const all = readCache();
  const live =
    all[inner.kind] && Date.now() - all[inner.kind].at < DAY && !fresh ? all[inner.kind] : { at: Date.now() };
  const entry: CacheEntry = { ...live, exists: { ...live.exists } };
  all[inner.kind] = entry;
  return {
    kind: inner.kind,
    app: inner.app,
    self() {
      if (entry.self === undefined) {
        entry.self = inner.self();
        writeCache(all);
      }
      return entry.self;
    },
    exists(id) {
      if (!(id in entry.exists!)) {
        entry.exists![id] = inner.exists(id);
        writeCache(all);
      }
      return entry.exists![id];
    },
    emails() {
      if (entry.emails === undefined) {
        entry.emails = inner.emails();
        writeCache(all);
      }
      return entry.emails;
    },
  };
}

// --- GitHub through gh ----------------------------------------------------------------------------------------------

function gh(args: string[]): { out: string } | { err: string } {
  try {
    const out = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
    }).trim();
    return { out };
  } catch (e) {
    return { err: String((e as { stderr?: unknown }).stderr || (e as Error).message) };
  }
}

/** The forge: GitHub, asked through gh with the person's own sign-in. */
export const githubChecker: Checker = {
  kind: 'github-user',
  app: 'GitHub',
  self() {
    const r = gh(['api', 'user', '--jq', '.login']);
    return 'out' in r && /^[A-Za-z0-9-]+$/.test(r.out) ? r.out : null;
  },
  exists(id) {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return false;
    const r = gh(['api', `users/${id}`, '--jq', '.login']);
    if ('out' in r) return r.out.length > 0;
    return /HTTP 404|Not Found/.test(r.err) ? false : null;
  },
  emails() {
    const r = gh(['api', 'user/emails', '--jq', '.[].email']);
    if ('out' in r)
      return {
        list: r.out
          .split('\n')
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean),
      };
    if (/scope/i.test(r.err))
      return { reason: "GitHub's emails need the user scope (gh auth refresh -h github.com -s user)" };
    return {
      reason: /not logged in|auth login/i.test(r.err)
        ? 'gh is not signed in (gh auth login)'
        : 'GitHub could not be asked',
    };
  },
};

export const DEFAULT_CHECKERS: Checker[] = [githubChecker];

/** The checkers to ask, each behind the day's cache. */
export function checkersFor(opts: IdentityOpts): Checker[] {
  return (opts.checkers ?? DEFAULT_CHECKERS).map((c) => cached(c, opts.fresh));
}

// --- the read ----------------------------------------------------------------------------------------------------

const kindOf = (key: string): string => key.slice(0, key.indexOf(':'));
const idOf = (key: string): string => key.slice(key.indexOf(':') + 1);

/** The machine's account name, the last fallback for a handle. */
export function machineName(): string | null {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
}

function originOf(handle: string, login: string | null): HandleOrigin {
  const same = (s: string | null) => !!s && slugify(s) === handle;
  if (same(login)) return 'forge';
  if (same(gitUserName())) return 'committer';
  if (same(machineName())) return 'machine';
  return 'hand';
}

const ORIGIN_WORDS: Record<HandleOrigin, string> = {
  forge: 'your forge login',
  committer: 'your committer name',
  machine: "this machine's account name",
  hand: 'a hand edit',
};

function personRecord(loaded: Loaded, actor: string) {
  return loaded.byKey.get(actor)?.[0] ?? loaded.byKey.get(loaded.aliases.get(actor)?.[0] ?? '')?.[0];
}

/** Who the person is: the store's answer, and the apps' when `verify`. Writes nothing. */
export function identity(store: Store, opts: IdentityOpts = {}): Identity {
  const actor = readUserConfig().actor ?? null;
  const handle = actor?.startsWith('person:') ? actor.slice('person:'.length) : null;
  const loaded = loadStore(store);
  const rec = actor ? personRecord(loaded, actor) : undefined;
  const links =
    rec && Array.isArray(rec.data.links)
      ? (rec.data.links as unknown[]).filter((l): l is string => typeof l === 'string')
      : [];
  const kinds = new Set(IDENTITY_KINDS.filter((k) => store.config.source_kinds.includes(k)));
  const accounts: Account[] = links
    .filter((l) => kinds.has(kindOf(l)))
    .map((key) => ({ key, kind: kindOf(key), id: idOf(key), primary: false }));
  const primary = accounts.find((a) => HANDLE_KINDS.includes(a.kind)) ?? null;
  if (primary) primary.primary = true;
  const id: Identity = {
    actor,
    handle,
    name: typeof rec?.data.name === 'string' ? rec.data.name : null,
    record: !!rec,
    accounts,
    primary: primary?.key ?? null,
    provisional: !!rec && !primary,
    origin: null,
    signed_in: [],
    verified: !!opts.verify,
    notices: [],
  };

  const checkers = opts.verify ? checkersFor(opts) : [];
  const selfOf = new Map<string, string | null>();
  for (const c of checkers) {
    const self = c.self();
    selfOf.set(c.kind, self);
    if (self) {
      const key = `${c.kind}:${self}`;
      id.signed_in.push({ kind: c.kind, id: self, key, claimed_by: personOf(loaded, key) ?? null });
    }
  }
  // each account's verdict: the signed-in account is the person's; another login is asked about; an email is read
  // against the signed-in account's list; a kind with no checker cannot be asked
  for (const a of accounts) {
    if (!opts.verify) continue;
    const c = checkers.find((x) => x.kind === a.kind);
    if (c) {
      const self = selfOf.get(c.kind);
      if (self && self.toLowerCase() === a.id.toLowerCase()) {
        a.verdict = 'verified';
        a.note = `signed in as ${self}`;
      } else {
        const ex = c.exists(a.id);
        if (ex === false) {
          a.verdict = 'unknown';
          a.note = `${c.app} knows no such account`;
        } else if (ex === true) {
          a.verdict = 'unchecked';
          a.note = self ? `exists at ${c.app}, but the sign-in is ${self}` : `exists at ${c.app}; not signed in there`;
        } else {
          a.verdict = 'unchecked';
          a.note = `${c.app} could not be asked`;
        }
      }
    } else if (a.kind === 'email') {
      const vouching = checkers.filter((x) => selfOf.get(x.kind));
      const answers = vouching.map((x) => ({ c: x, e: x.emails() }));
      const listed = answers.find((x) => 'list' in x.e && x.e.list.includes(a.id.toLowerCase()));
      const reason = answers.find((x) => 'reason' in x.e);
      if (listed) {
        a.verdict = 'verified';
        a.note = `on your ${listed.c.app} account`;
      } else if (reason) {
        a.verdict = 'unchecked';
        a.note = (reason.e as { reason: string }).reason;
      } else if (answers.length) {
        a.verdict = 'unknown';
        a.note = `not among the emails of your ${answers.map((x) => x.c.app).join(' or ')} account`;
      } else {
        a.verdict = 'unchecked';
        a.note = 'no app signed in to ask';
      }
    } else {
      a.verdict = 'unchecked';
      a.note = `no checker for ${a.kind}`;
    }
  }

  // what is off
  if (!actor)
    id.notices.push(
      "no actor is configured: run pjman init (it names you from your forge login, your committer name or this machine's account name)",
    );
  else if (!rec) id.notices.push(`${actor} has no record: run pjman init, which makes it with the accounts it knows`);
  if (rec && handle && id.provisional) {
    const forge = checkers.find((c) => HANDLE_KINDS.includes(c.kind));
    const login = forge ? (selfOf.get(forge.kind) ?? null) : null;
    id.origin = originOf(handle, login);
    const from = `your handle ${handle} came from ${ORIGIN_WORDS[id.origin]} and claims no account of a handle kind, so it is provisional`;
    if (login) {
      const claimed = personOf(loaded, `${forge!.kind}:${login}`);
      const loginSlug = slugify(login);
      const claim = `pjman set ${actor} links=${[...links, `${forge!.kind}:${login}`].join(',')}`;
      if (claimed && claimed !== rec.key)
        id.notices.push(`${from}; the ${forge!.app} login ${login} is claimed by ${claimed}`);
      else if (loginSlug === handle) id.notices.push(`${from}; it is your ${forge!.app} login, claim it: ${claim}`);
      else
        id.notices.push(
          `${from}; rename it to your ${forge!.app} login: pjman mv ${actor} person:${loginSlug} (the old handle stays an alias; the config and every reference follow), or keep it and claim the login: ${claim}`,
        );
    } else if (opts.verify)
      id.notices.push(
        `${from}; sign in to the forge (gh auth login) and run pjman init, or claim an account: pjman set ${actor} links=${[...links, 'github-user:<login>'].join(',')}`,
      );
    else id.notices.push(`${from}; pjman whoami --verify says what the forge knows`);
  }
  for (const s of id.signed_in) {
    if (s.claimed_by && rec && s.claimed_by !== rec.key)
      id.notices.push(
        `the ${s.kind} account ${s.id} you are signed in as is claimed by ${s.claimed_by}; one account is one person's`,
      );
  }
  for (const a of accounts)
    if (a.verdict === 'unknown')
      id.notices.push(`${a.key} is not known: ${a.note} (it stays until you drop it: pjman set ${actor} links=…)`);
  return id;
}

/** The read as lines: who, each account with its verdict, then what is off. */
export function formatIdentity(id: Identity): string[] {
  const out: string[] = [];
  if (!id.actor) out.push('no actor configured');
  else
    out.push(
      `you are ${id.actor}${id.name ? ` (${id.name})` : ''}${id.record ? '' : ' (no record)'}${id.provisional ? ' (provisional)' : ''}`,
    );
  for (const a of id.accounts) {
    const tags = [
      a.primary ? 'primary' : null,
      a.verdict ? (a.note ? `${a.verdict}: ${a.note}` : a.verdict) : null,
    ].filter(Boolean);
    out.push(`  ${a.key}${tags.length ? `  ${tags.join(' · ')}` : ''}`);
  }
  for (const n of id.notices) out.push(`note: ${n}`);
  return out;
}
