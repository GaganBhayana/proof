# PRoof

**Don't guess whether a PR is slop. Check.**

Verified PR triage for maintainers. PRoof checks whether a pull request does what it claims: linked issue, diff scope, tests, CI, your CONTRIBUTING rules and an optional before/after reproduction. Then it posts one evidence card with a priority. It never auto-closes by default.

> Status: pre-alpha, built in public. Follow progress in [docs/TASKS.md](docs/TASKS.md); the full plan is in [docs/PLAN.md](docs/PLAN.md).

## Development

Requires Node 22.18 or newer. No build step is needed for development: Node runs the TypeScript sources directly.

```sh
npm install
npm run check   # type-check + tests
```

## How this project is built

Work is planned in [docs/TASKS.md](docs/TASKS.md) and delivered in small, reviewed pull requests by an autonomous Claude pipeline that the owner supervises. See [oss-autopilot](https://github.com/GaganBhayana/oss-autopilot). AI involvement is disclosed on every commit.

## License

Apache-2.0
