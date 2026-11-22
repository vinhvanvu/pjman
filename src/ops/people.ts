// The writes for people (change:people-in-graph): person intake (a mention found, else created, so each human is one
// record) and a person's typed ties, set outright or said in conversation. A word new to the store's roles, stakes or
// parts is added on first use, in the same commit. Every write is one commit, which `pjman undo` reverts; a tie is
// also taken back with --remove.
import fs from 'node:fs';
import path from 'node:path';
import { IDENTITY_KINDS as IDENTITY, writeStoreConfig, type Store } from '../store/config.js';
import { fullKey, loadStore, type Loaded, type Rec } from '../store/records.js';
import { parseKey, slugify, SLUG_RE } from '../store/keys.js';
import { CliError } from '../store/util.js';
import { findPerson, isMapNode, parseTie, wordsOf, type PersonMatch, type Vocab } from '../model/people.js';
import { live } from '../model/tree.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo, writeFile } from './write.js';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Add a word to a store's vocabulary when it lacks it; the note to say, or nothing. Written to pjman.yaml now; the
 *  caller's commit carries it. */
function ensureWord(store: Store, vocab: Vocab, word: string): string | undefined {
  if (!SLUG_RE.test(word))
    throw new CliError(`'${word}' is not a word pjman keeps (lower-case letters, digits, hyphens)`);
  if (wordsOf(store, vocab).includes(word)) return undefined;
  store.config[vocab] = [...(store.config[vocab] ?? []), word];
  writeStoreConfig(store.root, store.config);
  return `added '${word}' to the store's ${vocab}`;
}

function normaliseAccount(raw: string): string {
  const k = parseKey(raw);
  if (!k || !IDENTITY.includes(k.kind))
    throw new CliError(`'${raw}' is not an account (${IDENTITY.map((kind) => `${kind}:…`).join(', ')})`);
  return k.kind === 'email' ? `email:${k.rest.toLowerCase()}` : `${k.kind}:${k.rest}`;
}

export interface PersonOpts {
  name?: string;
  role?: string;
  accounts?: string[];
  aliases?: string[];
  /** Create a new person even though candidates were found (they are someone else). */
  new?: boolean;
  /** The handle for a new person; else the name's slug. */
  handle?: string;
  writer?: string;
  session?: string;
}

export interface PersonResult {
  status: 'found' | 'created' | 'candidates' | 'conflict';
  key?: string;
  /** How a found person matched. */
  by?: string;
  candidates: PersonMatch[];
  /** What the write added to a found person. */
  added: string[];
  notes: string[];
  commit: string | null;
}

/** Person intake: the mention resolved to one person (adding what was given: a role, accounts, aliases), else a new
 *  person created; several candidates, or only a partial match, are handed back to choose from and nothing is written. */
export function personIntake(store: Store, mention: string, opts: PersonOpts = {}): PersonResult {
  if (!mention.trim())
    throw new CliError('usage: pjman person <name | person:<handle> | account> [--role …] [--account …]');
  const accounts = (opts.accounts ?? []).map(normaliseAccount);
  const mentionIsAccount = IDENTITY.includes(parseKey(mention)?.kind ?? '');
  if (mentionIsAccount) accounts.push(normaliseAccount(mention));
  let loaded = loadStore(store);
  const found = opts.new ? ({ status: 'none', candidates: [] } as const) : findPerson(loaded, mention, accounts);
  if (found.status === 'candidates' || found.status === 'conflict')
    return {
      status: found.status,
      candidates: found.candidates,
      added: [],
      notes: [],
      commit: null,
    };
  const env = envelope(opts);
  const notes: string[] = [];
  const prior = snapshot(store, ['pjman.yaml']);
  const words = wordsNow(store);
  // a refusal anywhere past here, up to the commit, puts back the role the write added to the store's words; once the
  // write has validated, the record and its words stand or fall together with the commit
  let committing = false;
  try {
    if (opts.role) {
      const n = ensureWord(store, 'roles', opts.role);
      if (n) notes.push(n);
    }
    const aliases = (opts.aliases ?? []).map((a) => {
      const s = slugify(a);
      if (!s) throw new CliError(`'${a}' makes no alias`);
      return s;
    });

    if (found.status === 'found' && found.match) {
      const rec = live(loaded, found.match.key) as Rec;
      if (rec.data.kind !== 'person') throw new CliError(`${rec.key} is an agent, not a person`);
      const data: Record<string, unknown> = { ...rec.data };
      const added: string[] = [];
      if (opts.role && data.role !== opts.role) {
        data.role = opts.role;
        added.push(`role ${opts.role}`);
      }
      if (opts.name && !data.name) {
        data.name = opts.name;
        added.push(`name ${opts.name}`);
      }
      const links = strings(data.links);
      for (const a of accounts)
        if (!links.some((l) => l.toLowerCase() === a.toLowerCase())) {
          links.push(a);
          added.push(a);
        }
      if (links.length) data.links = links;
      const al = strings(data.aliases);
      for (const a of aliases)
        if (!al.includes(a) && a !== rec.key.slice('person:'.length)) {
          al.push(a);
          added.push(`alias ${a}`);
        }
      if (al.length) data.aliases = al;
      if (!added.length) {
        restore(store, prior, words);
        return {
          status: 'found',
          key: rec.key,
          by: found.match.by,
          candidates: [],
          added,
          notes,
          commit: null,
        };
      }
      const before = snapshot(store, [rec.path]);
      fs.writeFileSync(rec.abs, render('actor', data, rec.body));
      undoOnRefusal(store, [rec.path, 'pjman.yaml'], [], new Map([...before, ...prior]), words);
      committing = true;
      const commit = finishWrite(store, `pjman: person ${rec.key} (${added.join(', ')})`, env.session, [
        {
          op: 'set',
          key: rec.key,
          type: 'actor',
          path: rec.path,
          fields: ['person'],
          writer: env.writer,
        },
      ]);
      return {
        status: 'found',
        key: rec.key,
        by: found.match.by,
        candidates: [],
        added,
        notes,
        commit,
      };
    }

    // no one answers: a new person, named by the mention unless it is a key or an account
    const name = opts.name ?? (mentionIsAccount || mention.includes(':') ? undefined : mention.trim());
    const handle =
      opts.handle ??
      (name
        ? slugify(name)
        : mentionIsAccount
          ? slugify(parseKey(mention)!.rest.split('@')[0])
          : slugify(mention.replace(/^person:/, '')));
    if (!handle || !SLUG_RE.test(handle)) throw new CliError(`no handle can be made from '${mention}'; pass --handle`);
    loaded = loadStore(store);
    if (loaded.byKey.has(`person:${handle}`) || loaded.aliases.has(`person:${handle}`))
      throw new CliError(`person:${handle} is taken by someone else; pass --handle <another>`);
    const rel = path.join('actors', `${handle}.md`);
    const data: Record<string, unknown> = {
      kind: 'person',
      name,
      role: opts.role,
      links: accounts.length ? [...new Set(accounts)] : undefined,
      aliases: aliases.filter((a) => a !== handle).length ? aliases.filter((a) => a !== handle) : undefined,
      writer: env.writer,
      session: env.session,
      created: new Date().toISOString().slice(0, 10),
    };
    writeFile(store, rel, render('actor', data, ''));
    undoOnRefusal(store, [rel, 'pjman.yaml'], [rel], prior, words);
    committing = true;
    const commit = finishWrite(store, `pjman: new person:${handle}`, env.session, [
      {
        op: 'created',
        key: `person:${handle}`,
        type: 'actor',
        path: rel,
        writer: env.writer,
      },
    ]);
    return {
      status: 'created',
      key: `person:${handle}`,
      candidates: [],
      added: [],
      notes,
      commit,
    };
  } catch (e) {
    if (!committing) restore(store, prior, words);
    throw e;
  }
}

type Words = Pick<Store['config'], Vocab>;
const wordsNow = (store: Store): Words => ({
  roles: store.config.roles,
  stakes: store.config.stakes,
  parts: store.config.parts,
});

/** Put pjman.yaml and the in-memory vocabulary back as they were before the write. */
function restore(store: Store, prior: Map<string, string>, words: Words): void {
  const cfg = prior.get('pjman.yaml');
  if (cfg !== undefined) fs.writeFileSync(path.join(store.root, 'pjman.yaml'), cfg);
  for (const k of ['roles', 'stakes', 'parts'] as const) {
    if (words[k] === undefined) delete store.config[k];
    else store.config[k] = words[k];
  }
}

/** Validate; a refusal puts the record and pjman.yaml (the words added for the write) back. */
function undoOnRefusal(
  store: Store,
  rels: string[],
  created: string[],
  prior: Map<string, string>,
  words: Words,
): void {
  try {
    validateOrUndo(store, rels, created, prior);
  } catch (e) {
    restore(store, prior, words);
    throw e;
  }
}

export interface TieOpts {
  /** From conversation: an inference, overridden by a tie set outright on the same target. */
  said?: boolean;
  remove?: boolean;
  writer?: string;
  session?: string;
}

export interface TieResult {
  person: string;
  type: string;
  target: string;
  op: 'tied' | 'removed' | 'unchanged';
  notes: string[];
  commit: string | null;
}

/** Tie a person to a key by a type (a stake on a map node, a part on anything else), or take the tie back. A tie set
 *  outright replaces what was said of the same type and target; what is said where it is set outright changes nothing. */
export function tie(store: Store, personRef: string, type: string, targetRef: string, opts: TieOpts = {}): TieResult {
  const loaded: Loaded = loadStore(store);
  const p = live(loaded, personRef.startsWith('person:') ? personRef : `person:${personRef}`);
  if (!p || p.type !== 'actor' || p.data.kind !== 'person')
    throw new CliError(`${personRef} is no person; find or create them first: pjman person "<their name>"`);
  const targetRec = live(loaded, targetRef);
  const target = targetRec?.key ?? fullKey(loaded, targetRef);
  if (!parseKey(target)) throw new CliError(`'${targetRef}' is not a key`);
  const vocab: Vocab = isMapNode(target) ? 'stakes' : 'parts';
  const line = `${type} ${target}`;
  const same = (raw: string) => {
    const t = parseTie(raw);
    return !!t && t.type === type && (live(loaded, t.target)?.key ?? t.target) === target;
  };
  const data: Record<string, unknown> = { ...p.data };
  let ties = strings(data.ties);
  let said = strings(data.said);
  const notes: string[] = [];
  const prior = snapshot(store, [p.path, 'pjman.yaml']);
  const words = wordsNow(store);
  let op: TieResult['op'] = 'tied';
  if (opts.remove) {
    const before = ties.length + said.length;
    ties = ties.filter((t) => !same(t));
    said = said.filter((t) => !same(t));
    op = ties.length + said.length < before ? 'removed' : 'unchanged';
  } else {
    const n = ensureWord(store, vocab, type);
    if (n) notes.push(n);
    if (opts.said) {
      // what is set outright already says it; a said tie of a type someone holds outright there is kept but shadowed
      if (ties.some(same) || said.some(same)) op = 'unchanged';
      else said.push(line);
    } else {
      // set outright: what was said of the same pair gives way
      const dropped = said.filter(same);
      if (dropped.length) notes.push(`replaces what was said: ${dropped.join(', ')}`);
      said = said.filter((t) => !same(t));
      if (ties.some(same) && !dropped.length) op = 'unchanged';
      else if (!ties.some(same)) ties.push(line);
    }
  }
  if (op === 'unchanged') {
    restore(store, prior, words);
    return { person: p.key, type, target, op, notes, commit: null };
  }
  data.ties = ties.length ? ties : undefined;
  data.said = said.length ? said : undefined;
  fs.writeFileSync(p.abs, render('actor', data, p.body));
  undoOnRefusal(store, [p.path, 'pjman.yaml'], [], prior, words);
  const env = envelope(opts);
  const commit = finishWrite(
    store,
    `pjman: ${opts.remove ? 'untie' : 'tie'} ${p.key} ${type} ${target}${opts.said ? ' (said)' : ''}`,
    env.session,
    [
      {
        op: 'set',
        key: p.key,
        type: 'actor',
        path: p.path,
        fields: [opts.said ? 'said' : 'ties'],
        writer: env.writer,
      },
    ],
  );
  return { person: p.key, type, target, op, notes, commit };
}
