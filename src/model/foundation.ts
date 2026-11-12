// The foundation: what a change and a decision are made of (change:record-foundation; decisions three-layers,
// change-template, changes-sectioned-decisions-threaded, the-ladder, projections-stay-fresh). A change's foundation
// is fixed sections in its body, in order of depth, and a plan of steps in its frontmatter, each with a state and a
// note; a decision's is a thread of typed entries, append-only, in its frontmatter. Both carry two rungs written from
// the foundation, name (which one in a crowd) and gist (what it is and why, in a line), and the hash of the foundation
// they were written from, so a stale rung is derived and never written. What a record still needs (an ingested or a
// migrated one) is derived the same way.
import { createHash } from 'node:crypto';
import type { Rec } from '../store/records.js';
import { localDate } from '../store/util.js';

/** The calendar day of an instant, as the record's dates are written: the local day, except for an instant at exactly
 *  midnight UTC, which stands for a date alone (a migrated acceptance carries the day it was decided, no time). */
export const dayOf = (at: string): string =>
  Number.isNaN(Date.parse(at)) || at.endsWith('T00:00:00.000Z') ? at.slice(0, 10) : localDate(new Date(at));

/** A change's sections, in order of depth: a reader who wants more than the gist reads the first and stops. */
export const CHANGE_SECTIONS = [
  'Origin',
  'Intent',
  'Done when',
  'Scope',
  'Open questions',
  'Blocked on',
  'Notes',
] as const;
export type ChangeSection = (typeof CHANGE_SECTIONS)[number];
/** The sections a change filed by a person or an agent carries from creation. An ingested or migrated change may lack
 *  Intent and Done when until it is first worked; Origin it always has. */
export const CHANGE_REQUIRED: readonly ChangeSection[] = ['Origin', 'Intent', 'Done when'];
/** The sections the rungs are written from: a write to one marks the rungs stale. */
export const CHANGE_FOUNDATION: readonly ChangeSection[] = ['Origin', 'Intent', 'Done when'];

/** The field a command takes for each section: `intent=…`, `done-when=…`. */
export const SECTION_FIELDS: Record<string, ChangeSection> = {
  origin: 'Origin',
  intent: 'Intent',
  'done-when': 'Done when',
  scope: 'Scope',
  'open-questions': 'Open questions',
  'blocked-on': 'Blocked on',
  notes: 'Notes',
};

// --- the plan -----------------------------------------------------------------------------------------------------

export const STEP_STATES = ['open', 'active', 'done', 'dropped'] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface Step {
  text: string;
  state: StepState;
  /** Where the work stands on it: written when it starts, moves or ends. */
  note?: string;
  /** When it last moved. */
  at?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** The steps a change's `plan` holds, as written; a malformed entry is left out (the validator names it). */
export function stepsOf(data: Record<string, unknown>): Step[] {
  if (!Array.isArray(data.plan)) return [];
  const out: Step[] = [];
  for (const raw of data.plan) {
    const s = obj(raw);
    const text = str(s?.text);
    if (!s || !text) continue;
    const state = (STEP_STATES as readonly string[]).includes(String(s.state)) ? (s.state as StepState) : 'open';
    out.push({ text, state, note: str(s.note), at: str(s.at) });
  }
  return out;
}

/** The plan's progress: steps done over steps not dropped; undefined without steps. */
export function planProgress(steps: Step[]): { done: number; total: number } | undefined {
  const counted = steps.filter((s) => s.state !== 'dropped');
  return counted.length ? { done: counted.filter((s) => s.state === 'done').length, total: counted.length } : undefined;
}

/** The next step: the first active one, else the first open one, with its number in the plan (from 1). */
export function nextStep(steps: Step[]): { n: number; step: Step } | undefined {
  const i = steps.findIndex((s) => s.state === 'active');
  const j = i >= 0 ? i : steps.findIndex((s) => s.state === 'open');
  return j >= 0 ? { n: j + 1, step: steps[j] } : undefined;
}

export function formatStep(n: number, s: Step): string {
  const mark = s.state === 'done' ? 'x' : s.state === 'active' ? '>' : s.state === 'dropped' ? '-' : ' ';
  return `${n}. [${mark}] ${s.text}${s.state === 'dropped' ? ' (dropped)' : ''}${s.note ? ` — ${s.note}` : ''}`;
}

// --- the thread ---------------------------------------------------------------------------------------------------

export const ENTRY_TYPES = [
  'question',
  'criterion',
  'option',
  'recommendation',
  'comment',
  'reject',
  'accept',
  'reopen',
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** One entry of a decision's thread. `text` is the entry's words: the question, the criterion, the option's name, the
 *  recommendation's reasoning, the comment, the reason for a rejection, the person's words at acceptance. */
export interface Entry {
  type: EntryType;
  at: string;
  /** The actor who wrote it; the person for a comment in their words and for an acceptance. */
  by?: string;
  text?: string;
  /** An option's id, a slug: what later entries name. */
  id?: string;
  /** An option's case: its points, one per line (what it gives, what it costs, what it rules out); the views draw
   *  them as bullets. A later option entry with the same id restates the option: its text and case replace the
   *  earlier ones, the marks on it stay, the thread keeps both. */
  case?: string;
  /** The option a recommendation, a rejection or an acceptance names; on a comment, the option it is about. */
  option?: string;
  /** An acceptance's condition for revisiting the decision. */
  revisit?: string;
}

/** The thread as written, in order; a malformed entry is left out (the validator names it). */
export function threadOf(data: Record<string, unknown>): Entry[] {
  if (!Array.isArray(data.thread)) return [];
  const out: Entry[] = [];
  for (const raw of data.thread) {
    const e = obj(raw);
    if (!e || !(ENTRY_TYPES as readonly string[]).includes(String(e.type))) continue;
    out.push({
      type: e.type as EntryType,
      at: str(e.at) ?? '',
      by: str(e.by),
      text: str(e.text),
      id: str(e.id),
      case: str(e.case),
      option: str(e.option),
      revisit: str(e.revisit),
    });
  }
  return out;
}

export interface OptionState {
  id: string;
  /** One line: what the option is. */
  text: string;
  /** Its points, one per line (`pointsOf`). */
  case?: string;
  recommended: boolean;
  /** Why it was set aside, when it was. */
  rejected?: string;
  accepted: boolean;
}

/** The current state of a decision, read off its thread: the latest question, the criteria, every option with its
 *  marks, the latest recommendation, the comments, and the acceptance in force (none after a reopen). */
export interface DecisionState {
  question?: string;
  criteria: string[];
  options: OptionState[];
  recommendation?: { option: string; text?: string; at: string };
  /** The comments in order; one about an option names it, and the views draw it beneath that option. */
  comments: { by?: string; at: string; text: string; option?: string }[];
  accepted?: { option: string; by?: string; at: string; text?: string; revisit?: string };
}

export function decisionState(entries: Entry[]): DecisionState {
  const s: DecisionState = { criteria: [], options: [], comments: [] };
  const option = (id: string | undefined) => s.options.find((o) => o.id === id);
  for (const e of entries) {
    switch (e.type) {
      case 'question':
        s.question = e.text;
        break;
      case 'criterion':
        if (e.text) s.criteria.push(e.text);
        break;
      case 'option': {
        if (!e.id || !e.text) break;
        const o = option(e.id);
        if (o) {
          o.text = e.text;
          o.case = e.case;
        } // restated: the latest statement stands; its marks stay
        else s.options.push({ id: e.id, text: e.text, case: e.case, recommended: false, accepted: false });
        break;
      }
      case 'recommendation': {
        for (const o of s.options) o.recommended = false;
        const o = option(e.option);
        if (o) {
          o.recommended = true;
          s.recommendation = { option: o.id, text: e.text, at: e.at };
        }
        break;
      }
      case 'comment':
        if (e.text) s.comments.push({ by: e.by, at: e.at, text: e.text, ...(e.option ? { option: e.option } : {}) });
        break;
      case 'reject': {
        const o = option(e.option);
        if (o) o.rejected = e.text ?? '';
        break;
      }
      case 'accept': {
        const o = option(e.option);
        if (o) {
          for (const x of s.options) x.accepted = false;
          o.accepted = true;
          s.accepted = { option: o.id, by: e.by, at: e.at, text: e.text, revisit: e.revisit };
        }
        break;
      }
      case 'reopen': {
        for (const x of s.options) x.accepted = false;
        s.accepted = undefined;
        break;
      }
    }
  }
  return s;
}

/** An option's case as its points: one per line, a leading bullet mark dropped, blank lines left out. A case written
 *  as one paragraph is one point. */
export function pointsOf(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ''))
    .filter(Boolean);
}

/** The decision's state as an agent reads it in the context: the question, the criteria, the options with their
 *  marks and their points, the why, the comments, the acceptance. */
export function formatDecisionState(s: DecisionState): string[] {
  const out: string[] = [];
  if (s.question) out.push(`Question: ${s.question}`);
  if (s.criteria.length) out.push(`Criteria:${s.criteria.map((c) => `\n- ${c}`).join('')}`);
  if (s.options.length) {
    out.push('Options:');
    for (const o of s.options) {
      const marks = [
        o.accepted ? 'accepted' : '',
        o.recommended && !o.accepted ? 'recommended' : '',
        o.rejected !== undefined ? `rejected${o.rejected ? `: ${o.rejected}` : ''}` : '',
      ].filter(Boolean);
      out.push(
        `- ${o.id}${marks.length ? ` (${marks.join('; ')})` : ''}: ${o.text}${pointsOf(o.case)
          .map((p) => `\n  - ${p}`)
          .join('')}`,
      );
    }
  }
  if (s.recommendation?.text) out.push(`Why ${s.recommendation.option}: ${s.recommendation.text}`);
  for (const c of s.comments)
    out.push(`${c.by ?? 'someone'} (${dayOf(c.at)})${c.option ? ` on ${c.option}` : ''}: ${c.text}`);
  if (s.accepted)
    out.push(
      `Accepted ${s.accepted.option}${s.accepted.by ? ` by ${s.accepted.by}` : ''} on ${dayOf(s.accepted.at)}${s.accepted.text ? `: ${s.accepted.text}` : ''}${s.accepted.revisit ? ` (revisit when ${s.accepted.revisit})` : ''}`,
    );
  return out;
}

// --- the rungs ----------------------------------------------------------------------------------------------------

/** The text the rungs are written from: a change's Origin, Intent and Done when; a decision's question, recommendation
 *  and acceptance, as its thread holds them. */
export function foundationOf(type: string, data: Record<string, unknown>, sections: Map<string, string>): string {
  if (type === 'change') return CHANGE_FOUNDATION.map((s) => `## ${s}\n${sections.get(s) ?? ''}`).join('\n');
  if (type === 'decision') {
    return threadOf(data)
      .filter((e) => e.type === 'question' || e.type === 'recommendation' || e.type === 'accept' || e.type === 'reopen')
      .map((e) => `${e.type} ${e.option ?? ''} ${e.text ?? ''}`)
      .join('\n');
  }
  return '';
}

export function foundationHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export interface Rungs {
  name?: string;
  gist?: string;
  /** The rungs were written from an earlier foundation than the record holds now. */
  stale: boolean;
}

/** The rungs as written and whether they are stale: `rungs_from` names the foundation they were written from, and the
 *  record's foundation now hashes to something else. A record with no `rungs_from` (hand-written) is never stale. */
export function rungsOf(rec: Pick<Rec, 'type' | 'data' | 'sections'>): Rungs {
  const from = str(rec.data.rungs_from);
  const stale = !!from && from !== foundationHash(foundationOf(rec.type, rec.data, rec.sections));
  return { name: str(rec.data.name), gist: str(rec.data.gist), stale };
}

/** What the record still needs before it is worked: the rungs it lacks, and for a record still in play the required
 *  sections (a change not done or dropped; a decision still proposed). Empty for a record that has them all. */
export function needsOf(rec: Pick<Rec, 'type' | 'data' | 'sections'>): string[] {
  const out: string[] = [];
  if (!str(rec.data.name)?.trim()) out.push('name');
  if (!str(rec.data.gist)?.trim()) out.push('gist');
  const status = str(rec.data.status);
  if (rec.type === 'change' && status !== 'done' && status !== 'dropped') {
    for (const s of CHANGE_REQUIRED) if (!rec.sections.get(s)?.trim()) out.push(s.toLowerCase());
  } else if (rec.type === 'decision' && status === 'proposed') {
    const s = decisionState(threadOf(rec.data));
    if (!s.question) out.push('question');
    if (!s.options.length) out.push('an option');
  }
  return out;
}

/** The record is in the shape before the foundation: a title, a Summary, a Decision section. `pjman migrate` maps it. */
export function unmigrated(rec: Pick<Rec, 'type' | 'data' | 'sections'>): boolean {
  if (rec.type === 'change')
    return (
      rec.data.title !== undefined ||
      rec.data.next !== undefined ||
      rec.sections.has('Summary') ||
      rec.sections.has('Plan')
    );
  if (rec.type === 'decision')
    return rec.data.title !== undefined || rec.sections.has('Decision') || rec.sections.has('Why');
  return false;
}

/** The record's one line: its title, or for a change or a decision its gist. */
export const lineOf = (data: Record<string, unknown>): string | undefined => str(data.title) ?? str(data.gist);
/** The record's label, which one in a crowd: its name, else its title, else its key's last segment. */
export const labelOf = (data: Record<string, unknown>, key: string): string =>
  str(data.name) ?? str(data.title) ?? key.slice(key.lastIndexOf('/') + 1).replace(/^[a-z-]+:/, '');

/** A name: one to four words. */
export function nameProblem(name: string): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'empty';
  if (words.length > 4) return `${words.length} words; one to four`;
  return null;
}

/** A gist: one line. */
export function gistProblem(gist: string): string | null {
  if (!gist.trim()) return 'empty';
  if (/[\r\n]/.test(gist.trim())) return 'more than one line';
  return null;
}
