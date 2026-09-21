#!/usr/bin/env sh
# Render deploy/docker-compose.yml the ways an operator's .env can ask for
# and check what comes out. Starts nothing; needs only `docker compose`.
set -eu
deploy=$(cd "$(dirname "$0")/../deploy" && pwd)

# A copy in a scratch directory, because the file reads the .env beside it.
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cp "$deploy/docker-compose.yml" "$dir/"
cd "$dir"
env_file=.env
fail() { echo "compose-check: $1" >&2; exit 1; }

render() { docker compose config "$@"; }
services() { render --services | sort | tr '\n' ' '; }

# The shipped .env.example: everything bundled.
cp "$deploy/.env.example" "$env_file"
[ "$(services)" = "livekit postgres stoop " ] || fail "default: got services: $(services)"
render | grep -q 'STOOP_DATABASE_URL: postgres://stoop:change-me@postgres:5432/stoop' ||
	fail "default: STOOP_DATABASE_URL is not the bundled Postgres"

# POSTGRES_ARGS reaches the server as separate arguments.
render | tr -d ' \n' | grep -q -- 'command:-postgresenvironment:' ||
	fail "default: postgres command is not the image's own"
echo 'POSTGRES_ARGS=-c shared_buffers=256MB -c max_connections=50' >>"$env_file"
render | tr -d ' \n' | grep -q -- 'command:-postgres--c-shared_buffers=256MB--c-max_connections=50' ||
	fail "POSTGRES_ARGS: flags did not reach the postgres command"

# Own Postgres: profile off, URL set.
printf 'COMPOSE_PROFILES=\nSTOOP_DATABASE_URL=postgres://me@db.lan/stoop\n' >"$env_file"
[ "$(services)" = "livekit stoop " ] || fail "own postgres: got services: $(services)"
render | grep -q 'STOOP_DATABASE_URL: postgres://me@db.lan/stoop' ||
	fail "own postgres: STOOP_DATABASE_URL from .env was not used"
render 2>&1 | grep -qi 'warn' && fail "own postgres: compose printed a warning"

echo "compose-check: ok"
