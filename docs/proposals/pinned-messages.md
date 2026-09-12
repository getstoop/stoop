# Pinned messages

Status: proposed 2026-09-11 (STOOP-219). Placement and the four decisions
at the end were settled with the maintainer before this was written; the
renderings live in a design canvas beside it.

Keep the handful of messages a channel keeps coming back to — the rules,
the server address, this week's plan — one click from the channel header,
without reposting them and without a new place to look.

Stoop has no pinning today: no ticket, no column, no proto field. A small
community's answer is to repost the important message every few weeks, or
to put it in the channel topic, which holds one line of plain text. This
adds a per-channel list of kept messages, a permission that already
exists, one realtime event, and one control in the channel header.

## Decisions at a glance

| | |
| --- | --- |
| Storage | A `channel_pins` table, not a flag on `messages`. Pins are their own fact: who kept it and when. |
| Permission | `manage_channels` (admin and owner) pins and unpins; every member reads. No new permission. |
| Scope | Space channels only. DMs have no roles; they follow as their own change. |
| Cap | 50 per channel. Pinning at the cap is refused: nothing falls off that nobody chose to drop. |
| Order | Most recently pinned first. |
| Paging | None. The cap is what makes the list one query and one render. |
| Announcement | None in the channel. The message carries a "Pinned" marker; the panel is the list. Authorless timeline messages are their own design (STOOP-248). |
| Placement | A pin button in the channel header, before the search field, opening a dropdown panel of pinned messages. Selecting one jumps the timeline to it. |
| Realtime | One `MessagePinned` event carrying the delta, not the list. |

## Why a table and not a flag

`messages.pinned boolean` would be one migration and one predicate, and
it is the wrong shape twice over. A pin is a decision somebody made at a
time — "casey pinned this on the 3rd" is the first thing a reader wants
and a flag cannot say it. And the list is read per channel, so a flag
needs its own partial index on `(channel_id) WHERE pinned` to avoid
scanning the channel's history; that is the pin table, spelled worse.

| Option | Reads | Costs | Verdict |
| --- | --- | --- | --- |
| `pinned boolean` on `messages` | Partial index scan, then the same hydrate | Rewrites the hottest table; no room for who or when; the cap needs a count over `messages` | No |
| `pinned_at`, `pinned_by` on `messages` | Same | Two more columns on every message row to describe at most 50 of them | No |
| **`channel_pins` table** | Index range scan of at most 50 rows, joined to `messages` | One more table | **Yes** |

The table also inherits the two behaviours we would otherwise write code
for. `ON DELETE CASCADE` from `messages` means deleting a pinned message
unpins it, with no sweep and no dangling row; `ON DELETE CASCADE` from
`channels` means deleting a channel takes its pins. Neither is a code
path anyone has to remember.

## Schema

One migration, `00030_channel_pins.sql`, expand-only: a new table and its
index, nothing altered, so the previous release runs against it unchanged
and a rollback is a no-op.

```sql
-- +goose Up
-- Messages a channel keeps: who pinned each and when. Owned by chat.
-- Cascades do the cleanup — deleting the message or the channel drops
-- the pin.
CREATE TABLE channel_pins (
    message_id uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    pinned_by  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pinned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channel_pins_channel_idx ON channel_pins (channel_id, pinned_at DESC);

-- +goose Down
DROP TABLE channel_pins;
```

- **`message_id` is the primary key**, not `(channel_id, message_id)`. A
  message belongs to exactly one channel, so the pair would let the
  database hold a contradiction it should not be able to hold, and the
  hydrate lookup ("is this message pinned?") wants `message_id` alone.
  `channel_id` is denormalised so the list query never touches
  `messages` to find its candidates.
- **The index is the list query**, in its order, so reading a channel's
  pins is a range scan of at most 50 rows.
- **`pinned_by` cascades from `users`.** A deleted account takes its pins
  with it, the same as its messages.
- **Nothing backfills.** The migration is instant on any instance.

## The cap, and the one race in it

Fifty is the bound that makes everything else simple: one query, no
cursor, no paging in a dropdown, a panel that renders in one pass. At the
cap, pinning is refused — `FailedPrecondition`, "this channel has 50
pinned messages; unpin one first" — rather than evicting the oldest pin,
because an eviction loses something nobody decided to lose, and the
person who would notice is not the person doing the pinning.

The check and the insert are one statement, so a pin cannot read a stale
count and then write:

```sql
-- name: PinMessage :one
INSERT INTO channel_pins (message_id, channel_id, pinned_by)
SELECT sqlc.arg(message_id)::uuid, sqlc.arg(channel_id)::uuid, sqlc.arg(pinned_by)::uuid
WHERE (SELECT count(*) FROM channel_pins WHERE channel_id = sqlc.arg(channel_id)::uuid) < sqlc.arg(cap)::int
ON CONFLICT (message_id) DO NOTHING
RETURNING *;
```

No row comes back in two cases, and the service tells them apart with one
follow-up read: the message is already pinned (idempotent success, return
the existing pin) or the channel is full (the refusal above). That read
only runs on the unusual path.

Two admins pinning simultaneously into a channel with 49 pins can both
pass the sub-select under `READ COMMITTED` and land at 51. The overshoot
is bounded by the number of concurrent pinners, it corrects itself as
soon as anyone unpins, and nothing downstream breaks — the panel renders
51 rows. Taking `SELECT … FOR UPDATE` on the channel row would close it
and serialise every pin behind a channel lock; that trade is not worth
making for a list that two people touch a week.

## Reading the list

The list query selects the same four columns as `ListMessagesBefore`, so
pinned messages hydrate through `hydrateMessages` — the one path that
resolves authors, mentions, reactions, attachments and link previews —
exactly as search results do.

```sql
-- name: ListChannelPins :many
SELECT sqlc.embed(m), p.author_id AS reply_author_id, p.content AS reply_content,
    COALESCE((SELECT a.file_id::text FROM message_attachments a WHERE a.message_id = p.id ORDER BY a.position LIMIT 1), '')::text AS reply_first_file_id,
    pin.pinned_by, pin.pinned_at
FROM channel_pins pin
JOIN messages m ON m.id = pin.message_id
LEFT JOIN messages p ON p.id = m.reply_to_message_id
WHERE pin.channel_id = sqlc.arg(channel_id)::uuid
ORDER BY pin.pinned_at DESC, pin.message_id DESC
LIMIT sqlc.arg(lim);
```

The two extra columns mean the row type is not the plain conversion
`dbgen.ListMessagesBeforeRow(r)` that `SearchMessages` uses; `pins.go`
builds the message row explicitly from the four shared fields. That is
four lines and one comment, and it is why the column list here must stay
in step with `ListMessagesBefore` when either changes.

The timeline's own "this one is pinned" marker needs no join on the hot
path. `hydrateMessages` already fans out per message id for reactions and
attachments; pins add one more of the same shape:

```sql
-- name: PinnedMessageIDs :many
SELECT message_id FROM channel_pins WHERE message_id = ANY(sqlc.arg(ids)::uuid[]);
```

A page of 50 messages costs one extra primary-key lookup over a table
that holds at most 50 rows per channel.

## API

Two RPCs on `ChatService`, and one entity message in a new
`proto/stoop/chat/v1/pin.proto` (one file per entity, per
`docs/conventions.md`).

```proto
// PinnedMessage is one kept message with the decision that kept it.
message PinnedMessage {
  Message message = 1;
  MessageAuthor pinned_by = 2;
  google.protobuf.Timestamp pinned_at = 3;
}
```

```proto
// SetMessagePinned pins or unpins a message in a space channel.
// Requires manage_channels in the channel's space. Setting the state it
// already has is a no-op. Pinning into a full channel is refused.
rpc SetMessagePinned(SetMessagePinnedRequest) returns (SetMessagePinnedResponse) {}
// ListPinnedMessages returns a channel's pins, most recently pinned
// first. Members only; no paging — a channel holds at most 50.
rpc ListPinnedMessages(ListPinnedMessagesRequest) returns (ListPinnedMessagesResponse) {}

message SetMessagePinnedRequest {
  string message_id = 1;
  bool pinned = 2;
}
message SetMessagePinnedResponse {
  // Set when pinned; empty after an unpin.
  PinnedMessage pin = 1;
}

message ListPinnedMessagesRequest {
  string channel_id = 1;
}
message ListPinnedMessagesResponse {
  repeated PinnedMessage pins = 1;
}
```

`SetMessagePinned` rather than `Pin`/`Unpin` matches the house style —
`SetChannelMuted`, `SetSpaceMuted`, `SetMemberRole` — and keeps one
permission check and one event site.

`Message` gains one field, so the timeline and the message's own actions
know the state without a second call:

```proto
  // True while this message is in its channel's pin list. Kept current
  // by the MessagePinned realtime event.
  bool pinned = 15;
```

Errors are the ones the client has to word: `PermissionDenied` for a
member without `manage_channels`, `NotFound` for a message outside the
caller's spaces (never "exists but not yours"), `FailedPrecondition` at
the cap, and `InvalidArgument` for a message in a DM until DM pins ship.

## Realtime

One event, delta-shaped, number 32 in the `ServerEvent` oneof:

```proto
// MessagePinned is broadcast to the space when a message is pinned or
// unpinned. It carries the change, not the list: the list can be 50 full
// messages and every client that cares can already ask for it.
message MessagePinned {
  string space_id = 1;
  string channel_id = 2;
  string message_id = 3;
  // False when unpinned.
  bool pinned = 4;
  // Set when pinned.
  stoop.chat.v1.MessageAuthor pinned_by = 5;
  google.protobuf.Timestamp pinned_at = 6;
}
```

`ReactionsChanged` sends a message's whole reaction list because that
list is small and always attached to a message the client is already
rendering. Pins are neither: the payload would be up to 50 hydrated
messages, broadcast to a whole space, most of whose clients do not have
the panel open. The delta is three ids, and a client that has the list
cached invalidates it.

On receipt the web client does two things: patch `pinned` on the message
in the `["messages", channelId]` window if it is loaded, so the marker
appears without a refetch; and invalidate `["pins", channelId]`, which
refetches only if the panel is open.

## Placement and design

The user-facing surface is one button and one panel. Three placements
were weighed; A is decided.

| Option | Entry | The list | Trade |
| --- | --- | --- | --- |
| **A. Header button + dropdown** | A pin icon in the channel header, before the search field | A panel anchored under the button, scrolling, rows that jump the timeline | In the header people already scan, one click from anywhere in the channel, and it closes itself. Costs 32px of header width, which the header already budgets for on a phone. |
| B. A route, like search | The same icon, navigating to `/s/$spaceId/c/$channelId/pins` | A full page built like the search results page | Linkable and roomy, but pins are a glance, not a destination: leaving the channel to read one and coming back loses the reader's place. |
| C. A right-hand panel | The same icon, sliding a column in | A column beside the timeline | There is no third column in the shell, and below 768px there is no room to grow one. The members panel already folds into the sidebar rather than claiming width. |

### The header control

The pin icon sits after the topic and before the search field, so the
header reads left to right as: where you are, what this channel is about,
what it keeps, how to look for something else. It is shown in every space
channel, for every member, whether or not anything is pinned — its
absence would be a more confusing state than an empty panel, and a member
who cannot pin can still read.

The button is a `.icon-button`, marked `aria-haspopup="menu"` and
`aria-expanded`, with an accessible name of "Pinned messages". It carries
no count: a count would mean `ListChannels` maintaining one per channel
for a number almost nobody is waiting on. The panel says how many when it
opens.

### The panel

A popover anchored to the button, right-aligned under it, fixed to the
viewport so the header cannot clip it — the mechanics `DotsMenu` already
has (Escape, a click outside, a scroll anywhere, or picking a row closes
it), applied to rows of messages instead of a list of labels.

- **Head.** "Pinned messages" and the count.
- **Rows.** Avatar, author, the date the message was sent, and a small
  second line, "Pinned by casey · Tuesday". Then the message body,
  clamped to three lines, with the attachment strip if there is one.
- **Selecting a row** closes the panel and navigates to the channel with
  `?m=<id>`, which is the jump the activity feed, search results and
  shared links already use: `history.jumpTo` replaces the window with one
  centred on the message and the timeline lands on it, highlighted.
- **Unpin** is a small × at the right of a row, shown to whoever holds
  `manage_channels` and on hover (always, on a touch screen — the
  channel row's menu does the same). It removes the row in place; the
  panel stays open.
- **Empty state.** "Nothing pinned yet." For an admin, a second line:
  "Pin a message from its hover actions to keep it here."
- **Scrolling.** The panel caps at roughly 60% of the viewport height and
  scrolls inside; 50 rows is the most it can ever hold.
- **On a phone** it is not a dropdown but a sheet: full width under the
  header, the same rows, a Close chip. `mobile.css` makes that swap, the
  way it already swaps the search field for its icon.

### Pinning a message

The message's hover actions gain a pin, between the link and the reply,
for whoever holds `manage_channels`. It toggles: a filled icon and
"Unpin" when the message is already pinned.

A pinned message in the timeline carries a small marker above its first
line — a pin glyph and the word "Pinned" in the muted small type the
day-line uses — so a reader scrolling past knows the message is kept
without opening anything.

### Files

The layout and style rules in `docs/conventions.md` decide most of this:

- `web/src/components/PinnedMessages/index.tsx` — the button and its
  panel, owning open state and the query; `PinnedMessages/PinRow.tsx` —
  one row.
- `web/src/api/pins.ts` — `usePins(channelId)` (fetched when the panel
  opens), the set/unset call, and the cache patches the realtime handler
  calls.
- `web/src/styles/pins.css` — the panel and the timeline marker, added to
  `index.css` before `mobile.css`; the phone sheet in `mobile.css`. If a
  second feature ever wants the rich popover, it moves to
  `surfaces.css` first.
- `web/src/components/Icons.tsx` — the pin glyph, filled and outline.
- `internal/chat/pins.go` and `pins_test.go`;
  `internal/db/queries/chat/pins.sql`; `proto/stoop/chat/v1/pin.proto`.
- `docs/architecture/messaging.md` gains a Pins section after Search, and
  `docs/architecture/data.md` a `channel_pins` entry in the chat schema.

## Not in the first cut

- **DM pins.** The same table and panel; the permission check becomes
  "is a participant" rather than a role. Its own change.
- **An announcement in the channel.** "casey pinned a message" means
  authorless messages — a new message kind through the schema, the
  renderer, search and the unread count. Filed as STOOP-248; pins do not
  wait on it.
- **Pin from the composer or a keyboard shortcut.** Waits on the binding
  layer (STOOP-127).
- **Reordering pins by hand.** Most-recent-first is the order; a manual
  one needs a position column and a drag affordance in a dropdown.
- **A count badge on the header button.** Needs a per-channel count in
  `ListChannels`; add it only if the empty panel proves to be a wasted
  click.
- **Space-wide pins**, or a pinned-messages digest for new joiners. A
  welcome-text question more than a pin one.

## Verification

- Go tests in `internal/chat/pins_test.go`: an admin pins and the list
  shows it; a member is refused with `PermissionDenied`; pinning twice is
  idempotent; the 51st pin is refused; deleting a pinned message drops the
  pin; deleting the channel drops them all; a non-member gets `NotFound`
  rather than a permission error.
- A web unit test for the cache patches in `api/pins.ts` — a
  `MessagePinned` event with the window loaded, and with it absent.
- A browser spec, `web/e2e-pw/pins.spec.ts` — pin, see the marker, open
  the panel, jump, unpin — after the maintainer has reviewed the feature
  on the dev instance. Per the project rule, no spec runs before that.
- The next release's rollback dry run covers this migration; there is
  nothing to backfill, so the only thing to confirm is that the previous
  binary ignores the new table.

## Decisions taken

Answered by the maintainer on 2026-09-11, before this was written.

1. **`manage_channels` pins.** No new permission, no space-level opt-in.
2. **Space channels only.** DMs are a separate change.
3. **Refuse at the cap**, rather than evicting the oldest pin.
4. **No announcement in the channel**, and the authorless timeline
   message is ticketed for later (STOOP-248).

Still open: whether the header button should eventually carry a count,
which only matters once a real instance says how often the panel opens
empty.
