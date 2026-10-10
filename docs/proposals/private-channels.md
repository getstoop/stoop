# Private channels

Status: decided 2026-10-10, not started. Nothing here is built. Where the
new controls sit in the web app is still open; see [UI](#ui).

Builds on [channel-membership.md](channel-membership.md), which lands
first: it creates `channel_members`, the join, leave, list and add calls,
and `@channel`. "What exists" below describes the code before either.

## What exists

- Reading a space channel needs space membership and nothing else. One
  query, `IsChannelMember`, answers "may this person read this channel"
  for messages, reactions, pins, threads, uploads and the voice token, and
  its twin `ChannelMembersAmong` answers it for activity recipients.
- A direct message is a channel with no space and a participants table
  (`dm_members`). Its events go to each participant's `user:` topic, so
  the gateway keeps no per-channel bookkeeping.
- Every space channel event goes to `space:<id>`, which every member's
  connection subscribes to.
- [permissions.md](../architecture/permissions.md) lists private channels
  as deliberately deferred, and says there are no per-channel overrides.

## The model

A private channel is a space channel with a people list. Reading it needs
space membership **and** a row in `channel_members`.

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
| Kinds | Text and voice. Voice may ship as a second phase. |
| Who creates one | Holders of `channels.manage` (space admins and the owner). |
| Who adds and removes people | The same. No new action in the table. |
| What a space admin sees in the sidebar | Only the private channels they are in. |
| What a space admin sees in Space settings → Channels | Every channel, private ones included, with who is in each. |
| Admins reading a channel they are not in | Not possible. They join it from Space settings → Channels first. |
| Signal that an admin joined | The member list changes; nothing is written to the timeline. The system-messages work may add a line later; nothing here depends on it. |
| Instance admins | Inherit space admin as they do today, so they can list and join. They must be a member of the space first: there is no channel membership without space membership. |
| Bots | Need a `channel_members` row to read or post, added like a person. |
| Incoming webhooks | Creating one that targets a private channel adds the hook's bot to that channel. |
| Outgoing webhooks | Receive nothing from private channels in v1. |
| `@channel` and `@here` | As in any channel: they reach the people in it. |
| `@name` of someone not in the channel | Not mentioned and not added. A public channel adds them; here only `channels.manage` adds people. |
| Joining | `JoinChannel` answers `NotFound` for a private channel. |
| History for someone added later | All of it. |

Defaults taken without being asked about, to confirm in review:

- A channel is made private when it is created and stays that way. No
  converting in either direction in v1.
- Whoever creates a private channel is its first member.
- A member may take themselves out of a private channel.
- A required channel can't be private, so a space's default channel
  can't be, and a space keeps at least one public text channel.
- A private channel may have no members. It still shows in Space
  settings → Channels, where an admin can add people or delete it.

## Schema

One additive migration, owned by chat. `channel_members` already exists.

```sql
ALTER TABLE channels ADD COLUMN private boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD CONSTRAINT channels_private_in_space
  CHECK (NOT private OR (space_id IS NOT NULL AND NOT required));
```

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
| Access check | `IsChannelMember`, `ChannelMembersAmong`: space member, or DM participant. | A private channel also needs the `channel_members` row. Covers messages, edits, reactions, pins, threads, uploads, the voice token and activity recipients. |
| Refusal | "not a member of this channel's space" | A space member outside a private channel gets `NotFound`, as for a hidden voice channel, so the answer does not confirm the channel exists. |
| Channel list | `ListChannelsBySpace`, `CountChannelsInSpace` return every channel. | Filter to public channels plus the caller's private ones. |
| Search | `SearchMessages` scans every channel in the space; `GetChannelInSpaceByName` resolves `in:#name` against all of them. | Both take the same filter. |
| Realtime: messages | `publishTo` publishes to `space:<id>`. | For a private channel, publish to each member's `user:` topic, as for a DM. Covers message, reaction, pin and typing events. |
| Realtime: channel events | `channel_created`, `channel_updated`, `channel_deleted` go to the space. | Members only. Being added arrives as `channel_created` on the person's own topic and being removed as `channel_deleted`, which is how a DM already appears and how the client already drops a channel. |
| Realtime: reorder | `channels_reordered` carries every channel in the space. | Private channels are left out of the space broadcast; each member of one is sent their own list. |
| Typing | The gateway relays to the space if the connection is subscribed to it. | For a private channel the gateway asks chat who may see it, as it does for a DM through `ChannelLookup.DMParticipants`. |
| Mentions | Named handles resolve against the space, and someone not in the channel is added to it. | In a private channel named handles resolve against the channel's people, and nobody is added. |
| Realtime: membership | `channel_member_joined` and `channel_member_left` go to the space. | Members only. |
| Attachments | `mayDownload` asks `MayReadSpace` for any file with a space id. | Ask by channel. `IsAttachmentReadable` already does this for a DM's files. |
| Activity | Items keep a preview of the message text. | Removing someone from a private channel deletes their activity items for it, as a block already does. |
| Outgoing webhooks | The subscriber listens on `space:<id>`. | Nothing to do: private events no longer reach that topic. A test pins it so it stays true on purpose. |

Credential bounds are unchanged and compose with membership: a token
bounded to a channel still needs its owner to be in that channel.

## API

`Channel` gains `bool private`. `CreateChannelRequest` gains the same.

| RPC | Needs | Notes |
| --- | --- | --- |
| `ListChannels` | membership | Filtered as above. Unchanged shape. |
| `ListAllChannels` | `channels.manage` | Every channel in the space, with a member count and whether the caller is in it. For Space settings → Channels. Listing is not membership and subscribes the caller to nothing, like `ListAllSpaces`. |
| `ListChannelMembers` | a member of the channel, or `channels.manage` | Exists; any space member may call it for a public channel. |
| `AddChannelMembers` | `channels.manage` | Exists. Naming yourself is how an admin joins. |
| `RemoveChannelMember` | `channels.manage` | New. Clears the person's activity items for the channel and takes them out of its voice room. `LeaveChannel` does the same when the channel is private. |

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
  so it reads as private at a glance.
- **Creating a channel.** A private switch, and picking the first members.
- **Space settings → Channels.** Which channels are private, how many
  people are in each, a Join action on the ones the admin is not in, and
  the way into a channel's members.
- **A channel's members.** List, add, remove; where a member sees who else
  is in the channel.
- **Integrations.** The channel picker for an incoming webhook shows
  private channels and says the bot will be added.

## Phases

1. **Server boundary, text.** Schema and floor, the access queries, the
   list and search filters, realtime fan-out, mentions, attachments, the
   typing lookup, the new RPCs.
2. **Web.** Everything under [UI](#ui).
3. **Voice.** The four changes above. It can ride with phase 1 or follow
   as its own pull request; private voice channels can't be created until
   it lands.

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
