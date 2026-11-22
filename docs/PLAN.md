# PRoof plan

**Don't guess whether a PR is slop. Check.**

PRoof is a GitHub App and Action for maintainers. On every external pull request it gathers evidence (does the PR match its linked issue, do tests change, does CI pass, does it follow the project's own rules, can the bug be reproduced before and after) and posts one evidence card with a priority. It never closes PRs by default.

## Why

Maintainers estimate about a quarter of incoming PRs are low-quality AI submissions. Existing bots guess from surface signals and auto-close, which also drives away real newcomers. PRoof runs and checks instead, and shows its evidence.

## Users and jobs

| User | Job |
| --- | --- |
| Maintainer of a busy repo | See at a glance which PRs deserve review now |
| First-time human contributor | Get fast, fair, specific feedback on what's missing |
| Enterprise team lead | Triage agent-written PRs by evidence before human review |

## Functional requirements

MVP (launch 29 Jan 2027):

1. **Trigger:** `pull_request` opened, synchronize, reopened, edited; `/proof recheck` comment.
2. **Linked issue match:** extract linked issues (closing keywords, URLs, `#n`), fetch them, compare the issue's ask with the PR's diff and description (keyword overlap first, model summary second).
3. **Diff scope check:** files and areas touched versus what the description claims; flag unrelated churn (lockfiles, formatting-only files, generated code) and very large diffs.
4. **Tests signal:** did tests change or get added; were tests deleted or skipped (`.skip`, `@pytest.mark.skip`, `xit`).
5. **CONTRIBUTING rules:** parse CONTRIBUTING.md and the PR template into checkable rules (issue required, tests required, sign-off, changelog entry, single topic), plus rules in `.proof.yml`.
6. **CI status:** read check runs and statuses for the head commit.
7. **Reproduction (opt-in):** if the issue contains a failing test or repro command and the repo opts in, run it on the base and head commits in a sandbox (the repo's own Actions runner by default) and record before/after.
8. **AI summary:** what the change actually does versus what the description says, with quoted lines as evidence; the PR text is always passed as untrusted data.
9. **Priority:** `review-now`, `needs-info`, `low-evidence`, from a transparent, documented score; labels applied per policy.
10. **Evidence card:** one sticky comment, updated in place, plus an optional check run.
11. **Policy file `.proof.yml`:** thresholds, which checks run, label names, who is "external", optional auto-close (off by default, requires `confirm: true`).

Later:

- AI provenance badge from Agent Trace records and `Co-Authored-By` trailers.
- Contributor history across opted-in repos.
- "Explain this PR" questions the contributor answers before review.
- Triage of issues and security reports with the same evidence approach.
- Public anonymised dashboard of PR quality across installs.

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Fairness | Never judge "AI-written" alone. False positives on first-time human contributors under 2% on our labelled set |
| Security | PR code is untrusted: runs with no secrets, read-only token, no network by default. PR text is data, never instructions |
| Latency | Evidence card within 5 minutes for repos with CI under 10 minutes |
| Cost | Model spend per PR capped (default $0.20); maintainers can supply their own key |
| Privacy | Hosted app stores only metadata and card text; code is read through the API and not retained |
| Reliability | Idempotent on webhook redelivery; one card per PR |

## Architecture

```
GitHub webhook ──► forge-core app server ──► queue ──► PRoof pipeline
                                                       ├─ collectors (pr, files, issue, checks, contributing)
                                                       ├─ checks (scope, tests, rules, ci, match)
                                                       ├─ reproduce (optional, sandbox runner)
                                                       ├─ summarise (llm, budgeted, guarded)
                                                       └─ score → evidence card (sticky comment, labels, check run)
```

- Pure logic lives in `src/checks/`, `src/rules/`, `src/score/` and `src/card/`, with no I/O, so it is fully unit-tested offline.
- I/O lives in `src/collect/` and `src/act/`, built on forge-core's GitHub client.
- `src/action/` packages the same pipeline as a GitHub Action for repos that don't want the hosted app.

## Scoring model (v1, transparent)

Start at 50. Add or subtract documented points: linked issue present (+10), issue/diff match (+0 to +15), tests added (+10), tests deleted or skipped (−20), CI passing (+10) or failing (−10), rules violated (−5 each, max −20), unrelated churn (−10), repro passes after and fails before (+20). `review-now` at 70+, `needs-info` at 40–69, `low-evidence` below 40. Weights live in one file and are overridable in `.proof.yml`.

## Evaluation

A labelled set of real public PRs (good, needs-info, low-quality) in `eval/dataset.jsonl` with expected priorities. `npm run eval` reports precision, recall and the false-positive rate on first-time contributors. The launch bar: false positives under 2%, `review-now` precision above 80%.

## Milestones

| Milestone | Target | Scope |
| --- | --- | --- |
| M0 Pure logic | 21 Dec 2026 | Link extraction, diff scope, test signals, CONTRIBUTING rules, policy schema, score, card renderer, eval harness |
| M1 App wiring | 15 Jan 2027 | Collectors and actions on forge-core, sticky card, labels, check run, recheck command |
| M2 Reproduce + AI | 29 Jan 2027 | Repro via Actions dispatch, AI summary, launch: docs site, demo repo, launch post |
| M3 After launch | Feb–Mar 2027 | Provenance badge, contributor history, issue triage |

## Launch checklist

- Public GitHub App listing and install flow.
- Docs site with the scoring model and policy reference.
- Demo repo with example PRs showing each priority.
- Benchmark results from `npm run eval` in the README.
- Launch post, Show HN, r/opensource, maintainer communities.
