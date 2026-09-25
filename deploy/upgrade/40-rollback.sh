
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
