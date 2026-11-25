import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTests, findSkipMarker, MAX_QUOTE_LENGTH, patchLines, type SkipLanguage } from './tests.ts';
import { makeFile } from '../../test/fixtures/pr.ts';
import * as skips from '../../test/fixtures/skips.ts';

const markerCases: ReadonlyArray<[string, SkipLanguage, string]> = [
  ['it.skip("x", () => {})', 'js', '.skip('],
  ['test.skip ("x")', 'js', '.skip('],
  ['describe.skip("suite", fn)', 'js', '.skip('],
  ['xit("x", fn)', 'js', 'xit('],
  ['xtest("x", fn)', 'js', 'xtest('],
  ['xdescribe("x", fn)', 'js', 'xdescribe('],
  ['pytest.skip("not ready")', 'python', 'pytest.skip('],
  ['@pytest.mark.skip', 'python', '@pytest.mark.skip'],
  ['@pytest.mark.skipif(True, reason="x")', 'python', '@pytest.mark.skipif'],
  ['@unittest.skip("x")', 'python', '@unittest.skip'],
  ['@unittest.skipIf(cond, "x")', 'python', '@unittest.skipIf'],
  ['t.Skip("x")', 'go', 't.Skip('],
  ['t.Skipf("on %s", os)', 'go', 't.Skipf('],
  ['b.SkipNow()', 'go', 'b.SkipNow('],
  ['@Disabled', 'java', '@Disabled'],
  ['@Disabled("reason")', 'java', '@Disabled'],
  ['@Ignore', 'java', '@Ignore'],
];

for (const [line, language, marker] of markerCases) {
  test(`findSkipMarker: ${line}`, () => {
    assert.deepEqual(findSkipMarker(line), { language, marker });
  });
}

const notMarkers = [
  '// it.skip("x")',
  '# @pytest.mark.skip',
  ' * @Disabled',
  '/* xit("x") */',
  '/* a */ /* it.skip("b") */',
  'exit(1)',
  'fixit(2)',
  'obj.xit(3)',
  '@DisabledFor',
  '',
];

for (const line of notMarkers) {
  test(`findSkipMarker ignores: ${JSON.stringify(line)}`, () => {
    assert.equal(findSkipMarker(line), undefined);
  });
}

for (const [line, marker] of [
  ['/* flaky */ it.skip("x", fn)', '.skip('],
  ['/**/xit("x", fn)', 'xit('],
  ['/* a */ /* b */ @Disabled', '@Disabled'],
  ['t.Skip("x") /* unclosed', 't.Skip('],
] as const) {
  test(`findSkipMarker sees code after an inline block comment: ${line}`, () => {
    assert.equal(findSkipMarker(line)?.marker, marker);
  });
}

test('findSkipMarker stays fast on a long line of unclosed comment openers', () => {
  const started = performance.now();
  assert.equal(findSkipMarker(`x ${'/*'.repeat(200_000)}`), undefined);
  assert.ok(performance.now() - started < 1000);
});

test('patchLines numbers added lines in the new file and handles CRLF', () => {
  const lines = patchLines('@@ -1,2 +7,3 @@\r\n context\r\n-old\r\n+new\r\n\\ No newline at end of file\r\n+more');
  assert.deepEqual(lines, [
    { kind: '-', text: 'old', line: 0 },
    { kind: '+', text: 'new', line: 8 },
    { kind: '+', text: 'more', line: 9 },
  ]);
  assert.deepEqual(patchLines('+not in a hunk'), []);
});

test('classifies added, modified and deleted test files', () => {
  const report = analyzeTests([
    makeFile('src/config.ts'),
    makeFile('src/config.test.ts', { status: 'added' }),
    makeFile('tests/test_api.py', { status: 'modified' }),
    makeFile('pkg/fetch_test.go', { status: 'removed' }),
    makeFile('src/ParserTest.java', { status: 'renamed', previousPath: 'src/OldParserTest.java' }),
    makeFile('src/helpers.ts', { status: 'renamed', previousPath: 'test/helpers.ts' }),
    makeFile('test/util.ts', { status: 'renamed', previousPath: 'src/util.ts' }),
    makeFile('test/copy.test.ts', { status: 'copied', previousPath: 'test/orig.test.ts' }),
    makeFile('test/same.test.ts', { status: 'unchanged' }),
  ]);
  assert.deepEqual(report.added.map((f) => f.path), ['src/config.test.ts', 'test/util.ts', 'test/copy.test.ts']);
  assert.deepEqual(report.modified.map((f) => f.path), ['tests/test_api.py', 'src/ParserTest.java']);
  assert.deepEqual(report.deleted.map((f) => f.path), ['pkg/fetch_test.go', 'src/helpers.ts']);
  assert.deepEqual(report.newlySkipped, []);
});

test('finds new JS skips with line numbers and quotes', () => {
  const { newlySkipped } = analyzeTests([makeFile('src/parser.test.ts', { patch: skips.jsSkips })]);
  assert.deepEqual(newlySkipped, [
    { file: 'src/parser.test.ts', line: 11, language: 'js', marker: '.skip(', quote: 'it.skip("parses dates", () => {' },
    { file: 'src/parser.test.ts', line: 41, language: 'js', marker: 'xdescribe(', quote: 'xdescribe("legacy", () => {});' },
  ]);
});

test('finds new Python, Go and Java skips', () => {
  const { newlySkipped } = analyzeTests([
    makeFile('tests/test_upload.py', { patch: skips.pythonSkips }),
    makeFile('pkg/fetch_test.go', { patch: skips.goSkips }),
    makeFile('src/test/java/ParserTest.java', { patch: skips.javaSkips }),
  ]);
  assert.deepEqual(
    newlySkipped.map((s) => [s.file, s.line, s.language, s.marker]),
    [
      ['tests/test_upload.py', 3, 'python', '@pytest.mark.skip'],
      ['tests/test_upload.py', 22, 'python', '@pytest.mark.skipif'],
      ['pkg/fetch_test.go', 5, 'go', 't.Skip('],
      ['pkg/fetch_test.go', 32, 'go', 't.Skipf('],
      ['src/test/java/ParserTest.java', 12, 'java', '@Disabled'],
      ['src/test/java/ParserTest.java', 42, 'java', '@Ignore'],
    ],
  );
});

test('removed skips are not counted', () => {
  const { newlySkipped } = analyzeTests([makeFile('test/parser.test.ts', { patch: skips.skipsRemoved })]);
  assert.deepEqual(newlySkipped, []);
});

test('a moved skip or a changed skip reason is not new', () => {
  const { newlySkipped } = analyzeTests([makeFile('test/ParserTest.java', { patch: skips.skipsMoved })]);
  assert.deepEqual(newlySkipped, []);
});

test('replacing one skip with two leaves one new skip', () => {
  const patch = ['@@ -1,1 +1,2 @@', '-it.skip("a", fn);', '+it.skip("b", fn);', '+it.skip("c", fn);'].join('\n');
  const { newlySkipped } = analyzeTests([makeFile('test/a.test.ts', { patch })]);
  assert.deepEqual(newlySkipped.map((s) => s.quote), ['it.skip("c", fn);']);
});

test('a skipped test moved to another test file is not new', () => {
  const { newlySkipped } = analyzeTests([
    makeFile('test/old.test.ts', { status: 'removed', patch: '@@ -1 +0,0 @@\n-it.skip("a", fn);' }),
    makeFile('test/new.test.ts', { status: 'added', patch: '@@ -0,0 +1 @@\n+  it.skip("a", fn);' }),
  ]);
  assert.deepEqual(newlySkipped, []);
});

test('a removed skip in one file does not hide a different new skip in another', () => {
  const { newlySkipped } = analyzeTests([
    makeFile('test/a.test.ts', { patch: '@@ -1 +1 @@\n-it.skip("a", fn);\n+it("a", fn);' }),
    makeFile('test/b.test.ts', { patch: '@@ -1 +1,2 @@\n+it.skip("b", fn);' }),
  ]);
  assert.deepEqual(
    newlySkipped.map((s) => [s.file, s.quote]),
    [['test/b.test.ts', 'it.skip("b", fn);']],
  );
});

test('one removed skip cancels only one of two identical added skips', () => {
  const { newlySkipped } = analyzeTests([
    makeFile('test/a.test.ts', { patch: '@@ -1 +1,2 @@\n-xit("a");\n+xit("a");\n+xit("a");' }),
  ]);
  assert.equal(newlySkipped.length, 1);
});

test('comments and look-alikes are not skips', () => {
  const { newlySkipped } = analyzeTests([makeFile('test/a.test.ts', { patch: skips.notSkips })]);
  assert.deepEqual(newlySkipped, []);
});

test('skips outside test files, in deleted files or without a patch are ignored', () => {
  const { newlySkipped } = analyzeTests([
    makeFile('src/stream.ts', { patch: '@@ -1 +1 @@\n+reader.skip(4);' }),
    makeFile('test/gone.test.ts', { status: 'removed', patch: '@@ -1 +0,0 @@\n-it.skip("x")' }),
    makeFile('test/big.test.ts'),
  ]);
  assert.deepEqual(newlySkipped, []);
});

test('long quotes are cut to MAX_QUOTE_LENGTH', () => {
  const patch = `@@ -0,0 +1 @@\n+it.skip("${'x'.repeat(500)}")`;
  const [skip] = analyzeTests([makeFile('test/a.test.ts', { patch })]).newlySkipped;
  assert.equal(skip?.quote.length, MAX_QUOTE_LENGTH);
});

test('a quote cut never ends in half a surrogate pair', () => {
  const patch = `@@ -0,0 +1 @@\n+it.skip("${'x'.repeat(190)}\u{1F600}")`;
  const [skip] = analyzeTests([makeFile('test/a.test.ts', { patch })]).newlySkipped;
  assert.equal(skip?.quote.length, MAX_QUOTE_LENGTH - 1);
  assert.doesNotMatch(skip?.quote ?? '', /[\uD800-\uDBFF]$/);
});
