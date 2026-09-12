# Group DMs

Status: proposed 2026-09-12 (STOOP-220). The three decisions that change
what gets built were settled with the maintainer before this was written;
they are listed at the end.

Let three or four people have a side conversation without building a
space for it. "The four of us sorting out Saturday" is the most common
thing a friend group does, and today Stoop's answer is either a 1:1 chain
of the same message three times or a whole space with its roles, invites,
channel list and sidebar entry — furniture nobody wants for a Tuesday.

The groundwork is already in the tree. `dm_members` was made a table
rather than two columns on the channel *for this*, and everything that
fans a DM out already loops over a list: `publishChannel` publishes to
each participant's user topic, `recordDM` writes an activity item per
participant, `DMParticipants` hands the realtime gateway a slice, and
`usePeople` on the web dresses participants up as members so the
timeline, composer and mention picker never learn there are two kinds of
channel. What is missing is a way to make one, a way to change who is in
it, and a name and face for a conversation that is not one other person.

## Decisions at a glance

| | |
| --- | --- |
| Storage | No new table. One migration, and it only loosens a `CHECK`. |
| Identity | A 1:1 is identified by its pair (`dm_key`); a group is not identified by who is in it, so a group carries no key. Two groups with the same people are two conversations. |
| Cap | 10 participants, the caller included. |
| Who may start one | The same rule as a 1:1: people you share a space with, or anyone if you are an instance admin. |
| Adding | Any participant may add. Adding to a **1:1** does not convert it — it forks a new group with no history. Adding to a **group** lets the newcomer read all of it. |
| Leaving | Any participant may leave a group; a 1:1 cannot be left. The last person out deletes the conversation. |
| Blocks | Enforced when somebody is added, not afterwards: no group is ever *created* holding a blocked pair, and a block made later does not silently gag the group. |
| Name | Derived from the participants. No custom name in this cut. |
| Realtime | One new event carrying the new participant list; `ChannelDeleted` to whoever left. |
| Pins, roles, invites | None. A group DM has no roles, so it has no manager, exactly as a 1:1 has none. |

## What the schema already does, and the one thing in the way

A DM is a channel with `space_id IS NULL` and `kind = 3`, its people in
`dm_members`, and `dm_key` — the two user ids sorted and joined — carrying
a `UNIQUE` constraint so that two people opening the same conversation at
once get one row rather than two. Messages, read markers, reactions,
attachments, previews and activity all hang off `channel_id` and cannot
tell a DM from a space channel, let alone a group from a pair.

The obstacle is `dm_key` itself, in two parts.

**A group is not its member list.** People are added and people leave, so
a key derived from the membership would have to be rewritten on every
change, and "the same key" would stop meaning "the same conversation".
Worse, it would make the set of people an identity: adding Casey to
{me, ada} and then removing him would have to find its way back to a row
that already exists under that key. A group therefore gets no key at all.
Its identity is its id, the way a channel's is.

That is the decision behind "two groups with the same people are two
conversations". It is also the honest reading of what a group is: {me,
ada, bea} planning a birthday and {me, ada, bea} arguing about a film are
not the same conversation and a key would insist they were. A 1:1 is
different — there is only ever one conversation with one person — and
keeps its key and its idempotency unchanged.

**The `CHECK` demands a key on every DM.** `channels_dm_shape` currently
reads `(kind = 3) = (space_id IS NULL) AND (kind = 3) = (dm_key IS NOT
NULL)`. The second half has to become "only a DM may carry a key" rather
than "every DM must".

## Schema

One migration, `00031_group_dms.sql`. Nothing is added, nothing is
backfilled, no data moves; a constraint is replaced with a weaker one.

```sql
-- +goose Up
-- Group DMs: a direct message with more than two people. dm_members
-- already held a list, so nothing moves. The one thing in the way was
-- dm_key, the pair identity that makes "open a DM with X" idempotent: a
-- group is not identified by who is in it — people are added and leave —
-- so a group carries no key, and the check that demanded one on every DM
-- now only forbids one on a channel that is not a DM.
ALTER TABLE channels DROP CONSTRAINT channels_dm_shape;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
    CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3 OR dm_key IS NULL));

-- +goose Down
DELETE FROM channels WHERE kind = 3 AND dm_key IS NULL;
ALTER TABLE channels DROP CONSTRAINT channels_dm_shape;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
    CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3) = (dm_key IS NOT NULL));
```

- **It is expand-only in the sense `data.md` means.** The new constraint
  accepts everything the old one accepted, so the previous binary runs
  against the new database unchanged: it writes a key on every DM it
  creates, which is still allowed. The one thing the previous binary does
  imperfectly is *read* a group — its DM list shows one of the other
  participants as though the conversation were a pair. It is wrong, not
  broken, and only during a rollback window.
- **The `DELETE` in the down migration** is how the old constraint can be
  restored at all: rows without a key cannot satisfy it. A rollback past
  this migration therefore discards group conversations, which the
  release runbook has to say out loud. Pair DMs are untouched.
- **Cost.** `DROP`/`ADD CONSTRAINT` takes `ACCESS EXCLUSIVE` on `channels`
  and validates every row. `channels` holds one row per channel on the
  largest instance anyone is running; this is milliseconds.
- **`dm_key` keeps its `UNIQUE` index** and so keeps doing its job for
  pairs. `NULL`s do not collide in a Postgres unique index, so any number
  of groups sit under it without contending.

`dm_members` needs nothing: `PRIMARY KEY (channel_id, user_id)` already
allows any number of rows per channel and makes a double-add a no-op, and
`dm_members_user_idx` already drives "my conversations".

## The cap

Ten participants, the caller included, as a constant in `internal/chat`
rather than a setting — an instance-wide knob for this would be a
question every operator has to answer and nobody has an opinion about.
Ten is where a conversation stops being a conversation; past it, the
thing being asked for is a space, which Stoop already has and does
better. The eleventh add is `FailedPrecondition` with a message that says
so: "a group conversation holds 10 people; make a space for anything
bigger".

The check is per add, inside the transaction that inserts — a `count(*)`
over at most ten rows on a primary-key range scan. Two people adding at
once can both pass it under `READ COMMITTED` and land at eleven, the same
bounded overshoot the pin cap has: bounded by the number of concurrent
adders, harmless to everything downstream, and not worth serialising every
add behind a lock on the channel row to prevent.

## Who may be in one

Opening a 1:1 today asks one question — do these two share a space, or is
the caller an instance admin — and then one more, is either blocking the
other. Groups ask the same questions, once per person being added, and
one extra.

- **Eligibility is checked between the caller and each person they add**,
  not between all pairs. Adding somebody to a group is an act by one
  person, and the rule they have to satisfy is the rule they already
  satisfy to message that person directly. It follows that a group can
  end up holding two people who share no space, introduced by somebody
  who shares one with each. That is what an introduction *is*, and
  refusing it would make the feature useless for the case it exists for.
- **Blocks are checked between the person being added and everyone
  already there**, both directions, and any hit refuses the add. This is
  the extra question, and it is what keeps the promise a block makes:
  you never land in a room with somebody you blocked because a third
  person put you there.
- **Blocks made later do not change an existing group.** Blocking
  somebody you already share a group with hides neither of you from the
  other inside it; the conversation is a shared room, and quietly
  swallowing one member's messages for one other member would be a lie
  the timeline cannot show. The out is to leave, which is one click and
  which the block does not have to do for you.

That last point needs a matching change in code, not only in prose.
`writableChannel` calls `dmBlocked`, which refuses the write if the
caller is blocked by *any* other participant — correct for a pair, and in
a group it would let one person silently mute another for everybody by
blocking them. `dmBlocked` becomes a pair-only rule, keyed off
`dm_key IS NOT NULL`; the group's guarantee is the add-time check above.

The same narrowing applies to the DM list. `ListDMChannelsByUser` hides
conversations whose other participant the caller has blocked, which in a
group would make one block hide a whole conversation from the person who
made it. One predicate, scoped to keyed DMs:

```sql
  AND (c.dm_key IS NULL OR NOT EXISTS (
    SELECT 1 FROM dm_members o
    JOIN user_blocks b ON b.blocked_id = o.user_id AND b.blocker_id = sqlc.arg(user_id)
    WHERE o.channel_id = c.id AND o.user_id <> sqlc.arg(user_id)
  ))
```

## Adding, forking and leaving

**Adding to a group shows the newcomer everything.** A group DM is one
room with one history, and the timeline, paging, the jump-to-message
window and the activity feed all read it as one. Giving a newcomer a
floor would mean a `joined_at` on `dm_members` respected by every query
in the DM path — history pages, the jump window, search when it gains DM
scope (STOOP-179), the reply preview on a quoted message, the attachment
download rule — and each of those is a place a leak can hide. The
simpler rule is also the one that can be stated in a sentence to the
person doing the adding, and the UI states it: "bea will be able to read
this conversation."

**Adding to a 1:1 does not convert it.** Two people's private
conversation stays private: `AddDirectMessageMembers` on a pair creates a
*new* group holding both of them plus everybody added, with no history,
and returns it for the client to navigate to. The pair conversation is
left exactly as it was. This is the only place the two rules meet, and
they meet cleanly: nothing a newcomer can read was ever said somewhere
they were not.

**Leaving** removes the row from `dm_members` and nothing else. Messages
stay — they are the other people's conversation too, and a departure
should not punch holes in it. The leaver stops seeing the conversation,
stops being notified, and is no longer a participant for `publishChannel`
or the gateway. A 1:1 cannot be left: `InvalidArgument`, because the
thing being asked for there is a block or a delete, and both exist.

**A group can shrink to one and survive.** The remaining person keeps the
conversation and its history, shown as "Just you", and may add people to
it again. Deleting it under them because everybody else walked out would
destroy a record they never agreed to destroy. When that last person
leaves, `dm_members` is empty and the channel row is deleted, taking its
messages, reads, reactions and attachments by the cascades already in
place.

## API

Four RPCs on `ChatService`. `OpenDirectMessage` is untouched — it is the
pair verb, and overloading it with a list would put "always the same row"
and "always a new row" behind one name.

```proto
// CreateGroupDirectMessage starts a conversation with several people.
// Always a new conversation: unlike a 1:1 a group is not identified by
// who is in it. 2 to 9 others, each of whom the caller must be able to
// message. Blocks between any of them refuse the whole call.
rpc CreateGroupDirectMessage(CreateGroupDirectMessageRequest) returns (CreateGroupDirectMessageResponse) {}

// AddDirectMessageMembers adds people to a conversation the caller is
// in. On a group they join it and can read all of it. On a 1:1 nothing
// is converted: a new group is created holding both people plus the
// ones added, with no history, and returned.
rpc AddDirectMessageMembers(AddDirectMessageMembersRequest) returns (AddDirectMessageMembersResponse) {}

// LeaveDirectMessage removes the caller from a group conversation. The
// conversation and its messages stay for everyone else; the last person
// to leave deletes it. A 1:1 cannot be left.
rpc LeaveDirectMessage(LeaveDirectMessageRequest) returns (LeaveDirectMessageResponse) {}

// ListDirectMessageCandidates is everyone the caller may start a
// conversation with: the people they share a space with, minus blocks in
// either direction. Instance admins get the same list, not every account.
rpc ListDirectMessageCandidates(ListDirectMessageCandidatesRequest) returns (ListDirectMessageCandidatesResponse) {}
```

```proto
message CreateGroupDirectMessageRequest {
  // The other people, without the caller. At least 2, at most 9.
  repeated string user_ids = 1;
}
message CreateGroupDirectMessageResponse {
  DirectMessage direct_message = 1;
}

message AddDirectMessageMembersRequest {
  string channel_id = 1;
  repeated string user_ids = 2;
}
message AddDirectMessageMembersResponse {
  // The conversation the people are now in: the same one for a group,
  // a new one when a 1:1 forked.
  DirectMessage direct_message = 1;
  // True when a 1:1 forked and this is a different conversation.
  bool forked = 2;
}

message LeaveDirectMessageRequest {
  string channel_id = 1;
}
message LeaveDirectMessageResponse {}

message ListDirectMessageCandidatesRequest {}
message ListDirectMessageCandidatesResponse {
  repeated MessageAuthor users = 1;
}
```

`DirectMessage` already carries `repeated MessageAuthor participants`, so
the response shape for a group is nearly the shape that has always been
there. It gains one field:

```proto
  // A group rather than a 1:1. Not a count: a group people have left is
  // still a group, and never becomes the pair conversation.
  bool group = 3;
```

A participant count would be the obvious way for a client to tell the two
apart, and it is wrong in both directions: a group everybody has left has
one participant, and a group two people are left in is still not the pair
conversation with that person. The server knows — it is `dm_key IS NULL` —
so it says so.

`Channel.name` stays empty for every DM; the title is the client's to
render, which is where it has to be anyway once "the people in it" is the
name.

`ListDirectMessageCandidates` is the one addition that is not about
groups as such. Starting a 1:1 today begins from somebody's face — a
message, a member list, a profile card — and there is always a person in
front of you to click. Starting a group begins from nobody, so there has
to be a list to pick from, and the client cannot assemble one: it would
need the member list of every space the caller is in. The query is one
self-join on `space_members` with the block filter, capped, and it
resolves through `resolveAuthors` like everything else.

Errors: `PermissionDenied` for somebody you do not share a space with and
for a blocked pair (the wording a block already uses, which does not say
which side blocked whom); `NotFound` for an unknown user or a
conversation the caller is not in; `FailedPrecondition` at the cap;
`InvalidArgument` for fewer than two others, for leaving a 1:1, and for
naming yourself.

## Realtime

One new event, number 33 in the `ServerEvent` oneof:

```proto
// DirectMessageMembersChanged carries a group conversation's new
// participant list to everyone still in it. The list, not a delta: it is
// at most ten names, the clients that care are exactly the people in it,
// and a delta would make every client keep an ordered list correct.
message DirectMessageMembersChanged {
  string channel_id = 1;
  repeated stoop.chat.v1.MessageAuthor participants = 2;
}
```

It carries no `Channel`, so there is no chance of leaking one caller's
`muted`, `unread_count` or `last_read_message_id` into a broadcast — the
hazard `Channel`'s own comment warns about. Clients patch `participants`
on their `["dms"]` row and leave their unread state alone.

Two events already do the rest:

- **Somebody added** gets `ChannelCreated` on their own user topic, which
  the web client already handles for a DM opened with it ("A DM someone
  opened with us arrives here too"): it invalidates `["dms"]` and the
  conversation appears.
- **Somebody left** gets `ChannelDeleted` with an empty `space_id`. The
  web handler currently filters a space's channel list and drops the
  message window; it gains the `["dms"]` invalidation for the DM case,
  which is two lines beside the two that already branch on `space_id`.

## The web

The DM list and conversation are already written against "a channel with
no space and some participants". What changes is that "the other person"
becomes "the people", in four places.

### Naming and faces

`dmTitle` derives a name from the participants other than me:

| Others | Title |
| --- | --- |
| 0 | Just you (everybody else left) |
| 1 | ada |
| 2 | ada and bea |
| 3 | ada, bea and casey |
| 4+ | ada, bea and 2 others |

Display names where set, usernames otherwise, in the order the server
returns (`ORDER BY user_id`, which is stable). A group's face is the
first two participants' avatars overlapped in one `.avatar-stack`, a
small shared component beside `Avatar.tsx` — the DM list, the
conversation header and the activity feed all want the same one.
Presence dots are a 1:1 thing and stay there: a dot per face in a stack
is noise, and "who of the four is online" is a question for the
participant list, not the row.

### Starting one

A `+` button in the DM sidebar header ("New conversation"), opening a
modal on the existing `Modal` frame:

- A search field over `ListDirectMessageCandidates`, filtering on display
  name and username.
- Rows with a checkbox, avatar and name; picked people become chips above
  the field, removable, with the count against the cap.
- One person picked → **Message**, which calls `OpenDirectMessage` and so
  lands in the existing conversation if there is one. Two or more →
  **Start conversation**, which calls `CreateGroupDirectMessage`.

The same modal, opened from a conversation's own menu with its
participants pre-excluded, is the Add people flow; its button says **Add
to conversation**, and for a 1:1 it carries the sentence that says what
is about to happen: "This starts a new conversation with the three of
you. ada won't see anything already said here."

### The conversation

`DMTitle` renders the stack, the derived name, and for a group a
participant count that opens a small popover listing everyone, each with
the profile card the member list already uses. The conversation's `⋯`
menu gains **Add people** and, for a group, **Leave conversation** —
which confirms through `stores/dialogs.ts`, because the conversation will
not be findable again unless somebody adds them back.

`usePeople` needs no change at all: mentions, the typing indicator and
reaction tooltips already resolve against participants, and a group just
hands them more.

### Files

- `web/src/api/dms.ts` — `dmTitle` and a new `dmIsGroup`, `dmFaces`; the
  three new calls; the cache patch for `DirectMessageMembersChanged`.
- `web/src/components/AvatarStack.tsx` — two overlapped avatars.
- `web/src/components/NewConversation/` — `index.tsx` (the modal and its
  state), `CandidateRow.tsx`, and `candidates.ts` for the pure filter, so
  the filter can be unit-tested without a DOM.
- `web/src/routes/DirectMessages.tsx` — the `+` button, group rows, the
  group header and its menu.
- `web/src/styles/direct-messages.css` — the stack, the chips, the
  picker rows; the phone overrides in `mobile.css`.
- `web/src/api/ws.ts` — the new event and the DM case of `channelDeleted`.

On the server: `internal/chat/dms.go` grows the three RPCs and
`internal/chat/candidates.go` holds the fourth (one file per concern);
`internal/db/queries/chat/dms.sql` gains the five queries;
`proto/stoop/chat/v1/chat.proto` and `realtime.proto` the messages above.
`docs/architecture/messaging.md` → Direct messages is rewritten for
groups, and `docs/architecture/data.md` notes that `dm_key` is now
pair-only.

## Not in the first cut

- **A custom group name.** `channels.name` is already there and empty;
  the work is a `SetDirectMessageName` RPC, a rename control, and a title
  rule that prefers the name. Worth doing once groups exist and somebody
  has a group they keep coming back to; not worth guessing at now.
- **A group avatar.** Same shape as a space icon, and the same argument
  for waiting.
- **Removing somebody else.** A group has no roles and no owner, so
  "who may remove" has no answer that is not invented. Leaving is the
  symmetric power everybody has.
- **Pins in a DM.** Already deferred by the pinned-messages proposal and
  unchanged by this: the permission check becomes "is a participant",
  which groups make no harder.
- **Search across DMs.** STOOP-179. Groups are channels, so they arrive
  with it for free.
- **Group voice.** A call in a DM is a voice channel without a space, and
  that is its own design (token minting, the stage, who may start one).
- **A per-member history floor.** Ruled out above; if it is ever wanted,
  it is a `joined_at` column and an audit of every read path.

## Verification

- `internal/chat/dms_test.go` grows: a group of three is created and all
  three see it; the same three again is a second conversation; a
  participant adds a fourth who can read the history; adding to a 1:1
  forks and the pair keeps its history; a non-participant adding is
  refused; the eleventh participant is refused; a blocked pair cannot be
  put in the same group; a block made afterwards does not stop either
  from posting; leaving hides it from the leaver and keeps it for the
  rest; the last leaver deletes the channel and its messages; leaving a
  1:1 is `InvalidArgument`.
- `internal/chat/candidates_test.go`: the list is people you share a
  space with, excludes yourself and both directions of a block, and an
  instance admin gets no wider a list.
- The migration's down path is exercised by hand against a dev database
  holding a group, since that `DELETE` is the one destructive line in
  the change and the release runbook has to describe it accurately.
  `schema_floor` does not move: the new constraint accepts everything the
  old one did.
- Web unit tests for `dmTitle` across the five shapes in the table, for
  the candidate filter, and for the `DirectMessageMembersChanged` cache
  patch with the list loaded and absent.
- A browser spec, `web/e2e-pw/group-dms.spec.ts` — three sign-ins, start
  a group, everyone sees the message, add a fourth, one leaves — written
  but not run locally until the maintainer has reviewed the feature on
  the dev instance, per the project rule. CI on the remote is the
  authority.

## Decisions taken

Answered by the maintainer on 2026-09-12, before this was written.

1. **Adding to a 1:1 forks a new group with no history**, rather than
   converting the pair conversation in place.
2. **A newcomer to a group reads all of it.** No per-member history
   floor.
3. **Create, add and leave ship together.** No custom name, no owner, no
   removing somebody else.

Still open: whether a group that has shrunk to two people should ever be
folded back into the pair conversation. It should not — they are
different conversations — but the first person to end up with both will
say whether the duplicate-looking row in the list is confusing enough to
need a marker.
