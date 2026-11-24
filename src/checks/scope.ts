import type { Evidence, PrFile } from '../types.ts';

/** Kinds of changed file, by path. */
export const FILE_CLASSES = ['source', 'test', 'docs', 'config', 'lockfile', 'generated', 'vendored', 'ci'] as const;

/** One of {@link FILE_CLASSES}. */
export type FileClass = (typeof FILE_CLASSES)[number];

/** Kinds of change that are probably unrelated to the PR's purpose. */
export type ChurnKind = 'lockfile-without-manifest' | 'formatting-only' | 'generated' | 'large-diff';

/** A changed file with its class. */
export interface ClassifiedFile {
  readonly path: string;
  readonly fileClass: FileClass;
  readonly additions: number;
  readonly deletions: number;
}

/** Line and file counts for a group of files. */
export interface ScopeCount {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

/** Totals for the whole PR and per file class. */
export interface ScopeTotals extends ScopeCount {
  readonly byClass: Readonly<Record<FileClass, ScopeCount>>;
  /** Changed lines outside lockfiles, generated and vendored files. */
  readonly reviewableLines: number;
}

/** One unrelated-churn finding with the files that caused it. */
export interface ChurnFlag {
  readonly kind: ChurnKind;
  readonly message: string;
  readonly evidence: readonly Evidence[];
}

/** Result of {@link analyzeScope}. */
export interface ScopeReport {
  readonly files: readonly ClassifiedFile[];
  readonly totals: ScopeTotals;
  readonly churn: readonly ChurnFlag[];
}

/** Size limits for the `large-diff` flag. */
export interface ScopeOptions {
  /** Most reviewable changed lines (additions plus deletions) before flagging. */
  readonly maxReviewableLines?: number;
  /** Most changed files before flagging. */
  readonly maxFiles?: number;
}

/** Defaults for {@link ScopeOptions}. */
export const DEFAULT_SCOPE_OPTIONS: Required<ScopeOptions> = { maxReviewableLines: 1000, maxFiles: 50 };

const VENDORED_DIRS = new Set(['vendor', 'third_party', 'third-party', 'node_modules', 'bower_components']);
const GENERATED_DIRS = new Set(['dist', 'build', 'generated', '__generated__']);
const GENERATED_NAME = /\.(?:min\.(?:js|css)|map|pb\.go|g\.dart|freezed\.dart)$|_pb2(?:_grpc)?\.py$|\.generated\.[^.]+$/;
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'testdata', '__snapshots__', '__mocks__']);
const TEST_NAME = /\.(?:test|spec)\.[^.]+$|_test\.[^.]+$|^test_[^/]*\.py$|_spec\.rb$/;
const TEST_NAME_CASED = /(?:Test|Tests|IT)\.(?:java|kt|cs|scala)$/;
const CI_DIRS = ['.github/workflows/', '.github/actions/', '.circleci/', '.buildkite/'];
const CI_FILES = new Set(['.gitlab-ci.yml', '.travis.yml', 'azure-pipelines.yml', 'jenkinsfile', 'appveyor.yml', '.drone.yml', 'bitbucket-pipelines.yml']);
const DOC_DIRS = new Set(['docs', 'doc', 'documentation']);
const DOC_NAME = /\.(?:md|mdx|markdown|rst|adoc|txt)$|^(?:readme|changelog|license|licence|contributing|authors|notice|copying)(?:\.[^.]+)?$/;
const CONFIG_TEXT_NAME = /^(?:requirements[\w.-]*\.txt|cmakelists\.txt|codeowners)$/;
const CONFIG_NAME = /^\.|\.(?:json|jsonc|ya?ml|toml|ini|cfg|conf|properties)$|^(?:dockerfile|makefile|gemfile|pipfile|podfile|setup\.py|mix\.exs|flake\.nix)$|\.(?:gemspec|csproj)$/;

/** Each lockfile name, with the manifests that would normally change with it. */
const LOCKFILE_MANIFESTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['package-lock.json', ['package.json']],
  ['npm-shrinkwrap.json', ['package.json']],
  ['yarn.lock', ['package.json']],
  ['pnpm-lock.yaml', ['package.json', 'pnpm-workspace.yaml']],
  ['bun.lock', ['package.json']],
  ['bun.lockb', ['package.json']],
  ['cargo.lock', ['cargo.toml']],
  ['poetry.lock', ['pyproject.toml']],
  ['uv.lock', ['pyproject.toml']],
  ['pipfile.lock', ['pipfile']],
  ['gemfile.lock', ['gemfile', '*.gemspec']],
  ['go.sum', ['go.mod']],
  ['composer.lock', ['composer.json']],
  ['mix.lock', ['mix.exs']],
  ['pubspec.lock', ['pubspec.yaml']],
  ['podfile.lock', ['podfile']],
  ['packages.lock.json', ['*.csproj']],
  ['flake.lock', ['flake.nix']],
]);

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.toLowerCase().split('/').filter((p) => p !== '');
  const name = parts.pop() ?? '';
  return { dirs: parts, name };
}

/**
 * Classifies a repository path. When rules overlap, the first match wins in this order:
 * vendored, lockfile, generated, ci, test, docs, config, then source as the default.
 * Matching ignores case, except for Java-style `FooTest.java` names.
 */
export function classifyPath(path: string): FileClass {
  const { dirs, name } = splitPath(path);
  const lower = path.toLowerCase();
  const originalName = path.split('/').pop() ?? '';
  if (dirs.some((d) => VENDORED_DIRS.has(d))) return 'vendored';
  if (LOCKFILE_MANIFESTS.has(name)) return 'lockfile';
  if (dirs.some((d) => GENERATED_DIRS.has(d)) || GENERATED_NAME.test(name)) return 'generated';
  if (CI_FILES.has(name) || CI_DIRS.some((d) => lower.startsWith(d))) return 'ci';
  if (dirs.some((d) => TEST_DIRS.has(d)) || TEST_NAME.test(name) || TEST_NAME_CASED.test(originalName)) return 'test';
  if (CONFIG_TEXT_NAME.test(name)) return 'config';
  if (dirs.some((d) => DOC_DIRS.has(d)) || DOC_NAME.test(name)) return 'docs';
  if (CONFIG_NAME.test(name)) return 'config';
  return 'source';
}

/** Splits a unified diff into hunks of removed and added lines. Context lines are dropped. */
export function parseHunks(patch: string): { removed: string[]; added: string[] }[] {
  const hunks: { removed: string[]; added: string[] }[] = [];
  let current: { removed: string[]; added: string[] } | undefined;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      current = { removed: [], added: [] };
      hunks.push(current);
    } else if (current !== undefined) {
      if (line.startsWith('+')) current.added.push(line.slice(1));
      else if (line.startsWith('-')) current.removed.push(line.slice(1));
    }
  }
  return hunks;
}

/** File types where leading indentation is syntax, so re-indenting is a real change. */
const INDENT_SENSITIVE_NAME = /\.(?:py|pyi|pyw|ya?ml|coffee|haml|pug|jade|sass|styl|nim|fs|fsx|hs|elm|mk)$|^(?:makefile|gnumakefile)$/;

/** True for paths whose language treats leading indentation as syntax (Python, YAML, Makefiles, ...). */
export function isIndentSensitive(path: string): boolean {
  return INDENT_SENSITIVE_NAME.test(splitPath(path).name);
}

/** Options for {@link isFormattingOnly}. */
export interface FormattingOptions {
  /**
   * Treat leading indentation as meaningful: only trailing whitespace and blank lines
   * may change, and lines may not be re-wrapped. Use for indentation-sensitive files.
   */
  readonly keepIndentation?: boolean;
}

/** Whitespace-separated tokens across lines, so `a b` and `ab` stay different. */
const tokens = (lines: readonly string[]): string[] => lines.join('\n').split(/\s+/).filter((t) => t !== '');

/** Non-blank lines with trailing whitespace removed and indentation kept. */
const indentedLines = (lines: readonly string[]): string[] => lines.map((l) => l.trimEnd()).filter((l) => l !== '');

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * True when the patch has at least one changed line and every hunk only changes whitespace.
 * By default removed and added text must have the same whitespace-separated tokens, so
 * re-indentation, re-wrapped lines and added or removed blank lines count as formatting,
 * but joining or splitting a token (`"a b"` to `"ab"`) does not. With `keepIndentation`,
 * leading indentation must also match line by line.
 */
export function isFormattingOnly(patch: string, options: FormattingOptions = {}): boolean {
  const normalize = options.keepIndentation === true ? indentedLines : tokens;
  const hunks = parseHunks(patch).filter((h) => h.removed.length + h.added.length > 0);
  return hunks.length > 0 && hunks.every((h) => sameList(normalize(h.removed), normalize(h.added)));
}

function matchesManifest(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => (p.startsWith('*') ? name.endsWith(p.slice(1)) : name === p));
}

/**
 * A lockfile's manifest counts when it changed in the lockfile's directory or below (workspaces).
 * Manifests inside vendored directories never count.
 */
function lockfilesWithoutManifest(files: readonly PrFile[]): PrFile[] {
  return files.filter((file) => {
    const { dirs, name } = splitPath(file.path);
    const patterns = LOCKFILE_MANIFESTS.get(name);
    if (patterns === undefined || dirs.some((d) => VENDORED_DIRS.has(d))) return false;
    const prefix = dirs.length === 0 ? '' : `${dirs.join('/')}/`;
    return !files.some((other) => {
      const o = splitPath(other.path);
      if (o.dirs.some((d) => VENDORED_DIRS.has(d))) return false;
      return [...o.dirs, o.name].join('/').startsWith(prefix) && matchesManifest(o.name, patterns);
    });
  });
}

function emptyCounts(): Record<FileClass, { files: number; additions: number; deletions: number }> {
  const counts = {} as Record<FileClass, { files: number; additions: number; deletions: number }>;
  for (const c of FILE_CLASSES) counts[c] = { files: 0, additions: 0, deletions: 0 };
  return counts;
}

function computeTotals(files: readonly ClassifiedFile[]): ScopeTotals {
  const byClass = emptyCounts();
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    const c = byClass[f.fileClass];
    c.files += 1;
    c.additions += f.additions;
    c.deletions += f.deletions;
    additions += f.additions;
    deletions += f.deletions;
  }
  const excluded = (['lockfile', 'generated', 'vendored'] as const).reduce(
    (sum, k) => sum + byClass[k].additions + byClass[k].deletions,
    0,
  );
  return { files: files.length, additions, deletions, byClass, reviewableLines: additions + deletions - excluded };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fileEvidence(files: readonly PrFile[], note: string): Evidence[] {
  return files.map((f) => ({ note, file: f.path }));
}

/**
 * Classifies every changed file, computes totals and flags unrelated churn:
 * lockfiles changed without their manifest, formatting-only patches, generated files
 * and diffs over the size limits. Files without a patch are never formatting-only, and
 * re-indentation does not count as formatting in indentation-sensitive files.
 */
export function analyzeScope(files: readonly PrFile[], options: ScopeOptions = {}): ScopeReport {
  const limits = { ...DEFAULT_SCOPE_OPTIONS, ...options };
  const classified = files.map((f) => ({
    path: f.path,
    fileClass: classifyPath(f.path),
    additions: f.additions,
    deletions: f.deletions,
  }));
  const totals = computeTotals(classified);
  const churn: ChurnFlag[] = [];

  const lockfiles = lockfilesWithoutManifest(files);
  if (lockfiles.length > 0) {
    churn.push({
      kind: 'lockfile-without-manifest',
      message: `${plural(lockfiles.length, 'lockfile')} changed without a matching manifest change`,
      evidence: fileEvidence(lockfiles, 'lockfile changed, manifest unchanged'),
    });
  }

  const formatting = files.filter(
    (f) => f.patch !== undefined && isFormattingOnly(f.patch, { keepIndentation: isIndentSensitive(f.path) }),
  );
  if (formatting.length > 0) {
    churn.push({
      kind: 'formatting-only',
      message: `${plural(formatting.length, 'file')} with whitespace-only changes`,
      evidence: fileEvidence(formatting, 'only whitespace changed'),
    });
  }

  const generated = files.filter((_, i) => classified[i]?.fileClass === 'generated');
  if (generated.length > 0) {
    churn.push({
      kind: 'generated',
      message: `${plural(generated.length, 'generated file')} changed`,
      evidence: fileEvidence(generated, 'generated file'),
    });
  }

  const evidence: Evidence[] = [];
  if (totals.reviewableLines > limits.maxReviewableLines) {
    evidence.push({ note: `${totals.reviewableLines} reviewable lines changed (limit ${limits.maxReviewableLines})` });
  }
  if (totals.files > limits.maxFiles) {
    evidence.push({ note: `${totals.files} files changed (limit ${limits.maxFiles})` });
  }
  if (evidence.length > 0) {
    churn.push({ kind: 'large-diff', message: 'diff is larger than the review size limit', evidence });
  }

  return { files: classified, totals, churn };
}
