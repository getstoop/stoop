Stoop 0.14.0

Stoop 0.14.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.13.0 and rolls back to it with
`stoop upgrade rollback`. **Read "Looking ahead" below: 0.15.0, which
follows soon after, will not roll back to 0.13.0.**

**What's new.**

- **Scrolling back has no end.** The channel view used to keep about 300
  messages and drop the oldest as you scrolled; now it draws only the rows
  on screen and holds up to 2,000 per channel, so reading back through a
  long history no longer forgets where you came from.
- **A dropped connection catches up instead of reloading.** When the
  realtime connection comes back, the app asks the server for exactly
  what it missed in each channel it is showing: messages, edits,
  reactions, pins, thread activity and deletions. Nothing flickers or
  scrolls, and a message sent while you were offline appears in place.
- **Deleted messages.** What people see is unchanged, with one
  difference: a message that quoted a since-deleted message now shows a
  "deleted" quote, where before the quote disappeared. A deleted message
  with replies still shows as a placeholder with its thread.
- **Presence waits before saying offline.** Someone's dot no longer
  flickers when they reload the page or lose the network for a moment:
  offline is announced only after a grace period (30 seconds by default)
  with no connection back. Signing out is still at once.
- **Online on mobile.** Someone connected only from the mobile app shows
  a small phone where the online dot goes, everywhere the dot appears.
  The mobile app itself is in development and is not part of this
  release; this is the server and web side of it.

**For operators.**

- **A deleted message leaves a record until retention removes it.**
  Deleting a message now blanks it in place rather than removing the row:
  its text, reactions, files, mentions, pins and notifications are
  deleted at once, and the row keeps who posted it, in which channel,
  when, and when it was deleted. Nothing in Stoop shows that row to
  anyone. The hourly message retention sweep removes it with everything
  else past the period; **with message retention off, these rows stay,
  and they are in your backups.** Set "Delete messages after" on the
  admin page's Storage tab if that matters to you.
- **The upgrade rewrites the messages table once.** Migration 00068
  numbers every existing message within its channel and builds an index
  over the result. On a large install the first start takes longer than
  usual, in proportion to the size of `messages`; `stoop upgrade` waits
  for it.
- **`STOOP_PRESENCE_GRACE`** (default `30s`) is the new presence grace
  period. `0` announces offline at once, as every release before this
  did. See [Configuration](https://github.com/getstoop/stoop/blob/v0.14.0/docs/self-hosting/configuration.md).
- **Outgoing webhooks are unchanged.** `message.created`,
  `message.updated` and `message.deleted` fire when they did before, with
  the same payloads.
- **Browser tabs left open from 0.13.0 keep working** against this
  release; everything the server adds is additive. Reload to get the new
  app.

**API changes**, all additive; nothing is removed or renamed.

- `stoop.chat.v1`: every `Message` carries `seq`, its position in its
  channel's log, which moves on every change to the row (send, edit,
  reaction, pin, link preview, thread activity, deletion). A higher `seq`
  is a newer copy. `ListMessagesResponse` gains `channel_seq` and
  `retention_floor_id`. New `ListChanges(channel_id, since_seq, limit)`
  returns every row of a channel above a position, in order, deletions
  and thread replies included, with `channel_seq`, `has_more` and
  `retention_floor_id`; the same access rules as `ListMessages`. A
  script that holds a channel's messages can keep them current with it
  instead of refetching pages.
- `stoop.realtime.v1`: `reactions_changed`, `message_pinned`,
  `thread_changed` and `message_deleted` carry the row's `seq` after the
  change. `UserPresence` and `PresenceChanged` gain `mobile`. A client
  that opens `/ws?client=mobile` is counted as the mobile app for that
  mark.

**Schema.** Migration 00068 runs at startup, taking the schema from 67
to 68. It adds `channels.seq` and `channels.swept_seq`, a nullable
`messages.seq` backfilled for every existing row, the index
`messages_channel_seq_idx`, and recreates the view `message_with_reply`
with the new column at its end. It is not a contract migration: the
schema floor stays at 65, and 0.13.0 starts against the result, so
`stoop upgrade rollback` takes this release back.

**Looking ahead: 0.15.0.** The next release finishes this change with a
contract migration that makes `messages.seq` required and raises the
schema floor to 68. After that, rolling back lands on 0.14.0 at the
oldest, not 0.13.0, and `stoop upgrade` will say so before it starts. A
message sent on 0.13.0 after a rollback from this release has no
position; the 0.15.0 migration gives it one. If you plan to sit on a
release for a while, 0.14.0 is the one that still has a way back.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.13.0.

**Known issues.**

- Deleting a message above the part of the channel you are reading
  shifts what you see by that message's height.
- An audio attachment starts over if you scroll far enough away for its
  row to be removed from the page and then come back to it.
- Two jumps in quick succession, such as clicking two message links,
  land on whichever the server answers first.
- Changing your display name does not reach other people's open tabs
  until they reload. A username change does. (Not new in this release.)
- When everything in a channel is unread, the "New messages" line can
  move as older messages load. (Not new in this release.)

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.13.0:

- Join from an invite link on the phone (a67e268f)
- Invite: the space's own icon in the card (7eb3251a)
- Invite: answer review — bad links, missed joins, closed sign-up, deadlines (a00ca48f)
- Maestro flows for the phone app's happy paths (184c5321)
- Spaces tab: the server's spaces, with the tab bar (1d6c0156)
- Spaces: each space's description under its name (9867447c)
- You tab: a theme picker, kept on the phone (bf8d23be)
- iOS: the system's own tab bar (94134703)
- iOS tabs: the theme's surface behind each tab, no flash on first open (9f59b6c1)
- Tell the system the theme's light or dark (f4edc197)
- README: the native iOS tab bar and the colour scheme it follows (49f519aa)
- Server switcher: a sheet of every server on the phone (96237963)
- Server switcher: swap the server in place under the closing sheet (1924012b)
- Presence: a grace before offline, and a phone mark for mobile (3fde4e9e)
- Mobile: hold the realtime socket to every server while open (bf9f3e22)
- Presence: announce in order, and reconcile a reconnect's spaces (744586c6)
- Presence: a larger, framed phone for online on mobile (2eb1bd96)
- Presence: a smaller frame with a home button (020eec4c)
- Presence: rewrap the phone mark comment (e90ca36c)
- Mobile: a space's channels, with who is in each voice room (e8de7203)
- Mobile: a space's channels follow the realtime socket (415128fe)
- Mobile: open a server on Spaces again, and test the channels live (b0a27b89)
- Mobile: space channels review fixes (da5f3fcd)
- Share web's browser-free helpers with the app as @stoop/core (f70919d4)
- check-core: catch bare side-effect imports (2d793ce7)
- Mobile: read a channel, kept live (d29c7d66)
- Mobile: channel review fixes (8c55f960)
- Mobile: channel catches up fully after a reconnect (fa4d77c5)
- Mobile: an older page can't undo a newer edit (495e6bc1)
- Core: a channel's timeline as a shared reducer (54479163)
- Core: the timeline's window apart from its header (791edbe1)
- Web: message windows run the shared timeline reducer (4946a891)
- Web: review fixes for the shared timeline windows (59c67e9c)
- Chat: the channel log's sequence, stamped on every write (56361b8a)
- Chat: the seq's NotFound is made per call, and the sweep is named (3127dadd)
- Chat: every delete is a tombstone, and the sweep holds the channel row (389a881b)
- Web: virtualise the channel message list (eb60c5e1)
- Chat: a hidden root loses its pin, and a late preview leaves a tombstone alone (aa04148d)
- Web: the list's anchor waits for its page, and the head's growth is kept (4af441fe)
- Chat: ListChanges catches a channel up, and every message event carries its seq (9da15e7b)
- Chat: the floor spares pinned threads, and a partial page is no position (062bb77c)
- Web: the edited row stays mounted, and an emptied list follows again (7c681074)
- Chat: a write checks its target again under the channel lock (2b873f30)
- Web: the channel log store and its loader, unwired (9bc3c1e1)
- Web: review fixes for the channel log store (6a6eca37)
- Web: the message timeline runs on the channel log (016aa865)
- Web: review fixes for the channel log switch (ab95d453)
- Web: a departed author is shown from their profile (69ad2a13)
- E2E: read a row's anchored position from a frame that has it (f8c41e6d)
- Web: review fixes for the channel log's gaps, ties, floor and reconnect (afb2b4fb)
- Web: the list asks for no page while an anchor is pending (2183f754)
- Docs: the list asks for no page while an anchor is pending (08bfab59)
- E2E: read a row's anchored position from a frame that has it (0389cb50)
- Web: the list asks for no page while an anchor is pending (807122e4)
- Docs: the list asks for no page while an anchor is pending (6e155dbe)
- E2E: the drag's arrow is repeated until the row is over another (86aa17b3)
- Web: the list reads its edges from a landing (6e0bd361)
- Web: the channel log's cleanup step (80bd8d48)
- Docs: review follow-ups for the channel log's cleanup step (1e1abf17)
