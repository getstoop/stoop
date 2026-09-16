# Announcement channels

Status: decided 2026-09-16 (STOOP-116). Every decision below was settled
with the maintainer before the build; the renderings live in a design
page beside it.

An admin can make any text channel an announcement channel: the space's
admins and owner, and bots in the space, post there; everyone else reads,
reacts, and deletes their own messages. It keeps a channel meant for
downtime notices and release feeds from filling up with replies.

## Decisions at a glance

| | |
| --- | --- |
| Shape | A `post_policy` field on the channel (`everyone`, `admins`), not a new `ChannelKind`. An existing channel flips without moving its history, and the enum has room for another policy without another migration. |
| Who posts | Space owner, space admins, instance admins (inherited admin), and every bot in the space. |
| Bots | Any bot in the space, whatever its role. Requiring a space-admin bot would hand a release feed the power to delete channels just to post into one. An instance admin already chose to put the bot there. |
| Members | Read, react, delete their own messages. No posting, replying, attaching, or editing earlier messages — editing would be a way to keep posting. |
| Credential | The rule checks the identity only. An admin's token granting just `messages.post` still posts. |
| Scope | Text channels. DMs have no roles; a voice channel's chat is for the people in the call. |
| Name | "Announcement channel" in the UI. The proto and the docs keep `post_policy`, which names the mechanism. |
| Realtime | None new. `ChannelUpdated` already carries the whole channel. |
| Permission table | Unchanged. The rule is a fixed meaning a channel has, not a per-channel override. |

## Placement

- **Member view:** a notice takes the composer's place, the composer's
  height so the timeline doesn't jump: "#name is an announcement channel.
  Only admins post here; you can still react." A disabled composer was
  rejected — it reads as broken, and every composer control would need a
  disabled state.
- **Admin view:** the ordinary composer, placeholder "Announce in #name",
  with a muted hint line under it.
- **Sidebar and header:** a megaphone replaces the `#`, as a speaker
  already does for voice channels; its tooltip says "Announcement channel".
- **Channel ⋮ menu:** "Make announcement channel" / "Let everyone post",
  after the topic item, with no "new" marker. Turning it on asks first,
  because it stops people mid-conversation; turning it off doesn't.
- **Space settings → Channels:** an "Announcement" switch column on text
  channel rows. It saves on click with no confirm, like the rest of that
  list.
- **About this channel:** "Announcement channel · created …".
- **Not in the new-channel prompt,** which stays one field. Create, then
  flip.

## Schema

`00040_channel_post_policy.sql`, expand-only: a column with a default,
checked to its two values, so the previous release runs against it
unchanged.

## API

- `ChannelPostPolicy` enum; `Channel.post_policy = 12`.
- `UpdateChannelRequest.post_policy = 4`, under `manage_channels`.
  `UNSPECIFIED` and a voice channel are `InvalidArgument`.
- Refusal is `PermissionDenied`, "#name is an announcement channel; only
  admins can post".

## Enforcement

`requirePostPolicy` in `internal/chat/permissions.go`, over the pure
`mayPost(actor, bot, policy)`. Called from `SendMessage` (replies are
sends), `EditMessage`, and the files upload port
`ChannelSpaceToPostIn`. Not from `writableChannel`, which reactions share.
Incoming webhooks post through `SendMessage` as their bot and pass.

## Edges

- **Flipped while a member is typing:** the composer becomes the notice;
  the unsent draft is lost, since drafts aren't kept today.
- **A send already on its way:** refused, shown through the composer's
  error path.
- **An admin is demoted:** the client refetches its spaces on its own role
  change, so the notice appears.
- **The space's default channel** may be an announcement channel.
- **@everyone, search, pins, unreads, mutes:** unchanged.

## Verification

- `TestMayPost` table; service tests for send, reply, edit, react, delete,
  upload port, token-only admin, bot, and refusing the policy on a voice
  channel or a DM.
- A web unit test for `canPost`.
- A browser spec only after the maintainer has reviewed on the dev
  instance.
