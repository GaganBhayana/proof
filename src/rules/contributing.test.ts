import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractContributingRules,
  MAX_EVIDENCE,
  MAX_QUOTE_LENGTH,
  type ContributingRule,
  type RuleKind,
  type TemplateSectionRule,
} from './contributing.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../test/fixtures/contributing/${name}`, import.meta.url), 'utf8');

const fromContributing = (text: string): ContributingRule[] =>
  extractContributingRules({ contributing: { path: 'CONTRIBUTING.md', text } });

/** `kind@line` for each rule, using the first evidence line. */
const summary = (rules: readonly ContributingRule[]): string[] =>
  rules.map((rule) => `${rule.kind}@${rule.evidence[0]?.line}`);

const kinds = (rules: readonly ContributingRule[]): RuleKind[] =>
  rules.flatMap((rule) => (rule.kind === 'template-section' ? [] : [rule.kind]));

const fixtureCases: ReadonlyArray<[string, string[]]> = [
  ['node-library.md', ['issue-required@7', 'tests-required@16', 'changelog-entry@26']],
  ['python-dco.md', ['tests-required@16', 'dco-signoff@4']],
  ['go-service.md', ['single-topic@10']],
  ['docs-site.md', []],
  ['rust-crate.md', ['issue-required@5', 'tests-required@10', 'changelog-entry@15', 'single-topic@6']],
];

for (const [name, expected] of fixtureCases) {
  test(`fixture ${name}`, () => {
    assert.deepEqual(summary(fromContributing(fixture(name))), expected);
  });
}

test('evidence carries the file, line and quoted sentence', () => {
  const [rule] = fromContributing(fixture('node-library.md'));
  assert.deepEqual(rule?.evidence, [
    {
      note: 'CONTRIBUTING.md line 7 states the issue-required rule',
      file: 'CONTRIBUTING.md',
      line: 7,
      quote: 'Every pull request must be linked to an open issue.',
    },
  ]);
});

test('python fixture: negated tests and changelog sentences do not count', () => {
  const rules = fromContributing(fixture('python-dco.md'));
  assert.equal(rules.find((r) => r.kind === 'tests-required')?.evidence.length, 1);
  assert.ok(!kinds(rules).includes('changelog-entry'));
  assert.deepEqual(
    rules.find((r) => r.kind === 'dco-signoff')?.evidence.map((e) => e.line),
    [4, 10, 10],
  );
});

test('PR template: checklist items imply rules and comments count', () => {
  const rules = extractContributingRules({
    prTemplate: { path: '.github/pull_request_template.md', text: fixture('pull_request_template.md') },
  });
  assert.deepEqual(summary(rules), [
    'issue-required@7',
    'tests-required@16',
    'dco-signoff@18',
    'changelog-entry@17',
    'template-section@1',
    'template-section@5',
    'template-section@10',
    'template-section@14',
  ]);
  assert.equal(rules[0]?.evidence[0]?.quote, 'Please link the issue this PR fixes, e.g. "Fixes #123".');
});

test('PR template sections keep their placeholder text and skip optional ones', () => {
  const sections = extractContributingRules({
    prTemplate: { path: 'PULL_REQUEST_TEMPLATE.md', text: fixture('pull_request_template.md') },
  }).filter((rule): rule is TemplateSectionRule => rule.kind === 'template-section');
  assert.deepEqual(
    sections.map((s) => [s.section, s.placeholder]),
    [
      ['Description', '<!-- What does this PR do and why? -->'],
      ['Related issue', '<!-- Please link the issue this PR fixes, e.g. "Fixes #123". -->\nFixes #'],
      ['How was this tested?', ''],
      [
        'Checklist',
        '- [ ] I have added tests for my change\n- [ ] I have added an entry to CHANGELOG.md\n- [ ] My commits are signed off (`git commit -s`)',
      ],
    ],
  );
});

test('a template without headings or rules gives nothing', () => {
  assert.deepEqual(extractContributingRules({ prTemplate: { path: 't.md', text: fixture('plain_template.md') } }), []);
});

test('no sources gives no rules', () => {
  assert.deepEqual(extractContributingRules({}), []);
});

test('CONTRIBUTING rules come before template rules of the same kind', () => {
  const rules = extractContributingRules({
    contributing: { path: 'CONTRIBUTING.md', text: 'All new code must include tests.' },
    prTemplate: { path: 'template.md', text: '- [ ] I added tests for this' },
  });
  assert.deepEqual(
    rules.map((r) => r.evidence.map((e) => `${e.file}:${e.line}`)),
    [['CONTRIBUTING.md:1', 'template.md:1']],
  );
});

const sentenceCases: ReadonlyArray<[string, RuleKind[]]> = [
  ['Please open an issue before you start work on a large change.', ['issue-required']],
  ['PRs must reference the issue they fix.', ['issue-required']],
  ['If you find a bug, please open an issue.', []],
  ['Security issues should be reported privately, not in a pull request.', []],
  ['You do not need to link an issue for typo fixes.', []],
  ['Make sure all tests pass before you push.', []],
  ['Please add unit tests for new features.', ['tests-required']],
  ['Tests are required for every pull request.', ['tests-required']],
  ['Tests are not required for every pull request.', []],
  ['Every change should be covered by tests.', ['tests-required']],
  ['Tests are optional for docs changes.', []],
  ['We require a DCO sign-off on every commit.', ['dco-signoff']],
  ['Please sign off your commits.', ['dco-signoff']],
  ['Changes need sign-off from two maintainers.', []],
  ['Update the changelog with your change.', ['changelog-entry']],
  ['Add a news fragment in newsfragments/ for user-facing changes.', ['changelog-entry']],
  ['Maintainers will update the changelog.', []],
  ['These changes are reviewed weekly.', []],
  ['Keep pull requests small and focused.', ['single-topic']],
  ['Please do one thing per pull request.', ['single-topic']],
  ['Avoid unrelated changes in your PR.', ['single-topic']],
  // "don't require" waives a rule even though it contains "require"
  ["We don't require tests for documentation changes.", []],
  ['We do not require a DCO sign-off.', []],
  ['Tests aren’t required for docs.', []],
  ['We never require an issue for typo fixes.', []],
  // a verb only pairs with "tests" a few words away
  ['Please write a clear description and make sure the tests pass.', []],
  ['Please update the README and run the linter before you push the tests.', []],
  ['Please add unit and integration tests for new features.', ['tests-required']],
  ['New code must be accompanied by appropriate unit tests.', ['tests-required']],
  ['Releases need sign-off from two maintainers, who then tag the release commit.', []],
  // negation and the security exclusion apply per clause
  ["You don't need to open an issue for typo fixes, but all other PRs must reference an issue.", ['issue-required']],
  ['Please add tests for new code; benchmarks are optional.', ['tests-required']],
  ['Every pull request must reference an issue, except security fixes.', ['issue-required']],
  ['Tests are welcome but optional.', []],
];

for (const [sentence, expected] of sentenceCases) {
  test(`sentence: ${sentence}`, () => {
    assert.deepEqual(kinds(fromContributing(sentence)), expected);
  });
}

test('a sentence wrapped over lines is matched and points at its first line', () => {
  const text = 'Intro line.\n\nAll pull requests\nmust include\ntests for new code.';
  assert.deepEqual(summary(fromContributing(text)), ['tests-required@3']);
});

test('fenced code and HTML comments in CONTRIBUTING.md are ignored', () => {
  const text = ['```', 'You must sign off every commit.', '```', '<!-- Please add tests', 'for everything. -->'].join('\n');
  assert.deepEqual(fromContributing(text), []);
});

test('CRLF line endings keep line numbers', () => {
  assert.deepEqual(summary(fromContributing('# Title\r\n\r\nPlease update the CHANGELOG.\r\n')), ['changelog-entry@3']);
});

test('evidence is capped per rule and long quotes are cut', () => {
  const many = Array.from({ length: 6 }, (_, i) => `Rule ${i}: you must sign off commits.`).join('\n\n');
  assert.equal(fromContributing(many)[0]?.evidence.length, MAX_EVIDENCE);
  const long = `Please add tests ${'for this very long reason '.repeat(20)}.`;
  const quote = fromContributing(long)[0]?.evidence[0]?.quote ?? '';
  assert.equal(quote.length, MAX_QUOTE_LENGTH + 1);
  assert.ok(quote.endsWith('…'));
});

test('a cut quote does not split a surrogate pair', () => {
  const text = `Please add tests ${'x'.repeat(MAX_QUOTE_LENGTH - 18)}😀😀 more.`;
  const quote = fromContributing(text)[0]?.evidence[0]?.quote ?? '';
  assert.ok(!/[\uD800-\uDBFF]…$/.test(quote));
});

test('hostile input stays fast', () => {
  const start = performance.now();
  fromContributing(`add ${'add '.repeat(100_000)} tests`);
  fromContributing('#'.repeat(300_000));
  fromContributing('- [ ] '.repeat(50_000));
  assert.ok(performance.now() - start < 2_000, 'took too long');
});

test('a clause-level match quotes the whole sentence', () => {
  const sentence = 'Benchmarks are optional, but please add tests for new code.';
  assert.equal(fromContributing(sentence)[0]?.evidence[0]?.quote, sentence);
});

test('template headings inside HTML comments or fenced code are not sections', () => {
  const text = ['## Summary', '', '<!--', '## Hidden', '-->', '```', '## Code', '```', '', '## Testing'].join('\n');
  const sections = extractContributingRules({ prTemplate: { path: 't.md', text } });
  assert.deepEqual(
    sections.map((rule) => (rule.kind === 'template-section' ? `${rule.section}@${rule.evidence[0]?.line}` : rule.kind)),
    ['Summary@1', 'Testing@10'],
  );
  const summarySection = sections[0];
  assert.equal(summarySection?.kind === 'template-section' ? summarySection.placeholder : undefined, '<!--\n## Hidden\n-->\n```\n## Code\n```');
});
