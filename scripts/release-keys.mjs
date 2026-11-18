// Which changes a commit ships, read from its message: what the changelog credits (scripts/release.mjs).

/** The change keys a commit names: every `change:<slug>` in the parenthesised group that ends the subject (the trailer
 *  the merge convention writes, `(change:a, change:b)`, or `(decision x/y; change:a)`; a squash merge's `(#12)` may
 *  follow it), else the branch a merge into main brought in, by git's merge commit or a pull request's. */
// (a key counts as an item of the group by itself, `(decision x/y; change:a)`, or as the change a decision named there
// was made under, `(decision x under change:a)`: one the words merely mention, `(as change:b did; change:a)`, credits
// nothing)
const keysIn = (m) =>
  m[1]
    .split(/[,;]/)
    .map((item) => /^\s*(?:decision\s+\S+\s+(?:under|on|of)\s+)?change:([A-Za-z0-9_./-]+)\s*$/.exec(item)?.[1])
    .filter(Boolean)
    .map((k) => k.replace(/^[^/]+\//, ''));
export function keysOf(subject, body = '') {
  // a squash merge ends its subject with the pull request's number, after the group: `… (change:a) (#12)`
  const trailer = /\(([^()]*\bchange:[^()]*)\)(?:\s*\(#\d+\))?\s*$/.exec(subject);
  if (trailer) return keysIn(trailer);
  const merge = /^Merge branch '([^']+)'(?:\s+into\s+main\b)?(?!\s+into\b)/.exec(subject);
  if (merge) return [merge[1]];
  // a pull request merged on GitHub: its merge commit names the head branch (`Merge pull request #12 from owner/branch`)
  const pr = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
  if (pr) return [pr[1].split('/').pop()];
  // a squash merge: the subject is the pull request's title, and the body lists the commits it folded, each naming
  // its change the same way
  return [...new Set([...body.matchAll(/\(([^()]*\bchange:[^()]*)\)/g)].flatMap(keysIn))];
}
