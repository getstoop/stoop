
# The runbook's two commands (docs/self-hosting.md → Backups), the dump
# first so a file uploaded in between is an extra the sweep removes,
# never a row whose file is missing.
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
