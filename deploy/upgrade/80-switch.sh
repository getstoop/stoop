
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
		echo "  docker compose exec -T postgres psql -U stoop -d postgres -c 'DROP DATABASE stoop WITH (FORCE)' -c 'CREATE DATABASE stoop'" >&2
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
