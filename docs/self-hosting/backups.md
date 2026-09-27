# Backups

Two things hold your data: the Postgres database and the uploads directory
(`STOOP_STORAGE_DIR`; the `stoop-data` volume in the compose file), which
holds avatars, space icons, message attachments and link preview images.
Back up both — a database dump alone restores every message but points at
files that are gone. LiveKit holds no state.

## Taking a backup

From the install directory, with everything running:

```sh
docker compose exec -T postgres pg_dump -U stoop -Fc stoop > stoop.dump
docker run --rm --volumes-from "$(docker compose ps -q stoop)" -v "$PWD":/backup \
  alpine tar -C /data -cf /backup/stoop-data.tar .
```

The dump is a consistent snapshot while the server keeps running. Take
it before the files, in that order: a file uploaded between the two is
then an extra in the archive the sweep will remove, never a row in the
database whose file is missing. The second command borrows the app
container's mounts to reach the volume, so it needs no volume name.

The uploads directory also holds the built-in Tailscale node's identity
and, for a bare binary, the LiveKit key pair, so a backup carries those
too.

## Restoring onto a fresh install

Set up the install directory as in the [quick start](install.md#quick-start-docker-compose)
with the **same release** the backup came from, or a newer one, and copy
the two backup files in. Then, before the server has ever started:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < stoop.dump
docker compose create stoop
docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v "$PWD":/backup \
  alpine sh -c 'tar -C /data -xf /backup/stoop-data.tar && chown -R 65532:65532 /data'
docker compose up -d
```

`create` makes the app container and its empty volume without starting
it, so the files can go in first.

The `chown` matters: the archive carries the files' old owner, and the
server runs as user 65532, so without it every restored file is readable
but nothing new can be written beside it, and uploads fail with "could
not store the file".

A dump from the same release starts with "no migrations to run"; from an
older release, the missing migrations run at startup. A dump from a newer
release is refused, as [Upgrading](install.md#upgrading) describes: restore it
onto that release instead.

Then sign in with a password from before the backup. Everyone's sessions
are in the database, so people who were signed in still are. Open a
channel that had attachments and link previews, check avatars show, and
upload something.

To restore as a **different** Tailscale machine rather than take over the
old node's identity, delete `tailscale/` from the uploads directory before
starting.

## Restoring in place

To put a backup back into a running install, say after an upgrade that
went wrong past the point `rollback` can reach, stop the app, replace the
database, unpack the files over the volume, and start again. `<dir>` is
the backup directory (the upgrade tool names its
`backups/<date>-<from>-to-<to>`):

```sh
docker compose stop stoop
docker compose exec -T postgres psql -U stoop -d postgres -c 'DROP DATABASE stoop WITH (FORCE)' -c 'CREATE DATABASE stoop'
docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < backups/<dir>/stoop.dump
docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v "$PWD/backups/<dir>":/backup alpine tar -C /data -xf /backup/stoop-data.tar
docker compose up -d
```

To go back to the release the backup came from at the same time, put its
compose file in place before the last line: `mv docker-compose.yml.prev
docker-compose.yml`. Files uploaded after the backup stay in the volume
with nothing pointing at them, and the sweep removes them.

With [your own Postgres](install.md#using-your-own-postgres) there is no container
to exec into. The two database lines become one `pg_restore` that
replaces the objects in place, run from a Postgres image with the URL
from `.env` in its environment:

```sh
export STOOP_DATABASE_URL=postgres://stoop:secret@192.168.1.20:5432/stoop?sslmode=require
docker run --rm -i --network host -e STOOP_DATABASE_URL postgres:16-alpine sh -c 'pg_restore --clean --if-exists --no-owner -d "$STOOP_DATABASE_URL"' < backups/<dir>/stoop.dump
```
