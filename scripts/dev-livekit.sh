#!/usr/bin/env sh
# Start/stop the development LiveKit server on the host network.
#   macOS: the native binary (brew install livekit), logging to tmp/livekit.log
#   Linux: the host-network container from docker-compose.dev.yml
# Browsers hide local IPs behind mDNS names that a bridge-networked container
# can't resolve, so LiveKit must share the host's network for local voice.
set -eu
cd "$(dirname "$0")/.."
CONFIG=deploy/livekit.dev.yaml
KEYFILE=data/livekit/keys.yaml
PIDFILE=tmp/livekit.pid
COMPOSE="docker compose -f deploy/docker-compose.dev.yml --profile linux"
# Same version the compose files pin; bump all three together.
LIVEKIT_VERSION=1.13.6

case "${1:-start}" in
start)
  if [ "$(uname -s)" = Darwin ]; then
    if ! command -v livekit-server >/dev/null; then
      echo "livekit-server not found; voice will be off in dev (brew install livekit)" >&2
      exit 0
    fi
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "livekit-server already running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    have=$(livekit-server --version 2>/dev/null | awk '{print $NF}')
    if [ "$have" != "$LIVEKIT_VERSION" ]; then
      echo "livekit-server $have installed; the compose files pin $LIVEKIT_VERSION (brew upgrade livekit)" >&2
    fi
    if lsof -nP -iTCP:7880 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "something else is listening on 7880; not starting livekit-server" >&2
      exit 0
    fi
    mkdir -p tmp
    # The key pair is whatever the Stoop server minted on its first boot
    # (data/livekit/keys.yaml) — dev runs the same path a self-hoster does,
    # so there is no dev key pair to keep in sync. On a fresh checkout that
    # file appears a moment after the server starts, so wait for it and
    # then exec, which keeps $! pointing at livekit-server either way.
    nohup sh -c 'while [ ! -f '"$KEYFILE"' ]; do sleep 1; done;
      exec livekit-server --config '"$CONFIG"' --key-file '"$KEYFILE"'' \
      >tmp/livekit.log 2>&1 &
    echo $! >"$PIDFILE"
    if [ -f "$KEYFILE" ]; then
      echo "livekit-server started (pid $!, log tmp/livekit.log)"
    else
      echo "livekit-server waiting for $KEYFILE (pid $!); it starts once the server mints one"
    fi
  else
    $COMPOSE up -d --wait livekit
  fi
  ;;
stop)
  if [ "$(uname -s)" = Darwin ]; then
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "livekit-server stopped"
    fi
  else
    $COMPOSE stop livekit
  fi
  ;;
*)
  echo "usage: $0 start|stop" >&2
  exit 2
  ;;
esac
