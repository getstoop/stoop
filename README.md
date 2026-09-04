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
natively in dev — see docs/self-hosting.md → Voice in development for why).

```sh
make dev        # Postgres in Docker + LiveKit on the host, Go server with hot reload, Vite dev server
                # → web UI at http://localhost:5173 (proxies the API, /ws and /livekit to :8091)

make generate   # regenerate protobuf + sqlc code (output is committed)
node scripts/gen-emoji.mjs   # refresh the reaction picker's emoji list from Unicode (output is committed)
make lint       # golangci-lint (incl. module-boundary rules) + biome + tsc + theme contrast check
make test       # go test ./...
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

- `make test` — Go unit tests. Tests that need Postgres (most of `internal/`)
  create a throwaway database per test when `STOOP_TEST_DATABASE_URL` is
  set and skip otherwise: `STOOP_TEST_DATABASE_URL=postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable make test`.
- `make dev-reset` — wipe the dev database and seed a fixed cast against the
  running server: eight named accounts (`casey` is the server admin) plus
  eighteen extra neighbours in The Stoop so its member list scrolls, all
  with password `password1` and profiles filled in unevenly on purpose (two have
  no bio, two no pronouns, so the empty states have somewhere to show),
  across two spaces — "The Stoop" (a neighbourhood) and
  "Basement Arcade" (a gaming guild), each with a description, welcome text and
  channels with topics, and a few people in both. It prints the accounts and
  their roles when it finishes.
- `make e2e` — browser end-to-end suite (`web/e2e/*.mjs`, puppeteer driving
  a local Chrome). It builds, then `scripts/e2e-scratch.sh` recreates a
  `stoop_e2e` database on the dev Postgres, starts a second server on :8092
  with its own storage directory, runs every spec against it and stops it;
  the dev server and its data are left alone. `make e2e specs="setup members"`
  runs a subset. Set `STOOP_E2E_CHROME` if Chrome isn't in the usual place.
  The runner itself (`cd web && pnpm e2e`) works against any server named
  by `STOOP_E2E_BASE_URL`, wiping the database in `STOOP_E2E_DATABASE_URL`
  before each spec; a hand-started server needs
  `STOOP_UNFURL_ALLOW_PRIVATE=true STOOP_AUTH_RATE_LIMIT=0` (the suite signs
  in far more than 20 times a minute from one address). The voice spec is
  opt-in — `STOOP_E2E_VOICE=1 pnpm e2e voice` — because it needs the server
  pointed at a running LiveKit with the key pair it minted (`make dev`
  does that; the scratch server has no LiveKit); CI skips it.

CI runs lint, codegen drift checks, the Go tests, and the browser suite.

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) says how a change lands;
[SECURITY.md](SECURITY.md) says how to report a vulnerability privately.

## License

[Apache-2.0](LICENSE)
