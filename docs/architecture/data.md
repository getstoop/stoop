# Data: schema, migrations, and queries

Postgres holds all of Stoop's durable state, and the blob store holds the
bytes of uploaded files. There is nothing else — no cache to warm, no
search index to rebuild, no queue whose contents matter across a restart.
A backup is `pg_dump` plus the storage directory, and that is the whole
recovery story.

The database is also the only shared thing between modules, which is why
ownership of it is a rule rather than a convention.

## Ownership

Every table has exactly one owning module. Only that module's code queries
its columns; anything else goes through a port
([modules.md](modules.md#rule-3--each-module-owns-its-tables)).

Ownership is stated three times, so it stays true: in a comment at the top
of the migration that creates the table, in the directory the sqlc queries
live in, and in the port a consumer has to use instead.

## The schema

### auth

**`users`** — one row per account, and the row is never deleted. A
deactivated account keeps its row so that its old messages keep an author;
"delete my account" would leave orphaned authorship or destroy other
people's conversations, and neither is a good answer.

| Column | Notes |
| ------ | ----- |
| `id` | UUIDv7. The durable identity everywhere in the system. |
| `username` | `citext UNIQUE` — case-insensitive, so `Casey` and `casey` are one handle. Freely renameable. |
| `display_name` | What people actually see. |
| `password_hash` | Nullable: an account created by an identity provider has no password until its owner sets one. "Has a password" is a schema fact, not a sentinel value. |
| `role` | `admin` or `member`, checked by constraint. See [permissions.md](permissions.md). |
| `deactivated_at` | Set on deactivation; can't log in, sessions revoked. |
| `avatar_file_id` | → `files(id) ON DELETE SET NULL`. A pointer, not a copy. |
| `username_pending` | The handle was derived from a provider claim and hasn't been confirmed; the client nudges about it. |
| `username_frozen` | An admin locked self-service renames on this account. Admin renames bypass it. |
| `pronouns`, `bio` | 40 and 300 characters, whitespace-collapsed. Shown on the profile card and nowhere else. |

**`sessions`** — `token_hash bytea UNIQUE` is the SHA-256 of an opaque
32-byte token. The token itself is never stored, so a database dump does
not hand over live sessions. Indexed on `expires_at` for cleanup.

**`user_identities`** — `(provider, subject) PRIMARY KEY` maps an OIDC
subject to an account, with `UNIQUE (user_id, provider)` so one account
links at most one identity per provider. No provider tokens are stored:
the provider is consulted at sign-in and never again.

### chat

**`spaces`** — `name`, `owner_id`, `description` (the public one line an
invite shows a stranger), `welcome` (Markdown a new member reads on
arrival, not public), `members_can_invite`, `icon_file_id`.

**`space_members`** — `PRIMARY KEY (space_id, user_id)` plus `role`. A
partial unique index enforces the model's most important invariant in the
database rather than in code:

```sql
CREATE UNIQUE INDEX space_members_one_owner_idx
  ON space_members (space_id) WHERE role = 'owner';
```

Exactly one owner per space, always — an ownership transfer that half-ran
cannot leave a space with two owners or none.

**`space_bans`** — `(space_id, user_id)`, with `banned_by` and a `reason`
kept for the people who manage members. A ban is a kick that survives
re-invite; every join path consults it.

**`user_blocks`** — `(blocker_id, blocked_id)`, indexed both ways. Personal,
not a space power.

**`channels`** — `name`, `kind` (1 text, 2 voice, 3 DM), `position`,
`topic`, `last_message_id`, and the two columns that make direct messages
work:

```sql
ALTER TABLE channels ALTER COLUMN space_id DROP NOT NULL;
ALTER TABLE channels ADD COLUMN dm_key text UNIQUE;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
  CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3) = (dm_key IS NOT NULL));
```

That constraint is the whole DM data model in three lines. A DM is a
channel with no space; `dm_key` is the participant ids sorted and joined,
and its `UNIQUE` makes "open a DM with X" idempotent under a race — two
people opening the same conversation simultaneously get the same row
because the second insert loses to a unique constraint rather than to a
check that could interleave. `last_message_id` is maintained on send so the
channel list can answer "anything new?" without touching `messages`.

**`dm_members`** — a participants *table* rather than two columns on the
channel, so group DMs can follow without a migration. v1 is 1:1 only.

**`channel_reads`** — `(user_id, channel_id) → last_read_message_id`, only
ever moving forward. Because message ids are time-ordered, "unread" is an
id comparison against `channels.last_message_id`, not a count.

**`channel_mutes`** — `(user_id, channel_id)`. The one presence-ish
preference that is persisted, because it is a decision about a channel
rather than about a device.

**`space_mutes`** — `(user_id, space_id)`, its twin: muting a space
silences every channel in it. Two tables and two raw flags on the wire;
the client derives the effective state for the room-shaped surfaces and
the server stamps it on each activity item (see
[messaging.md](messaging.md#mutes)). Leaving or being kicked drops the
row in the same transaction as the membership, so a rejoin starts
unmuted; channel mutes are left alone and go when the channel does.

**`messages`** — `channel_id`, `author_id`, `content`, `created_at`,
`edited_at`, `reply_to_message_id`, `mentions_everyone`, `mentions_here`,
and `search`, a stored column Postgres generates from `content`
(`to_tsvector('simple', content)`) for message search. The index that
matters for history:

```sql
CREATE INDEX messages_channel_recent_idx ON messages (channel_id, id DESC);
```

Every history read is a range scan on that index. There is no separate
timestamp ordering because ids are UUIDv7 — see below. Search reads the
GIN index on `search` instead
([messaging.md](messaging.md#search)).

**`message_mentions`** — `(message_id, user_id)`. Recipients of
`@everyone` and `@here` are *materialised* here at send time, not
recomputed at read time, so activity delivery has one shape regardless
of how the mention was written and a later membership change doesn't
retroactively change who was mentioned.

**`message_reactions`** — `(message_id, user_id, emoji)`. The emoji is its
Unicode string, validated as a single grapheme cluster of at most 16 bytes;
skin-tone and other modifiers make variants genuinely distinct.

**`message_attachments`** — `(message_id, file_id)` with `file_id UNIQUE`.
That `UNIQUE` is what makes "this upload is already attached elsewhere" a
database fact instead of a check-then-act race.

**`message_links` / `link_previews`** — links are recorded per message with
a position; the preview is cached per URL and shared by every message that
links it, with a `state` of `pending`/`ok`/`failed`. Failures are cached
too, so a dead link isn't refetched once per message that mentions it.

**`activity_items`** — `kind` (`mention` | `reply` | `dm`, by constraint),
pointers at space/channel/message, `actor_id`, `read_at`. `space_id` is
nullable because a DM has no space. Two indexes: `(user_id, id DESC)` for
the feed, and a partial index on unread rows for the badge.

**`invites`** — `code UNIQUE`, `expires_at` (NULL = never), `max_uses`
(NULL = unlimited), `use_count`, `revoked_at`, and the `role` the code
grants. Validity is evaluated at join time rather than materialised, so an
expiry needs no sweeper.

### instance

**`instance_settings`** — `key text PRIMARY KEY, value jsonb`. One table
for settings of every shape: the registration policy is a string, the
login-provider list is an array of objects, the LiveKit key pair is a
struct. A new setting is a new key, not a migration.

The rule that makes this work: **the environment seeds, the database
decides.** `STOOP_REGISTRATION` sets the value on first boot only; after
that the admin page owns it. Reachability and provider settings invert
slightly — a saved value overrides the environment, and *clearing* it falls
back to the environment — so an operator who never opens the admin page
keeps their `.env` live. See [runtime.md](runtime.md).

### files

**`files`** — `kind` (`avatar` | `space_icon` | `attachment` |
`link_preview`), `owner_id`, optional `space_id`, `name`, `content_type`,
`size`, `sha256`, `storage_key UNIQUE`. The bytes live in the blob store
under `storage_key`; this table is the record of truth for everything
*about* them, including the content type used to serve them. See
[files.md](files.md).

## Identifiers

**Every id is a UUIDv7**, minted by the application (`uuid.NewV7()`), not
by the database.

UUIDv7 embeds a millisecond timestamp in its high bits, so ids sort
chronologically. That single property buys a surprising amount:

- History paging is `WHERE channel_id = $1 AND id < $2 ORDER BY id DESC` —
  one index, no tiebreaker, no `(created_at, id)` composite, and no
  ambiguity when two messages share a millisecond.
- The read marker is a single id, and "unread" is `last_message_id >
  last_read_message_id`.
- The activity feed orders by `id DESC` and gets creation order for
  free.
- Ids are generated before the insert, so a message's id is known while
  building the transaction that also writes its attachments and links.

The cost is that ids leak an approximate creation time. For a chat service
where every message already carries a visible timestamp, that is not a
disclosure.

## Migrations

Goose, embedded in the binary, applied automatically at startup by
`db.Migrate` before anything else is constructed. **Upgrading is pull and
restart** — there is no separate migration step for an operator to forget,
and no window where a new binary runs against an old schema.

Conventions:

- One numbered file per change, `NNNNN_name.sql`, created with
  `make migrate-new name=…`.
- The first comment says which module owns what the migration touches.
- Every migration has a real `-- +goose Down`. They are for developing
  against a live database and for the test harness, not for production
  rollback — that story is below.
- Backfills go in the same migration as the column they fill (see
  `00004_space_roles.sql`, which adds `role`, backfills owners from
  `spaces.owner_id`, and then creates the unique index that the backfill
  makes satisfiable).

## Upgrades and rollback

Upgrading is the new binary against the old database; migrations run
before anything else. Rolling back is the old binary against the *new*
database, and the schema has to allow that, because "put the previous
image back" is the only rollback a self-hoster has that doesn't involve a
restore. So migrations follow **expand/contract**:

- A release may **add** tables, nullable or defaulted columns, indexes and
  backfills freely. The previous release's code never touches them and
  keeps working.
- A release may **drop, rename, or tighten** (`NOT NULL`, a narrower type,
  a new constraint) only what the *previous* release already stopped
  reading and writing. Removing something therefore takes two releases:
  N stops using it, N+1 drops it.
- A backfill the new code depends on runs in the migration, not lazily, so
  the new binary never sees the half state — but the column it fills stays
  nullable or defaulted until the release after.

Review question for any PR with a migration: would the binary from the
last tag start against this schema and pass its tests? If not, split it.

Goose itself is fine with this: it ignores applied versions it has no file
for, so an older binary sees "nothing to run" against an additive newer
schema (`TestMigrateToleratesNewerAdditiveSchema`).

The exception is a contract migration, which by definition breaks the
release before last. It says so by raising the one-row `schema_floor`
table to the last migration the *previous* release shipped, and
`db.Migrate` refuses to start a binary whose newest embedded migration is
below that floor, naming both numbers, instead of failing at some later
query. Expand-only releases never touch the floor, so rolling back across
several of them still works. The fix for a refused start is the newer
binary, or the backup taken before it ran.

A **patch release carries no migrations.** It is cut from a branch off the
previous tag ([releasing.md](../releasing.md)), and goose applies files in
numeric order: a migration numbered after `main`'s unreleased ones would be
applied on patched instances and then block the upgrade to the next minor
as an out-of-order gap. A fix that needs the schema ships as a minor.

## Queries and sqlc

Hand-written SQL, generated Go. `sqlc.yaml` points at
`internal/db/migrations` for the schema and at four query directories, one
per owning module, and emits `internal/dbgen`.

Type overrides worth knowing: `uuid` maps to `string` (ids cross the
protobuf boundary as strings, and converting at every edge would be noise),
`citext` to `string`, `timestamptz` to `time.Time`, and nullable columns to
pointers. So a `*time.Time` in `dbgen` means the column is genuinely
nullable, which reads well at the call site.

Transactions use `s.q.WithTx(tx)`, and there are few of them, on purpose.
The two that matter:

- **`SendMessage`** writes the message, its attachment links, and its link
  records in one transaction. An attachment claim that fails — because the
  file is already attached to another message — must not leave a bare
  message behind.
- **`createAccount`** inserts the user and, for a provider sign-up, its
  `user_identities` row together — a provider sign-up can never leave an
  account with no identity attached. The same transaction takes a Postgres
  advisory lock and re-counts users inside it, because the first account on
  a fresh instance becomes the instance admin and two simultaneous first
  registrations must not both observe an empty table.

Registration with an invite is deliberately *not* one transaction: it
cannot be, since redeeming the code is chat's work reached through a port.
The account is created first and the code redeemed after, best-effort. If
the code was exhausted in the interval the account still stands and the
person can try another once signed in — the opposite ordering would throw
away a valid account over a race on an invite.

Everything else is a single statement, which for a single-instance service
with a bounded working set is both simpler and fast enough.

## What is deliberately not in the database

| State | Where it lives instead | Why |
| ----- | ---------------------- | --- |
| Presence and status | Gateway memory | It is a fact about a live TCP connection. Persisting it means reconciling it after a crash, and the reconciliation is always wrong for a while. A restart drops it and clients reconnect. |
| Typing hints | Gateway memory, rate-limited | Worthless two seconds later. |
| Voice participation | Gateway memory, client-reported | LiveKit is the source of truth for media; this is a hint for the sidebar. |
| The chosen theme | `localStorage` | A per-browser preference. Nothing a space or an admin sets should be able to recolour someone's client. |
| Draft messages | Component state | Not worth a round trip. |

Channel mute is the one member of that family that *is* persisted, because
it is a decision about a channel that should follow the person to their
other devices, not a property of a connection.

## Testing against Postgres

`internal/db/dbtest` creates a throwaway database per test when
`STOOP_TEST_DATABASE_URL` is set, and the tests skip otherwise — so `go
test ./...` works on a clean checkout with no services running, and the
same command exercises the real schema in CI where Postgres is available.
Migrations run against each fresh database, which means every test run is
also a migration test.
