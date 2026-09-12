# Group DMs

Status: proposed 2026-09-12 (STOOP-220), revised the same day after a
design conversation that removed most of the first draft. The decisions,
and how they moved, are at the end.

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
channel.

## The whole design in one sentence

**A conversation is its people.**

`dm_key` — every participant's id, sorted and joined — already identifies
a 1:1. Let it identify a conversation of any size and the rest follows:
opening one is idempotent for two people or ten, there is only ever one
conversation with a given set, and membership is fixed at creation,
because a key that could change would stop being an identity.

## Decisions at a glance

| | |
| --- | --- |
| Storage | **No migration.** `dm_key` already exists with a `UNIQUE` constraint; it just holds more ids. |
| Identity | The participant set. One conversation per set, forever; a subset is a different conversation. |
| API | One idempotent `OpenDirectMessage(user_ids)`. No create-versus-open, no add, no leave. |
| Cap | 10 participants, the caller included. |
| Who may open one | People you share a space with, or anyone if you are an instance admin — checked between the caller and each person named. |
| Membership | Fixed at creation. Nobody is added, nobody leaves. |
| Safety | Blocks: cannot start, cannot write, not listed for the blocker. |
| Name | Derived from the participants. No custom name. |
| Realtime | `ChannelCreated` on each participant's topic. No new event. |

## Why membership is fixed

This is the load-bearing decision, and it is what makes everything else
small.

Adding and leaving both mutate the thing the key is made of, so either
one forces a second identity rule — "a conversation is its people, except
when it isn't". Keeping the key authoritative means the awkward questions
stop existing rather than getting answered:

- **"What can somebody added later read?"** has no subject. There is no
  later.
- **"Does adding to a 1:1 convert it or fork it?"** is not a question.
  Bringing a third person in is opening the conversation with all three,
  which is a different set and therefore a different conversation, and
  the pair's history was never anywhere near it.
- **"Who may remove whom?"** has no answer that is not invented, because
  a conversation with no roles has nobody to invent it.

It also enforces the boundary with private channels rather than relying
on discipline. A conversation whose membership cannot change is
definitionally not a durable room — persistent identity *across*
membership change is exactly what a room has and this deliberately lacks.
That is also why there is no custom name: the moment a group DM can be
named, it starts becoming a private channel with worse features. Private
channels are their own feature, already listed under "Deliberately
deferred" in [permissions.md](../architecture/permissions.md).

### What it costs

"Add Dave to this" means starting a conversation with all four and
leaving the old one behind, with no history. That is a real cost, and the
honest answer to somebody who wants it is *you wanted a private channel*.

## Leaving, and why there is none

"Leave" looks like one feature and is three, two of which already have
owners:

| What somebody means | What answers it |
| --- | --- |
| "I don't want to be notified" | **Mute** — `channel_mutes`, already built, already offered on a DM row |
| "Get this off my list" | **Close** — doesn't exist; STOOP-249 |
| "I want away from this person" | **Block** — already built |

Leaving would be a fourth mechanism doing worse versions of all three,
and it would have to break the identity rule to do it. Blocks carry the
safety story on their own, which they can because nobody can put you in a
conversation after it starts: the only way in is being named at creation
by somebody who already shares a space with you.

Closing is deliberately *not* leaving, and deliberately not in this
change. It is list grooming — a closed conversation comes back on the
next message, muted or not, and mute decides whether that arrival is
noisy. It applies to the 1:1s that shipped in STOOP-65 exactly as much as
to group conversations, so it is its own ticket: **STOOP-249**.

**The interim gap, stated plainly:** until that lands, a conversation you
would rather not be in can be muted but not dismissed. It sits in the
list, silent.

## Blocks

One rule, two people or ten: **a conversation holding somebody you
blocked cannot be started, cannot be written in, and is not listed for
you.**

- **Starting** is refused if any two participants block each other in
  either direction. `checkNoBlocks` asks once per participant against
  everyone else — at ten people, ten small queries, run only at creation
  because membership never changes.
- **Writing** is refused symmetrically: `dmBlocked` stops the blocker and
  the blocked alike. In a conversation of three that means one block
  silences two of them and the third is left with a room that went quiet.
  That collateral is accepted deliberately; the alternative is a
  group-versus-pair special case, which is the thing this design exists
  to avoid.
- **Hiding is one-sided**, and the asymmetry is the point rather than an
  oversight: the conversation leaves the *blocker's* list only. Making it
  vanish for the blocked person would tell them they had been blocked,
  which a block never does.

## Schema

None. `00017` already says what is needed:

```sql
ALTER TABLE channels ADD COLUMN dm_key text UNIQUE;
ALTER TABLE channels ADD CONSTRAINT channels_dm_shape
    CHECK ((kind = 3) = (space_id IS NULL) AND (kind = 3) = (dm_key IS NOT NULL));
```

Every DM carries a key, and that stays true when the key is three ids
instead of two. `dm_members` is already a table with
`PRIMARY KEY (channel_id, user_id)`, so it holds any number of rows and
makes a double insert a no-op, and `dm_members_user_idx` already drives
"my conversations".

Ten UUIDs joined is about 370 characters, comfortably inside a btree
index, which tops out around 2700 bytes.

The first draft of this proposal added a migration `00031` to *loosen*
that `CHECK`, because groups were going to carry no key. Deleting that
migration is how you can tell the second design is the right one.

## API

One RPC changes, one is added.

```proto
// OpenDirectMessage returns the caller's conversation with one or more
// other people, creating it if it does not exist. A conversation *is*
// its participants, so this is idempotent for any number of them and
// there is only ever one conversation with a given set.
rpc OpenDirectMessage(OpenDirectMessageRequest) returns (OpenDirectMessageResponse) {}

// ListDirectMessageCandidates is everyone the caller may start a
// conversation with: the people they share a space with, minus blocks in
// either direction. Instance admins get the same list, not every account.
rpc ListDirectMessageCandidates(ListDirectMessageCandidatesRequest) returns (ListDirectMessageCandidatesResponse) {}
```

```proto
message OpenDirectMessageRequest {
  // Was `string user_id`, before a conversation could hold more than two.
  reserved 1;
  reserved "user_id";
  // Everyone else in the conversation, without the caller: 1 to 9 of them.
  repeated string user_ids = 2;
}
```

Field 1 is reserved rather than reused: `user_id` is on `main` and
shipped in v0.1.0, so it is public contract
([contracts.md](../architecture/contracts.md) → "Never renumber or reuse a
field"). `DirectMessage` needs nothing new — it already carries
`repeated MessageAuthor participants`, and because that list never
changes, counting it is a reliable way to tell a pair from a group.

`ListDirectMessageCandidates` is the one genuine addition, and it is not
really about groups. Starting a 1:1 begins from somebody's face — a
message, a member list, a profile card — and there is always a person in
front of you to click. Starting a group begins from nobody, so there has
to be a list to pick from, and the client cannot assemble one: it would
need the member list of every space the caller is in.

Errors: `PermissionDenied` for somebody you do not share a space with and
for a blocked pair (the wording a block already uses, which does not say
which side blocked whom); `NotFound` for an unknown id;
`FailedPrecondition` at the cap; `InvalidArgument` for an empty list or
for naming yourself.

## The cap

Ten participants, the caller included, as a constant in `internal/chat`
rather than a setting — an instance-wide knob for this is a question
every operator has to answer and nobody has an opinion about. Past ten
the thing being asked for is a space.

**It is not the anti-spam mechanism and should not be mistaken for one.**
A cap bounds one conversation, not how many you create: nothing in it
stops fifty conversations of ten. What bounds that is the eligibility
rule — you can only reach people you share a space with, which on a
homelab instance is the friend group — and, if an instance ever needs it,
a rate limit on creation, which `internal/ratelimit` already has the
shape for.

## The web

The DM list and conversation are already written against "a channel with
no space and some participants". What changes is that "the other person"
becomes "the people", in three places.

`dmTitle` derives a name from the participants other than me:

| Others | Title |
| --- | --- |
| 1 | ada |
| 2 | ada and bea |
| 3 | ada, bea and casey |
| 4+ | ada, bea and 2 others |

Display names where set, usernames otherwise, in the order the server
returns (`ORDER BY user_id`, which is stable). A group's face is the
first two participants' avatars overlapped in an `AvatarStack`. Presence
dots stay a 1:1 thing: a dot per face in a stack is noise, and "who of
the four is online" is a question for the header.

Starting one is a `+` in the DM sidebar header, opening a picker on the
existing `Modal` frame — a search field over the candidates, rows with
checkboxes, picked people as removable chips. One person picked reads
**Message**, two or more **Start conversation**; both are the same call.
Picking a set that already has a conversation simply opens it.

There is no Add people control and no Leave control, because there is
nothing for them to do.

### Files

- `web/src/api/dms.ts` — `dmTitle`, `dmIsGroup`, `dmFaces`, and
  `openDirectMessage` taking a list.
- `web/src/components/AvatarStack.tsx` — two overlapped avatars.
- `web/src/components/NewConversation/` — `index.tsx` (the modal and its
  state), `CandidateRow.tsx`, and `candidates.ts` for the pure filter, so
  it can be unit-tested without a DOM.
- `web/src/routes/DirectMessages/` — the route became a directory
  (`index.tsx`, `DMRow.tsx`, `DMIndex.tsx`, `DMTitle.tsx`) per
  `docs/conventions.md`.
- `web/src/styles/direct-messages.css` — the stack, the chips, the picker.

On the server: `internal/chat/dms.go` grows `dmTargets` and
`checkNoBlocks`, and its key function takes a slice;
`internal/chat/dm_candidates.go` holds the picker's query.
`docs/architecture/messaging.md` → Direct messages is rewritten, and
`data.md` gains a sentence saying the key holds every participant.

## Not in the first cut

- **Closing a conversation.** STOOP-249, and it covers 1:1s too.
- **A custom group name.** Deliberately not, per "Why membership is
  fixed" — it is the drift point toward being a worse private channel.
- **A group avatar.** Same argument.
- **Pins in a DM.** Already deferred by the pinned-messages proposal and
  unchanged by this: the permission check becomes "is a participant".
- **Search across DMs.** STOOP-179. Groups are channels, so they arrive
  with it for free.
- **Group voice.** A call in a DM is a voice channel without a space, and
  that is its own design.

## Verification

- `internal/chat/dm_groups_test.go`: a conversation of three, and all
  three are told about it; the same three in any order and from any of
  them is the same conversation; a repeated id is the same conversation;
  a subset is a different one; an outsider is refused; the eleventh
  participant is refused; a blocked pair cannot be put together, in
  either direction; a block afterwards stops both writing, drops it from
  the blocker's list, and keeps it in the blocked person's and a
  bystander's.
- Candidates: the list is people you share a space with, minus both
  directions of a block; an instance admin gets no wider a list.
- Web unit tests for `dmTitle` across the shapes in the table, `dmFaces`,
  and the candidate filter.
- A browser spec, `web/e2e-pw/group-dms.spec.ts` — start one from the
  picker, everybody sees it, the same people open the same conversation,
  a subset opens a different one, and there is no add or leave control —
  written but not run locally until the maintainer has reviewed the
  feature on the dev instance, per the project rule. CI on the remote is
  the authority.

## Decisions taken

Answered by the maintainer on 2026-09-12, in two rounds. The second round
is why this document says "revised".

1. **A conversation is its people.** Identity is the participant set, for
   pairs and groups alike.
2. **Nobody can be added.** Bringing somebody in is opening a
   conversation with the larger set, which is a different conversation.
3. **Nobody can leave.** It was three features wearing one name; mute and
   block already own two of them, and closing (STOOP-249) owns the third.
4. **Blocks are the safety mechanism**, symmetric on writing.
5. **A hard cap**, because "DM ninety people" should not be expressible.

The first draft had groups keyed by nothing, an `AddDirectMessageMembers`
RPC that forked when handed a 1:1, a `LeaveDirectMessage`, a
`DirectMessageMembersChanged` realtime event, a `DirectMessage.group`
flag, and a migration. All six are gone. The questions that removed them
were, in order: *why is the server doing the forking rather than the
client?*, *is a group DM just a private channel?*, and *why is leaving a
thing at all?*
