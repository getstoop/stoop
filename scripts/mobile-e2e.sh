#!/usr/bin/env sh
# Run the phone app's flows (mobile/e2e/*.yaml) with Maestro on a throwaway
# instance, the way e2e-scratch.sh runs the browser suite: a fresh database
# on the dev Postgres container and a second bin/stoop on its own port,
# seeded over RPC by mobile/e2e/seed.mjs. The dev server on :8091 and the
# `stoop` database are never touched.
#   scripts/mobile-e2e.sh                          every flow
#   scripts/mobile-e2e.sh mobile/e2e/sign-in.yaml  just that one
# Needs bin/stoop from `make build`, Docker for the dev Postgres, Maestro,
# and the app installed on a booted iOS simulator (mobile/README.md →
# Tests). STOOP_MOBILE_E2E_PORT picks another port than 8093.
set -eu
cd "$(dirname "$0")/.."

FLOWS=${*:-mobile/e2e}
PORT=${STOOP_MOBILE_E2E_PORT:-8093}
DB=stoop_mobile_e2e
DB_URL="postgres://stoop:stoop@localhost:5440/$DB?sslmode=disable"
COMPOSE="docker compose -f deploy/docker-compose.dev.yml"
STORAGE=$PWD/tmp/mobile-e2e-storage
LOG=tmp/mobile-e2e-server.log
SEEDED=tmp/mobile-e2e.env

command -v maestro >/dev/null || { echo "maestro missing; see mobile/README.md → Tests" >&2; exit 1; }
test -x bin/stoop || { echo "bin/stoop missing; run make build" >&2; exit 1; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is in use; stop what holds it or set STOOP_MOBILE_E2E_PORT:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 1
fi

# The app's bundle ID: a developer build's own from mobile/.env.local, as
# app.config.js reads it, else the app's.
APP_ID=$(sed -n 's/^STOOP_IOS_BUNDLE_ID=//p' mobile/.env.local 2>/dev/null | tail -n 1)
APP_ID=${APP_ID:-org.getstoop.app}

$COMPOSE up -d --wait postgres
$COMPOSE exec -T postgres psql -U stoop -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER stoop"

rm -rf "$STORAGE"
mkdir -p "$STORAGE" tmp

# As e2e-scratch.sh: no public URL, so invite links carry this server's
# local origin, and no sign-in throttle.
unset STOOP_TAILSCALE STOOP_TAILSCALE_FUNNEL STOOP_TRUST_PROXY STOOP_PUBLIC_URL STOOP_LIVEKIT_URL
STOOP_DATABASE_URL=$DB_URL STOOP_LISTEN_ADDR=":$PORT" STOOP_STORAGE_DIR=$STORAGE \
STOOP_AUTH_RATE_LIMIT=0 \
bin/stoop >"$LOG" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null' EXIT INT TERM

i=0
until curl -sf "http://localhost:$PORT/healthz" >/dev/null; do
  i=$((i + 1))
  if [ $i -ge 30 ] || ! kill -0 $pid 2>/dev/null; then
    echo "scratch server did not come up on :$PORT; see $LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "scratch server on :$PORT (database $DB, log $LOG)"

STOOP_E2E_BASE_URL="http://localhost:$PORT" node mobile/e2e/seed.mjs >"$SEEDED"

# Each seeded KEY=value becomes a -e for the flows. Values may hold spaces.
set -- -e "APP_ID=$APP_ID"
while IFS= read -r line; do
  set -- "$@" -e "$line"
done <"$SEEDED"

status=0
maestro test mobile/e2e/setup || status=$?
# shellcheck disable=SC2086 # FLOWS is a list of paths
[ $status -ne 0 ] || maestro test "$@" $FLOWS || status=$?
[ $status -eq 0 ] || echo "server log: $LOG" >&2
exit $status
