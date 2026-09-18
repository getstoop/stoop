# Stoop

**A self-hostable chat & voice app for you and your people.**

Run it on your own machine — a VPS, an old laptop, a Raspberry Pi — and
invite your friends. Spaces, channels, realtime text chat, and low-latency
voice rooms backed by [LiveKit](https://livekit.io).

> Beta. The core works and is in daily use — accounts, spaces, channels,
> realtime messaging, voice — and the API and schema may still change
> between minor versions. What will not change: every release upgrades in
> place from the one before it, and can be rolled back one release.

## Why Stoop

- **Yours.** One static binary + Postgres. Your community's messages live on
  your hardware, not someone else's cloud.
- **Small-hardware friendly.** Pure-Go static builds for linux/amd64 and
  linux/arm64; runs happily on a Pi.
- **Boring, sturdy tech.** Go, Postgres, protobuf contracts
  ([Connect RPC](https://connectrpc.com)), React. Typed end to end — the same
  schemas drive the HTTP API, the WebSocket events, and the TypeScript client.

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md) — including how to put
Stoop behind the reverse proxy, Cloudflare Tunnel, or Tailscale you already
use, and what voice needs from each. Short version:

```sh
R=https://github.com/getstoop/stoop/releases/latest/download
curl -fLO $R/docker-compose.yml
curl -fLO $R/livekit.yaml
curl -fLO $R/livekit-entrypoint.sh
curl -fL -o .env $R/env.example
# edit .env — at minimum POSTGRES_PASSWORD
docker compose up -d          # open http://localhost:8080
```

## Developing

Prereqs: Go ≥ 1.27, Node ≥ 20 + pnpm, Docker, and for codegen
[buf](https://buf.build) + [sqlc](https://sqlc.dev). On macOS:
`brew install go buf sqlc golangci-lint air livekit` (LiveKit runs
natively in dev — see docs/architecture/voice.md → Development for why).

```sh
make dev        # Postgres in Docker + LiveKit on the host, Go server with hot reload, Vite dev server
                # → everything at http://localhost:8091: the server proxies the web app to Vite (:5173),
                #   so a browser, the desktop shell and a phone on the LAN all see the live source

make generate   # regenerate protobuf + sqlc code (output is committed)
node scripts/gen-emoji.mjs   # refresh the reaction picker's emoji list from Unicode (output is committed)
make lint       # golangci-lint (incl. module-boundary rules) + biome + tsc + theme and stylesheet checks
make test       # go test ./... and the web unit tests (Vitest)
make build      # single self-contained binary at bin/stoop (web UI embedded)
```

Changes land through pull requests: `main` only accepts merges whose CI
(protobuf codegen drift, Go lint and tests, web lint and build, the
browser suite, and both cross-compiles) is green, and refuses direct
pushes. `gh pr create` then `gh pr merge --squash --auto` is
the whole ceremony; the ruleset is described in
[docs/agent-workflow.md](docs/agent-workflow.md#how-a-change-lands).

Architecture — module boundaries, the event bus, the realtime protocol — is
documented in [docs/architecture/](docs/architecture/README.md). The project's
"why" lives in [docs/vision.md](docs/vision.md); how files are laid out
(one component per file, one stylesheet per feature) in
[docs/conventions.md](docs/conventions.md). Handing a ticket to a
coding agent? The brief template and this environment's traps are in
[docs/agent-workflow.md](docs/agent-workflow.md).

## Testing

- `make test` — Go tests and the web unit tests (Vitest). Go tests that
  need Postgres (most of `internal/`) create a throwaway database per test
  when `STOOP_TEST_DATABASE_URL` is set and skip otherwise:
  `STOOP_TEST_DATABASE_URL=postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable make test`.
- `make dev-reset` — wipe the dev database and seed a fixed cast against
  the running server: two spaces, eight named accounts (`casey` is the
  server admin) and eighteen extras, all with password `password1`. It
  prints the accounts and their roles when it finishes.
- `make e2e` — the browser suite (`web/e2e-pw/*.spec.ts`, Playwright
  driving Chromium) on a throwaway server and database; the dev server and
  its data are left alone. `make e2e specs="setup members"` runs a subset.
  CI runs it on every pull request, so you don't need to run it locally.

CI runs lint, codegen drift checks, the Go and web tests, and the browser
suite. More on all of these in
[docs/agent-workflow.md](docs/agent-workflow.md).

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) says how a change lands;
[SECURITY.md](SECURITY.md) says how to report a vulnerability privately.

## License

[Apache-2.0](LICENSE)
