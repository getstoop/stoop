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

render | tr -d ' \n"' | grep -q 'published:8080' || fail "default: app is not published on 8080"
# Compose renders a range as one entry per port.
out=$(render | tr -d ' \n"')
for want in published:50000protocol:udp published:50100protocol:udp; do
	echo "$out" | grep -q "$want" || fail "default: $want missing from the render"
done
echo "$out" | grep -q 'published:50101' && fail "default: UDP media range runs past 50100"

# Ports: one line each in .env moves the published port and LiveKit's own.
printf 'STOOP_PORT=8090\nSTOOP_LIVEKIT_TCP_PORT=7891\nSTOOP_LIVEKIT_UDP_PORTS=51000-51050\n' >>"$env_file"
out=$(render | tr -d ' \n"')
for want in published:8090 published:7891 target:7891 LIVEKIT_RTC_TCP_PORT:7891 \
	published:51000protocol:udp target:51050published:51050 STOOP_LIVEKIT_UDP_PORTS:51000-51050; do
	echo "$out" | grep -q "$want" || fail "ports: $want missing from the render"
done
echo "$out" | grep -q 'published:50000' && fail "ports: the default UDP range is still published"
cp "$deploy/.env.example" "$env_file"

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
