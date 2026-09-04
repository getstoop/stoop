# Contributing

Thanks for looking. Stoop is a small project with one maintainer, so the
rules below exist to keep it small.

## Before you start

- **Bugs and small fixes:** open an issue or a PR straight away.
- **Anything bigger** (a feature, a schema change, a new setting): open an
  issue first and say what you want to change and why. The roadmap lives
  in a private tracker for now; issues are how it becomes visible. A
  short conversation before the work saves a long one after.
- Read [docs/vision.md](docs/vision.md) for what Stoop is trying to be,
  and [docs/architecture/README.md](docs/architecture/README.md) for how
  the pieces fit.

## Making a change

Getting a dev environment running is in the README (Developing);
the traps and verification steps are in
[docs/agent-workflow.md](docs/agent-workflow.md); the layout and
file-size rules are in [docs/conventions.md](docs/conventions.md). In
short:

- `make lint`, `make test`, `make build` from the repo root; the binary
  embeds the web app, so rebuild after web changes.
- One component per `.tsx` file, one stylesheet per feature, one Go file
  per entity. Small files, few comments; reasoning goes in `docs/`.
- Schema changes follow the expand/contract rule in
  [docs/architecture/data.md](docs/architecture/data.md): a release may
  add freely, and may only remove what the previous release stopped
  using.
- Test data uses invented people. No real names, emails or hostnames in
  fixtures, docs or screenshots.

## AI-generated code

Welcome, on one condition: the person opening the PR understands the
code and can answer for it. You are the author of record. Be able to
say what each part does and why it is there, take part in the review
yourself, and answer questions in your own words. A PR whose only
explanation is "the tool wrote it" will be closed, not reviewed. The
same goes for review comments: post them because you agree with them,
not because a tool produced them.

## Pull requests

- Branch from `main`, one change per PR, with a description that says
  what changed and why.
- `main` only merges with every CI job green. CI for a PR from a fork
  runs after a maintainer approves it, so a first PR may wait a little.
- The browser suite runs in CI on a throwaway database. You don't need
  to run it locally, and please don't point it at a database you care
  about: it wipes what it is given.
- Reviews are about the change, not the person. Expect questions;
  expect to be asked to split something.

## Security

Not here: see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), like the rest of the project.
