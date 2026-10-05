#!/usr/bin/env sh
# Run the browser suite on a throwaway instance: a fresh database on the dev
# Postgres container, a second bin/stoop on its own port with its own storage
# directory, and the Playwright suite pointed at both. The dev server on :8091 and
# the `stoop` database are never touched.
#   scripts/e2e-scratch.sh                every spec
#   scripts/e2e-scratch.sh replies edits  just those (any playwright filter)
# Needs bin/stoop from `make build` (`make e2e` builds first) and Docker for
# the dev Postgres. STOOP_E2E_PORT picks another port than 8092.
set -eu
cd "$(dirname "$0")/.."

PORT=${STOOP_E2E_PORT:-8092}
DB=stoop_e2e
DB_URL="postgres://stoop:stoop@localhost:5440/$DB?sslmode=disable"
COMPOSE="docker compose -f deploy/docker-compose.dev.yml"
STORAGE=$PWD/tmp/e2e-storage
LOG=tmp/e2e-server.log

test -x bin/stoop || { echo "bin/stoop missing; run make build (make e2e does)" >&2; exit 1; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is in use; stop what holds it or set STOOP_E2E_PORT:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 1
fi

# Drop and recreate so migrations always start from nothing; the database is
# left in place afterwards for a look at what a failed spec did.
$COMPOSE up -d --wait postgres
$COMPOSE exec -T postgres psql -U stoop -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER stoop"

rm -rf "$STORAGE"
mkdir -p "$STORAGE" tmp

# Voice, if the dev LiveKit is up. Handing this server the pair LiveKit was
# started against (STOOP_LIVEKIT_API_KEY/_SECRET win over minting) is what
# lets the voice spec run here; letting it mint its own is why voice used
# to be left out. Without LiveKit the spec skips itself.
KEYS=data/livekit/keys.yaml
LIVEKIT_ENV=""
if [ -f "$KEYS" ] && curl -sf http://localhost:7880 >/dev/null 2>&1; then
  LIVEKIT_ENV="STOOP_LIVEKIT_URL=http://localhost:7880 \
STOOP_LIVEKIT_API_KEY=$(awk -F': *' 'NR==1{print $1}' "$KEYS") \
STOOP_LIVEKIT_API_SECRET=$(awk -F': *' 'NR==1{print $2}' "$KEYS")"
  echo "voice: using the LiveKit on :7880"
else
  echo "voice: no LiveKit on :7880, the voice spec will skip (make dev-services)"
fi

# The same shape CI starts the server in: no Tailscale, no proxy, no public
# URL (invite links must carry the local origin), private unfurls allowed,
# the per-address sign-in throttle off.
unset STOOP_TAILSCALE STOOP_TAILSCALE_FUNNEL STOOP_TRUST_PROXY STOOP_PUBLIC_URL STOOP_LIVEKIT_URL
env $LIVEKIT_ENV \
STOOP_DATABASE_URL=$DB_URL STOOP_LISTEN_ADDR=":$PORT" STOOP_STORAGE_DIR=$STORAGE \
STOOP_UNFURL_ALLOW_PRIVATE=true STOOP_AUTH_RATE_LIMIT=0 \
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
echo "scratch server on :$PORT (database $DB, storage $STORAGE, log $LOG)"

status=0
(cd web && STOOP_E2E_BASE_URL="http://localhost:$PORT" STOOP_E2E_DATABASE_URL=$DB_URL \
  STOOP_STORAGE_DIR=$STORAGE npx playwright test "$@") || status=$?
[ $status -eq 0 ] || echo "server log: $LOG" >&2
exit $status
