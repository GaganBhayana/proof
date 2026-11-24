/** Small unified-diff patches, in the form GitHub returns for `PrFile.patch`. */

/** A real logic change. */
export const logicChange = [
  '@@ -10,7 +10,9 @@ export function loadConfig(path: string) {',
  '   const text = readFileSync(path, "utf8");',
  '-  return JSON.parse(text);',
  '+  if (text.trim() === "") return defaults;',
  '+  return JSON.parse(text);',
  ' }',
].join('\n');

/** Re-indentation from two spaces to four and a trailing-space fix. */
export const reindent = [
  '@@ -1,4 +1,4 @@',
  ' function add(a, b) {',
  '-  return a + b;',
  '+    return a + b;',
  ' }',
  '@@ -20,3 +20,3 @@',
  '-const x = 1;   ',
  '+const x = 1;',
].join('\n');

/** One long line wrapped onto two, plus an added blank line. */
export const rewrap = [
  '@@ -5,2 +5,4 @@',
  '-const message = format(name, count, unit);',
  '+const message = format(name,',
  '+  count, unit);',
  '+',
].join('\n');

/** Whitespace in one hunk, a real change in another. */
export const mixed = [
  '@@ -1,2 +1,2 @@',
  '-  a();',
  '+    a();',
  '@@ -9,2 +9,2 @@',
  '-  b();',
  '+  c();',
].join('\n');

/** Only removed lines. */
export const deletion = ['@@ -1,3 +0,0 @@', '-one', '-two', '-three'].join('\n');

/** Only blank lines added. */
export const blankLines = ['@@ -3,0 +3,2 @@', '+', '+  '].join('\n');

/** CRLF line endings and the no-newline marker. */
export const crlfReindent = '@@ -1 +1 @@\r\n-\tx = 1\r\n\\ No newline at end of file\r\n+  x = 1\r\n\\ No newline at end of file';

/** Whitespace removed inside a string literal: a real change. */
export const innerSpace = ['@@ -1 +1 @@', '-msg = "a b"', '+msg = "ab"'].join('\n');

/** Python: `return 1` dedented out of the `if` block. A logic change. */
export const pythonDedent = [
  '@@ -1,3 +1,3 @@',
  ' def f(x):',
  '     if x:',
  '-        return 1',
  '+    return 1',
].join('\n');

/** Python: trailing spaces removed and a blank line added, indentation unchanged. */
export const pythonTrailing = ['@@ -1,2 +1,3 @@', '-def f(x):   ', '+def f(x):', '+', '     return x'].join('\n');
