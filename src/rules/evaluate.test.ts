import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CheckResult, PrSnapshot } from '../types.ts';
import { extractContributingRules, type ContributingRule, type RuleKind, type TextRule } from './contributing.ts';
import {
  evaluateRules,
  isChangelogPath,
  MAX_OBSERVATIONS,
  MAX_QUOTE_LENGTH,
  RULE_VIOLATION_POINTS,
  TEMPLATE_SECTIONS_ID,
} from './evaluate.ts';
import { makeFile, makePr } from '../../test/fixtures/pr.ts';

const textRule = (kind: RuleKind): TextRule => ({
  kind,
  evidence: [{ note: `CONTRIBUTING.md line 3 states the ${kind} rule`, file: 'CONTRIBUTING.md', line: 3, quote: 'Rule.' }],
});

/** Evaluates one text rule and returns its single result. */
const one = (kind: RuleKind, pr: PrSnapshot): CheckResult => {
  const results = evaluateRules([textRule(kind)], pr);
  assert.equal(results.length, 1);
  return results[0] as CheckResult;
};

const notes = (r: CheckResult): string[] => r.evidence.map((e) => e.note);

function assertPass(r: CheckResult): void {
  assert.equal(r.passed, true, r.message);
  assert.equal(r.points, 0);
}

function assertFail(r: CheckResult): void {
  assert.equal(r.passed, false, r.message);
  assert.equal(r.points, RULE_VIOLATION_POINTS);
}

const signed = (subject: string): string => `${subject}\n\nSigned-off-by: Ada Lovelace <ada@example.com>`;

// issue-required

test('issue-required passes with a closing link and lists it as evidence', () => {
  const r = one('issue-required', makePr());
  assertPass(r);
  assert.equal(r.id, 'rules.issue-required');
  assert.deepEqual(notes(r), ['CONTRIBUTING.md line 3 states the issue-required rule', 'Closes acme/widgets#12']);
});

test('issue-required fails when no issue is linked', () => {
  const r = one('issue-required', makePr({ body: 'Small fix.', linkedIssues: [] }));
  assertFail(r);
  assert.match(r.message, /links none/);
});

test('issue-required passes on a bare mention but says no closing keyword was used', () => {
  const r = one(
    'issue-required',
    makePr({ body: 'See #12', linkedIssues: [{ owner: 'acme', repo: 'widgets', number: 12, strength: 'mention' }] }),
  );
  assertPass(r);
  assert.match(r.message, /no closing keyword/);
  assert.ok(notes(r).includes('Mentions acme/widgets#12'));
});

// tests-required

test('tests-required passes when a test file changes', () => {
  const r = one('tests-required', makePr());
  assertPass(r);
  assert.deepEqual(r.evidence.at(-1), { note: 'Test file modified', file: 'src/config.test.ts' });
});

test('tests-required counts added test files', () => {
  const r = one('tests-required', makePr({ files: [makeFile('src/a.ts'), makeFile('tests/test_a.py', { status: 'added' })] }));
  assertPass(r);
  assert.match(r.message, /1 test file\./);
});

test('tests-required fails when source changes without tests', () => {
  const r = one('tests-required', makePr({ files: [makeFile('src/config.ts')] }));
  assertFail(r);
  assert.ok(notes(r).includes('No test file was added or modified'));
});

test('tests-required fails when the only test change is a deletion', () => {
  const r = one('tests-required', makePr({ files: [makeFile('src/a.ts'), makeFile('src/a.test.ts', { status: 'removed' })] }));
  assertFail(r);
});

test('tests-required passes for a docs-only PR', () => {
  const r = one('tests-required', makePr({ files: [makeFile('README.md'), makeFile('docs/guide.md')] }));
  assertPass(r);
  assert.match(r.message, /no source files/);
});

// dco-signoff

test('dco-signoff passes when every commit is signed off', () => {
  const r = one('dco-signoff', makePr({ commitMessages: [signed('fix: a'), signed('test: b')] }));
  assertPass(r);
  assert.equal(r.message, 'All 2 commits are signed off.');
});

test('dco-signoff accepts any letter case and trailing spaces', () => {
  const r = one('dco-signoff', makePr({ commitMessages: ['fix: a\n\nsigned-off-by: Ada <ada@example.com>  '] }));
  assertPass(r);
});

test('dco-signoff fails and quotes the unsigned commit subjects', () => {
  const r = one('dco-signoff', makePr({ commitMessages: [signed('fix: a'), 'test: b\n\nbody'] }));
  assertFail(r);
  assert.equal(r.message, '1 of 2 commits lack a Signed-off-by line (use git commit -s).');
  assert.deepEqual(r.evidence.at(-1), { note: 'Commit 2 of 2 has no Signed-off-by line', quote: 'test: b' });
});

test('dco-signoff rejects a sign-off without an email or inside the subject', () => {
  const noEmail = one('dco-signoff', makePr({ commitMessages: ['fix: a\n\nSigned-off-by: Ada'] }));
  assertFail(noEmail);
  const inline = one('dco-signoff', makePr({ commitMessages: ['fix: a Signed-off-by: Ada <ada@example.com>'] }));
  assertFail(inline);
});

test('dco-signoff caps listed commits and counts the rest', () => {
  const messages = Array.from({ length: MAX_OBSERVATIONS + 3 }, (_, i) => `chore: ${i}`);
  const r = one('dco-signoff', makePr({ commitMessages: messages }));
  assertFail(r);
  // The rule's own evidence, the capped list, and one "and N more" line.
  assert.equal(r.evidence.length, 1 + MAX_OBSERVATIONS + 1);
  assert.equal(r.evidence.at(-1)?.note, 'and 3 more unsigned commits');
});

test('dco-signoff cuts long hostile subjects', () => {
  const r = one('dco-signoff', makePr({ commitMessages: ['x'.repeat(5_000)] }));
  const quote = r.evidence.at(-1)?.quote ?? '';
  assert.equal(quote.length, MAX_QUOTE_LENGTH + 1);
  assert.ok(quote.endsWith('…'));
});

test('dco-signoff does not penalise when commit messages are unavailable', () => {
  const r = one('dco-signoff', makePr({ commitMessages: [] }));
  assertPass(r);
  assert.match(r.message, /not checked/);
});

// changelog-entry

test('changelog-entry passes when CHANGELOG.md is touched', () => {
  const r = one('changelog-entry', makePr({ files: [makeFile('src/a.ts'), makeFile('CHANGELOG.md')] }));
  assertPass(r);
  assert.deepEqual(r.evidence.at(-1), { note: 'Changelog touched', file: 'CHANGELOG.md' });
});

test('changelog-entry accepts changeset and towncrier fragments', () => {
  for (const path of ['.changeset/brave-dogs-run.md', 'newsfragments/123.bugfix', 'changelog.d/added.md', 'packages/x/CHANGES.rst']) {
    assertPass(one('changelog-entry', makePr({ files: [makeFile('src/a.ts'), makeFile(path, { status: 'added' })] })));
  }
});

test('changelog-entry fails when source changes without a changelog', () => {
  const r = one('changelog-entry', makePr());
  assertFail(r);
  assert.ok(notes(r).includes('No changelog file or fragment in the changed files'));
});

test('changelog-entry does not count a deleted changelog', () => {
  const r = one('changelog-entry', makePr({ files: [makeFile('src/a.ts'), makeFile('CHANGELOG.md', { status: 'removed' })] }));
  assertFail(r);
});

test('changelog-entry passes for a docs-only PR', () => {
  assertPass(one('changelog-entry', makePr({ files: [makeFile('docs/intro.md')] })));
});

test('a changelog-only PR needs no tests, even for fragments classified as source', () => {
  // `newsfragments/12.bugfix` and `NEWS` have no known extension, so classifyPath calls them source.
  const pr = makePr({ files: [makeFile('newsfragments/12.bugfix', { status: 'added' }), makeFile('NEWS')] });
  const tests = one('tests-required', pr);
  assertPass(tests);
  assert.match(tests.message, /no source files/);
  assertPass(one('changelog-entry', pr));
});

test('a fragment does not stand in for source next to real source changes', () => {
  const pr = makePr({ files: [makeFile('src/a.ts'), makeFile('newsfragments/12.bugfix', { status: 'added' })] });
  assertFail(one('tests-required', pr));
  assertPass(one('changelog-entry', pr));
});

test('isChangelogPath: names and fragment folders, but not look-alike source files', () => {
  const yes = ['CHANGELOG.md', 'changelog', 'HISTORY.rst', 'NEWS', 'docs/RELEASE_NOTES.md', 'changes/42.feature.md', 'news/1.bugfix'];
  const no = ['src/news.ts', 'src/changes/diff.ts', 'lib/history.js', 'src/changelog/render.ts', 'docs/changes-guide.md'];
  for (const path of yes) assert.equal(isChangelogPath(path), true, path);
  for (const path of no) assert.equal(isChangelogPath(path), false, path);
});

// single-topic and rule lists

test('single-topic gives no result because it cannot be checked from the PR alone', () => {
  assert.deepEqual(evaluateRules([textRule('single-topic')], makePr()), []);
});

test('no rules give no results, and a repeated rule kind is checked once', () => {
  assert.deepEqual(evaluateRules([], makePr()), []);
  const results = evaluateRules([textRule('issue-required'), textRule('issue-required')], makePr());
  assert.equal(results.length, 1);
});

// template sections

const templateText = readFileSync(
  new URL('../../test/fixtures/contributing/pull_request_template.md', import.meta.url),
  'utf8',
);
const templateRules: ContributingRule[] = extractContributingRules({
  prTemplate: { path: '.github/pull_request_template.md', text: templateText },
}).filter((rule) => rule.kind === 'template-section');

const sectionsResult = (body: string): CheckResult => {
  const result = evaluateRules(templateRules, makePr({ body })).find((r) => r.id === TEMPLATE_SECTIONS_ID);
  assert.ok(result);
  return result;
};

const filledBody = [
  '## Description',
  '',
  'Falls back to defaults when the config file is empty.',
  '',
  '## Related issue',
  '',
  'Fixes #12',
  '',
  '## How was this tested?',
  '',
  'Added a unit test for an empty file.',
  '',
  '## Checklist',
  '',
  '- [x] I have added tests for my change',
  '- [ ] I have added an entry to CHANGELOG.md',
  '- [ ] My commits are signed off (`git commit -s`)',
].join('\n');

test('template fixture yields the four required sections', () => {
  assert.deepEqual(
    templateRules.map((r) => (r.kind === 'template-section' ? r.section : '')),
    ['Description', 'Related issue', 'How was this tested?', 'Checklist'],
  );
});

test('template sections pass when every section is filled in', () => {
  const r = sectionsResult(filledBody);
  assertPass(r);
  assert.equal(r.message, 'All 4 PR template sections are filled in.');
});

test('the untouched template fails every section, as one result', () => {
  const r = sectionsResult(templateText);
  assertFail(r);
  assert.equal(r.message, '4 of 4 PR template sections are not filled in.');
  assert.deepEqual(notes(r), [
    'The "Description" section is empty',
    'The "Related issue" section still holds the template text',
    'The "How was this tested?" section is empty',
    'The "Checklist" section still holds the template text',
  ]);
  assert.deepEqual(r.evidence[0], {
    note: 'The "Description" section is empty',
    file: '.github/pull_request_template.md',
    line: 1,
    quote: 'Description',
  });
});

test('a section left with only the template comment counts as empty', () => {
  const body = filledBody.replace(
    'Falls back to defaults when the config file is empty.',
    '<!-- What does this PR do and why? -->',
  );
  const r = sectionsResult(body);
  assertFail(r);
  assert.deepEqual(notes(r), ['The "Description" section is empty']);
});

test('a removed section is reported as missing', () => {
  const body = filledBody.replace('## How was this tested?\n\nAdded a unit test for an empty file.\n\n', '');
  assert.deepEqual(notes(sectionsResult(body)), ['The PR body has no "How was this tested?" section']);
});

test('headings match regardless of level, case, spacing and a trailing colon', () => {
  const body = filledBody.replace('## Description', '### DESCRIPTION:').replace('## Related issue', '#  related   issue');
  assertPass(sectionsResult(body));
});

test('a heading inside a code fence does not count as the section', () => {
  const body = filledBody.replace(
    '## How was this tested?\n\nAdded a unit test for an empty file.',
    '```md\n## How was this tested?\nlooks tested\n```',
  );
  const r = sectionsResult(body);
  assert.ok(notes(r).includes('The PR body has no "How was this tested?" section'));
});

test('a heading with only subheadings under it is a group, not an empty section', () => {
  const groupRules = extractContributingRules({
    prTemplate: { path: '.github/pull_request_template.md', text: '## Changes\n\n### Added\n\n### Removed\n' },
  }).filter((rule) => rule.kind === 'template-section');
  const check = (body: string): CheckResult => evaluateRules(groupRules, makePr({ body }))[0] as CheckResult;
  assertPass(check('## Changes\n\n### Added\n\nA flag.\n\n### Removed\n\nAn old option.\n'));
  // The subsections are still checked on their own.
  assert.deepEqual(notes(check('## Changes\n\n### Added\n\nA flag.\n\n### Removed\n')), ['The "Removed" section is empty']);
  // A same-level heading after an empty section does not make it a group.
  assert.deepEqual(notes(check('## Changes\n\n## Added\n\nA flag.\n\n### Removed\n\nx\n')), ['The "Changes" section is empty']);
});

test('closing # runs are stripped from headings, as in the template', () => {
  assertPass(sectionsResult(filledBody.replace('## Description', '## Description ##')));
});

test('a hostile heading line in the body is parsed in linear time', () => {
  const hostile = `# x${' #'.repeat(40_000)}y`;
  const started = performance.now();
  const r = sectionsResult(`${hostile}\n\n${filledBody}`);
  assert.ok(performance.now() - started < 500, 'heading parsing must not backtrack');
  assertPass(r);
});

test('CRLF bodies are read like LF bodies', () => {
  assertPass(sectionsResult(filledBody.replace(/\n/g, '\r\n')));
});

test('an empty body fails every section as missing', () => {
  const r = sectionsResult('');
  assertFail(r);
  assert.ok(notes(r).every((note) => note.startsWith('The PR body has no')));
});

test('results come in rule order with the template result last', () => {
  const rules = [textRule('changelog-entry'), ...templateRules, textRule('issue-required'), textRule('tests-required')];
  const ids = evaluateRules(rules, makePr({ body: filledBody })).map((r) => r.id);
  assert.deepEqual(ids, ['rules.changelog-entry', 'rules.issue-required', 'rules.tests-required', TEMPLATE_SECTIONS_ID]);
});

test('end to end: rules extracted from CONTRIBUTING.md and the template', () => {
  const rules = extractContributingRules({
    contributing: {
      path: 'CONTRIBUTING.md',
      text: 'Every pull request must be linked to an open issue.\n\nAll commits must be signed off with git commit -s.\n',
    },
    prTemplate: { path: '.github/pull_request_template.md', text: templateText },
  });
  const results = evaluateRules(rules, makePr({ body: filledBody, commitMessages: ['fix: a'] }));
  const byId = new Map(results.map((r) => [r.id, r.passed]));
  assert.equal(byId.get('rules.issue-required'), true);
  assert.equal(byId.get('rules.tests-required'), true);
  assert.equal(byId.get('rules.dco-signoff'), false);
  assert.equal(byId.get('rules.changelog-entry'), false);
  assert.equal(byId.get(TEMPLATE_SECTIONS_ID), true);
});
