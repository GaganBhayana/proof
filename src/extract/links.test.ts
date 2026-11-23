import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LinkedIssueRef } from '../types.ts';
import { extractLinkedIssues, findIssueRefs, stripNonProse } from './links.ts';
import { makePr } from '../../test/fixtures/pr.ts';

const context = { owner: 'acme', repo: 'widgets' };
const closing = (number: number, owner = 'acme', repo = 'widgets'): LinkedIssueRef => ({ owner, repo, number, strength: 'closing' });
const mention = (number: number, owner = 'acme', repo = 'widgets'): LinkedIssueRef => ({ owner, repo, number, strength: 'mention' });

const cases: ReadonlyArray<{ name: string; body: string; want: LinkedIssueRef[] }> = [
  { name: 'fixes #n', body: 'Fixes #12', want: [closing(12)] },
  { name: 'every keyword form, any case', body: 'close #1 closes #2 CLOSED #3 fix #4 Fixed #5 resolve #6 resolves #7 Resolved #8', want: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => closing(n)) },
  { name: 'keyword with a colon', body: 'Fixes: #9 and closes:#10', want: [closing(9), closing(10)] },
  { name: 'cross-repo short ref', body: 'closes octo-org/other.repo#3', want: [closing(3, 'octo-org', 'other.repo')] },
  { name: 'issue URL', body: 'Resolves https://github.com/o/r/issues/4', want: [closing(4, 'o', 'r')] },
  { name: 'issue URL with a comment anchor', body: 'see https://github.com/o/r/issues/5#issuecomment-99', want: [mention(5, 'o', 'r')] },
  { name: 'bare #n is a mention', body: 'Related to #7, follow-up of #8.', want: [mention(7), mention(8)] },
  { name: 'GH-n is a mention', body: 'Context in GH-21', want: [mention(21)] },
  { name: 'only the ref right after a keyword closes', body: 'Fixes #1, #2', want: [closing(1), mention(2)] },
  { name: 'keyword followed by other words does not close', body: 'fixes the bug from #3', want: [mention(3)] },
  { name: 'keyword must be a whole word', body: 'prefixes #3 and unfixed #4', want: [mention(3), mention(4)] },
  { name: 'duplicates collapse, closing wins', body: 'See #5. Later: fixes #5. Also #5.', want: [closing(5)] },
  { name: 'refs inside a fenced code block are ignored', body: 'Intro\n```js\n// fixes #11\n```\nFixes #12', want: [closing(12)] },
  { name: 'tilde fences and longer fences', body: '~~~\nfixes #1\n~~~\n````\n```\nfixes #2\n````\ncloses #3', want: [closing(3)] },
  { name: 'unterminated fence hides the rest', body: 'closes #1\n```\nfixes #2', want: [closing(1)] },
  { name: 'indented code blocks are ignored', body: 'Intro\n\n    fixes #21\n\n\tcloses #22\n\nFixes #23', want: [closing(23)] },
  { name: 'an indented code block may start the body', body: '    fixes #24\nFixes #25', want: [closing(25)] },
  { name: 'an indented line inside a paragraph is not code', body: 'Intro text\n    fixes #26', want: [closing(26)] },
  { name: 'indented list continuations still count', body: '- item\n\n    fixes #27\n1. step\n\n   closes #28', want: [closing(27), closing(28)] },
  { name: 'backslash-escaped refs are not links', body: 'escaped \\#29 and \\GH-30 but #31', want: [mention(31)] },
  { name: 'inline code is ignored', body: 'Run `fixes #13` then ``closes #14`` but fixes #15', want: [closing(15)] },
  { name: 'block quotes are ignored', body: '> Fixes #16\n> > closes #17\nResolves #18', want: [closing(18)] },
  { name: 'HTML comments from PR templates are ignored', body: '<!-- Write "Fixes #123" here -->\nFixes #19\n<!-- unterminated fixes #20', want: [closing(19)] },
  { name: 'not refs: anchors, HTML entities, words, paths, zero', body: 'page.html#3 it&#39;s abc#4 #5abc a/b/c#6 #0 #12-beta', want: [] },
  { name: 'CRLF line endings', body: '```\r\nfixes #1\r\n```\r\nfixes #2', want: [closing(2)] },
  { name: 'numbers beyond the issue range are dropped', body: 'fixes #99999999999', want: [] },
];

for (const { name, body, want } of cases) {
  test(`findIssueRefs: ${name}`, () => {
    assert.deepEqual(findIssueRefs(body, context), want);
  });
}

test('extractLinkedIssues treats title refs as mentions and keeps order', () => {
  const pr = makePr({ title: 'Fix #30: crash on empty config', body: 'Fixes #31\n\nAlso see #30.' });
  assert.deepEqual(extractLinkedIssues(pr, pr), [mention(30), closing(31)]);
});

test('extractLinkedIssues upgrades a title mention when the body closes it', () => {
  const pr = makePr({ title: 'Handle #32', body: 'closes #32' });
  assert.deepEqual(extractLinkedIssues(pr, pr), [closing(32)]);
});

test('extractLinkedIssues matches the default fixture', () => {
  const pr = makePr();
  assert.deepEqual(extractLinkedIssues(pr, pr), pr.linkedIssues);
});

test('dedup ignores owner and repo case', () => {
  assert.deepEqual(findIssueRefs('ACME/Widgets#4 fixes acme/widgets#4', context), [closing(4, 'ACME', 'Widgets')]);
});

test('stripNonProse keeps line count and ordinary text', () => {
  const text = 'a\n```\ncode\n```\n> quote\nb `x` c';
  const stripped = stripNonProse(text);
  assert.equal(stripped.split('\n').length, text.split('\n').length);
  assert.match(stripped, /^a\n/);
  assert.match(stripped, /b {5}c$/);
});

test('long hostile input finishes quickly', () => {
  const backtickRuns = Array.from({ length: 5_000 }, (_, i) => `${'`'.repeat((i % 60) + 1)}a`).join(' ');
  const inputs = [
    `${'fixes '.repeat(20_000)}${'#'.repeat(20_000)}${'`'.repeat(20_000)}`,
    backtickRuns,
    '<!--'.repeat(50_000),
    `${'a/'.repeat(50_000)}#1`,
    `${'    x\n\n'.repeat(20_000)}fixes #1`,
  ];
  for (const body of inputs) {
    const started = performance.now();
    findIssueRefs(body, context);
    assert.ok(performance.now() - started < 1_000, `took too long on input starting ${JSON.stringify(body.slice(0, 12))}`);
  }
});
