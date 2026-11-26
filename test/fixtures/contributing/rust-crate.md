# Contributing to tinyhash

## Workflow

We only accept pull requests that reference an existing issue (for example
"Fixes #123"). Every PR should address one change at a time.

## Code

Each bug fix should come with a regression test. Run `cargo test` and
`cargo clippy` locally.

## Changelog and sign-off

We use [changesets](https://github.com/changesets/changesets): run
`npx changeset` and commit the generated file with your PR.

Commits do not need a sign-off.
