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

`stoop-upgrade.sh`, shipped in the compose bundle beside
`docker-compose.yml`, fetched the same way. Compose installs only in the
first version; the bare binary comes later.

```sh
curl -fLO https://github.com/getstoop/stoop/releases/latest/download/stoop-upgrade.sh
sh stoop-upgrade.sh            # to the latest release
sh stoop-upgrade.sh --plan     # print what would happen and stop
sh stoop-upgrade.sh --to 0.4.0
sh stoop-upgrade.sh rollback   # the previous compose file, back in place
```

What a run does, in order:

1. **Preflight.** `docker compose` present; the directory holds
   `docker-compose.yml` and `.env`; the running instance answers
   `/version`. The current tag is read from the compose file.
2. **Resolve the target.** The latest release from the GitHub API, or
   `--to`. Fetch that release's `docker-compose.yml` to a temporary name.
   Refuse a target older than current: going back is `rollback`. Refuse a
   Postgres major that differs from the running one and point at the
   Postgres section of self-hosting.md; that upgrade stays manual.
3. **Plan.** `docker compose -f <new file> run --rm --no-deps stoop
   migrate plan` against the running database. This pulls the new image
   as a side effect. Print the plan, and the `.env` keys the new
   `env.example` has that `.env` lacks (the `COMPOSE_PROFILES` lesson
   from 0.2 → 0.3). `--plan` stops here.
4. **Back up.** The runbook's two commands, into
   `backups/<date>-<from>-<to>/`. With `bundled-postgres` off, `pg_dump`
   runs from a `postgres:16-alpine` container against
   `STOOP_DATABASE_URL`.
5. **Switch.** Keep the old file as `docker-compose.yml.prev`, move the
   new one into place, `docker compose up -d --wait` with a long timeout,
   then check `/version` reports the target.
6. **On failure.** Print the tail of the `stoop` logs. If the plan said
   no contract migration: offer `rollback`, which is the previous file
   back and `up -d`. If it did: print the restore commands from the
   runbook with this backup's paths filled in. The first version prints
   them; a later one runs them.

Why a script and not a second binary: every step on the host is
`docker compose`, `curl` and `tar`. The only judgment, what the
migrations will do, is answered by the image itself through `migrate
plan`. A host binary adds a download, an architecture and a checksum to
get wrong, for no logic the image does not already hold.

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
2. **The script.** Forward, `--plan`, backup, one-step rollback. The
   Upgrading section of self-hosting.md leads with it; the manual
   commands stay below as "what it does".
3. **Hardening.** Restore on a contract failure run by the script; the
   upgrade CI job; fixture dumps.
4. **Later.** The bare-binary path; the update notice shows the command;
   migrating from the new image while the old one still serves, for
   shorter downtime.

## Decisions

Settled 2026-09-25 by the operator:

1. A script in the bundle, not a host binary.
2. The release table in code (R3), so messages speak in versions.
3. Migrations keep running at startup, with the verbs beside them.
4. Forward jumps of any distance under R1 and the fixture test; one
   minor back promised, the floor decides the rest.
5. The first script prints the restore commands on a contract failure.
   Running them is phase 3.
