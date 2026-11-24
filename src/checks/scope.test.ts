import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrFile } from '../types.ts';
import {
  analyzeScope,
  classifyPath,
  isFormattingOnly,
  isIndentSensitive,
  parseHunks,
  type ChurnKind,
  type FileClass,
} from './scope.ts';
import { makeFile } from '../../test/fixtures/pr.ts';
import * as patches from '../../test/fixtures/patches.ts';

const classCases: ReadonlyArray<[string, FileClass]> = [
  ['src/config.ts', 'source'],
  ['lib/widgets/parser.py', 'source'],
  ['cmd/main.go', 'source'],
  ['assets/logo.png', 'source'],
  ['src/config.test.ts', 'test'],
  ['src/button.spec.jsx', 'test'],
  ['pkg/parse_test.go', 'test'],
  ['tests/test_parser.py', 'test'],
  ['test_cli.py', 'test'],
  ['__tests__/app.js', 'test'],
  ['spec/models/user_spec.rb', 'test'],
  ['src/main/java/com/acme/ParserTest.java', 'test'],
  ['test/fixtures/config.json', 'test'],
  ['src/__snapshots__/card.snap', 'test'],
  ['README.md', 'docs'],
  ['docs/guide/install.mdx', 'docs'],
  ['LICENSE', 'docs'],
  ['CHANGELOG', 'docs'],
  ['doc/api.rst', 'docs'],
  ['package.json', 'config'],
  ['tsconfig.build.json', 'config'],
  ['.eslintrc', 'config'],
  ['.gitignore', 'config'],
  ['config/settings.yaml', 'config'],
  ['pyproject.toml', 'config'],
  ['Dockerfile', 'config'],
  ['requirements-dev.txt', 'config'],
  ['.github/CODEOWNERS', 'config'],
  ['package-lock.json', 'lockfile'],
  ['packages/web/yarn.lock', 'lockfile'],
  ['pnpm-lock.yaml', 'lockfile'],
  ['Cargo.lock', 'lockfile'],
  ['go.sum', 'lockfile'],
  ['poetry.lock', 'lockfile'],
  ['dist/index.js', 'generated'],
  ['public/app.min.js', 'generated'],
  ['proto/api.pb.go', 'generated'],
  ['proto/api_pb2.py', 'generated'],
  ['src/schema.generated.ts', 'generated'],
  ['dist/index.test.js', 'generated'],
  ['vendor/github.com/pkg/errors/errors.go', 'vendored'],
  ['third_party/zlib/README.md', 'vendored'],
  ['node_modules/left-pad/package-lock.json', 'vendored'],
  ['.github/workflows/ci.yml', 'ci'],
  ['.gitlab-ci.yml', 'ci'],
  ['.circleci/config.yml', 'ci'],
  ['Jenkinsfile', 'ci'],
];

for (const [path, want] of classCases) {
  test(`classifyPath: ${path} is ${want}`, () => {
    assert.equal(classifyPath(path), want);
  });
}

test('classifyPath ignores case for directories and names', () => {
  assert.equal(classifyPath('Docs/Intro.MD'), 'docs');
  assert.equal(classifyPath('Vendor/lib.c'), 'vendored');
  assert.equal(classifyPath('.GitHub/Workflows/release.yml'), 'ci');
});

test('parseHunks keeps removed and added lines per hunk and skips context and markers', () => {
  assert.deepEqual(parseHunks(patches.mixed), [
    { removed: ['  a();'], added: ['    a();'] },
    { removed: ['  b();'], added: ['  c();'] },
  ]);
  assert.deepEqual(parseHunks(patches.crlfReindent), [{ removed: ['\tx = 1'], added: ['  x = 1'] }]);
  assert.deepEqual(parseHunks(''), []);
  assert.deepEqual(parseHunks('+not inside a hunk'), []);
});

const formattingCases: ReadonlyArray<[string, string, boolean]> = [
  ['re-indentation and trailing spaces', patches.reindent, true],
  ['re-wrapped line and a blank line', patches.rewrap, true],
  ['blank lines only', patches.blankLines, true],
  ['CRLF re-indentation', patches.crlfReindent, true],
  ['a logic change', patches.logicChange, false],
  ['one real hunk among whitespace hunks', patches.mixed, false],
  ['deletions only', patches.deletion, false],
  ['an empty patch', '', false],
  ['a hunk header with no changed lines', '@@ -1,1 +1,1 @@\n unchanged', false],
  ['whitespace removed inside a string literal', patches.innerSpace, false],
  ['one token split into two', '@@ -1 +1 @@\n-foobar\n+foo bar', false],
];

for (const [name, patch, want] of formattingCases) {
  test(`isFormattingOnly: ${name} -> ${want}`, () => {
    assert.equal(isFormattingOnly(patch), want);
  });
}

test('isFormattingOnly with keepIndentation rejects re-indentation but allows trailing space and blank lines', () => {
  assert.equal(isFormattingOnly(patches.pythonDedent), true);
  assert.equal(isFormattingOnly(patches.pythonDedent, { keepIndentation: true }), false);
  assert.equal(isFormattingOnly(patches.reindent, { keepIndentation: true }), false);
  assert.equal(isFormattingOnly(patches.rewrap, { keepIndentation: true }), false);
  assert.equal(isFormattingOnly(patches.pythonTrailing, { keepIndentation: true }), true);
  assert.equal(isFormattingOnly(patches.blankLines, { keepIndentation: true }), true);
});

test('isIndentSensitive matches Python, YAML and Makefiles only', () => {
  for (const path of ['app/main.py', 'stubs/x.pyi', 'config.yaml', '.github/workflows/ci.yml', 'Makefile', 'build/rules.mk']) {
    assert.equal(isIndentSensitive(path), true, path);
  }
  for (const path of ['src/a.ts', 'README.md', 'go.mod', 'yaml/notes.txt']) {
    assert.equal(isIndentSensitive(path), false, path);
  }
});

const kinds = (files: PrFile[]): ChurnKind[] => analyzeScope(files).churn.map((c) => c.kind);

test('a focused change has no churn flags', () => {
  const files = [
    makeFile('src/config.ts', { additions: 2, deletions: 1, patch: patches.logicChange }),
    makeFile('src/config.test.ts', { additions: 20 }),
  ];
  assert.deepEqual(kinds(files), []);
});

test('totals count files and lines overall and per class', () => {
  const report = analyzeScope([
    makeFile('src/a.ts', { additions: 10, deletions: 2 }),
    makeFile('src/b.ts', { additions: 5, deletions: 5 }),
    makeFile('src/a.test.ts', { additions: 30, deletions: 0 }),
    makeFile('package.json', { additions: 1, deletions: 1 }),
    makeFile('package-lock.json', { additions: 400, deletions: 120 }),
  ]);
  assert.equal(report.totals.files, 5);
  assert.equal(report.totals.additions, 446);
  assert.equal(report.totals.deletions, 128);
  assert.deepEqual(report.totals.byClass.source, { files: 2, additions: 15, deletions: 7 });
  assert.deepEqual(report.totals.byClass.test, { files: 1, additions: 30, deletions: 0 });
  assert.deepEqual(report.totals.byClass.lockfile, { files: 1, additions: 400, deletions: 120 });
  assert.deepEqual(report.totals.byClass.docs, { files: 0, additions: 0, deletions: 0 });
  assert.equal(report.totals.reviewableLines, 54);
  assert.deepEqual(report.files.map((f) => f.fileClass), ['source', 'source', 'test', 'config', 'lockfile']);
});

test('a lockfile changed without its manifest is flagged with the file as evidence', () => {
  const report = analyzeScope([makeFile('src/a.ts'), makeFile('yarn.lock', { additions: 50, deletions: 40 })]);
  assert.equal(report.churn.length, 1);
  assert.equal(report.churn[0]?.kind, 'lockfile-without-manifest');
  assert.deepEqual(report.churn[0]?.evidence.map((e) => e.file), ['yarn.lock']);
});

test('a lockfile with its manifest is not flagged', () => {
  assert.deepEqual(kinds([makeFile('package.json'), makeFile('package-lock.json')]), []);
  assert.deepEqual(kinds([makeFile('go.mod'), makeFile('go.sum')]), []);
  assert.deepEqual(kinds([makeFile('Gemfile.lock'), makeFile('widgets.gemspec')]), []);
});

test('a root lockfile accepts a workspace manifest below it', () => {
  assert.deepEqual(kinds([makeFile('packages/web/package.json'), makeFile('pnpm-lock.yaml')]), []);
});

test('a nested lockfile needs a manifest in its own directory tree', () => {
  const report = analyzeScope([makeFile('package.json'), makeFile('apps/api/package-lock.json')]);
  assert.deepEqual(report.churn.map((c) => c.kind), ['lockfile-without-manifest']);
  assert.deepEqual(report.churn[0]?.evidence.map((e) => e.file), ['apps/api/package-lock.json']);
});

test('the wrong manifest does not count', () => {
  assert.deepEqual(kinds([makeFile('pyproject.toml'), makeFile('Cargo.lock')]), ['lockfile-without-manifest']);
});

test('a manifest inside a vendored directory does not satisfy a lockfile', () => {
  assert.deepEqual(kinds([makeFile('vendor/x/package.json'), makeFile('package-lock.json')]), ['lockfile-without-manifest']);
  assert.deepEqual(kinds([makeFile('node_modules/y/package.json'), makeFile('yarn.lock')]), ['lockfile-without-manifest']);
});

test('lockfiles inside vendored directories are not flagged', () => {
  assert.deepEqual(kinds([makeFile('vendor/lib/Cargo.lock')]), []);
});

test('formatting-only files are flagged; files without a patch are not', () => {
  const report = analyzeScope([
    makeFile('src/a.ts', { patch: patches.reindent }),
    makeFile('src/b.ts', { patch: patches.logicChange }),
    makeFile('assets/logo.png', { additions: 0, deletions: 0 }),
  ]);
  assert.deepEqual(report.churn.map((c) => c.kind), ['formatting-only']);
  assert.deepEqual(report.churn[0]?.evidence.map((e) => e.file), ['src/a.ts']);
  assert.equal(report.churn[0]?.message, '1 file with whitespace-only changes');
});

test('re-indenting a Python file is not formatting churn, a trailing-space fix is', () => {
  assert.deepEqual(kinds([makeFile('app/logic.py', { patch: patches.pythonDedent })]), []);
  assert.deepEqual(kinds([makeFile('app/logic.py', { patch: patches.pythonTrailing })]), ['formatting-only']);
  assert.deepEqual(kinds([makeFile('.github/workflows/ci.yml', { patch: patches.reindent })]), []);
});

test('generated files are flagged', () => {
  const report = analyzeScope([makeFile('src/a.ts'), makeFile('dist/a.js'), makeFile('dist/a.js.map')]);
  assert.deepEqual(report.churn.map((c) => c.kind), ['generated']);
  assert.equal(report.churn[0]?.message, '2 generated files changed');
});

test('a diff over the line limit is flagged; lockfile lines do not count', () => {
  assert.deepEqual(kinds([makeFile('src/a.ts', { additions: 900, deletions: 101 })]), ['large-diff']);
  assert.deepEqual(kinds([makeFile('src/a.ts', { additions: 900, deletions: 100 })]), []);
  assert.deepEqual(kinds([makeFile('package.json'), makeFile('package-lock.json', { additions: 5000 })]), []);
});

test('a diff over the file limit is flagged, and limits can be overridden', () => {
  const many = Array.from({ length: 51 }, (_, i) => makeFile(`src/f${i}.ts`));
  assert.deepEqual(kinds(many), ['large-diff']);
  assert.deepEqual(kinds(many.slice(0, 50)), []);
  const report = analyzeScope([makeFile('src/a.ts', { additions: 30 }), makeFile('src/b.ts')], { maxReviewableLines: 20, maxFiles: 1 });
  assert.deepEqual(report.churn.map((c) => c.kind), ['large-diff']);
  assert.deepEqual(report.churn[0]?.evidence.map((e) => e.note), [
    '31 reviewable lines changed (limit 20)',
    '2 files changed (limit 1)',
  ]);
});

test('several kinds of churn are reported together in a stable order', () => {
  const files = [
    makeFile('dist/bundle.js'),
    makeFile('src/a.ts', { patch: patches.rewrap }),
    makeFile('yarn.lock'),
    ...Array.from({ length: 50 }, (_, i) => makeFile(`src/f${i}.ts`)),
  ];
  assert.deepEqual(kinds(files), ['lockfile-without-manifest', 'formatting-only', 'generated', 'large-diff']);
});

test('an empty file list gives zero totals and no flags', () => {
  const report = analyzeScope([]);
  assert.equal(report.totals.files, 0);
  assert.equal(report.totals.reviewableLines, 0);
  assert.deepEqual(report.churn, []);
});
