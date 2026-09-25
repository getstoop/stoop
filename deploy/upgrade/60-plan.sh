
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
	cleanup_next
	say "plan only; nothing was changed"
	exit 0
fi
confirm "Upgrade to $target? A backup is taken first."
