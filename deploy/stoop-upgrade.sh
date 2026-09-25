#!/bin/sh
# Upgrades a compose install of Stoop to a newer release, and rolls one
# back. Run it from the directory that holds docker-compose.yml and .env.
# What it does and why: docs/self-hosting.md → Upgrading.
#
#   sh stoop-upgrade.sh                  to the latest release
#   sh stoop-upgrade.sh --to 0.4.0       to that release
#   sh stoop-upgrade.sh --plan           show what would happen and stop
#   sh stoop-upgrade.sh --yes            no confirmation prompt
#   sh stoop-upgrade.sh --file FILE      FILE is the new compose file (no download)
#   sh stoop-upgrade.sh rollback         the previous compose file, back in place
set -eu

repo=https://github.com/getstoop/stoop
next=docker-compose.yml.next
prev=docker-compose.yml.prev

usage() {
	sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
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

plan=no
yes=no
to=
file=
command=upgrade
while [ $# -gt 0 ]; do
	case "$1" in
	--plan) plan=yes ;;
	--yes | -y) yes=yes ;;
	--to) [ $# -ge 2 ] || usage; to=$2; shift ;;
	--file) [ $# -ge 2 ] || usage; file=$2; shift ;;
	rollback) command=rollback ;;
	-h | --help) usage ;;
	*) usage ;;
	esac
	shift
done

# ---- preflight --------------------------------------------------------------

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available"
[ -f docker-compose.yml ] || die "no docker-compose.yml here; run this from the install directory"
[ -f .env ] || die "no .env here; run this from the install directory"
current=$(tag_of docker-compose.yml)
[ -n "$current" ] || die "cannot read the stoop image tag from docker-compose.yml"

# ---- rollback ---------------------------------------------------------------

if [ "$command" = rollback ]; then
	[ -f "$prev" ] || die "no $prev to roll back to"
	target=$(tag_of "$prev")
	say "rolling back $current -> $target"
	# The release going back in has to be able to start against the database
	# as it is now. The running (newer) image knows: its status line names
	# the oldest release that can, from the floor and its release table.
	oldest=$(compose run --rm --no-deps -T stoop migrate status 2>/dev/null | sed -n 's/^startable *\([0-9][0-9.]*\).*/\1/p')
	if [ -n "$oldest" ] && older "$target" "$oldest"; then
		echo "$target cannot start against this database: only $oldest and later can, because an upgrade contained a contract migration." >&2
		echo "Restore the backup taken before that upgrade instead: docs/self-hosting.md → Restoring in place." >&2
		exit 1
	fi
	confirm "Put $target back and restart?"
	mv docker-compose.yml "$next"
	mv "$prev" docker-compose.yml
	compose up -d --remove-orphans --wait --wait-timeout 600
	say "back on $target; the $current file is kept as $next"
	exit 0
fi

# ---- the target -------------------------------------------------------------

fetched=no
if [ -n "$file" ]; then
	[ -f "$file" ] || die "$file does not exist"
	cp "$file" "$next"
else
	command -v curl >/dev/null || die "curl is needed to fetch the release"
	if [ -z "$to" ]; then
		to=$(curl -fsSL "https://api.github.com/repos/getstoop/stoop/releases/latest" |
			sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
		[ -n "$to" ] || die "could not read the latest release from GitHub"
	fi
	to=${to#v}
	base="$repo/releases/download/v$to"
	say "fetching the $to compose bundle"
	curl -fsSL -o "$next" "$base/docker-compose.yml" || die "no release v$to at $base"
	curl -fsSL -o env.example.next "$base/env.example" || die "could not fetch env.example for $to"
	curl -fsSL -o stoop-upgrade.sh.next "$base/stoop-upgrade.sh" || rm -f stoop-upgrade.sh.next
	fetched=yes
fi
target=$(tag_of "$next")
[ -n "$target" ] || die "cannot read the stoop image tag from the new compose file"

if [ "$target" = "$current" ]; then
	say "already on $target; nothing to do"
	rm -f "$next" env.example.next stoop-upgrade.sh.next
	exit 0
fi
if older "$target" "$current"; then
	rm -f "$next" env.example.next stoop-upgrade.sh.next
	die "$target is older than the installed $current; going back is: sh stoop-upgrade.sh rollback"
fi
pg_now=$(postgres_major docker-compose.yml)
pg_next=$(postgres_major "$next")
if [ -n "$pg_now" ] && [ -n "$pg_next" ] && [ "$pg_now" != "$pg_next" ]; then
	rm -f "$next" env.example.next stoop-upgrade.sh.next
	die "$target moves Postgres from $pg_now to $pg_next, which this script does not do: docs/self-hosting.md → Supported Postgres and LiveKit versions"
fi

# ---- the plan ---------------------------------------------------------------

say "upgrade $current -> $target"
say "what $target will do to the database"
# The new image, against the running database, changing nothing.
plan_out=$(compose -f "$next" run --rm --no-deps -T stoop migrate plan 2>&1) && plan_code=0 || plan_code=$?
echo "$plan_out"
case "$plan_code" in
0 | 2) ;;
3) die "$target cannot start against this database; it is older than what made it" ;;
*) die "could not read the migration plan (exit $plan_code)" ;;
esac
contract=no
echo "$plan_out" | grep -q 'contract migration' && contract=yes

# Settings the new release's env.example sets that .env does not mention.
if [ -f env.example.next ]; then
	missing=$(sed -n 's/^\([A-Z_][A-Z0-9_]*\)=\(..*\)$/\1=\2/p' env.example.next | while IFS= read -r line; do
		key=${line%%=*}
		grep -q "^#\{0,1\} *$key=" .env || echo "  $line"
	done)
	if [ -n "$missing" ]; then
		say "settings $target expects that .env does not have (see the release notes):"
		echo "$missing"
	fi
fi

if [ "$contract" = yes ]; then
	say "$target has a contract migration: after it, rolling back to $current needs the backup this script takes, not just the old compose file"
fi
if [ "$plan" = yes ]; then
	rm -f "$next" env.example.next stoop-upgrade.sh.next
	say "plan only; nothing was changed"
	exit 0
fi
confirm "Upgrade to $target? A backup is taken first."

# ---- the backup -------------------------------------------------------------

stamp=$(date -u +%Y%m%d-%H%M%S)
backup="backups/$stamp-$current-to-$target"
mkdir -p "$backup"
say "backing up to $backup"
if [ -n "$(compose ps -q postgres 2>/dev/null)" ]; then
	compose exec -T postgres pg_dump -U stoop -Fc stoop >"$backup/stoop.dump"
else
	url=$(sed -n 's/^STOOP_DATABASE_URL=//p' .env | head -n 1)
	[ -n "$url" ] || die "no bundled postgres and no STOOP_DATABASE_URL in .env; cannot take the backup"
	docker run --rm --network host "postgres:${pg_next:-16}-alpine" pg_dump -Fc "$url" >"$backup/stoop.dump"
fi
[ -s "$backup/stoop.dump" ] || die "the database dump is empty; not continuing"
docker run --rm --volumes-from "$(compose ps -q stoop)" -v "$PWD/$backup":/backup alpine \
	tar -C /data -cf /backup/stoop-data.tar .
[ -s "$backup/stoop-data.tar" ] || die "the uploads archive is empty; not continuing"

# ---- the switch -------------------------------------------------------------

say "starting $target"
cp docker-compose.yml "$prev"
mv "$next" docker-compose.yml
if compose up -d --remove-orphans --wait --wait-timeout 600; then
	running=$(compose exec -T stoop stoop version 2>/dev/null | sed -n 's/^stoop v\{0,1\}\([^ ]*\).*/\1/p')
else
	running=
fi
if [ "$running" != "$target" ]; then
	echo
	compose logs --tail 40 stoop || true
	echo
	echo "stoop-upgrade: $target did not come up healthy (running: ${running:-nothing})." >&2
	if [ "$contract" = yes ]; then
		echo "It ran a contract migration, so $current cannot start against the database now." >&2
		echo "Restore the backup, then put the old file back:" >&2
		echo "  docker compose stop stoop" >&2
		echo "  docker compose exec -T postgres psql -U stoop -d postgres -c 'DROP DATABASE stoop' -c 'CREATE DATABASE stoop'" >&2
		echo "  docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < $backup/stoop.dump" >&2
		echo "  docker run --rm --volumes-from \"\$(docker compose ps -aq stoop)\" -v \"\$PWD/$backup\":/backup alpine tar -C /data -xf /backup/stoop-data.tar" >&2
		echo "  mv $prev docker-compose.yml && docker compose up -d" >&2
		echo "docs/self-hosting.md → Restoring in place explains each line." >&2
	else
		echo "Nothing it did stops $current from starting. To go back:" >&2
		echo "  sh stoop-upgrade.sh rollback" >&2
	fi
	exit 1
fi

if [ "$fetched" = yes ]; then
	[ -f stoop-upgrade.sh.next ] && mv stoop-upgrade.sh.next stoop-upgrade.sh
	rm -f env.example.next
fi
say "upgraded $current -> $target; backup in $backup"
if [ "$contract" = yes ]; then
	echo "Rolling back to $current now means restoring that backup (docs/self-hosting.md → Restoring in place)."
else
	echo "If something is wrong: sh stoop-upgrade.sh rollback"
fi
