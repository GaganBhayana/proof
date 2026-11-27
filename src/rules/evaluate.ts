import type { CheckResult, Evidence, PrSnapshot } from '../types.ts';
import { classifyPath } from '../checks/scope.ts';
import { analyzeTests } from '../checks/tests.ts';
import type { ContributingRule, RuleKind, TemplateSectionRule, TextRule } from './contributing.ts';

/** Points a broken rule removes from the score. The scorer caps the total for all rules. */
export const RULE_VIOLATION_POINTS = -5;
/** Most observation entries (unsigned commits, unfilled sections) listed per result. */
export const MAX_OBSERVATIONS = 5;
/** Quotes taken from the PR are cut to this many characters. */
export const MAX_QUOTE_LENGTH = 120;
/** Only this much of the PR body is read when looking for template sections. */
export const MAX_BODY_LENGTH = 100_000;

/** Id of the single result that covers every template section rule. */
export const TEMPLATE_SECTIONS_ID = 'rules.template-sections';

/**
 * Checks the project's rules against a PR and returns one `CheckResult` per rule kind,
 * with id `rules.<kind>`: a linked issue is present, tests changed, every commit has a
 * `Signed-off-by:` trailer, a changelog file is touched. All `template-section` rules are
 * folded into one {@link TEMPLATE_SECTIONS_ID} result, so a long template cannot cost more
 * than one rule. `single-topic` returns no result: it cannot be checked from the PR alone.
 *
 * A broken rule costs {@link RULE_VIOLATION_POINTS}; a kept rule scores 0. The tests and
 * changelog rules pass when the PR changes no source files (a docs-only fix should not need
 * either); changelog files and fragments never count as source. Evidence lists where the
 * rule is stated, then what was observed.
 */
export function evaluateRules(rules: readonly ContributingRule[], pr: PrSnapshot): CheckResult[] {
  const results: CheckResult[] = [];
  const seen = new Set<RuleKind>();
  const sections: TemplateSectionRule[] = [];
  for (const rule of rules) {
    if (rule.kind === 'template-section') {
      sections.push(rule);
      continue;
    }
    if (seen.has(rule.kind)) continue;
    seen.add(rule.kind);
    const result = evaluateTextRule(rule, pr);
    if (result) results.push(result);
  }
  if (sections.length > 0) results.push(checkTemplateSections(sections, pr.body));
  return results;
}

function evaluateTextRule(rule: TextRule, pr: PrSnapshot): CheckResult | undefined {
  switch (rule.kind) {
    case 'issue-required':
      return checkIssueLinked(rule, pr);
    case 'tests-required':
      return checkTestsChanged(rule, pr);
    case 'dco-signoff':
      return checkSignedOff(rule, pr);
    case 'changelog-entry':
      return checkChangelog(rule, pr);
    case 'single-topic':
      return undefined;
  }
}

function result(rule: TextRule, passed: boolean, message: string, observed: readonly Evidence[]): CheckResult {
  return {
    id: `rules.${rule.kind}`,
    passed,
    points: passed ? 0 : RULE_VIOLATION_POINTS,
    message,
    evidence: [...rule.evidence, ...observed],
  };
}

function checkIssueLinked(rule: TextRule, pr: PrSnapshot): CheckResult {
  const issues = pr.linkedIssues;
  if (issues.length === 0) {
    return result(rule, false, 'The project asks for a linked issue, but the PR links none.', [
      { note: 'No issue reference found in the PR title or body' },
    ]);
  }
  const closing = issues.filter((issue) => issue.strength === 'closing');
  const observed = issues.slice(0, MAX_OBSERVATIONS).map((issue) => ({
    note: `${issue.strength === 'closing' ? 'Closes' : 'Mentions'} ${issue.owner}/${issue.repo}#${issue.number}`,
  }));
  const message =
    closing.length > 0
      ? 'The PR links the issue it fixes.'
      : 'The PR mentions an issue but uses no closing keyword such as "Fixes #12".';
  return result(rule, true, message, observed);
}

/** Changed source files. Changelog files and fragments are not source, even when `classifyPath` says so. */
function sourceFiles(pr: PrSnapshot): string[] {
  return pr.files
    .filter((file) => file.status !== 'unchanged' && classifyPath(file.path) === 'source' && !isChangelogPath(file.path))
    .map((f) => f.path);
}

function checkTestsChanged(rule: TextRule, pr: PrSnapshot): CheckResult {
  if (sourceFiles(pr).length === 0) {
    return result(rule, true, 'The PR changes no source files, so no tests are needed.', []);
  }
  const signals = analyzeTests(pr.files);
  const changed = [...signals.added, ...signals.modified];
  if (changed.length === 0) {
    return result(rule, false, 'The project asks for tests, but the PR changes source files without adding or updating any.', [
      { note: 'No test file was added or modified' },
    ]);
  }
  return result(
    rule,
    true,
    `The PR adds or updates ${changed.length} test file${changed.length === 1 ? '' : 's'}.`,
    changed.slice(0, MAX_OBSERVATIONS).map((t) => ({ note: `Test file ${t.change}`, file: t.path })),
  );
}

/** A `Signed-off-by:` trailer line with a name and an email address. */
const SIGN_OFF = /^[ \t]*signed-off-by:[ \t]*\S[^\n<]*<[^<>\s@]+@[^<>\s]+>[ \t]*$/im;

function checkSignedOff(rule: TextRule, pr: PrSnapshot): CheckResult {
  const messages = pr.commitMessages;
  if (messages.length === 0) {
    return result(rule, true, 'No commit messages were available, so sign-off was not checked.', []);
  }
  const unsigned = messages.map((text, index) => ({ text, index })).filter(({ text }) => !SIGN_OFF.test(text));
  if (unsigned.length === 0) {
    return result(rule, true, `All ${messages.length} commit${messages.length === 1 ? ' is' : 's are'} signed off.`, []);
  }
  const observed: Evidence[] = unsigned.slice(0, MAX_OBSERVATIONS).map(({ text, index }) => ({
    note: `Commit ${index + 1} of ${messages.length} has no Signed-off-by line`,
    quote: cut(subjectOf(text)),
  }));
  if (unsigned.length > MAX_OBSERVATIONS) {
    observed.push({ note: `and ${unsigned.length - MAX_OBSERVATIONS} more unsigned commits` });
  }
  return result(
    rule,
    false,
    `${unsigned.length} of ${messages.length} commit${messages.length === 1 ? '' : 's'} lack a Signed-off-by line (use git commit -s).`,
    observed,
  );
}

/** Changelog files by name, in a text format (so `src/news.ts` is not one). */
const CHANGELOG_NAME = /^(?:change[-_ ]?log|changes|history|news|release[-_ ]?notes)(?:\.(?:md|markdown|rst|txt|adoc))?$/i;
/** Directories of changelog fragments (changesets, towncrier) that count anywhere in the path. */
const FRAGMENT_DIRS = new Set(['.changeset', '.changesets', 'changelog.d', 'newsfragments']);
/** Fragment directory names too common to trust below the repository root. */
const ROOT_FRAGMENT_DIRS = new Set(['changes', 'changelog', 'news']);

/** True when the path is a changelog file or a changelog fragment (changesets, towncrier). */
export function isChangelogPath(path: string): boolean {
  const parts = path.split('/').filter((part) => part !== '');
  const name = parts.pop() ?? '';
  if (CHANGELOG_NAME.test(name)) return true;
  const dirs = parts.map((dir) => dir.toLowerCase());
  return dirs.some((dir) => FRAGMENT_DIRS.has(dir)) || ROOT_FRAGMENT_DIRS.has(dirs[0] ?? '');
}

function checkChangelog(rule: TextRule, pr: PrSnapshot): CheckResult {
  if (sourceFiles(pr).length === 0) {
    return result(rule, true, 'The PR changes no source files, so no changelog entry is needed.', []);
  }
  const touched = pr.files.filter((file) => file.status !== 'removed' && file.status !== 'unchanged' && isChangelogPath(file.path));
  if (touched.length === 0) {
    return result(rule, false, 'The project asks for a changelog entry, but the PR does not touch a changelog.', [
      { note: 'No changelog file or fragment in the changed files' },
    ]);
  }
  return result(
    rule,
    true,
    'The PR adds a changelog entry.',
    touched.slice(0, MAX_OBSERVATIONS).map((file) => ({ note: 'Changelog touched', file: file.path })),
  );
}

/** Why a template section counts as not filled in. */
type Unfilled = 'missing' | 'empty' | 'placeholder';

function checkTemplateSections(rules: readonly TemplateSectionRule[], body: string): CheckResult {
  const found = bodySections(body);
  const unfilled: { rule: TemplateSectionRule; why: Unfilled }[] = [];
  for (const rule of rules) {
    const section = found.get(headingKey(rule.section));
    if (section === undefined) unfilled.push({ rule, why: 'missing' });
    else if (section.content === '') {
      // A heading with only subheadings under it groups them; they are checked on their own.
      if (!section.hasSubsections) unfilled.push({ rule, why: 'empty' });
    } else if (section.content === normalise(rule.placeholder)) unfilled.push({ rule, why: 'placeholder' });
  }
  const evidence: Evidence[] = unfilled.slice(0, MAX_OBSERVATIONS).map(({ rule, why }) => ({
    ...(rule.evidence[0] ?? { note: '' }),
    note: sectionNote(rule.section, why),
  }));
  if (unfilled.length > MAX_OBSERVATIONS) {
    evidence.push({ note: `and ${unfilled.length - MAX_OBSERVATIONS} more unfilled sections` });
  }
  const passed = unfilled.length === 0;
  return {
    id: TEMPLATE_SECTIONS_ID,
    passed,
    points: passed ? 0 : RULE_VIOLATION_POINTS,
    message: passed
      ? `All ${rules.length} PR template section${rules.length === 1 ? ' is' : 's are'} filled in.`
      : `${unfilled.length} of ${rules.length} PR template section${rules.length === 1 ? ' is' : 's are'} not filled in.`,
    evidence,
  };
}

function sectionNote(section: string, why: Unfilled): string {
  const name = `"${cut(section)}"`;
  if (why === 'missing') return `The PR body has no ${name} section`;
  if (why === 'empty') return `The ${name} section is empty`;
  return `The ${name} section still holds the template text`;
}

/** An ATX heading's opening run of `#` and the text after it. Linear on any input. */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A heading in the PR body: its level and its raw text without the closing `#` run. */
interface Heading {
  readonly level: number;
  readonly text: string;
}

/** Parses an ATX heading line, or returns undefined when the line is not one. */
function parseHeading(line: string): Heading | undefined {
  const match = HEADING.exec(line);
  if (!match) return undefined;
  const text = match[2] ?? '';
  // Strip trailing spaces, tabs and `#` with a loop: a regex like `(.*?)[ \t#]*$`
  // backtracks quadratically on a long run of " #" in an untrusted body.
  let end = text.length;
  while (end > 0 && ' \t#'.includes(text.charAt(end - 1))) end -= 1;
  return { level: (match[1] ?? '#').length, text: text.slice(0, end) };
}

/** The normalised text under a body heading, and whether a deeper heading follows it directly. */
interface BodySection {
  readonly content: string;
  readonly hasSubsections: boolean;
}

/**
 * Maps each ATX heading in the PR body (normalised, first occurrence wins) to the
 * normalised text under it, up to the next heading of any level. Headings inside
 * fenced code do not count.
 */
function bodySections(body: string): Map<string, BodySection> {
  const lines = body.slice(0, MAX_BODY_LENGTH).replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').split(/\r?\n/);
  const sections = new Map<string, BodySection>();
  let current: { key: string; level: number; lines: string[] } | undefined;
  const close = (next: Heading | undefined): void => {
    if (!current || sections.has(current.key)) return;
    const content = normalise(current.lines.join('\n'));
    const hasSubsections = content === '' && next !== undefined && next.level > current.level;
    sections.set(current.key, { content, hasSubsections });
  };
  let fence: string | undefined;
  for (const line of lines) {
    const run = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length && line.trim() === run) fence = undefined;
    } else if (run !== undefined) {
      fence = run;
    } else {
      const heading = parseHeading(line);
      if (heading) {
        close(heading);
        current = { key: headingKey(heading.text), level: heading.level, lines: [] };
        continue;
      }
    }
    current?.lines.push(line);
  }
  close(undefined);
  return sections;
}

/** Heading text compared case-insensitively, ignoring spacing and trailing colons. */
function headingKey(heading: string): string {
  return heading.replace(/\s+/g, ' ').replace(/[\s:]+$/, '').trim().toLowerCase();
}

/** Text with HTML comments removed and whitespace collapsed, for placeholder comparison. */
function normalise(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

function subjectOf(message: string): string {
  return message.trim().split(/\r?\n/, 1)[0] ?? '';
}

/** Cuts text to {@link MAX_QUOTE_LENGTH} without splitting a surrogate pair. */
function cut(text: string): string {
  if (text.length <= MAX_QUOTE_LENGTH) return text;
  let end = MAX_QUOTE_LENGTH;
  if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end -= 1;
  return `${text.slice(0, end)}…`;
}
