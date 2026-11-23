import type { LinkedIssueRef } from '../types.ts';

/** The repository the PR belongs to; bare `#n` references resolve against it. */
export interface RepoContext {
  readonly owner: string;
  readonly repo: string;
}

/** The PR text that can link issues. A `PrSnapshot` satisfies this. */
export interface LinkSource {
  readonly title: string;
  readonly body: string;
}

const KEYWORD = String.raw`(?<kw>\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?::[ \t]*|[ \t]+))?`;
const URL_REF = String.raw`https?://github\.com/(?<uo>[A-Za-z0-9][A-Za-z0-9-]{0,38})/(?<ur>[\w.-]{1,100})/issues/(?<un>\d+)(?!\w)`;
const SHORT_REF = String.raw`(?<![\w/&#.-])(?:(?<o>[A-Za-z0-9][A-Za-z0-9-]{0,38})/(?<r>[\w.-]{1,100}))?#(?<n>\d+)(?![\w-])`;
const GH_REF = String.raw`(?<![\w-])GH-(?<gn>\d+)(?![\w-])`;
const REFERENCE = new RegExp(`${KEYWORD}(?:${URL_REF}|${SHORT_REF}|${GH_REF})`, 'gi');

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const MAX_ISSUE_NUMBER = 2 ** 31 - 1;

/**
 * Finds issues linked from a PR's title and body, in order of first appearance, without duplicates.
 * Closing keywords (`fixes #12`, `closes o/r#3`, `resolves <issue URL>`) give `closing` links,
 * other references give `mention`. As on GitHub, keywords only close from the body, so every
 * title reference is a `mention`. Code, quotes and HTML comments are ignored.
 */
export function extractLinkedIssues(source: LinkSource, context: RepoContext): LinkedIssueRef[] {
  const fromTitle = findIssueRefs(source.title, context).map((ref) => ({ ...ref, strength: 'mention' as const }));
  return mergeRefs([...fromTitle, ...findIssueRefs(source.body, context)]);
}

/** Finds issue references in one Markdown text. See {@link extractLinkedIssues}. */
export function findIssueRefs(text: string, context: RepoContext): LinkedIssueRef[] {
  const refs: LinkedIssueRef[] = [];
  for (const match of stripNonProse(text).matchAll(REFERENCE)) {
    const g = match.groups ?? {};
    const number = Number(g['un'] ?? g['n'] ?? g['gn']);
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_ISSUE_NUMBER) continue;
    refs.push({
      owner: g['uo'] ?? g['o'] ?? context.owner,
      repo: g['ur'] ?? g['r'] ?? context.repo,
      number,
      strength: g['kw'] === undefined ? 'mention' : 'closing',
    });
  }
  return mergeRefs(refs);
}

/**
 * Blanks out text where references must not count: fenced code blocks, inline code,
 * block quotes and HTML comments. Line breaks are kept so later steps can still count lines.
 */
export function stripNonProse(text: string): string {
  const withoutComments = text.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of withoutComments.split(/\r?\n/)) {
    const open = FENCE_OPEN.exec(line)?.[1];
    if (fence !== undefined) {
      if (open !== undefined && open[0] === fence[0] && open.length >= fence.length && line.trim() === open) fence = undefined;
      out.push('');
    } else if (open !== undefined) {
      fence = open;
      out.push('');
    } else if (/^ {0,3}>/.test(line)) {
      out.push('');
    } else {
      out.push(line.replace(/(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g, (code) => ' '.repeat(code.length)));
    }
  }
  return out.join('\n');
}

/** Keeps the first occurrence of each issue; a later closing reference upgrades a mention. */
function mergeRefs(refs: readonly LinkedIssueRef[]): LinkedIssueRef[] {
  const byKey = new Map<string, LinkedIssueRef>();
  for (const ref of refs) {
    const key = `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
    const seen = byKey.get(key);
    if (seen === undefined) byKey.set(key, ref);
    else if (seen.strength === 'mention' && ref.strength === 'closing') byKey.set(key, { ...seen, strength: 'closing' });
  }
  return [...byKey.values()];
}
