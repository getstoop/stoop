# Stoop

Self-hosted community chat: a Go monolith (Connect RPC, Postgres, LiveKit)
with a React web app in `web/`.

- **Layout and file-size rules:** `docs/conventions.md` — one component
  per `.tsx` file (directories with an `index.tsx` for bigger ones), one
  stylesheet per feature under `web/src/styles/`, one Go file per entity.
- **Module boundaries and the realtime protocol:** `docs/architecture/`
  (start at `docs/architecture/README.md`).
- **Environment traps, build/run/verify steps, E2E rules:**
  `docs/agent-workflow.md`. In short: `make lint`, `make test`,
  `make build` from the repo root; the binary embeds `web/dist`, so
  rebuild after web changes; the browser suite runs in CI on the pull
  request, so don't run `make e2e` locally before a push (it is there for
  debugging a spec CI failed). Changes land by
  pull request: `main` refuses direct pushes and merges only with green
  CI (`docs/agent-workflow.md` → How a change lands).
- **Releases and patch releases:** `docs/releasing.md` — a minor is a tag
  on `main`; a patch is a tag on a `release/X.Y` branch off the previous
  tag and carries no migrations.
- **Build Iteratively:** Build stable simple solutions before building nice 
  to have features or clever solutions. The operator has the final say in
  what you build.
