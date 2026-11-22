import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult } from './types.ts';
import { makeAuthor, makeFile, makeIssue, makePr } from '../test/fixtures/pr.ts';

test('makePr builds a consistent default snapshot', () => {
  const pr = makePr();
  assert.equal(pr.number, 42);
  assert.equal(pr.headSha.length, 40);
  assert.equal(pr.linkedIssues[0]?.number, 12);
  assert.ok(pr.files.some((file) => file.path.endsWith('.test.ts')));
});

test('overrides replace defaults without touching other fields', () => {
  const pr = makePr({ author: makeAuthor({ isFirstTime: true, association: 'FIRST_TIME_CONTRIBUTOR' }), files: [] });
  assert.equal(pr.author.isFirstTime, true);
  assert.equal(pr.files.length, 0);
  assert.equal(pr.title, makePr().title);
});

test('makeFile and makeIssue apply overrides', () => {
  assert.deepEqual(makeFile('README.md', { status: 'added', additions: 3 }), {
    path: 'README.md',
    status: 'added',
    additions: 3,
    deletions: 0,
  });
  assert.equal(makeIssue({ state: 'closed' }).state, 'closed');
});

test('a CheckResult can carry evidence with file and line', () => {
  const result: CheckResult = {
    id: 'tests.added',
    passed: true,
    points: 10,
    message: 'Tests were added',
    evidence: [{ note: 'New test file', file: 'src/config.test.ts', line: 1 }],
  };
  assert.equal(result.evidence[0]?.file, 'src/config.test.ts');
});
