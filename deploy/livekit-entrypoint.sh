#!/bin/sh
# LiveKit reads the address it advertises to browsers — NODE_IP — once, at
# startup. Stoop writes that address to the shared volume whenever its
# built-in Tailscale node comes up, changes, or goes away, so this wrapper
# starts LiveKit with whatever is there and then exits if it changes.
# Compose's restart policy brings the container straight back with the new
# value; that is the same policy that already covers a first start before
# Stoop has written the key file.
#
# Setting NODE_IP in .env pins the address by hand: it wins, and the watch
# is switched off, because there is then nothing for Stoop to change.
set -u

NODE_IP_FILE=${NODE_IP_FILE:-/keys/node-ip}

read_node_ip() {
	cat "$NODE_IP_FILE" 2>/dev/null || true
}

if [ -n "${NODE_IP:-}" ]; then
	watching=no
else
	NODE_IP=$(read_node_ip)
	export NODE_IP
	watching=yes
fi
started_with=${NODE_IP:-}

/livekit-server "$@" &
pid=$!

stop() { kill -TERM "$pid" 2>/dev/null || true; }
trap stop TERM INT

# Polling beats an inotify here: two file reads every couple of seconds,
# of a file that is always in cache, and it behaves the same everywhere.
# The loop also ends on its own if LiveKit exits for its own reasons.
restarting=no
while [ "$watching" = yes ] && kill -0 "$pid" 2>/dev/null; do
	sleep 2
	now=$(read_node_ip)
	if [ "$now" != "$started_with" ]; then
		echo "livekit-entrypoint: node address changed (\"$started_with\" -> \"$now\"); restarting so LiveKit advertises it"
		restarting=yes
		stop
		break
	fi
done

wait "$pid"
code=$?
# A restart we asked for is not a failure, and shouldn't look like one.
if [ "$restarting" = yes ]; then
	code=0
fi
exit "$code"
