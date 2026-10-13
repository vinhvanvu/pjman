import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsQuote, parseRecord, repairFrontmatter, sections, stringifyRecord, violatesRule } from '../frontmatter.js';

test('the YAML rule: colon-space, hash, special leading characters', () => {
  assert.equal(violatesRule('Schema v3: keys'), "contains ': '");
  assert.equal(violatesRule('acme/app#123'), "contains '#'");
  assert.equal(violatesRule('-foo'), "starts with '-'");
  assert.equal(violatesRule('plain words'), null);
  assert.equal(violatesRule('2026-10-13'), null);
  assert.ok(needsQuote('true'));
  assert.ok(needsQuote('42'));
  assert.ok(!needsQuote('open'));
});

test('parse reports unquoted scalars and missing frontmatter', () => {
  const p = parseRecord('---\nlinks: [github-pr:acme/app#1]\ntitle: ok\n---\n\n## Summary\n\nx\n');
  assert.equal(p.errors.length, 0);
  assert.deepEqual(p.unquoted, ["links: unquoted scalar contains '#'"]);
  const none = parseRecord('no frontmatter');
  assert.equal(none.hasFrontmatter, false);
  assert.equal(none.errors.length, 1);
});

test('stringify orders fields, quotes by the rule, and round-trips', () => {
  const text = stringifyRecord(
    { created: '2026-10-13', title: 'A: b', status: 'open', ext: { x: { y: 1 } }, links: ['github-pr:acme/app#1'], custom: 'z' },
    '\n\n## Summary\n\nhello\n\n\n',
    ['title', 'status', 'links', 'created', 'ext'],
  );
  assert.equal(
    text,
    '---\ntitle: "A: b"\nstatus: open\nlinks:\n  - "github-pr:acme/app#1"\ncreated: 2026-10-13\ncustom: z\next:\n  x:\n    y: 1\n---\n\n## Summary\n\nhello\n',
  );
  const back = parseRecord(text);
  assert.equal(back.errors.length, 0);
  assert.equal(back.unquoted.length, 0);
  assert.equal(back.data.title, 'A: b');
  assert.equal(back.data.created, '2026-10-13');
  assert.deepEqual(back.data.links, ['github-pr:acme/app#1']);
});

test('repair quotes the offending scalar when that makes the document parse', () => {
  assert.equal(repairFrontmatter('title: Gamma: colon\nstatus: open'), 'title: "Gamma: colon"\nstatus: open');
  assert.equal(repairFrontmatter('title: fine\nstatus: open'), null);
  const p = parseRecord('---\ntitle: Gamma: colon\n---\n');
  assert.ok(p.errors.length >= 1);
  assert.ok(p.repaired);
});

test('sections split on ## headings', () => {
  const s = sections('intro\n\n## Summary\n\none\n\n## Plan\n\ntwo\n');
  assert.equal(s.get(''), 'intro');
  assert.equal(s.get('Summary'), 'one');
  assert.equal(s.get('Plan'), 'two');
});
