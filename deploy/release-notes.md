Stoop 0.15.0

Stoop 0.15.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.14.0. **`stoop upgrade rollback`
takes it back to 0.14.0 and no further**: this release makes the schema
change 0.14.0 began permanent, so 0.13.0 and older refuse to start
against the result. `stoop upgrade` says so before it starts. If you are
still on 0.13.0, upgrade to 0.14.0 first and check it, because this is
the release that closes the way back.

**What's in it.** Nothing new to use. This is the second half of the
channel log that 0.14.0 shipped: the position every message carries is
now required by the database rather than filled in by the app, and the
schema floor moves up to match. The one visible change for people is
none; the one for operators is below.

**For operators.**

- **Contract migration.** 00069 runs at startup. It gives a position to
  any message that has none (only a message written by a 0.13.0 binary
  during a rollback from 0.14.0 can lack one), makes `messages.seq`
  required, and raises the schema floor from 65 to 68. 0.14.0 starts
  against the result, so a one-step rollback still works; 0.13.0 and
  older do not. On a failed upgrade, `stoop upgrade` prints the restore
  commands for the backup it took rather than offering `rollback`
  ([Restoring in place](https://github.com/getstoop/stoop/blob/v0.15.0/docs/self-hosting/backups.md#restoring-in-place));
  anything written after the upgrade is lost by restoring it.
- **Skipping 0.14.0 is fine.** An upgrade straight from 0.13.0 runs 00068
  and then 00069 in order and lands in the same place, with the same
  rollback: to 0.14.0, not 0.13.0.
- **`channels.swept_seq` is no longer written.** Nothing has read it
  since 0.14.0; the column stays this release so that 0.14.0's retention
  sweep still runs on rollback, and is dropped in a later release.
- **Deleted messages in the self-hosting docs.** [Storage and retention](https://github.com/getstoop/stoop/blob/v0.15.0/docs/self-hosting/storage.md#what-a-deleted-message-leaves-behind)
  now says what a deleted message's row keeps until the retention sweep
  removes it, as the 0.14.0 notes did.

**API changes.** None. `Message.seq` is documented as always set; it was
already set on every message 0.14.0 served.

**Schema.** Migration 00069 takes the schema from 68 to 69 and the floor
from 65 to 68. It fills `messages.seq` where NULL with positions above
the channel's counter, sets `NOT NULL`, and updates `schema_floor`. No
table, column or view is added or removed.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.14.0.

**Known issues.** As 0.14.0's: deleting a message above the part of a
channel you are reading shifts the view by its height; an audio
attachment starts over if its row is scrolled far enough away to be
removed from the page and then comes back; two quick jumps land on
whichever the server answers first; a display name change reaches other
people's open tabs on reload; with everything in a channel unread, the
"New messages" line can move as older messages load.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.14.0:

- Docs: what a deleted message leaves behind (4734c9ea)
- Chat: the channel log's contract migration (step 8) (9b917113)
- Chat: review follow-ups for the contract migration (35217a12)
- Docs: step 8's pull request number in the proposal (0711d352)
- Scripts: the flood locks the channel rows before stamping (25abcb1b)
