// People (change:people-in-graph): a person record heads their accounts, holds a role (their job) and typed ties, each
// an edge whose type is the relationship: a stake on a map node (owner, stakeholder…) or a part on anything else
// (author, reviewer…), written `<type> <key>` on the person (decision people-in-graph/where-ties-live, typed-ties).
// Ties come from conversation (`said`) or are set outright (`ties`); a type set outright on a target overrides what
// was said of that type there, by anyone (decision people-in-graph/ownership-from). A source that names an account (a ticket's
// assignee, an issue's author) reaches the account's person with nothing written, and an account no person claims
// still shows as itself. Map nodes inherit stakes downward, the nearest node naming a stake winning for it.
import { IDENTITY_KINDS, type Store } from '../store/config.js';
import { memo, recordOf, type Loaded, type Rec } from '../store/records.js';
import { parseKey, slugify } from '../store/keys.js';
import { personOf } from './refs.js';
import { ancestorsOf, live, rootProductOf } from './tree.js';

/** The roles pjman starts a store with: a person's job. */
export const DEFAULT_ROLES = ['engineer', 'designer', 'product', 'research', 'data', 'leadership'];
/** The stakes: how a person relates to a node of the product map. */
export const DEFAULT_STAKES = ['owner', 'contributor', 'reviewer', 'stakeholder'];
/** The parts: what a person did on a source, a change or a decision. */
export const DEFAULT_PARTS = ['author', 'assignee', 'reviewer', 'requested-by', 'mentioned'];

export type Vocab = 'roles' | 'stakes' | 'parts';

/** The words a store knows for a vocabulary: pjman's, then those the store added. */
export function wordsOf(store: Pick<Store, 'config'>, vocab: Vocab): string[] {
  const base = vocab === 'roles' ? DEFAULT_ROLES : vocab === 'stakes' ? DEFAULT_STAKES : DEFAULT_PARTS;
  const own = store.config[vocab] ?? [];
  return [...new Set([...base, ...own])];
}

/** Whether a key is a node of the product map, where a tie is a stake (else it is a part). */
export function isMapNode(key: string): boolean {
  return key.startsWith('product:') || key.startsWith('feature:');
}

export interface Tie {
  person: string;
  type: string;
  /** The key the tie reaches, as written (the graph resolves it through aliases). */
  target: string;
  /** From conversation; one set outright on the same target overrides it. */
  said: boolean;
}

/** `<type> <key>` → its parts, or null. */
export function parseTie(raw: unknown): { type: string; target: string } | null {
  if (typeof raw !== 'string') return null;
  const m = /^([a-z0-9][a-z0-9-]*)\s+(\S+)$/.exec(raw.trim());
  return m && parseKey(m[2]) ? { type: m[1], target: m[2] } : null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A person's ties as they stand: everything set outright, and what was said that nothing set outright already says. */
export function personTies(loaded: Loaded, rec: Rec): Tie[] {
  const resolved = (k: string) => live(loaded, k)?.key ?? k;
  const set = strings(rec.data.ties)
    .map(parseTie)
    .filter((t) => t !== null)
    .map((t) => ({ person: rec.key, ...t, said: false }));
  const setPairs = new Set(set.map((t) => `${t.type} ${resolved(t.target)}`));
  const said = strings(rec.data.said)
    .map(parseTie)
    .filter((t) => t !== null)
    .filter((t) => !setPairs.has(`${t.type} ${resolved(t.target)}`))
    .map((t) => ({ person: rec.key, ...t, said: true }));
  return [...set, ...said];
}

export const people = (loaded: Loaded): Rec[] =>
  loaded.records.filter((r) => r.type === 'actor' && r.valid && r.data.kind === 'person');

/** Every tie in the store, by the live key it reaches. */
export function tiesByTarget(loaded: Loaded): Map<string, Tie[]> {
  return memo(loaded, 'ties-by-target', () => {
    const out = new Map<string, Tie[]>();
    for (const p of people(loaded))
      for (const t of personTies(loaded, p)) {
        const k = live(loaded, t.target)?.key ?? t.target;
        out.set(k, [...(out.get(k) ?? []), t]);
      }
    // a type set outright on a target is its answer: what was said of that type there, by anyone, gives way
    for (const [k, ties] of out) {
      const set = new Set(ties.filter((t) => !t.said).map((t) => t.type));
      out.set(
        k,
        ties.filter((t) => !t.said || !set.has(t.type)),
      );
    }
    return out;
  });
}

/** An account a source names, by the part it plays there: observed by the sync, so a resync backs it out. */
export interface AccountPart {
  account: string;
  type: string;
  source: string;
}

/** The accounts each synced ticket names: a GitHub issue's assignees and author, a Linear issue's assignee and creator. */
export function accountParts(loaded: Loaded): AccountPart[] {
  return memo(loaded, 'account-parts', () => {
    const out: AccountPart[] = [];
    for (const r of loaded.records) {
      if (r.type !== 'source' || !r.valid) continue;
      const ext = (r.data.ext ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const gh = ext.github;
      if (gh) {
        for (const login of strings(gh.assignees))
          out.push({
            account: `github-user:${login}`,
            type: 'assignee',
            source: r.key,
          });
        if (typeof gh.author === 'string' && gh.author)
          out.push({
            account: `github-user:${gh.author}`,
            type: 'author',
            source: r.key,
          });
      }
      const ln = ext.linear;
      if (ln) {
        if (typeof ln.assignee === 'string' && ln.assignee)
          out.push({
            account: `linear-user:${ln.assignee}`,
            type: 'assignee',
            source: r.key,
          });
        if (typeof ln.creator === 'string' && ln.creator)
          out.push({
            account: `linear-user:${ln.creator}`,
            type: 'author',
            source: r.key,
          });
      }
    }
    return out;
  });
}

/** One person (or an account no person claims) on a key, and how. */
export interface PersonOn {
  /** person:<handle>, or the account key when no person claims it. */
  who: string;
  name?: string;
  role?: string;
  type: string;
  /** tie: set outright · said: from conversation · account: a source names their account · inherited: from a node above */
  via: 'tie' | 'said' | 'account';
  /** The node above it was inherited from, for a stake held higher on the map. */
  from?: string;
  /** The account a source named, when that is how they were reached. */
  account?: string;
}

function whoFields(loaded: Loaded, who: string): Pick<PersonOn, 'name' | 'role'> {
  const r = recordOf(loaded, who);
  return {
    ...(typeof r?.data.name === 'string' ? { name: r.data.name } : {}),
    ...(typeof r?.data.role === 'string' ? { role: r.data.role } : {}),
  };
}

const tieOn = (loaded: Loaded, t: Tie, from?: string): PersonOn => ({
  who: t.person,
  ...whoFields(loaded, t.person),
  type: t.type,
  via: t.said ? 'said' : 'tie',
  ...(from ? { from } : {}),
});

/** Who is on a key: the ties that reach it, the accounts a source names (resolved to their person), and for a map node
 *  the stakes inherited from above, the nearest node naming a stake winning it. */
export function peopleOn(loaded: Loaded, key: string): PersonOn[] {
  const byTarget = tiesByTarget(loaded);
  const out: PersonOn[] = (byTarget.get(key) ?? []).map((t) => tieOn(loaded, t));
  for (const a of accountParts(loaded)) {
    if (a.source !== key) continue;
    const p = personOf(loaded, a.account);
    if (out.some((o) => o.who === (p ?? a.account) && o.type === a.type)) continue;
    out.push({
      who: p ?? a.account,
      ...(p ? whoFields(loaded, p) : {}),
      type: a.type,
      via: 'account',
      account: a.account,
    });
  }
  if (isMapNode(key)) {
    const held = new Set(out.map((o) => o.type));
    for (const up of ancestorsOf(loaded, key).filter(isMapNode)) {
      const here = (byTarget.get(up) ?? []).filter((t) => !held.has(t.type));
      for (const t of here) out.push(tieOn(loaded, t, up));
      for (const t of here) held.add(t.type);
    }
  }
  return out;
}

/** The people to reference for a change (its PR, a message): each stake on the nodes it names, inherited from above,
 *  and the people tied to the change itself. Each person once per stake, with the nodes it came from. */
export interface Poc {
  who: string;
  name?: string;
  role?: string;
  type: string;
  said: boolean;
  /** The nodes (or the change itself) the stake is held on. */
  on: string[];
}

export function pocsOf(loaded: Loaded, changeKey: string): Poc[] {
  const rec = recordOf(loaded, changeKey);
  if (!rec) return [];
  const named = strings(rec.data.features)
    .map((f) => f.replace(/^(adds|changes|removes)\s+/, ''))
    .map((k) => live(loaded, k)?.key ?? k);
  // a change that names no node is the product's: its stakes are the ones to reference
  const root = named.length ? undefined : rootProductOf(loaded, rec)?.key;
  const nodes = root ? [root] : named;
  const acc = new Map<string, Poc>();
  const take = (o: PersonOn, on: string) => {
    const id = `${o.who} ${o.type}`;
    const was = acc.get(id);
    const at = o.from ?? on;
    if (was) {
      if (!was.on.includes(at)) was.on.push(at);
      was.said = was.said && o.via === 'said';
    } else
      acc.set(id, {
        who: o.who,
        ...(o.name ? { name: o.name } : {}),
        ...(o.role ? { role: o.role } : {}),
        type: o.type,
        said: o.via === 'said',
        on: [at],
      });
  };
  for (const n of nodes) for (const o of peopleOn(loaded, n)) take(o, n);
  for (const o of peopleOn(loaded, rec.key)) take(o, rec.key);
  // the tickets and pull requests it binds: their assignee and author, through the accounts they name
  for (const b of strings(rec.data.binds)) for (const o of peopleOn(loaded, b)) take(o, b);
  const rank = (t: string) => {
    const i = DEFAULT_STAKES.indexOf(t);
    return i < 0 ? DEFAULT_STAKES.length : i;
  };
  return [...acc.values()].toSorted((a, b) => rank(a.type) - rank(b.type) || a.who.localeCompare(b.who));
}

/** A person read whole: role, accounts, ties, and the sources that reach them through an account. */
export interface PersonView {
  key: string;
  name?: string;
  role?: string;
  aliases: string[];
  accounts: string[];
  ties: Tie[];
  /** Sources that name one of their accounts. */
  through: AccountPart[];
}

export function personView(loaded: Loaded, rec: Rec): PersonView {
  const accounts = strings(rec.data.links);
  const own = new Set(accounts.map((a) => a.toLowerCase()));
  return {
    key: rec.key,
    ...(typeof rec.data.name === 'string' ? { name: rec.data.name } : {}),
    ...(typeof rec.data.role === 'string' ? { role: rec.data.role } : {}),
    aliases: strings(rec.data.aliases),
    accounts,
    ties: personTies(loaded, rec),
    through: accountParts(loaded).filter((a) => own.has(a.account.toLowerCase())),
  };
}

/** The person a key reads as: the person themselves, or the one who holds an account; any other key (a source a
 *  person merely links) is not a person. */
export function personAt(loaded: Loaded, key: string): Rec | undefined {
  const rec = key.startsWith('person:')
    ? live(loaded, key)
    : accountKind(key)
      ? live(loaded, personOf(loaded, key) ?? '')
      : undefined;
  return rec && rec.type === 'actor' && rec.data.kind === 'person' ? rec : undefined;
}

// --- intake: a mention to its person ---------------------------------------------------------------------------

export interface PersonMatch {
  key: string;
  name?: string;
  /** What matched: account, handle, alias, name; a partial match (a first or last name) is only a candidate. */
  by: string;
}

export interface Intake {
  /** found: one person answers · none: no one does · candidates: several, or only partial matches, to choose from ·
   *  conflict: the accounts given belong to someone the name does not match. */
  status: 'found' | 'none' | 'candidates' | 'conflict';
  match?: PersonMatch;
  candidates: PersonMatch[];
}

/** A mention resolved to its person, as intake does for a change: an account given is exact and wins; then the handle,
 *  an alias or the full name; a first or last name alone only offers candidates, so no two people are merged on a name. */
export function findPerson(loaded: Loaded, mention: string, accounts: string[] = []): Intake {
  const all = people(loaded);
  const byAccount = [...new Set(accounts.map((a) => personOf(loaded, a)).filter((p): p is string => !!p))];
  const m = mention.trim();
  const direct = m.startsWith('person:') ? live(loaded, m) : undefined;
  if (m.startsWith('person:')) {
    if (!direct || direct.type !== 'actor') return { status: 'none', candidates: [] };
    if (byAccount.length && byAccount.some((k) => k !== direct.key))
      return {
        status: 'conflict',
        candidates: byAccount.map((k) => ({ key: k, by: 'account' })),
      };
    return {
      status: 'found',
      match: { key: direct.key, by: 'key' },
      candidates: [],
    };
  }
  const fromAccount = accountKind(m) ? personOf(loaded, m) : undefined;
  if (fromAccount) byAccount.push(fromAccount);
  const slug = slugify(m);
  const lower = m.toLowerCase();
  const nameOf = (r: Rec) => (typeof r.data.name === 'string' ? r.data.name : undefined);
  const exact: PersonMatch[] = [];
  const partial: PersonMatch[] = [];
  for (const r of all) {
    const name = nameOf(r);
    const handle = r.key.slice('person:'.length);
    const by =
      handle === slug
        ? 'handle'
        : strings(r.data.aliases).includes(slug)
          ? 'alias'
          : name && name.toLowerCase() === lower
            ? 'name'
            : undefined;
    if (by) exact.push({ key: r.key, ...(name ? { name } : {}), by });
    else if (
      slug &&
      name &&
      !accountKind(m) &&
      name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => slugify(w) === slug)
    )
      partial.push({ key: r.key, name, by: 'part of the name' });
  }
  const accountsSay = [...new Set(byAccount)];
  if (accountsSay.length > 1)
    return {
      status: 'conflict',
      candidates: accountsSay.map((k) => ({ key: k, by: 'account' })),
    };
  if (accountsSay.length === 1) {
    const k = accountsSay[0];
    if (exact.length && !exact.some((e) => e.key === k))
      return {
        status: 'conflict',
        candidates: [{ key: k, by: 'account' }, ...exact],
      };
    const r = recordOf(loaded, k);
    return {
      status: 'found',
      match: {
        key: k,
        ...(r && nameOf(r) ? { name: nameOf(r) } : {}),
        by: 'account',
      },
      candidates: [],
    };
  }
  // a full name is the person; a handle or an alias beside others whose name holds the word is not decided here
  if (exact.length === 1 && (exact[0].by === 'name' || !partial.length))
    return { status: 'found', match: exact[0], candidates: [] };
  if (exact.length === 1) return { status: 'candidates', candidates: [...exact, ...partial] };
  if (exact.length > 1) return { status: 'candidates', candidates: exact };
  if (partial.length) return { status: 'candidates', candidates: partial };
  return { status: 'none', candidates: [] };
}

const IDENTITY = new Set(IDENTITY_KINDS);
function accountKind(raw: string): string | undefined {
  const k = parseKey(raw);
  return k && IDENTITY.has(k.kind) ? k.kind : undefined;
}

// --- text ------------------------------------------------------------------------------------------------------

const whoLabel = (o: { who: string; name?: string; role?: string }) =>
  `${o.who}${o.name ? ` (${o.name}${o.role ? `, ${o.role}` : ''})` : o.role ? ` (${o.role})` : ''}`;

export function formatPeopleOn(list: PersonOn[]): string[] {
  return list.map(
    (o) =>
      `- ${o.type}: ${whoLabel(o)}${o.via === 'said' ? ' · said' : ''}${o.via === 'account' ? ` · as ${o.account}` : ''}${o.from ? ` · from ${o.from}` : ''}`,
  );
}

export function formatPocs(list: Poc[]): string[] {
  return list.map((p) => `- ${p.type}: ${whoLabel(p)}${p.said ? ' · said' : ''} · on ${p.on.join(', ')}`);
}

export function formatPerson(v: PersonView): string[] {
  const out = [`${v.key}${v.name ? ` — ${v.name}` : ''}${v.role ? ` · ${v.role}` : ''}`];
  if (v.aliases.length) out.push(`aliases: ${v.aliases.join(', ')}`);
  out.push('', '## Accounts', '', ...(v.accounts.length ? v.accounts.map((a) => `- ${a}`) : ['(none)']));
  const stakes = v.ties.filter((t) => isMapNode(t.target));
  const parts = v.ties.filter((t) => !isMapNode(t.target));
  const tie = (t: Tie) => `- ${t.type} ${t.target}${t.said ? ' · said' : ''}`;
  out.push('', '## Stakes', '', ...(stakes.length ? stakes.map(tie) : ['(none)']));
  out.push('', '## Parts', '', ...(parts.length ? parts.map(tie) : ['(none)']));
  if (v.through.length)
    out.push('', '## Through their accounts', '', ...v.through.map((a) => `- ${a.type} ${a.source} · as ${a.account}`));
  return out;
}
