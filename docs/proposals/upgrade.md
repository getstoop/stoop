# Upgrading a server: the tool, and the migration rules it needs

Status: decided 2026-09-25 (STOOP-294), not started. Nothing here is built.

## What exists

- Migrations are embedded and run at startup, so an upgrade is "pull the
  new image and restart" ([architecture/data.md → Migrations](../architecture/data.md#migrations)).
- Expand/contract: a release only drops or tightens what the previous
  release stopped using, so the previous binary starts against the new
  schema. A contract migration raises `schema_floor`, and a binary below
  the floor refuses to start and says so.
- A patch release carries no migrations.
- A backup is `pg_dump` plus the uploads directory; the restore runbook is
  in [self-hosting.md → Backups](../self-hosting.md#backups).
- `stoop admin`, `stoop health`, `stoop version`, and `GET /version`.

## The problem

The pieces are right; nothing joins them, and the operator is the join.

1. **The upgrade is blind.** Migrations run at startup, so the first sign
   that a release contained a contract migration is a refused rollback.
   There is no way to ask "what will this do to my database" first.
2. **Nothing takes the backup.** The runbook is a page an operator has to
   remember to open.
3. **Jumping releases is undefined.** The docs promise an upgrade from the
   release before. Goose will apply every missing file, but no test
   proves a migration behaves on a database that never ran the code of
   the releases in between, and afterwards nothing tells the operator how
   far back they can roll.
4. **Failure has no scripted way back.** "Put the old tag back" is right
   only when the floor allows it; otherwise the answer is the restore
   runbook, and the operator has to know which case they are in.

The tool is worth building only if the migration rules make its answers
true. So the rules come first.

## Migration rules

The existing rules stay. These are added to
[architecture/data.md](../architecture/data.md).

**R1. A migration is self-contained.** It must be correct against a
database that has had every earlier migration and *no code* from any
release in between. Backfills in the migration, never lazily in code, is
already the rule; this is the reason for it. Consequence: a forward
upgrade may jump any number of minors. (What it forbids: a contract
migration that assumes release N's code ran for a while and cleaned
something up. If N+1 drops a column, the migration that drops it must
carry whatever copy N's code would have made.)

**R2. The binary knows its own floor.** A Go constant next to the
migrations, `db.Floor`, holds the floor the newest contract migration
sets. A test migrates a fresh database and checks `schema_floor` equals
the constant, so the two cannot drift. This lets the binary describe an
upgrade with no database in front of it.

**R3. A release table in code.** `internal/db/releases.go` maps each tag
to the last migration it shipped (`0.1.0 → 28`, `0.2.0 → 37`). The release
PR appends a row, next to the compose pin and the notes it already
edits. It is what lets the tool say "you can roll back to 0.2.0" instead
of "to migration 37". A test checks the newest row is not above the
embedded migrations.

**R4. Long migrations resume.** Anything that builds an index or rewrites
rows on `messages` or `files` goes in a `-- +goose NO TRANSACTION`
migration using `CONCURRENTLY` and `IF NOT EXISTS`, so a container that
is killed mid-way (the compose health check gives startup 20 seconds)
picks up where it stopped. Small DDL stays transactional as today.

**R5. Rollback promise unchanged.** One minor back without a restore.
The floor is the truth for anything further, and the tool reads it.

Migrations keep running at startup. The tool does not become the only
way to migrate; the promise that a new binary never serves an old
schema is worth more than a separate step.

## The verbs, in the binary

All the judgment lives in the image, so the host side stays dumb.

| Verb | Does | Exit |
| ---- | ---- | ---- |
| `stoop migrate status` | Database version, the binary's newest migration, the floor, pending migrations by name. Reads only. | 0 |
| `stoop migrate plan` | `status`, plus: whether any pending migration is a contract, the floor after, and which releases can start against the result ("0.2.0 and later"). Reads only. | 0 nothing to do, 2 pending, 3 database is ahead |
| `stoop migrate up` | Applies, logging each migration, and exits. The same call startup makes. | 0 or 1 |
| `stoop version --json` | `{"version","commit","migration","floor"}`. No database needed. | 0 |

`GET /version` gains `migration` and `floor`, so the update notice
(STOOP-174) and the tool can ask a running instance the same question.

## The host tool

`stoop upgrade`: a verb of the server binary, run on the host from the
install directory. The same archive GoReleaser already builds per
architecture; nothing new to package. Compose installs only in the first
version; the bare binary comes later, as the same verb with a different
switch step.

```sh
curl -fsSL https://github.com/getstoop/stoop/releases/latest/download/stoop_linux_amd64.tar.gz | tar -xz stoop
./stoop upgrade                 # to the latest release
./stoop upgrade --plan          # print what would happen and stop
./stoop upgrade --to 0.4.0
./stoop upgrade --yes           # no confirmation prompt
./stoop upgrade rollback        # the previous compose file, back in place
```

The tool's own version does not limit what it can upgrade to: the
judgment about the database comes from the target image through
`migrate plan --json`, and the compose file comes from the target
release. Download it once and keep it; it says when a newer copy of
itself is worth fetching.

What a run does, in order:

1. **Preflight.** `docker compose` present; the directory holds
   `docker-compose.yml` and `.env`. The current tag is read from the
   compose file.
2. **Resolve the target.** The latest release from the GitHub API, or
   `--to`, or `--file` for a compose file already on disk. Fetch that
   release's `docker-compose.yml` and `env.example` to temporary names.
   Refuse a target older than current: going back is `rollback`. Refuse a
   Postgres major that differs from the running one and point at the
   Postgres section of self-hosting.md; that upgrade stays manual.
3. **Plan.** `docker compose -f <new file> run --rm --no-deps stoop
   migrate plan --json` against the running database. This pulls the new
   image as a side effect. Print the plan, and the `.env` keys the new
   `env.example` sets that `.env` lacks (the `COMPOSE_PROFILES` lesson
   from 0.2 → 0.3). `--plan` stops here.
4. **Back up.** The runbook's two commands, into
   `backups/<date>-<from>-to-<to>/`. With `bundled-postgres` off,
   `pg_dump` runs from a `postgres` container against
   `STOOP_DATABASE_URL`. An empty dump or archive stops the upgrade.
5. **Switch.** Keep the old file as `docker-compose.yml.prev`, move the
   new one into place, `docker compose up -d --remove-orphans --wait`
   with a long timeout, then check the running binary reports the target.
6. **On failure.** Print the tail of the `stoop` logs. If the plan said
   no contract migration: offer `rollback`, which is the previous file
   back and `up -d`. If it did: print the restore commands from the
   runbook with this backup's paths filled in. The first version prints
   them; a later one runs them.

`rollback` asks the running image's `migrate status --json` which
releases can start against the database now (the floor and the release
table), refuses when the previous release cannot, and otherwise swaps
the files back and restarts. It never runs the older image's binary for
that: releases up to 0.2.0 treat an unknown verb as "serve".

Why a verb of the binary and not a script: a script cannot be unit
tested, cannot run on a Windows host with Docker Desktop, parses JSON
and compares versions with `sed` and `sort -V`, and the bare-binary path
(archive download, checksum, atomic swap, service restart) is miserable
in shell. The cost is fetching an archive for the host's architecture
instead of one file. The script was built first (PR #216, closed
unmerged) and drilled on a scratch stack; its sequence, plan output and
failure messages are this verb's specification.

Layout: `internal/upgrade` holds the steps behind a small interface for
running `docker compose`, so the sequence is tested with a fake that
records commands; `cmd/stoop/upgrade.go` parses arguments and wires it.
A drill against a real scratch stack is a Go test gated by an
environment variable, which is phase 3's CI job.

## Testing

- **Plan against an older schema.** `dbtest` migrates up to migration N
  with goose `UpTo`, then `plan` from the full set must list the rest and
  name the floor correctly. Covers R2 and R3.
- **Fixture dumps.** A `pg_dump` of a seeded instance at each tag, kept
  under `internal/db/testdata/`, restored and migrated forward in CI.
  This is the test for R1: data shaped by an old release, with no
  intermediate code run. The release PR adds the dump for the release it
  cuts.
- **An upgrade job.** Install the previous tag's bundle in a scratch
  compose stack (the docker-in-docker recipe in agent-workflow.md), seed
  it, run the script to the snapshot image, check `/version` and a
  message written before, roll back, check again. Runs on release PRs
  and on demand, not on every PR. It automates step 5 of releasing.md.

## Phases

1. **Rules and verbs.** R1 to R5 into data.md; `stoop migrate
   status|plan|up`; `stoop version --json`; the floor constant and its
   test; the release table. Small PRs, no operator-visible change yet.
2. **The verb.** `migrate plan --json` and `status --json`; `stoop
   upgrade` with forward, `--plan`, `--to`, `--file`, `--yes`, backup,
   one-step rollback. The Upgrading section of self-hosting.md leads
   with it; the manual commands stay below as "what it does", and
   Backups gains "Restoring in place".
3. **Hardening.** Restore on a contract failure run by the verb; the
   drill as a CI job; fixture dumps.
4. **Later.** The bare-binary path (the same verb, switching a binary
   under a service instead of a compose file); a Windows build once a
   Windows host can be checked; the update notice shows the command;
   migrating from the new image while the old one still serves, for
   shorter downtime.

## Decisions

Settled 2026-09-25 by the operator:

1. ~~A script in the bundle, not a host binary.~~ Revisited the same
   day, after the script was built and drilled: a `stoop upgrade` verb
   of the binary, run on the host, for Windows, tests and the
   bare-binary path.
2. The release table in code (R3), so messages speak in versions.
3. Migrations keep running at startup, with the verbs beside them.
4. Forward jumps of any distance under R1 and the fixture test; one
   minor back promised, the floor decides the rest.
5. The first script prints the restore commands on a contract failure.
   Running them is phase 3.
