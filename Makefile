.PHONY: dev dev-git-check dev-port-check dev-services dev-services-stop dev-reset dev-flood generate build build-web lint test e2e migrate-new docker clean

BINARY := bin/stoop
# The Go hot-reloader, by path: Homebrew ships an unrelated `air` (the R
# language server) that shadows it on PATH, and `make dev` would then run
# the wrong tool and leave Vite proxying to nothing.
AIR := $(shell go env GOPATH)/bin/air

# ---- Development -----------------------------------------------------------

## dev: start Postgres + LiveKit, then run the Go server (hot reload) and Vite
## together. Everything is at http://localhost:8091: the server proxies the web
## app to Vite (STOOP_DEV_WEB_URL), so a browser, the desktop shell and a phone
## all see the live source. Vite itself is pinned to :5173.
dev: dev-git-check dev-port-check dev-services
	@test -x $(AIR) || { echo "make dev: $(AIR) not found; install with: go install github.com/air-verse/air@latest" >&2; exit 1; }
	@echo "make dev: http://localhost:8091 (Go with hot reload; web app live from Vite on :5173)"
	@trap 'kill 0' INT TERM; \
	STOOP_DEV_WEB_URL=http://localhost:5173 $(AIR) & \
	(cd web && pnpm dev) & \
	wait

## dev-git-check: name what is about to run, and warn when origin/main has
## commits this checkout lacks — work lands by PR, so a checkout left on an
## old branch runs old code with nothing else saying so
dev-git-check:
	@git fetch -q origin 2>/dev/null || true; \
	echo "make dev: running $$(git rev-parse --abbrev-ref HEAD) @ $$(git rev-parse --short HEAD)"; \
	behind=$$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0); \
	if [ "$$behind" != 0 ]; then \
	  echo "make dev: WARNING: origin/main has $$behind commit(s) this checkout lacks; git switch main && git pull to run what has landed" >&2; \
	fi

## dev-port-check: refuse to start if something already holds the server port
## or Vite's — a stale bin/stoop on 8091 would take the traffic instead of
## air's build, and another Vite on 5173 would be what the proxy serves
dev-port-check:
	@for port in 8091 5173; do \
	  if lsof -nP -iTCP:$$port -sTCP:LISTEN >/dev/null 2>&1; then \
	    echo "make dev: port $$port is already in use:" >&2; \
	    lsof -nP -iTCP:$$port -sTCP:LISTEN >&2; \
	    echo "stop it first (kill <PID>), then rerun make dev" >&2; \
	    exit 1; \
	  fi; \
	done

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

## dev-flood: fill a space with generated messages, e.g. make dev-flood count=20000 space="The Stoop"
dev-flood:
	node scripts/dev-flood.mjs --space "$(or $(space),The Stoop)" --count $(or $(count),5000) --days $(or $(days),60)

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

## e2e: browser suite on a throwaway instance (scripts/e2e-scratch.sh): a
## fresh database, its own server on :8092 and its own storage, so the dev
## server and its data are untouched. make e2e specs="replies edits" runs a subset.
e2e: build
	scripts/e2e-scratch.sh $(specs)

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
