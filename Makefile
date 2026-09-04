.PHONY: dev dev-port-check dev-services dev-services-stop dev-reset generate build build-web lint test e2e migrate-new docker clean

BINARY := bin/stoop
# The Go hot-reloader, by path: Homebrew ships an unrelated `air` (the R
# language server) that shadows it on PATH, and `make dev` would then run
# the wrong tool and leave Vite proxying to nothing.
AIR := $(shell go env GOPATH)/bin/air

# ---- Development -----------------------------------------------------------

## dev: start Postgres + LiveKit, then run the Go server (hot reload) and Vite together
dev: dev-port-check dev-services
	@test -x $(AIR) || { echo "make dev: $(AIR) not found; install with: go install github.com/air-verse/air@latest" >&2; exit 1; }
	@trap 'kill 0' INT TERM; \
	$(AIR) & \
	(cd web && pnpm dev) & \
	wait

## dev-port-check: refuse to start if something already holds the server port — a
## stale bin/stoop there would silently take Vite's proxy traffic instead of air's build
dev-port-check:
	@if lsof -nP -iTCP:8091 -sTCP:LISTEN >/dev/null 2>&1; then \
	  echo "make dev: port 8091 is already in use; air would fail to bind and Vite would proxy to the old process:" >&2; \
	  lsof -nP -iTCP:8091 -sTCP:LISTEN >&2; \
	  echo "stop it first (kill <PID>), then rerun make dev" >&2; \
	  exit 1; \
	fi

## dev-services: start the dev dependencies — Postgres in Docker, LiveKit on the host network
dev-services:
	docker compose -f deploy/docker-compose.dev.yml up -d --wait
	scripts/dev-livekit.sh start

## dev-services-stop: stop them
dev-services-stop:
	scripts/dev-livekit.sh stop
	docker compose -f deploy/docker-compose.dev.yml down

## dev-reset: wipe the dev database; seed the fixed cast (password1) in "The Stoop" and "Basement Arcade"
dev-reset:
	node scripts/dev-reset.mjs

# ---- Code generation -------------------------------------------------------

## generate: regenerate protobuf (Go + TS) and sqlc code; output is committed
generate:
	buf lint
	buf generate
	sqlc generate

# ---- Build -----------------------------------------------------------------

## build-web: build the SPA and stage it for go:embed. The tracked .gitkeep
## is restored so `all:dist` always matches something on a fresh checkout
## (CI's lint and cross-compile jobs never build the web app).
build-web:
	cd web && pnpm install --frozen-lockfile && pnpm build
	rm -rf internal/webui/dist
	cp -R web/dist internal/webui/dist
	touch internal/webui/dist/.gitkeep

## build: produce the single self-contained server binary
build: build-web
	CGO_ENABLED=0 go build -trimpath -o $(BINARY) ./cmd/stoop

# ---- Quality ---------------------------------------------------------------

lint:
	golangci-lint run
	cd web && pnpm lint && pnpm typecheck && pnpm check:themes && pnpm check:styles

test:
	go test ./...

## e2e: browser end-to-end suite against a running server (see web/e2e/run.mjs)
e2e:
	cd web && pnpm e2e

# ---- Database --------------------------------------------------------------

## migrate-new: create a new migration file, e.g. make migrate-new name=add_invites
migrate-new:
	goose -dir internal/db/migrations create $(name) sql

# ---- Docker ----------------------------------------------------------------

docker:
	docker build -f deploy/Dockerfile -t stoop:dev .

clean:
	rm -rf bin web/dist
	rm -rf internal/webui/dist && mkdir -p internal/webui/dist && touch internal/webui/dist/.gitkeep
