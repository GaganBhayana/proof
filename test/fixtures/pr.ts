import type { IssueSnapshot, PrAuthor, PrFile, PrSnapshot } from '../../src/types.ts';

/** Builds a PR author for tests. */
export function makeAuthor(overrides: Partial<PrAuthor> = {}): PrAuthor {
  return {
    login: 'octo-contributor',
    association: 'CONTRIBUTOR',
    isFirstTime: false,
    isBot: false,
    ...overrides,
  };
}

/** Builds a changed file for tests. */
export function makeFile(path: string, overrides: Partial<PrFile> = {}): PrFile {
  return { path, status: 'modified', additions: 1, deletions: 0, ...overrides };
}

/** Builds a PR snapshot with sensible defaults; override any field. */
export function makePr(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    owner: 'acme',
    repo: 'widgets',
    number: 42,
    title: 'Fix crash when the config file is empty',
    body: 'Fixes #12\n\nHandle an empty config file by falling back to defaults.',
    author: makeAuthor(),
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    files: [makeFile('src/config.ts', { additions: 8, deletions: 2 }), makeFile('src/config.test.ts', { additions: 20 })],
    labels: [],
    linkedIssues: [{ owner: 'acme', repo: 'widgets', number: 12, strength: 'closing' }],
    checks: [{ name: 'ci / test', conclusion: 'success' }],
    commitMessages: ['fix: handle empty config file'],
    ...overrides,
  };
}

/** Builds a linked issue for tests. */
export function makeIssue(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    owner: 'acme',
    repo: 'widgets',
    number: 12,
    title: 'Crash when config file is empty',
    body: 'Running `widgets build` with an empty widgets.config.json throws a TypeError in loadConfig.',
    state: 'open',
    labels: ['bug'],
    ...overrides,
  };
}
