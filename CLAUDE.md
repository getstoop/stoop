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
  rebuild after web changes; `make e2e` runs the browser suite on its own
  throwaway server and database, but still needs the user's go-ahead — they
  review the change on the dev instance first. Changes land by
  pull request: `main` refuses direct pushes and merges only with green
  CI (`docs/agent-workflow.md` → How a change lands).
