Stoop 0.11.0

Stoop 0.11.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.10.0. **`stoop upgrade rollback`
cannot take it back to 0.10.x**: this release reshapes the schema, so
going back needs the backup the upgrade takes. `stoop upgrade` says so
before it starts.

**What's new.**

- **Private channels.** A channel can be made private when it is
  created, with the Private switch in New channel. Only the people
  added to it see it, read it, find it in search, download its files or
  get its notifications. To everyone else in the space it does not
  exist. It shows a lock where other channels show a hash.
- **Its people.** Whoever makes a private channel is its first person.
  The People button in its header lists who is in it. Someone who can
  manage channels adds and removes people there; anyone in it can
  leave. Being added or removed takes effect at once, with no reload.
- **Private voice channels.** A voice channel can be private too. Only
  its people see it, see who is in the call, or join. Someone removed
  from it, or who leaves it, is taken out of the call.
- **Space settings lists every channel.** The Channels tab shows who is
  in each one: "Everyone", or a count for a private channel. A space
  admin who is not in a private channel sees its name and its people
  there, and can rename, reorder or delete it, or choose "Join as
  member". They read nothing in it until they join, and its people see
  them join.
- **`@channel` replaces `@everyone`.** `@channel` notifies everyone in
  the channel and `@here` everyone in it who is online. In a private
  channel that is its people, not the space. `@everyone` no longer does
  anything, and nobody can take `everyone` or `channel` as a username.
- **A channel's name in a sentence.** Where the app writes a channel's
  name in text, a private channel has its lock in front and a public
  one reads "# general".

**What a private channel can't be.** A channel is private from creation
and stays so, and a public channel can't be made private. The channel a
space opens in can't be private, and neither can an announcement
channel. A private channel may end up with nobody in it; a space admin
can still join or delete it from Space settings.

**For operators.**

- **Private means private in the app.** Nothing in Stoop lets a server
  admin read a private channel they are not in, and its files are
  served only to its people. It is not private from the machine: like
  every message, its messages sit in Postgres in plaintext and in your
  backups. See [Privacy of direct messages and private channels](https://github.com/getstoop/stoop/blob/v0.11.0/docs/self-hosting/accounts-and-security.md#privacy-of-direct-messages-and-private-channels).
- **Reload open tabs after upgrading.** A browser tab left open from
  0.10.0 keeps the old app until it is reloaded, and the old app does
  not draw `@channel` mentions or know about private channels.
- **Old `@everyone` messages.** The people they notified keep those
  notifications. The text `@everyone` in an old message is now drawn as
  plain text.
- **Incoming webhooks.** A webhook can post into a private channel:
  make it while you are in the channel, and its bot is added to the
  channel. The switch that lets a webhook notify the channel now reads
  "May use @channel and @here", and a payload that says `@everyone`
  notifies nobody; send `@channel`.
- **Outgoing webhooks send nothing from a private channel**, as they
  already sent nothing from a direct message. A private channel can't
  be picked as an outgoing webhook's channel in the app.
- **The integrations list follows the channel.** A webhook into a
  private channel is listed only to that channel's people and to server
  admins.
- **Tokens and bots.** A token or bot reaches a private channel only if
  its account is in it. Stored grants named `messages.notify_everyone`
  are renamed by the upgrade; nothing needs re-issuing.
- **API changes for scripts.** Three names changed, with no alias:
  the permission `PERMISSION_MESSAGES_NOTIFY_EVERYONE` is
  `PERMISSION_MESSAGES_NOTIFY_ENTIRE_CHANNEL`, a message's
  `mentions_everyone` is `mentions_entire_channel` (`mentionsEntireChannel`
  in JSON), and an incoming webhook's `notify_everyone` is
  `notify_entire_channel` (`notifyEntireChannel` in JSON). New:
  `private` on `CreateChannel` and on a channel, the RPCs
  `ListAllChannels`, `ListChannelMembers`, `AddChannelMembers`,
  `RemoveChannelMember` and `LeaveChannel`, and the events
  `channel_member_joined` and `channel_member_left`.

**Schema.** Migrations 00062 to 00065 run at startup, taking the schema
from 61 to 65. 00062 adds the view `channel_readers`, 00063 the
`private` column and the `channel_members` table, and 00064 records
which private channel a file belongs to. 00065 is a contract migration:
it renames `messages.mentions_everyone` to `mentions_entire_channel`
and rewrites stored grants. The schema floor goes from 53 to 65. 0.10.x
and older refuse to start against the result, so `stoop upgrade
rollback` refuses and points at the backup it took
([Restoring in place](https://github.com/getstoop/stoop/blob/v0.11.0/docs/self-hosting/backups.md#restoring-in-place)).
Anything written after the upgrade is lost by restoring it.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.10.0.

**Known issues.**

- The count on a private channel's People button can lag behind a
  change made by someone else until the page is reloaded.
- Someone removed from a private channel while search results from it
  are on their screen keeps what is already drawn until they move to
  another page.
- Taking someone out of a private voice call depends on the voice
  server being reachable. If it is not at that moment, they can stay in
  the call until they hang up.
- Placeholders, dialog titles and screen reader labels can't carry the
  lock, so a private channel's name stands alone there.
- A link that failed to get a card stays without one for a week.
- The image preview's arrows step through the messages already loaded
  in the channel; they don't fetch older history.
- A video's still and playback in the preview were not checked in
  Safari, or with MP4 and `.mov` files.
- A mail relay with a self-signed certificate is not supported over
  STARTTLS or TLS.
- On the new space's first-run card, "Set up" beside a skipped Email
  step opens Hosting. Email is its own tab in Server admin.
- On a phone, picking a channel from the drawer while a thread is open,
  or following the thread header's link to the channel you are already
  in, leaves one extra step in the browser's history, so Back stays on
  the same page once.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.10.0:

- Docs: channel membership and private channels proposals (6554a401)
- Docs: private channels stand on their own; drop the membership proposal (95eecea7)
- Docs: private channels proposal checked against the code (05723308)
- Docs: private channels: attachments by recorded channel, and the gates (9e99715a)
- Docs: private channels ship in one release, voice included (0b2886fb)
- Docs: private channels: @channel replaces @everyone, no alias (661f2d06)
- Chat: who may read a channel is written once, as a view (09dd4601)
- Chat: a private channel is read by its people only (50789bd4)
- Files: a private channel's attachments are served to its people only (ad9d8bea)
- Chat: a private channel's events go to its people only (0a12bd1f)
- Files: the private attachment test names its fixture (24143439)
- Chat: private channels can be created and their people managed (410ddfee)
- Realtime: typing in a private channel goes to its people whatever the client sends (60eee560)
- Realtime: relayTyping names its hint (fe64782a)
- Chat: a missing channel reads like a private one, and leaving a space drops its private alerts (baa3446a)
- Files: a bounded token that reaches a private channel downloads its attachments (be4faa97)
- Realtime: an empty or unknown channel is never taken for a public one (b796c95f)
- Chat: review fixes for private channel management (6466804d)
- Web: a channel that leaves the list takes its share of the space's unread dot (3d21afae)
- Chat: every query that reads channels for a person asks channel_readers (ad613550)
- Chat: adding several people to a private channel is all or nothing (fd2eb334)
- Integrations: a failed hook leaves its bot in a channel another hook needs (6d769bf8)
- Web: a private channel shows a lock, and a reorder keeps it in place (d188ad78)
- Web: create a private channel and manage who is in it (0de80472)
- Web: focus returns from New channel, and a kick updates a private channel's people (3c6af68d)
- Chat: a private channel can't be an announcement channel (fbded79c)
- Web: the sidebar order matches the server to the nanosecond, and the settings lock is named (a9bd4988)
- Web: say what nanos is in the channel order (4bd74720)
- Web: order channels by creation time in milliseconds (5c4974ba)
- Web: Space settings lists every channel, with who is in a private one (9d3840a7)
- Web: a browser spec for private channels (a60f5833)
- Web: the private channels spec goes past the link gate (be639f35)
- Web: review fixes for private channels (097e82f2)
- Chat: @channel replaces @everyone (caf7db95)
- Regenerate after the comment edits (efdde310)
- Chat: helpers say they notify the entire channel (338d9dbb)
- Docs: the permission's real name, and who @channel reaches (4ddb68f6)
- Web: @here reads "Everyone online in this channel" (dca57931)
- Chat: the names say "entire channel" (4a129096)
- Voice: a voice channel can be private (ec5e71c2)
- Voice: deleting a public voice channel asks nothing (53b287e9)
- Web: the settings row menu says "Join as member" (74749416)
- Web: a browser spec for a private voice channel (e03ca9ba)
- Integrations: a private channel's webhook is listed only to its people (987691f1)
- Docs: private channels, and the built proposal is deleted (980e9e67)
- Web: a private channel's name in text has no hash (5d9abd84)
- Web: a lock before a private channel's name in a sentence (870766b1)
- Web: a space after the hash of a public channel's name in a sentence (72dbd56b)
- Web: the also-send spec names the checkbox as it now reads (19bffd73)
- Web: the retention spec reads the start of history as it now reads (66bb1349)
