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

/** Returns the first skip marker on a line of code; comment lines never match. */
export function findSkipMarker(line: string): SkipMarker | undefined {
  const code = line.trim();
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

/**
 * Skips added in one file's patch, net of skips it removed. A removed skip line
 * cancels an added one with the same trimmed text (a moved or re-indented skip),
 * and any remaining removed skips cancel added skips with the same marker (a
 * renamed skipped test or a changed skip reason).
 */
function newSkipsInPatch(file: string, patch: string): NewSkip[] {
  const added: { line: PatchLine; pattern: SkipMarker }[] = [];
  const removedText = new Map<string, number>();
  const removedMarker = new Map<string, number>();
  for (const line of patchLines(patch)) {
    const pattern = findSkipMarker(line.text);
    if (!pattern) continue;
    if (line.kind === '+') added.push({ line, pattern });
    else {
      const text = line.text.trim();
      removedText.set(text, (removedText.get(text) ?? 0) + 1);
      removedMarker.set(pattern.marker, (removedMarker.get(pattern.marker) ?? 0) + 1);
    }
  }
  const unmatched = added.filter(({ line, pattern }) => {
    const text = line.text.trim();
    const count = removedText.get(text) ?? 0;
    if (count === 0) return true;
    removedText.set(text, count - 1);
    removedMarker.set(pattern.marker, (removedMarker.get(pattern.marker) ?? 1) - 1);
    return false;
  });
  const result: NewSkip[] = [];
  for (const { line, pattern } of unmatched) {
    const left = removedMarker.get(pattern.marker) ?? 0;
    if (left > 0) {
      removedMarker.set(pattern.marker, left - 1);
      continue;
    }
    result.push({
      file,
      line: line.line,
      language: pattern.language,
      marker: pattern.marker,
      quote: line.text.trim().slice(0, MAX_QUOTE_LENGTH),
    });
  }
  return result;
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
 * that only moved or changed its reason is not new. Files without a patch report
 * no skips; comment lines are ignored.
 */
export function analyzeTests(files: readonly PrFile[]): TestSignals {
  const added: TestFileSignal[] = [];
  const modified: TestFileSignal[] = [];
  const deleted: TestFileSignal[] = [];
  const newlySkipped: NewSkip[] = [];
  const lists = { added, modified, deleted };
  for (const file of files) {
    const change = testChange(file);
    if (change === undefined) continue;
    lists[change].push({ path: file.path, change });
    if (change !== 'deleted' && file.patch !== undefined) newlySkipped.push(...newSkipsInPatch(file.path, file.patch));
  }
  return { added, modified, deleted, newlySkipped };
}
