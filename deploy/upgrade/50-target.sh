
# The new compose file lands as $next: from --file, or fetched from the
# release along with its env.example and its own copy of this script.
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
	cleanup_next
	exit 0
fi
if older "$target" "$current"; then
	cleanup_next
	die "$target is older than the installed $current; going back is: sh stoop-upgrade.sh rollback"
fi
pg_now=$(postgres_major docker-compose.yml)
pg_next=$(postgres_major "$next")
if [ -n "$pg_now" ] && [ -n "$pg_next" ] && [ "$pg_now" != "$pg_next" ]; then
	cleanup_next
	die "$target moves Postgres from $pg_now to $pg_next, which this script does not do: docs/self-hosting.md → Supported Postgres and LiveKit versions"
fi
