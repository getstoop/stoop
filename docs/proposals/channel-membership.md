# Channel membership

Status: decided 2026-10-10, not started. Nothing here is built. Where the
new controls sit in the web app is a separate design; see [Web](#web).

## What exists

- Every space member is in every channel of the space. There is no
  channel-level list of people: `IsChannelMember` means "member of the
  channel's space".
- `ListChannelsBySpace` returns every channel with the caller's unread
  count, and `ListSpacesByUser.has_unread` looks at every channel.
- `@everyone` and `@here` resolve against the space's members
  (`resolveMentions`), and need `messages.notify_everyone`.
- Every space channel event goes to `space:<id>`.

## The model

A text channel has a list of people in it. Being in a channel is a
subscription: it decides whether the channel is in your sidebar, whether
it can be unread, and whether `@channel` reaches you.

It is not a boundary. Any space member can still open, page, search and
link into any channel of the space. What a person outside a channel can't
do is write in it.

A channel can be **required**: everyone in the space is in it and nobody
can leave.

Voice channels have no membership. Every space member counts as in them,
as today. Direct messages keep `dm_members`.

## Decisions

| Question | Answer |
| --- | --- |
| What joining controls | Sidebar, unreads, notifications. Not reading, not search. |
| Who may join | Any space member, any text channel. |
| Who may leave | Anyone, unless the channel is required. |
| Required channels | Set by holders of `channels.manage` on a text or announcement channel. Everyone in the space is in it; new members are added when they join the space. |
| A space's default channel | Every space has one, and it is required. "First channel" is no longer a choice. |
| Writing without joining | Refused: send, edit, react, reply, upload. The composer is a Join control. Deleting your own message still works. |
| `@everyone` | Removed. Plain text from this release on. No alias. |
| `@channel` | Reaches everyone in the channel. Needs `messages.notify_everyone`, as `@everyone` did. |
| `@here` | Reaches the people in the channel who are online. Same permission. |
| `@name` of someone in the space but not the channel | Joins them to the channel and notifies them. |
| Leaving | Removes the person's mute on the channel and stops its thread-reply items. |
| Joining | Sets the person's read marker to the newest message. |
| A new channel | The creator is in it. They may add people, or make it required. No minimum. |
| Seeing who is in a channel | Any space member. |
| Adding other people | Holders of `channels.manage`, or anyone by mentioning them. |
| Bots and incoming webhooks | In a channel like anyone else before they post. Creating a hook adds its bot to the target channel. |
| `ListChannels` for a bot or a token | Every channel, as for a person. |
| Realtime | Channel events stay on `space:<id>`. Clients ignore what they haven't joined. |
| Upgrade | Every member is put in every text channel. A space with no default channel gets its first text channel as one. Each default channel becomes required. |

Defaults taken without being asked about, to confirm in review:

- A quote-reply to someone who has left the channel raises nothing for
  them. A mention is how to bring someone back.
- A person joined by a mention has their read marker set to the message
  before it, so the channel arrives unread with its badge.
- Someone who blocked the author is not joined by the author's mention.
- An edit never joins anyone: mentions are not re-resolved on edit today.
- A credential needs `messages.post` to join or leave a channel.
- Turning required off leaves everyone in the channel, free to leave.
- Pinning, renaming, reordering and deleting stay on `channels.manage`
  and work on a channel the admin has not joined.
- The default channel can't be deleted; an admin chooses another
  default first. This replaces clearing the default when its channel is
  deleted.
- A member in no channels can't happen while the default is required, so
  the sidebar needs no empty state.

## Schema

One additive migration, owned by chat.

```sql
ALTER TABLE channels ADD COLUMN required boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD CONSTRAINT channels_required_is_space_text
  CHECK (NOT required OR (space_id IS NOT NULL AND kind = 1));

CREATE TABLE channel_members (
  channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  space_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  added_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (space_id, user_id)
    REFERENCES space_members (space_id, user_id) ON DELETE CASCADE
);
CREATE INDEX channel_members_user_idx ON channel_members (user_id, space_id);

ALTER TABLE messages ADD COLUMN mentions_channel boolean NOT NULL DEFAULT false;

INSERT INTO channel_members (channel_id, space_id, user_id)
SELECT c.id, c.space_id, m.user_id
FROM channels c JOIN space_members m ON m.space_id = c.space_id
WHERE c.kind = 1;

UPDATE spaces s SET default_channel_id = (
  SELECT f.id FROM channels f
  WHERE f.space_id = s.id AND f.kind = 1
  ORDER BY f.position, f.created_at LIMIT 1)
WHERE s.default_channel_id IS NULL;

UPDATE channels SET required = true
WHERE id IN (SELECT default_channel_id FROM spaces);
```

`spaces.default_channel_id` stays nullable in the schema, because a space
is created before its first channel; `CreateSpace` sets it in the same
transaction.

A required channel holds a row for every space member, so "in the
channel" is one question everywhere: the row exists.

The foreign key onto `space_members` is the cleanup: a kick, a ban, a
leave or a deleted account drops the person's channel rows with their
membership.

`messages.mentions_channel` goes in the `message_with_reply` view.
`mentions_everyone` stays, read for old messages and never written.

No floor: an older binary ignores the table and behaves as it did.

## Server

| Surface | Today | Change |
| --- | --- | --- |
| Reading | `accessChannel`: space member. | None. |
| Writing | `writableChannel`: `accessChannel`, plus the block rule in a DM. | A space text channel also needs the caller's `channel_members` row, else `FailedPrecondition`. Covers send, edit and react. |
| Uploads | `ChannelSpaceToPostIn`. | The same row. |
| Space membership | `CreateSpaceMember` is called in six places (`AddMember`, two in invites, `CreateSpace`, bots, the ownership hand-over). | One helper beside it adds the person to the space's required channels. All six call it. |
| Channel list | `ListChannelsBySpace` counts unread for every channel. | Returns `joined` and a member count; counts unread only where joined. |
| Space unread | `ListSpacesByUser.has_unread` looks at every channel. | Only channels the person is in, and voice channels. |
| Mentions | `resolveMentions`: `@everyone` and `@here` against the space. | `@channel` and `@here` against the channel's people. `@everyone` is no longer a keyword. Named handles still resolve against the space. |
| Mention join | — | In the send's transaction: named people not in the channel, less anyone who blocked the author, get a row (`added_by` the author) and a read marker at the channel's previous newest message. |
| Activity | `notify` drops recipients who are no longer in the space (`ChannelMembersAmong`). | In a space text channel it drops recipients who are not in the channel. This is what stops reply and thread-reply items for someone who left. Mentions pass because the join comes first. |
| Leaving | — | Deletes the row and the person's `channel_mutes` row. Unread activity items stay. |
| Default channel | `UpdateSpace` accepts any text channel, or none. Deleting the default channel clears it (`ClearSpaceDefaultChannel`). The web app falls back to the first channel. | Always set. Choosing one marks it required; it can't be cleared, and required can't be turned off on it. `CreateSpace` sets it. `DeleteChannel` refuses the default channel, and the clearing query and the web fallback go. |
| Incoming webhooks | `CreateIncoming`, `UpdateIncoming`. | Add the hook's bot to the target channel. |
| Search, history, pins, files, typing, voice, outgoing webhooks, the gateway | | None. |

`Message.mentions_channel` is new. `mentions_everyone` stays on the proto
for messages already sent.

## API

`Channel` gains `joined`, `required` and `member_count`. `joined` is the
caller's own and is never set on broadcast events, like `muted`.

| RPC | Needs | Notes |
| --- | --- | --- |
| `JoinChannel` | space member | Text channels. Sets the read marker to the newest message. |
| `LeaveChannel` | in the channel | Refused on a required channel. |
| `ListChannelMembers` | space member | |
| `AddChannelMembers` | `channels.manage` | People and bots already in the space. |
| `CreateChannel` | `channels.manage` | Gains `required` and `member_ids`. The creator is always added. |
| `UpdateChannel` | `channels.manage` | Gains `required`. Turning it on adds everyone in the space. |

## Events

Both go to `space:<id>`, so a person's other devices and everyone looking
at the channel's member list hear the same event.

| Event | Sent when |
| --- | --- |
| `channel_member_joined` (channel, user) | A join, an add, a mention join, a new space member landing in a required channel. |
| `channel_member_left` (channel, user) | A leave. Leaving the space is still `member_removed`. |

Turning required on is one `channel_updated`; clients refetch the
channel.

## Web

Placement of the new controls is its own design. What the client has to
change whatever that decides:

- The `channels` query holds every channel with `joined`. The sidebar
  shows joined ones. `messageCreated` in `api/ws.ts` bumps unread and
  lights the space only for a joined channel; a channel missing from a
  loaded list is no longer a reason to refetch.
- The two member events patch `joined` and the member count.
- A channel the person has not joined: Join in place of the composer, no
  react, reply or edit actions, live messages as usual.
- `api/mentions.ts` and the mention picker: `@channel` in, `@everyone`
  out. Old messages with `mentions_everyone` keep their highlight.
- The hook form's "may notify everyone" wording.

## Phases

1. **Membership.** Schema and backfill, the required-channel helper, the
   four membership RPCs, the events, the new `Channel` fields.
2. **What membership means.** The write check, unreads, the activity
   filter, leave's clean-up, the mention join, `@channel` and `@here`,
   the hook's bot.
3. **Web, the minimum.** The first four items under [Web](#web), plus
   Leave and a way to reach channels you are not in.
4. **Web, the rest.** Member list, adding people, the create-channel
   options, the required switch.

Phases 1 to 3 ship in one release: after phase 1 a new member is in the
default channel only, and until phase 3 the web app shows them the rest
with a composer that is refused.

The seed (`scripts/dev-reset.mjs`) and the browser specs assume a new
member sees every channel. Specs that post from a second account in a
channel other than the default join it first.

## Not in this

- Private channels. [private-channels.md](private-channels.md) builds on
  this table.
- An admin removing someone from a public channel.
- A line in the timeline when someone joins, which belongs to the
  system-messages work.
- Member-only delivery of public channel events.

## Docs to change when it lands

- `architecture/messaging.md`: mentions, activity, reads and unreads,
  mutes.
- `architecture/permissions.md`: what `messages.notify_everyone` covers;
  that being in a channel is not a per-channel permission.
- `architecture/data.md`: `channels.required`, `channel_members`,
  `messages.mentions_channel`.
- `architecture/realtime.md`: the two events.
- `architecture/integrations.md`: the hook's bot joins its channel.
- `architecture/web.md`: `joined` in the channel cache.
