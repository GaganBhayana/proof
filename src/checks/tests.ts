import type { PrFile } from '../types.ts';
import { classifyPath } from './scope.ts';

/** How a test file changed in the PR. */
export type TestFileChange = 'added' | 'modified' | 'deleted';

/** Language family of a skip marker. */
export type SkipLanguage = 'js' | 'python' | 'go' | 'java';

/** A test file the PR touched. */
export interface TestFileSignal {
  readonly path: string;
  readonly change: TestFileChange;
}

/** A skip marker on an added line that was not there before. */
export interface NewSkip {
  readonly file: string;
  /** Line number in the new version of the file. */
  readonly line: number;
  readonly language: SkipLanguage;
  /** The marker that matched, such as `.skip(` or `@Disabled`. */
  readonly marker: string;
  /** The added line, trimmed and cut to {@link MAX_QUOTE_LENGTH} characters. Untrusted. */
  readonly quote: string;
}

/** Result of {@link analyzeTests}. */
export interface TestSignals {
  readonly added: readonly TestFileSignal[];
  readonly modified: readonly TestFileSignal[];
  readonly deleted: readonly TestFileSignal[];
  readonly newlySkipped: readonly NewSkip[];
}

/** Longest quote kept in a {@link NewSkip}. */
export const MAX_QUOTE_LENGTH = 200;

/** A skip marker found on one line. */
export interface SkipMarker {
  readonly language: SkipLanguage;
  /** The matched text without spaces, such as `.skip(`, `xdescribe(` or `@Disabled`. */
  readonly marker: string;
}

/**
 * Markers that skip or disable a test, per language. The first match wins, so the
 * generic JS `.skip(` comes last and `@unittest.skip(` or `pytest.skip(` stay Python.
 */
const SKIP_PATTERNS: readonly { readonly language: SkipLanguage; readonly regex: RegExp }[] = [
  { language: 'python', regex: /@pytest\.mark\.skip(?:if)?\b/ },
  { language: 'python', regex: /@unittest\.skip(?:If|Unless)?\b/ },
  { language: 'python', regex: /\bpytest\.skip\s*\(/ },
  { language: 'go', regex: /\b[tb]\.Skip(?:f|Now)?\s*\(/ },
  { language: 'java', regex: /@(?:Disabled|Ignore)\b/ },
  { language: 'js', regex: /(?<![\w$.])x(?:it|test|describe|context)\s*\(/ },
  { language: 'js', regex: /\.skip\s*\(/ },
];

/** Lines that start a comment in the supported languages. */
const COMMENT_START = /^(?:\/\/|\/\*|\*|#)/;

/**
 * Replaces block comments that open and close on the same line, such as
 * `/* flaky *\/`, with a space. Linear in the line length: an unclosed `/*` ends the scan.
 */
function stripInlineBlockComments(line: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const open = line.indexOf('/*', from);
    const close = open === -1 ? -1 : line.indexOf('*/', open + 2);
    if (close === -1) return out + line.slice(from);
    out += `${line.slice(from, open)} `;
    from = close + 2;
  }
}

/**
 * Returns the first skip marker on a line of code. Lines that are comments as a
 * whole never match; closed `/* ... *\/` spans are removed first, so a comment in
 * front of live code (`/* flaky *\/ it.skip(...)`) cannot hide a skip.
 */
export function findSkipMarker(line: string): SkipMarker | undefined {
  const code = stripInlineBlockComments(line).trim();
  if (code === '' || COMMENT_START.test(code)) return undefined;
  for (const { language, regex } of SKIP_PATTERNS) {
    const match = regex.exec(code);
    if (match) return { language, marker: match[0].replace(/\s+/g, '') };
  }
  return undefined;
}

/** One added or removed line of a patch. */
export interface PatchLine {
  readonly kind: '+' | '-';
  readonly text: string;
  /** New-file line number for `+` lines; 0 for `-` lines. */
  readonly line: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Added and removed lines of a unified diff, with new-file line numbers for added lines. */
export function patchLines(patch: string): PatchLine[] {
  const out: PatchLine[] = [];
  let next = 0;
  let inHunk = false;
  for (const raw of patch.split(/\r?\n/)) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      next = Number(header[1]);
      inHunk = true;
    } else if (!inHunk || raw.startsWith('\\')) {
      continue;
    } else if (raw.startsWith('+')) {
      out.push({ kind: '+', text: raw.slice(1), line: next++ });
    } else if (raw.startsWith('-')) {
      out.push({ kind: '-', text: raw.slice(1), line: 0 });
    } else {
      next++;
    }
  }
  return out;
}

/** A skip marker on an added or removed line of one test file. */
interface SkipLine {
  readonly file: string;
  readonly line: PatchLine;
  readonly pattern: SkipMarker;
}

/** Skip markers on the added and removed lines of one file's patch. */
function skipLines(file: string, patch: string): { added: SkipLine[]; removed: SkipLine[] } {
  const added: SkipLine[] = [];
  const removed: SkipLine[] = [];
  for (const line of patchLines(patch)) {
    const pattern = findSkipMarker(line.text);
    if (pattern) (line.kind === '+' ? added : removed).push({ file, line, pattern });
  }
  return { added, removed };
}

/** Removed skips under one key, consumed front to back. */
interface Queue {
  readonly items: SkipLine[];
  next: number;
}

/** Takes the first unused removed skip under `key`, marking it used. */
function claim(pool: Map<string, Queue>, key: string, used: Set<SkipLine>): boolean {
  const queue = pool.get(key);
  if (queue === undefined) return false;
  while (queue.next < queue.items.length) {
    const candidate = queue.items[queue.next++] as SkipLine;
    if (!used.has(candidate)) {
      used.add(candidate);
      return true;
    }
  }
  return false;
}

function push(pool: Map<string, Queue>, key: string, skip: SkipLine): void {
  const queue = pool.get(key);
  if (queue) queue.items.push(skip);
  else pool.set(key, { items: [skip], next: 0 });
}

/** Trims a quote to {@link MAX_QUOTE_LENGTH} without leaving half a surrogate pair. */
function quoteOf(text: string): string {
  const cut = text.trim().slice(0, MAX_QUOTE_LENGTH);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * Added skips net of removed ones across the whole PR. A removed skip line cancels
 * an added one with the same trimmed text in any test file (a moved, re-indented or
 * moved-to-another-file skip). Remaining removed skips cancel added skips with the
 * same marker in the same file only (a renamed skipped test or a changed reason),
 * so removing a skip in one file cannot hide a different new skip in another.
 */
function netNewSkips(added: readonly SkipLine[], removed: readonly SkipLine[]): NewSkip[] {
  const byText = new Map<string, Queue>();
  const byFileMarker = new Map<string, Queue>();
  const used = new Set<SkipLine>();
  const fileMarker = (skip: SkipLine): string => JSON.stringify([skip.file, skip.pattern.marker]);
  for (const skip of removed) {
    push(byText, skip.line.text.trim(), skip);
    push(byFileMarker, fileMarker(skip), skip);
  }
  const unmatched = added.filter((skip) => !claim(byText, skip.line.text.trim(), used));
  return unmatched
    .filter((skip) => !claim(byFileMarker, fileMarker(skip), used))
    .map(({ file, line, pattern }) => ({
      file,
      line: line.line,
      language: pattern.language,
      marker: pattern.marker,
      quote: quoteOf(line.text),
    }));
}

/** How a file change looks from the point of view of test files, or undefined if not a test. */
function testChange(file: PrFile): TestFileChange | undefined {
  const isTest = classifyPath(file.path) === 'test';
  const wasTest = file.previousPath !== undefined ? classifyPath(file.previousPath) === 'test' : isTest;
  if (file.status === 'unchanged') return undefined;
  if (file.status === 'removed') return isTest ? 'deleted' : undefined;
  if (file.status === 'added' || file.status === 'copied') return isTest ? 'added' : undefined;
  if (isTest) return wasTest ? 'modified' : 'added';
  return wasTest ? 'deleted' : undefined;
}

/**
 * Reports test files added, modified and deleted, and skip markers newly added to
 * test files (`.skip(`, `xit(`, `@pytest.mark.skip`, `t.Skip(`, `@Disabled`, ...).
 * Test files are found by path (see `classifyPath`). A file renamed out of a test
 * location counts as a deleted test. Removed skips are never counted, and a skip
 * that only moved (also to another test file) or changed its reason is not new.
 * Files without a patch report no skips; comment lines are ignored.
 */
export function analyzeTests(files: readonly PrFile[]): TestSignals {
  const added: TestFileSignal[] = [];
  const modified: TestFileSignal[] = [];
  const deleted: TestFileSignal[] = [];
  const addedSkips: SkipLine[] = [];
  const removedSkips: SkipLine[] = [];
  const lists = { added, modified, deleted };
  for (const file of files) {
    const change = testChange(file);
    if (change === undefined) continue;
    lists[change].push({ path: file.path, change });
    if (file.patch === undefined) continue;
    const lines = skipLines(file.path, file.patch);
    // A deleted file's removed skips still cancel the same skip moved elsewhere.
    if (change !== 'deleted') addedSkips.push(...lines.added);
    removedSkips.push(...lines.removed);
  }
  return { added, modified, deleted, newlySkipped: netNewSkips(addedSkips, removedSkips) };
}
