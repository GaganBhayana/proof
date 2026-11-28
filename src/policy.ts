import type { AuthorAssociation, PrAuthor } from './types.ts';

/** Checks a repository can turn on or off in `.proof.yml`. */
export const CHECK_NAMES = ['linked-issue', 'match', 'scope', 'tests', 'rules', 'ci', 'reproduce', 'summary'] as const;
/** One of {@link CHECK_NAMES}. */
export type CheckName = (typeof CHECK_NAMES)[number];

/** Priorities PRoof assigns, best first. */
export const PRIORITIES = ['review-now', 'needs-info', 'low-evidence'] as const;
/** One of {@link PRIORITIES}. */
export type Priority = (typeof PRIORITIES)[number];

/**
 * Points each signal adds to (positive) or removes from (negative) the score of 50.
 * Bonuses must be 0 or above and penalties 0 or below; see {@link PENALTY_WEIGHTS}.
 */
export interface Weights {
  readonly linkedIssue: number;
  /** Upper end of the issue/diff match bonus (scaled by the 0–1 match). */
  readonly issueMatch: number;
  readonly testsAdded: number;
  readonly testsRemovedOrSkipped: number;
  readonly ciPassing: number;
  readonly ciFailing: number;
  /** Per broken project rule. */
  readonly ruleViolation: number;
  /** Floor for the total of all rule violations. */
  readonly rulesTotalMin: number;
  readonly unrelatedChurn: number;
  /** Repro fails on the base commit and passes on the head commit. */
  readonly reproVerified: number;
}

/** Which authors count as external; PRoof only triages their PRs. */
export interface ExternalAuthors {
  readonly associations: readonly AuthorAssociation[];
  /** Whether bot accounts are triaged. */
  readonly includeBots: boolean;
  /** Logins that are never triaged (compared case-insensitively). */
  readonly ignoreUsers: readonly string[];
}

/** Optional auto-close of `low-evidence` PRs. Off unless `enabled` and `confirm` are both true. */
export interface AutoClose {
  readonly enabled: boolean;
  readonly confirm: boolean;
}

/** A complete, validated `.proof.yml` policy. */
export interface Policy {
  readonly checks: Readonly<Record<CheckName, boolean>>;
  readonly weights: Weights;
  /** Lowest score for each priority above `low-evidence`. */
  readonly thresholds: Readonly<Record<'review-now' | 'needs-info', number>>;
  readonly labels: Readonly<Record<Priority, string>>;
  readonly external: ExternalAuthors;
  readonly autoClose: AutoClose;
}

/** One readable problem in a policy file, with the option's dotted path. */
export interface PolicyError {
  readonly path: string;
  readonly message: string;
}

/** Outcome of {@link parsePolicy}. */
export type PolicyResult = { readonly ok: true; readonly policy: Policy } | { readonly ok: false; readonly errors: readonly PolicyError[] };

/** GitHub's limit on label name length. */
export const MAX_LABEL_LENGTH = 50;
/** Weights must stay within this many points either way. */
export const MAX_WEIGHT = 100;
/** Most entries accepted in `external.ignoreUsers`. */
export const MAX_IGNORED_USERS = 200;
/** Weights that lower the score, so must be 0 or below. Every other weight is a bonus (0 or above). */
export const PENALTY_WEIGHTS: readonly (keyof Weights)[] = ['testsRemovedOrSkipped', 'ciFailing', 'ruleViolation', 'rulesTotalMin', 'unrelatedChurn'];

const ASSOCIATIONS: readonly AuthorAssociation[] = ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE'];
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
/** C0 controls, DEL and C1 controls. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** The policy used when `.proof.yml` is absent or leaves an option out. Matches docs/PLAN.md. */
export const DEFAULT_POLICY: Policy = deepFreeze({
  checks: { 'linked-issue': true, match: true, scope: true, tests: true, rules: true, ci: true, reproduce: false, summary: true },
  weights: {
    linkedIssue: 10,
    issueMatch: 15,
    testsAdded: 10,
    testsRemovedOrSkipped: -20,
    ciPassing: 10,
    ciFailing: -10,
    ruleViolation: -5,
    rulesTotalMin: -20,
    unrelatedChurn: -10,
    reproVerified: 20,
  },
  thresholds: { 'review-now': 70, 'needs-info': 40 },
  labels: { 'review-now': 'proof: review-now', 'needs-info': 'proof: needs-info', 'low-evidence': 'proof: low-evidence' },
  external: { associations: ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE'], includeBots: false, ignoreUsers: [] },
  autoClose: { enabled: false, confirm: false },
});

/**
 * Validates the parsed contents of `.proof.yml` and fills every option it leaves out from
 * {@link DEFAULT_POLICY}. `undefined` or `null` (an empty file) gives the defaults.
 * Unknown keys are errors, so a typo never silently falls back to a default.
 * Returns every problem found, each with a dotted path such as `thresholds.review-now`.
 */
export function parsePolicy(input: unknown): PolicyResult {
  const errors: PolicyError[] = [];
  const root = readObject(input ?? {}, '', Object.keys(DEFAULT_POLICY), errors);
  const d = DEFAULT_POLICY;
  const policy: Policy = {
    checks: readFlags(root['checks'], 'checks', d.checks, errors),
    weights: readWeights(root['weights'], errors),
    thresholds: readThresholds(root['thresholds'], errors),
    labels: readLabels(root['labels'], errors),
    external: readExternal(root['external'], errors),
    autoClose: readFlags(root['autoClose'], 'autoClose', d.autoClose, errors),
  };
  const confirmInvalid = errors.some((e) => e.path === 'autoClose.confirm');
  if (policy.autoClose.enabled && !policy.autoClose.confirm && !confirmInvalid) {
    errors.push({ path: 'autoClose.confirm', message: 'must be true to enable autoClose (closing PRs is never on by accident)' });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, policy };
}

/** True when PRoof should triage a PR by this author under the policy. */
export function isExternalAuthor(author: PrAuthor, external: ExternalAuthors = DEFAULT_POLICY.external): boolean {
  if (author.isBot && !external.includeBots) return false;
  const login = author.login.toLowerCase();
  if (external.ignoreUsers.some((user) => user.toLowerCase() === login)) return false;
  return external.associations.includes(author.association);
}

/** Formats errors one per line, for a check run or log. */
export function formatPolicyErrors(errors: readonly PolicyError[]): string {
  return errors.map((e) => `.proof.yml ${e.path || '(root)'}: ${e.message}`).join('\n');
}

function readObject(value: unknown, path: string, allowed: readonly string[], errors: PolicyError[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({ path, message: `must be a mapping of options, got ${describe(value)}` });
    return {};
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      errors.push({ path: join(path, key), message: `unknown option; expected one of ${allowed.join(', ')}` });
    }
  }
  return record;
}

function readFlags<K extends string>(value: unknown, path: string, defaults: Readonly<Record<K, boolean>>, errors: PolicyError[]): Record<K, boolean> {
  const keys = Object.keys(defaults) as K[];
  const record = readObject(value, path, keys, errors);
  const out = { ...defaults } as Record<K, boolean>;
  for (const key of keys) out[key] = readBoolean(record[key], join(path, key), defaults[key], errors);
  return out;
}

function readBoolean(value: unknown, path: string, fallback: boolean, errors: PolicyError[]): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  errors.push({ path, message: `must be true or false, got ${describe(value)}` });
  return fallback;
}

/** Allowed range for one number, with an optional note for the error message. */
interface NumberRange {
  readonly min: number;
  readonly max: number;
  readonly note?: string;
}

function readNumbers<K extends string>(
  value: unknown,
  path: string,
  defaults: Readonly<Record<K, number>>,
  rangeOf: (key: K) => NumberRange,
  errors: PolicyError[],
): Record<K, number> {
  const keys = Object.keys(defaults) as K[];
  const record = readObject(value, path, keys, errors);
  const out = { ...defaults } as Record<K, number>;
  for (const key of keys) {
    const n = record[key];
    if (n === undefined) continue;
    const { min, max, note } = rangeOf(key);
    if (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max) out[key] = n;
    else errors.push({ path: join(path, key), message: `must be a number from ${min} to ${max}${note ? ` (${note})` : ''}, got ${describe(n)}` });
  }
  return out;
}

const BONUS: NumberRange = { min: 0, max: MAX_WEIGHT, note: 'a bonus' };
const PENALTY: NumberRange = { min: -MAX_WEIGHT, max: 0, note: 'a penalty' };

function readWeights(value: unknown, errors: PolicyError[]): Weights {
  return readNumbers(value, 'weights', DEFAULT_POLICY.weights, (key) => (PENALTY_WEIGHTS.includes(key) ? PENALTY : BONUS), errors);
}

function readThresholds(value: unknown, errors: PolicyError[]): Policy['thresholds'] {
  const before = errors.length;
  const thresholds = readNumbers(value, 'thresholds', DEFAULT_POLICY.thresholds, () => ({ min: 0, max: 100 }), errors);
  if (errors.length === before && thresholds['review-now'] <= thresholds['needs-info']) {
    errors.push({
      path: 'thresholds.review-now',
      message: `must be greater than thresholds.needs-info (${thresholds['needs-info']}), got ${thresholds['review-now']}`,
    });
  }
  return thresholds;
}

function readLabels(value: unknown, errors: PolicyError[]): Policy['labels'] {
  const record = readObject(value, 'labels', PRIORITIES, errors);
  const out: Record<Priority, string> = { ...DEFAULT_POLICY.labels };
  for (const priority of PRIORITIES) {
    const name = record[priority];
    if (name === undefined) continue;
    if (isLabelName(name)) out[priority] = name.trim();
    else {
      const message = `must be a label name of 1 to ${MAX_LABEL_LENGTH} characters with no control characters, got ${describe(name)}`;
      errors.push({ path: `labels.${priority}`, message });
    }
  }
  const names = PRIORITIES.map((p) => out[p].toLowerCase());
  if (new Set(names).size !== names.length) {
    errors.push({ path: 'labels', message: 'each priority needs its own label name (GitHub label names ignore case)' });
  }
  return out;
}

function isLabelName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed !== '' && trimmed.length <= MAX_LABEL_LENGTH && !CONTROL_CHARS.test(trimmed);
}

function readExternal(value: unknown, errors: PolicyError[]): ExternalAuthors {
  const d = DEFAULT_POLICY.external;
  const record = readObject(value, 'external', Object.keys(d), errors);
  return {
    associations: readList(record['associations'], 'external.associations', d.associations, 1, ASSOCIATIONS.length, isAssociation, `one of ${ASSOCIATIONS.join(', ')}`, errors),
    includeBots: readBoolean(record['includeBots'], 'external.includeBots', d.includeBots, errors),
    ignoreUsers: uniqueIgnoringCase(
      readList(record['ignoreUsers'], 'external.ignoreUsers', d.ignoreUsers, 0, MAX_IGNORED_USERS, isLogin, 'a GitHub login', errors),
    ),
  };
}

function readList<T extends string>(
  value: unknown,
  path: string,
  fallback: readonly T[],
  minItems: number,
  maxItems: number,
  isItem: (item: unknown) => item is T,
  expected: string,
  errors: PolicyError[],
): readonly T[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    errors.push({ path, message: `must be a list of ${minItems} to ${maxItems} entries, got ${describe(value)}` });
    return fallback;
  }
  const items: T[] = [];
  value.forEach((item: unknown, i) => {
    if (isItem(item)) items.push(item);
    else errors.push({ path: `${path}[${i}]`, message: `must be ${expected}, got ${describe(item)}` });
  });
  return [...new Set(items)];
}

/** Keeps the first spelling of each login; logins match ignoring case. */
function uniqueIgnoringCase(logins: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return logins.filter((login) => {
    const key = login.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isAssociation(item: unknown): item is AuthorAssociation {
  return typeof item === 'string' && (ASSOCIATIONS as readonly string[]).includes(item);
}

function isLogin(item: unknown): item is string {
  return typeof item === 'string' && LOGIN.test(item);
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/** Short, safe description of a value for an error message. Never echoes long text. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === 'string') return value.length > 40 ? `a ${value.length}-character string` : JSON.stringify(value);
  if (typeof value === 'object') return 'a mapping';
  return String(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
