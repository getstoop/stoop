# Install

## Quick start (Docker Compose)

```sh
mkdir stoop && cd stoop
R=https://getstoop.org/releases/latest/download
curl -fLO $R/docker-compose.yml
curl -fLO $R/livekit.yaml
curl -fLO $R/livekit-entrypoint.sh
curl -fL -o .env $R/env.example
# edit .env — at minimum set POSTGRES_PASSWORD
docker compose up -d
```

The four files come from the release itself, so they always match the
image the compose file pins. The compose file needs Docker Compose 2.20 or
newer (`docker compose version`).

Open http://localhost:8080. A fresh instance walks you through setup: create
the admin account (the first account operates the server), create your first
space, and copy an invite link for your people. Later, the Invite button in a
space's header makes more.

`docker compose ps` shows `stoop` as healthy once it has migrated the
database and is answering. Container logs are capped at 30 MB a service.

To let people in from outside the machine, see
[Reaching your server](reaching-your-server.md). Voice works once its media
has a reachable path: see [Voice](voice.md).

### Upgrading

Fetch the `stoop` binary for the machine once, then run its `upgrade`
verb from the install directory whenever a release is out (Server admin
→ About says when one is):

```sh
curl -fsSL https://getstoop.org/releases/latest/download/stoop_linux_amd64.tar.gz | tar -xz stoop
./stoop upgrade
```

(`stoop_linux_arm64.tar.gz` and `stoop_darwin_arm64.tar.gz` are the
other builds.) It fetches the newest release's compose file, shows what
that release's migrations will do to the database and which releases can
still start against it afterwards, lists settings the release's
`env.example` has that your `.env` does not, and asks. Then it backs up
the database and the uploads into `backups/` (readable by your user
only; the dump is the whole database), keeps the old bundle files as
`.prev` (`docker-compose.yml`, `livekit.yaml`, `livekit-entrypoint.sh`),
puts the new ones in place and starts. A `docker-compose.override.yml`
beside the compose file is honoured, in the plan as well as the start. If
the new release does not come up healthy it prints the log and the way
back. `./stoop upgrade --plan` stops after showing; `--to 0.4.0` picks a
release; `--yes` skips the question. The copy you fetched keeps working
for later releases: the judgment about the database comes from the new
image, not from this binary.

Release notes say when the LiveKit or Postgres pin moves. Moving to a new
Postgres major is the one thing the tool refuses to do; see
[Supported Postgres and LiveKit versions](#supported-postgres-and-livekit-versions).

**Going back.** `./stoop upgrade rollback` puts the previous compose file
back and restarts. Each release keeps its schema readable by the release
before it, so this needs no restore, unless the upgrade ran a contract
migration: the tool says so before it upgrades, and `rollback` refuses
afterwards and points at the backup it took
([Restoring in place](backups.md#restoring-in-place)). Stoop refuses to start
against a database that a much newer release has reshaped, and says so
plainly, rather than misbehaving.

**By hand.** The tool only runs compose commands you can run yourself.
Fetch the new release's compose file, ask the new image what it will do
while the old one is still running, then restart on it; migrations run at
startup, so there is no separate step:

```sh
curl -fLO https://getstoop.org/releases/latest/download/docker-compose.yml
docker compose run --rm --no-deps stoop migrate plan
docker compose pull && docker compose up -d
```

`migrate plan` lists the migrations that will run and says which
releases can still start against the database afterwards, which is the
rollback you will have. It changes nothing. Exit status 2 means there is
something to run, 3 that the release is older than the database. Rolling
back by hand is putting the previous image tag back in the compose file
and `docker compose up -d` again.

Coming from 0.2.0, add `COMPOSE_PROFILES=bundled-postgres` to `.env`
first. Without it the bundled Postgres does not start, and the log says
`lookup postgres: no such host`.

Coming from 0.3, add `bundled-livekit` to `COMPOSE_PROFILES` first,
keeping what is already on that line
(`COMPOSE_PROFILES=bundled-postgres,bundled-livekit` on the default
install). Without it the upgrade leaves the LiveKit that is running in
place on its old version, and the next time the stack is recreated there
is none: voice joins fail, and Server admin → Diagnostics shows `livekit`
as not answering.

The image tag `latest` follows the newest release, for people who prefer
it to the pinned tag. Tags of the form `0.3` are no longer moved: 0.3.0
was the last release to set one.

### Supported Postgres and LiveKit versions

Stoop is tested on Postgres 16, which the compose file runs. Other majors
that Postgres itself still supports should work, but are not tested; if
you run one and something breaks, that is a bug worth reporting. A patch
or minor release of Stoop never raises the minimum Postgres major; if a
future release has to, the notes say so one minor ahead.

Moving to a newer Postgres major is the one upgrade `docker compose pull`
cannot do, because Postgres does not read a data directory written by an
older major. Dump with the old container, switch the image tag, restore:

```sh
docker compose exec postgres pg_dump -U stoop -Fc stoop > stoop.dump
docker compose down
docker volume ls | grep postgres-data     # then remove that one volume, and only that one
docker volume rm <name>_postgres-data
# edit docker-compose.yml: postgres:16-alpine → postgres:17-alpine
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U stoop -d stoop < stoop.dump
docker compose up -d
```

Keep `stoop.dump` until the restored instance has been used for a while;
the `stoop-data` volume with the uploads is untouched by all of this.

LiveKit is pinned in the compose file to the exact version a Stoop
release was tested against, and Stoop needs nothing newer than that pin.
The pin moves only in a minor release and the notes say when.

### Using your own Postgres

In `.env`, take `bundled-postgres` out of `COMPOSE_PROFILES` and name your
server:

```sh
COMPOSE_PROFILES=bundled-livekit
STOOP_DATABASE_URL=postgres://stoop:secret@192.168.1.20:5432/stoop?sslmode=require
```

Then `docker compose up -d`. The bundled Postgres no longer starts, and
`POSTGRES_PASSWORD` is unused.

- Create the database and its role first. Stoop creates tables, not
  databases.
- The bundled URL says `sslmode=disable` because it never leaves the
  compose network. A remote server usually wants `require`.
- A Postgres on the same machine is `host.docker.internal` on Docker
  Desktop and the machine's LAN address on Linux; `localhost` is the
  container itself.
- [Backups](backups.md) of that database are then yours: the `pg_dump`
  lines there run against your server instead of `docker compose exec
  postgres`. The `stoop-data` volume still holds the uploads.

### Running background jobs apart

The sweeps and outgoing webhook deliveries run inside the server by
default. To run them in their own container, in `.env` set
`STOOP_JOBS=external` and add `jobs` to `COMPOSE_PROFILES`:

```sh
COMPOSE_PROFILES=bundled-postgres,bundled-livekit,jobs
STOOP_JOBS=external
```

Then `docker compose up -d`. The `jobs` service starts once `stoop` is
healthy and works the queue; the server runs none itself. Server admin →
Diagnostics → Health shows the `jobs_runner` row at ok while a runner has
been seen in the last minute, and at danger when none has.

The runner must see the same uploads directory as the server, because file
storage is local disk and the file sweep removes blobs: the compose
service mounts the same volume; a bare `stoop jobs` runs on the same host,
or against the same mounted path, with the server's environment.

### Where the data lives

To keep uploads and the database on a disk you already back up, set the
paths in `.env` and run Stoop as the user that owns the uploads path:

```sh
STOOP_DATA_PATH=/mnt/tank/stoop/data
POSTGRES_DATA_PATH=/mnt/tank/stoop/postgres
PUID=1000    # id -u
PGID=1000    # id -g
```

```sh
mkdir -p /mnt/tank/stoop/data /mnt/tank/stoop/postgres
chown 1000:1000 /mnt/tank/stoop/data
docker compose up -d
```

- A path starts with `/` or `./`; anything else is read as a volume name.
- Postgres owns its path itself. Give it a directory nothing else uses.
- `PUID` and `PGID` go with `STOOP_DATA_PATH`. On the default `stoop-data`
  volume, leave them unset.
- If the owner is wrong, uploads fail and Server admin → Diagnostics →
  File storage says the directory is not writable.
- [Backups](backups.md) and the restore runbook then mean those two paths,
  in place of the `stoop-data` and `postgres-data` volumes.

To move an existing install, stop the stack and copy each volume out
before setting the path:

```sh
docker compose stop
docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v /mnt/tank/stoop/data:/to busybox cp -a /data/. /to
```

The database copies the same way, from the `postgres` container's
`/var/lib/postgresql/data`.

### Tuning the bundled Postgres

Put `postgres -c` flags in `POSTGRES_ARGS` in `.env`, then
`docker compose up -d`:

```sh
POSTGRES_ARGS=-c shared_buffers=256MB -c max_connections=50
```

Postgres's defaults are right for a chat database of this size, so most
installs leave this unset. A misspelt setting stops the container, and
`docker compose logs postgres` names it.

## Bare binary (no Docker)

Release binaries are static with the web UI embedded — no runtime
dependencies beyond Postgres (and a LiveKit server if you want voice).
Each [release](https://github.com/getstoop/stoop/releases) carries
`stoop_linux_amd64.tar.gz`, `linux_arm64` and `darwin_arm64`
archives and a `checksums.txt` to verify them against:

```sh
STOOP_DATABASE_URL=postgres://stoop:secret@localhost:5432/stoop ./stoop
```

`./stoop --version` prints the release and commit; the same appears in
the first log line and, for admins, under Server admin → Server.

For voice, point it at your LiveKit with `STOOP_LIVEKIT_URL` and start
LiveKit against the key file Stoop writes:

```sh
STOOP_LIVEKIT_URL=http://127.0.0.1:7880 ./stoop      # mints on first boot
livekit-server --config livekit.yaml \
  --key-file ./data/livekit/keys.yaml                 # same pair, no copying
```

LiveKit refuses a key file others can read, so leave it `0600` as written.
Start Stoop first: LiveKit exits if the file isn't there yet.
