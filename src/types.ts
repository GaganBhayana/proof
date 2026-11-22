/** How the PR author relates to the repository, as reported by GitHub. */
export type AuthorAssociation =
  | 'OWNER'
  | 'MEMBER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'NONE';

/** The PR author as PRoof sees it. */
export interface PrAuthor {
  readonly login: string;
  readonly association: AuthorAssociation;
  /**
   * True when this is the author's first PR to the repository.
   * Source of truth for fairness rules: the collector computes it from the
   * author's PR history, because `association` is coarse and can lag.
   */
  readonly isFirstTime: boolean;
  /** True for bot accounts such as `dependabot[bot]`. */
  readonly isBot: boolean;
}

/** One changed file in the PR. */
export interface PrFile {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  readonly additions: number;
  readonly deletions: number;
  /** Unified diff hunk text. GitHub omits it for large or binary files. */
  readonly patch?: string;
  /** Previous path for renamed files. */
  readonly previousPath?: string;
}

/** Strength of a link between the PR and an issue. */
export type LinkStrength = 'closing' | 'mention';

/** An issue the PR refers to. */
export interface LinkedIssueRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly strength: LinkStrength;
}

/**
 * Outcome of one CI check or status on the head commit.
 * GitHub reports a running check with `conclusion: null`; collectors map that to `'pending'`.
 */
export interface CheckOutcome {
  readonly name: string;
  readonly conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'pending';
}

/** Everything PRoof needs to evaluate a PR, gathered before any check runs. */
export interface PrSnapshot {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly author: PrAuthor;
  readonly baseSha: string;
  readonly headSha: string;
  readonly files: readonly PrFile[];
  readonly labels: readonly string[];
  readonly linkedIssues: readonly LinkedIssueRef[];
  readonly checks: readonly CheckOutcome[];
  /** Commit messages on the PR, oldest first. */
  readonly commitMessages: readonly string[];
}

/** An issue linked from the PR. */
export interface IssueSnapshot {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  readonly labels: readonly string[];
}

/** A pointer to the place that supports a check's conclusion. */
export interface Evidence {
  /** Plain-language description of what was observed. */
  readonly note: string;
  readonly file?: string;
  readonly line?: number;
  /** Short quoted text. Always treated as untrusted when rendered. */
  readonly quote?: string;
}

/** The outcome of one PRoof check. */
export interface CheckResult {
  /** Stable id such as `tests.added` or `rules.issue-required`. */
  readonly id: string;
  readonly passed: boolean;
  /** Points added to (positive) or removed from (negative) the score. */
  readonly points: number;
  readonly message: string;
  readonly evidence: readonly Evidence[];
}
