import type { Evidence } from '../types.ts';

/** A rule kind PRoof can check against a PR. */
export type RuleKind = 'issue-required' | 'tests-required' | 'dco-signoff' | 'changelog-entry' | 'single-topic';

/** A project rule found in CONTRIBUTING.md or the PR template, with the lines that state it. */
export interface TextRule {
  readonly kind: RuleKind;
  /** The sentences that state the rule, first one first; at most {@link MAX_EVIDENCE}. */
  readonly evidence: readonly Evidence[];
}

/** A section of the PR template that the author is expected to fill in. */
export interface TemplateSectionRule {
  readonly kind: 'template-section';
  /** Heading text, for example `Description`. */
  readonly section: string;
  /** The template's text under the heading, trimmed. A PR body that still has it was not filled in. */
  readonly placeholder: string;
  readonly evidence: readonly Evidence[];
}

/** Any rule returned by {@link extractContributingRules}. */
export type ContributingRule = TextRule | TemplateSectionRule;

/** A Markdown file and its repository path. */
export interface SourceDoc {
  readonly path: string;
  readonly text: string;
}

/** The files to read rules from. Either may be missing. */
export interface RuleSources {
  readonly contributing?: SourceDoc;
  readonly prTemplate?: SourceDoc;
}

/** Most evidence entries kept per rule. */
export const MAX_EVIDENCE = 3;
/** Quotes in evidence are cut to this many characters. */
export const MAX_QUOTE_LENGTH = 200;
/** Only this much of each file is read, so a huge file cannot slow the check down. */
export const MAX_SOURCE_LENGTH = 200_000;
/** Longer sentences are cut before matching, which keeps the patterns fast on hostile input. */
export const MAX_SENTENCE_LENGTH = 1_000;

/** Every text rule kind, in the order rules are returned. */
export const RULE_KINDS: readonly RuleKind[] = ['issue-required', 'tests-required', 'dco-signoff', 'changelog-entry', 'single-topic'];

const REQUIREMENT =
  /\b(?:must|required?|requires|need(?:s)? to|should|please|always|make sure|ensure|every|each|only (?:accept|merge|review)|mandatory|expected to)\b/i;
const NEGATION =
  /\b(?:not (?:required|necessary|needed|mandatory)|no need|don'?t (?:need|have) to|do not need|doesn'?t need|optional|maintainers? (?:will|handle|update|write|take care|add))\b/i;
const PR_CONTEXT =
  /\b(?:pull requests?|PRs?|before (?:you )?(?:start|begin|work|submit|open|send)|link(?:ed)?|reference[sd]?|associated|corresponding|tracking|approved|fixes|closes)\b/i;

const ISSUE = /\bissues?\b|#\d+/i;
const SECURITY = /\b(?:security|vulnerabilit)/i;
const TESTS = new RegExp(
  [
    String.raw`\b(?:add|adds|added|adding|include[sd]?|including|write|writing|written|cover(?:s|ed)?|accompan\w*|come with|update[sd]?)\b[^.]*\b(?:tests?|test cases?|specs?|coverage)\b`,
    String.raw`\b(?:tests?|test cases?) (?:for|covering)\b`,
    String.raw`\btests? (?:are|is) (?:required|mandatory|expected)\b`,
  ].join('|'),
  'i',
);
const DCO = new RegExp(
  [
    String.raw`\b(?:DCO|Developer Certificate of Origin|Signed-off-by)\b`,
    String.raw`--signoff\b`,
    String.raw`\bgit commit -s\b`,
    String.raw`\bsign(?:ed)?[- ]?off\b[^.]*\bcommits?\b`,
    String.raw`\bcommits?\b[^.]*\bsign(?:ed)?[- ]?off\b`,
  ].join('|'),
  'i',
);
const CHANGELOG = /\b(?:change ?log|release notes?|changesets?|news (?:entry|fragment)|towncrier)\b/i;
/** `CHANGES.md` and friends; case-sensitive so the word "changes" does not count. */
const CHANGES_FILE = /\bCHANGES(?:\.md|\.rst|\.txt)?\b/;
const CHANGELOG_ACTION = /\b(?:add|update|run|include|create|write|commit)\b/i;
const SINGLE_TOPIC = new RegExp(
  [
    String.raw`\bone (?:thing|change|topic|feature|fix|concern|issue|logical change) (?:per|in each|at a time)\b`,
    String.raw`\bsingle (?:topic|purpose|concern|logical change|feature|change)\b`,
    String.raw`\bunrelated changes\b`,
    String.raw`\bfocused\b`,
    String.raw`\bseparate (?:PRs|pull requests)\b`,
    String.raw`\bsplit (?:\w+ )?(?:changes|PRs|pull requests)\b`,
  ].join('|'),
  'i',
);

/**
 * How each rule kind is recognised in one sentence. `implied` is true for PR template
 * checklist items, which state a requirement without words like "must".
 */
const MATCHERS: Readonly<Record<RuleKind, (sentence: string, implied: boolean) => boolean>> = {
  'issue-required': (s, implied) =>
    ISSUE.test(s) && PR_CONTEXT.test(s) && !SECURITY.test(s) && (implied || REQUIREMENT.test(s)),
  'tests-required': (s, implied) => TESTS.test(s) && (implied || REQUIREMENT.test(s)),
  'dco-signoff': (s) => DCO.test(s),
  'changelog-entry': (s, implied) =>
    (CHANGELOG.test(s) || CHANGES_FILE.test(s)) && (implied || REQUIREMENT.test(s) || CHANGELOG_ACTION.test(s)),
  'single-topic': (s) => SINGLE_TOPIC.test(s),
};

/**
 * Reads CONTRIBUTING.md and the PR template and returns the rules PRoof can check:
 * issue required, tests required, DCO sign-off, changelog entry, one topic per PR,
 * and one `template-section` rule per template heading (headings marked optional are skipped).
 * Detection is by pattern, sentence by sentence; negated sentences ("tests are not required")
 * do not count. Code blocks and, in CONTRIBUTING.md, HTML comments are ignored. In the PR
 * template, comments and checklist items count, since authors see them while filling it in,
 * and a checklist item implies the requirement. Text rules come first, in {@link RULE_KINDS} order.
 */
export function extractContributingRules(sources: RuleSources): ContributingRule[] {
  const sentences = [
    ...(sources.contributing ? readSentences(sources.contributing, false) : []),
    ...(sources.prTemplate ? readSentences(sources.prTemplate, true) : []),
  ];
  const rules: ContributingRule[] = [];
  for (const kind of RULE_KINDS) {
    const evidence = sentences
      .filter((s) => !NEGATION.test(s.text) && MATCHERS[kind](s.text, s.implied))
      .slice(0, MAX_EVIDENCE)
      .map((s) => toEvidence(s, `states the ${kind} rule`));
    if (evidence.length > 0) rules.push({ kind, evidence });
  }
  if (sources.prTemplate) rules.push(...templateSections(sources.prTemplate));
  return rules;
}

interface Sentence {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  /** True for PR template checklist items, which imply a requirement. */
  readonly implied: boolean;
}

interface Part {
  readonly text: string;
  readonly line: number;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const TASK_ITEM = /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]+/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A setext heading underline or a thematic break: ends the current block. */
const UNDERLINE = /^ {0,3}(?:=+|-+|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/;

/**
 * Splits a Markdown file into sentences with their 1-based line numbers.
 * Paragraph lines are joined first, so a sentence wrapped over lines is still one sentence.
 */
function readSentences(doc: SourceDoc, isTemplate: boolean): Sentence[] {
  const lines = proseLines(doc.text, isTemplate);
  const out: Sentence[] = [];
  let block: Part[] = [];
  let implied = false;
  const flush = (): void => {
    if (block.length > 0) out.push(...splitSentences(doc.path, block, implied));
    block = [];
    implied = false;
  };
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '' || UNDERLINE.test(raw)) return flush();
    const heading = HEADING.exec(raw);
    if (heading) {
      flush();
      block = [{ text: heading[2] ?? '', line }];
      return flush();
    }
    if (LIST_ITEM.test(raw)) {
      flush();
      implied = isTemplate && TASK_ITEM.test(raw);
      block.push({ text: raw.replace(TASK_ITEM, '').replace(LIST_ITEM, ''), line });
      return;
    }
    block.push({ text: raw.trim(), line });
  });
  flush();
  return out;
}

/**
 * Splits one joined block at sentence ends: `.`, `!` or `?` followed by space and a capital,
 * except after `e.g.`, `i.e.`, `etc.`, `vs.` and `cf.`.
 */
function splitSentences(path: string, parts: readonly Part[], implied: boolean): Sentence[] {
  const starts: number[] = [];
  let joined = '';
  for (const part of parts) {
    if (joined !== '') joined += ' ';
    starts.push(joined.length);
    joined += part.text.trim();
  }
  const out: Sentence[] = [];
  for (const match of joined.matchAll(/\S.*?(?:(?<!\b(?:e\.g|i\.e|etc|vs|cf))[.!?](?=\s+["'(`[]?[A-Z])|$)/g)) {
    const text = match[0].replace(/`/g, '').trim().slice(0, MAX_SENTENCE_LENGTH);
    if (text === '') continue;
    let partIndex = 0;
    while (partIndex + 1 < starts.length && (starts[partIndex + 1] ?? Infinity) <= match.index) partIndex += 1;
    out.push({ path, line: parts[partIndex]?.line ?? 1, text, implied });
  }
  return out;
}

/**
 * Returns the file's lines with fenced code blanked. HTML comments are blanked too,
 * unless `keepComments`, in which case only the comment markers are removed.
 * Line count is kept, so line numbers stay right.
 */
function proseLines(text: string, keepComments: boolean): string[] {
  const capped = text.length > MAX_SOURCE_LENGTH ? text.slice(0, MAX_SOURCE_LENGTH) : text;
  const uncommented = capped.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) =>
    keepComments ? comment.replace(/<!--|-->/g, (m) => ' '.repeat(m.length)) : comment.replace(/[^\n]/g, ' '),
  );
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of uncommented.split(/\r?\n/)) {
    const run = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length && line.trim() === run) fence = undefined;
      out.push('');
    } else if (run !== undefined) {
      fence = run;
      out.push('');
    } else out.push(line);
  }
  return out;
}

/** One `template-section` rule per ATX heading in the PR template, except headings marked optional. */
function templateSections(doc: SourceDoc): TemplateSectionRule[] {
  const original = doc.text.slice(0, MAX_SOURCE_LENGTH).split(/\r?\n/);
  const visible = proseLines(doc.text, false);
  const headings: { line: number; title: string }[] = [];
  visible.forEach((raw, index) => {
    const match = HEADING.exec(raw);
    if (match && (match[2] ?? '').trim() !== '') headings.push({ line: index + 1, title: (match[2] ?? '').trim() });
  });
  return headings
    .map((heading, i) => {
      const end = headings[i + 1]?.line ?? original.length + 1;
      return { ...heading, placeholder: original.slice(heading.line, end - 1).join('\n').trim() };
    })
    .filter((heading) => !/\boptional\b/i.test(heading.title))
    .map((heading) => ({
      kind: 'template-section' as const,
      section: heading.title,
      placeholder: heading.placeholder,
      evidence: [
        toEvidence({ path: doc.path, line: heading.line, text: heading.title, implied: true }, 'has a section to fill in'),
      ],
    }));
}

function toEvidence(sentence: Sentence, what: string): Evidence {
  return {
    note: `${sentence.path} line ${sentence.line} ${what}`,
    file: sentence.path,
    line: sentence.line,
    quote: cut(sentence.text),
  };
}

/** Cuts text to {@link MAX_QUOTE_LENGTH} without splitting a surrogate pair. */
function cut(text: string): string {
  if (text.length <= MAX_QUOTE_LENGTH) return text;
  const chars = Array.from(text.slice(0, MAX_QUOTE_LENGTH));
  if (chars.length > 0 && /[\uD800-\uDBFF]$/.test(chars[chars.length - 1] ?? '')) chars.pop();
  return `${chars.join('')}…`;
}
