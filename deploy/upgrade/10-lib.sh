
usage() {
	cat <<'USAGE'
usage: sh stoop-upgrade.sh [--plan] [--yes] [--to VERSION | --file FILE]
       sh stoop-upgrade.sh rollback [--yes]

  (no arguments)   upgrade to the latest release
  --to 0.4.0       upgrade to that release
  --plan           show what would happen and stop
  --yes            no confirmation prompt
  --file FILE      FILE is the new compose file (nothing is downloaded)
  rollback         put the previous compose file back and restart

Run it from the directory that holds docker-compose.yml and .env.
USAGE
	exit 2
}
die() {
	echo "stoop-upgrade: $*" >&2
	exit 1
}
say() { echo "== $*"; }
compose() { docker compose "$@"; }

# The image tag in a compose file: "0.2.0" from "image: ghcr.io/getstoop/stoop:0.2.0".
tag_of() { sed -n 's|^ *image: *[^ ]*/stoop:\([^ ]*\).*|\1|p; s|^ *image: *stoop:\([^ ]*\).*|\1|p' "$1" | head -n 1; }
postgres_major() { sed -n 's|^ *image: *postgres:\([0-9]*\).*|\1|p' "$1" | head -n 1; }
# "a is older than b" for X.Y.Z versions; anything unparseable is treated as newest.
older() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$1" ]; }
confirm() {
	[ "$yes" = yes ] && return 0
	printf '%s [y/N] ' "$1"
	read -r answer
	case "$answer" in y | Y | yes | YES) return 0 ;; esac
	die "stopped; nothing was changed"
}
cleanup_next() { rm -f "$next" env.example.next stoop-upgrade.sh.next; }
