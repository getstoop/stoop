# Private channels

Status: decided 2026-10-10, checked against the code and updated
2026-10-13, not started. Nothing here is built. Where the new controls sit
in the web app is still open; see [UI](#ui).

## What exists

- Reading a space channel needs space membership and nothing else. The
  rule "a member of the channel's space, or a participant in the DM" is
  written out in five queries: `IsChannelMember` (messages, reactions,
  pins, threads, uploads, the voice token), `ChannelMembersAmong`
  (activity recipients), `ThreadParticipants` (thread reply activity),
  `ListThreadMutes` (Profile → Muted) and `IsAttachmentReadable` (a DM's
  files).
- Pinning, deleting someone else's message and deleting a thread load the
  channel from the message id and check only the space permission.
- A direct message is a channel with no space and a participants table
  (`dm_members`). Its events go to each participant's `user:` topic, so
  the gateway keeps no per-channel bookkeeping.
- Every space channel event goes to `space:<id>`, which every member's
  connection subscribes to.
- [permissions.md](../architecture/permissions.md) lists private channels
  as deliberately deferred, and says there are no per-channel overrides.

## The model

A private channel is a space channel with a people list. Reading it needs
space membership **and** a row in `channel_members`. A public channel has
no list: everyone in the space is in it, as today.

It is a list of people, not a rule about roles, so the fixed permission
table does not change and there is still no per-channel override. Like an
announcement channel, it is a fixed meaning a channel either has or
doesn't.

It is an application boundary, as DMs are: messages sit in Postgres in
plaintext, readable by whoever holds the database.
`docs/self-hosting/accounts-and-security.md` says so for DMs and will say
so for private channels.

## Decisions

| Question | Answer |
| --- | --- |
| Kinds | Text and voice. Voice follows the first release. |
| Who creates one | Holders of `channels.manage` (space admins and the owner). |
| Who adds and removes people | The same. No new action in the table. |
| What a space admin sees in the sidebar | Only the private channels they are in. |
| What a space admin sees in Space settings → Channels | Every channel, private ones included, with who is in each. |
| Admins reading a channel they are not in | Not possible. They join it from Space settings → Channels first. |
| Admins pinning, deleting a message or deleting a thread in a channel they are not in | Not possible either. Rename, topic, delete and reorder of the channel itself work from settings without joining. |
| Signal that an admin joined | The member list changes; nothing is written to the timeline. The system-messages work may add a line later; nothing here depends on it. |
| Instance admins | Inherit space admin as they do today, so they can list and join. They must be a member of the space first: there is no channel membership without space membership. |
| Bots | Need a `channel_members` row to read or post, added like a person. |
| Incoming webhooks | Creating one that targets a private channel adds the hook's bot to that channel. |
| Outgoing webhooks | Receive nothing from private channels in v1. |
| `@everyone` and `@here` | They reach the people in the channel, not the space. |
| `@name` of someone not in the channel | Not mentioned and not added. Only `channels.manage` adds people. |
| History for someone added later | All of it. |

Also decided:

- A channel is made private when it is created and stays that way. No
  converting in either direction in v1.
- Whoever creates a private channel is its first member.
- A member may take themselves out of a private channel.
- A space's default channel can't be private. `UpdateSpace` refuses one.
- A private channel may have no members. It still shows in Space
  settings → Channels, where an admin can add people or delete it.

## Schema

One additive migration, owned by chat.

```sql
ALTER TABLE channels ADD COLUMN private boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD CONSTRAINT channels_private_in_space
  CHECK (NOT private OR space_id IS NOT NULL);

CREATE TABLE channel_members (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  space_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (space_id, user_id)
    REFERENCES space_members(space_id, user_id) ON DELETE CASCADE
);
```

Only private channels have rows. Leaving or being removed from the space
takes the person out of its private channels through the foreign key.

### The rollback trap

The migration only adds, so by the expand/contract rules the previous
binary would start against it. It would also treat every private channel
as public. **This migration raises `schema_floor` and `db.Floor`** to
itself, even though it drops nothing, so an older binary refuses to start
instead of opening private channels to the space. The release notes say
that rolling back past it needs the backup.

## The boundary

Everything in this section ships in one release. Any one of them missing
is a leak.

| Surface | Today | Change |
| --- | --- | --- |
| Access check | The rule is copied into five queries (see [What exists](#what-exists)). | One SQL definition that all five use, and a private channel also needs the `channel_members` row. A post already runs this one query; a public channel pays nothing more. Covers messages, edits, reactions, pins, threads, uploads, the voice token, activity recipients, thread reply activity and the muted threads list. |
| Moderation | `SetMessagePinned`, a moderator's `DeleteMessage` and `DeleteThread` check `channels.manage` or `messages.moderate` in the space. | They also need the access check, so they work only for someone in the channel. |
| Refusal | "not a member of this channel's space" | A space member outside a private channel gets `NotFound`, as for a hidden voice channel, so the answer does not confirm the channel exists. |
| Channel list | `ListChannelsBySpace`, `CountChannelsInSpace` return every channel. | Filter to public channels plus the caller's private ones. |
| Search | `SearchMessages` scans every channel in the space; `GetChannelInSpaceByName` resolves `in:#name` against all of them. | Both take the same filter. |
| Realtime: messages | `publishTo` publishes to `space:<id>`. | For a private channel, publish to each member's `user:` topic, as for a DM. Covers message, reaction, pin and typing events. |
| Realtime: channel events | `channel_created`, `channel_updated`, `channel_deleted` go to the space. | Members only. Being added arrives as `channel_created` on the person's own topic and being removed as `channel_deleted`, which is how a DM already appears and how the client already drops a channel. |
| Realtime: reorder | `channels_reordered` carries every channel in the space, and the client sorts by the order of that list, putting a channel missing from it first. | The space broadcast carries public channels only and the client applies each one's `position`. A private channel's new position goes to its members as `channel_updated`. `ReorderChannels` is called from settings with every channel in the space. |
| Typing | The gateway relays to the space if the connection is subscribed to it. | For a private channel the gateway asks chat who may see it, as it does for a DM through `ChannelLookup.DMParticipants`. |
| Mentions | `@everyone`, `@here` and named handles resolve against the space. | In a private channel all three resolve against the channel's people. |
| Realtime: membership | None. | `channel_member_joined` and `channel_member_left`, to the channel's members. |
| Attachments | `mayDownload` asks `MayReadSpace` for any file with a space id, which an instance admin outside the space also passes. A file row has a space and no channel, and `claimAttachments` lets a file uploaded for one channel be attached in another of the same space. | An upload to a private channel records the channel on the file row. A download of such a file needs channel membership, with no admin bypass; its uploader can always read it. A public channel's files record nothing and are served as today. Sending refuses an attachment whose recorded channel is not the message's channel. |
| Activity | Items keep a preview of the message text. | Removing someone from a private channel deletes their activity items for it, as a block already does. |
| Outgoing webhooks | The subscriber listens on `space:<id>`. | Nothing to do: private events no longer reach that topic. A test pins it so it stays true on purpose. |

A public channel's events go to the space topic as today, with no
membership lookup: the channel row in hand says whether it is private.
A private channel's are fanned out per member, with no `channel:` topic, so the
gateway keeps no per-channel subscriptions and a removal can't leave one
behind. From the jobs runner each publish is one notification to the
server, so a link preview arriving in a private channel costs one per
member.

Credential bounds are unchanged and compose with membership: a token
bounded to a channel still needs its owner to be in that channel.

## API

`Channel` gains `bool private`. `CreateChannelRequest` gains the same.

| RPC | Needs | Notes |
| --- | --- | --- |
| `ListChannels` | membership | Filtered as above. Unchanged shape. |
| `ListAllChannels` | `channels.manage` | Every channel in the space, with a member count and whether the caller is in it. For Space settings → Channels. Listing is not membership and subscribes the caller to nothing, like `ListAllSpaces`. |
| `ListChannelMembers` | a member of the channel, or `channels.manage` | New. Private channels only. |
| `AddChannelMembers` | `channels.manage` | New. Naming yourself is how an admin joins. |
| `RemoveChannelMember` | `channels.manage` | New. Clears the person's activity items for the channel and takes them out of its voice room. |
| `LeaveChannel` | a member of the channel | New. The same as being removed, for yourself. |

Rename, topic, delete and reorder stay on `channels.manage` and work from
settings on a channel the admin has not joined.

## Voice

The media is already behind the boundary: `JoinVoiceChannel` mints the
LiveKit token only after `IsChannelMember`.

The roster is not. The gateway tracks who is in which voice channel per
space and broadcasts it to the space. For a private voice channel:

- `publishVoice` sends to the channel's members, not the space.
- The snapshots in `Ready` and after `SpaceJoined` leave out private rooms
  the connection's person is not in.
- `handleVoiceState` accepts a report only from someone who may see the
  channel; today being subscribed to the space is enough.
- Removal from the channel disconnects the person from its LiveKit room
  and clears their gateway entry, reusing what a space kick does.

All four use the lookup typing needs. The gateway asks chat each time and
keeps no cache of who may see a channel: voice events are rare, and a
stale answer here is a privacy bug.

## UI

Placement is undecided and is being worked out as a design. What it has
to cover:

- **Sidebar.** A mark on a private channel in place of `#` or the speaker,
  so it reads as private at a glance. The same mark in the Muted channels
  panel.
- **Creating a channel.** A private switch, and picking the first members.
- **Space settings → Channels.** Which channels are private, how many
  people are in each, a Join action on the ones the admin is not in, and
  the way into a channel's members.
- **A channel's members.** List, add, remove; where a member sees who else
  is in the channel. The sidebar's members list shows the space's members
  today.
- **Integrations.** The channel picker for an incoming webhook shows
  private channels and says the bot will be added.

## Phases

Tracked as STOOP-485. Pull requests 2 to 5 ship in the same release.

0. **Design.** Mock-ups of everything under [UI](#ui), approved before
   anything is built.
1. **One definition of the access rule.** The five queries share one SQL
   definition, and `publishChannel` gets one place that decides who an
   event goes to. No behaviour changes.
2. **Schema and read boundary.** The migration and floor, the access rule,
   `NotFound` for outsiders, the list and search filters, moderation,
   activity clean-up, mentions. Nothing can create a private channel yet;
   tests insert the rows.
3. **Attachments.** The channel on the file row, the download check, the
   attach rule.
4. **Realtime.** Per-member fan-out for message, channel and reorder
   events, and the gateway's lookup for typing.
5. **The RPCs.** `private` on create, `ListAllChannels`, add, remove,
   leave, the incoming webhook's bot. With it, a test in which a member
   of the space who is not in the channel calls every chat RPC, the
   download route and holds a socket, and sees nothing of the channel.
   A walk-through on a scratch instance is reviewed before the web work.
6. **Web.** Built to the approved design, reviewed on the dev instance
   before its browser specs are written.
7. **Voice.** The four changes above. `CreateChannel` refuses a private
   voice channel until it lands.

## Not in v1

- Converting a channel between public and private.
- Members creating private channels or adding people.
- Outgoing webhooks for private channels. The likely shape is a hook
  explicitly filtered to that channel.
- A line in the timeline when someone joins, which belongs to the
  system-messages work.

## Docs to change when it lands

- `architecture/permissions.md`: take private channels out of
  "Deliberately deferred"; say that membership of a channel is not a
  per-channel permission override.
- `architecture/data.md`: `channels.private`, `channel_members`, the floor.
- `architecture/realtime.md`: which topic a private channel's events take,
  and the gateway's lookup for typing and voice.
- `architecture/messaging.md`, `files.md`, `voice.md`, `integrations.md`:
  the rows of the boundary table that are theirs.
- `self-hosting/accounts-and-security.md` and
  `webhooks-and-diagnostics.md`: what private means to an operator, and
  that outgoing hooks do not carry it.
