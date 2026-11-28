# PRoof tasks

Status values: `todo`, `review (PR #n)`, `done (PR #n)`, `blocked: <reason>`. Sizes: S (under 150 lines changed), M (150–400). The autopilot picks the first `todo` task whose dependencies are `done`. One task per PR. Tasks in M0 are pure logic with no I/O.

## M0 Pure logic (target 21 Dec 2026)

### PR-001 Core types for a PR snapshot
- Status: done (PR #1)
- Size: S
- Depends on: none
- Goal: `src/types.ts` with `PrSnapshot` (number, title, body, author `{login, association, isFirstTime}`, base/head SHAs, files `{path, status, additions, deletions, patch?}`, labels, linkedIssues, checks `{name, conclusion}`), `IssueSnapshot`, and `CheckResult` (id, passed, points, message, evidence).
- Acceptance: types exported from `src/index.ts`; a fixture builder `test/fixtures/pr.ts` creates snapshots for tests.

### PR-002 Linked issue extraction
- Status: done (PR #2)
- Size: S
- Depends on: PR-001
- Goal: `src/extract/links.ts` finds linked issues in PR title and body: closing keywords (`fixes #12`, `closes owner/repo#3`, `resolves https://github.com/o/r/issues/4`), bare `#n` mentions (marked as weak), and ignores code blocks and quotes.
- Acceptance: table-driven tests with at least 15 cases, including cross-repo links and keywords inside code fences.

### PR-003 Diff scope analysis
- Status: done (PR #3)
- Size: M
- Depends on: PR-001
- Goal: `src/checks/scope.ts` classifies changed files (source, test, docs, config, lockfile, generated, vendored, CI) by path rules, computes totals, and flags unrelated churn: lockfile-only changes without manifest changes, formatting-only patches (whitespace-only hunks), generated files, and diffs over a size threshold.
- Acceptance: tests for each class and churn flag using small patch fixtures.

### PR-004 Test signals
- Status: done (PR #4)
- Size: S
- Depends on: PR-003
- Goal: `src/checks/tests.ts` reports tests added, modified or deleted, and newly skipped tests by scanning added patch lines for `.skip(`, `xit(`, `xdescribe(`, `@pytest.mark.skip`, `t.Skip(`, `@Disabled`.
- Acceptance: tests cover JS, Python, Go and Java patterns, and removed skips are not counted.

### PR-005 CONTRIBUTING.md rule extraction
- Status: done (PR #5)
- Size: M
- Depends on: PR-001
- Goal: `src/rules/contributing.ts` reads CONTRIBUTING.md and the PR template and extracts checkable rules by pattern: issue required, tests required, DCO sign-off, changelog entry, one topic per PR, template sections that must be filled. Each rule carries the source line as evidence.
- Acceptance: fixtures from 5 realistic CONTRIBUTING files (written for tests, not copied) with expected rules.

### PR-006 Rule evaluation against a PR
- Status: done (PR #6)
- Size: M
- Depends on: PR-002, PR-004, PR-005
- Goal: `src/rules/evaluate.ts` checks each rule: linked issue present, tests changed, `Signed-off-by` on commits, CHANGELOG touched, empty template sections left as placeholders.
- Acceptance: tests for pass and fail of every rule kind; output is `CheckResult[]` with evidence.

### PR-007 Policy file schema and defaults
- Status: review
- Size: S
- Depends on: PR-001
- Goal: `src/policy.ts` defines `.proof.yml` options (enabled checks, weights, thresholds, label names, external-author definition, autoClose with required `confirm: true`) with defaults and a validator returning readable errors.
- Acceptance: tests for defaults, partial overrides, invalid values and that autoClose without confirm is rejected.

### PR-008 Issue-to-diff match (lexical)
- Status: todo
- Size: M
- Depends on: PR-002, PR-003
- Goal: `src/checks/match.ts` scores how well the diff relates to the linked issue without a model: identifiers and file paths mentioned in the issue versus touched files and changed identifiers, TF-IDF-style overlap, returning 0–1 with the matched terms as evidence.
- Acceptance: tests with matching, unrelated and partially related fixtures.

### PR-009 Scoring and priority
- Status: todo
- Size: S
- Depends on: PR-006, PR-007, PR-008
- Goal: `src/score.ts` combines `CheckResult`s with policy weights into a 0–100 score and a priority (`review-now`, `needs-info`, `low-evidence`), with a breakdown list.
- Acceptance: tests for thresholds, clamping and custom weights.

### PR-010 Evidence card renderer
- Status: todo
- Size: M
- Depends on: PR-009
- Goal: `src/card.ts` renders the sticky Markdown card: priority badge line, score with breakdown table, per-check details with evidence, "what would raise this score" tips for the contributor, and a hidden marker `<!-- proof:card -->`.
- Acceptance: snapshot tests for each priority; content from the PR is escaped.

### PR-011 Eval harness and seed dataset
- Status: todo
- Size: M
- Depends on: PR-009
- Goal: `eval/dataset.jsonl` with 20 synthetic but realistic PR snapshots and expected priorities; `eval/run.ts` (`npm run eval`) reports accuracy, per-class precision and recall, and false positives on first-time contributors.
- Acceptance: the harness runs offline; results printed as a Markdown table.

## M1 App wiring (target 15 Jan 2027)

### PR-012 Depend on forge-core and build the pipeline skeleton
- Status: todo
- Size: S
- Depends on: PR-010
- Goal: add forge-core (Git dependency on its v0.1.0 tag), create `src/pipeline.ts` that takes collectors and actions as interfaces and runs checks → score → card.
- Acceptance: pipeline test with fake collectors produces a card.

### PR-013 Collectors over the GitHub API
- Status: todo
- Size: M
- Depends on: PR-012
- Goal: `src/collect/` builds a `PrSnapshot` from the API: PR, files (paginated), linked issues, check runs, author association and first-time status, CONTRIBUTING.md and PR template.
- Acceptance: tests against forge-core's fake HTTP client with recorded fixtures.

### PR-014 Actions: sticky card, labels, check run
- Status: todo
- Size: S
- Depends on: PR-013
- Goal: `src/act/` posts or updates the card, syncs priority labels (removing stale ones), and creates a neutral check run with the summary.
- Acceptance: tests for first run, re-run and label change.

### PR-015 App entry and `/proof recheck`
- Status: todo
- Size: M
- Depends on: PR-014
- Goal: `src/app.ts` wires forge-core's app server to the pipeline for PR events and the recheck comment command (only from users with write access).
- Acceptance: integration test with a signed fixture.

### PR-016 GitHub Action packaging
- Status: todo
- Size: M
- Depends on: PR-015
- Goal: `action.yml` and `src/action/main.ts` to run PRoof inside a repo's own workflow using `GITHUB_TOKEN`.
- Acceptance: a workflow example in `docs/` and a test that runs the action entry with a fake event payload.

## M2 Reproduce and AI summary (target 29 Jan 2027)

### PR-017 Repro command extraction
- Status: todo
- Size: S
- Depends on: PR-002
- Goal: find repro commands and failing test names in issue text (fenced shell blocks, "steps to reproduce" lists, test IDs).
- Acceptance: table-driven tests.

### PR-018 Before/after reproduction runner
- Status: todo
- Size: M
- Depends on: PR-015, PR-017
- Goal: run the repro on base and head in a sandbox (Actions dispatch by default), record outcomes, add a check result.
- Acceptance: tests with forge-core's fake runner.

### PR-019 AI change summary
- Status: todo
- Size: M
- Depends on: PR-015
- Goal: budgeted, guarded model call that returns JSON `{ doesWhat, claimsVsReality, evidence: [{file, line, quote}] }`; validated; rendered in the card.
- Acceptance: tests with the fake provider, including invalid JSON repair and budget refusal.

### PR-020 Docs site and demo repo plan
- Status: todo
- Size: S
- Depends on: PR-016
- Goal: `docs/` pages: quick start, policy reference, scoring model, FAQ on fairness; README badges and screenshots placeholders.
- Acceptance: links checked by a small script in CI.
