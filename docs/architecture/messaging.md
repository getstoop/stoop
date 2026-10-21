# Messaging

Everything in this document belongs to `internal/chat` — the largest
module, and the only one whose surface is big enough that its files are
organised by entity rather than by layer (`spaces.go`, `channels.go`,
`messages.go`, `mentions.go`, `mention_tokens.go`, `activity.go`,
`reactions.go`, `invites.go`, `bans.go`, `blocks.go`, `dms.go`,
`links.go`, `permissions.go`, `markdown.go`).

## The container model

**Space → channel → message**, with one twist: a channel does not need a
space.

- A **space** is a community: a name, a description (public, shown to an
  invited stranger), a welcome (Markdown, shown to people who joined), an
  icon, members with roles, and an ordered list of channels.
- A **channel** is `kind` 1 (text), 2 (voice), or 3 (direct message), with
  a position, a topic, and a `last_message_id`. Position is one sequence
  per space, but the sidebar shows text and voice in separate groups, so
  `ReorderChannels` is written as every text channel and then every voice
  one — space settings drags them in two tables and sends both lists.
- A **message** is content, an author, a channel, and optional replies,
  attachments, reactions, mentions and links.

### Channel names

A space channel's name is an identifier, because search addresses a
channel by it (`in:#garden`). `validChannelName` in `chat/channels.go`:

- lowercase ASCII letters, digits, `-` and `_`;
- starts with a letter or a digit;
- 32 characters at most;
- unique within the space, compared case-folded.

The shape is checked in the chat module when a channel is created or
renamed; a name saved before the rule (`General`, `off topic`) stays
until someone renames the channel. Uniqueness is the index
`channels_space_name_uniq` on `(space_id, lower(name))`, and a write it
refuses is the name field's error. A rename that repeats the channel's current name writes no
name at all, so a request built from a stale read cannot put an old name
back.

A refused name comes back as `InvalidArgument` with the rule in one
line, a clash as `AlreadyExists`. The web app shows the rule beside the
field and the server's message on refusal; it does not rewrite what was
typed.

### Space names

A space's name is a community's name (`Maple Street`, `The Workshop`),
not an identifier: nothing addresses a space by it, only by id. So it is
free-form. `cleanSpaceName` in `chat/spaces.go`:

- trims the name and collapses every run of whitespace to one space, and
  saves that;
- refuses a name with no letter, number, punctuation or symbol left, which
  covers whitespace-only and zero-width names;
- refuses control characters;
- 50 characters at most.

Two spaces may share a name. A uniqueness rule would tell a member that
a space they cannot see exists, and free-form text has no good "same
name" test (case, spacing, look-alike letters). The rule is checked when
a space is created or renamed, and a name saved before it stays as it
is.

If a space ever becomes addressable by name (a URL slug, a search
filter), add a unique handle with channel-style rules; the name stays
free-form.

The chat module tells a space channel and a DM apart in exactly **two
places**, and nowhere else:

- **`accessChannel`** loads a channel the caller may read — a member of its
  space, or a participant in the DM. Every message RPC starts there, so
  there is one authorisation check for reading, not one per operation.
- **`publishChannel`** delivers an event to whoever can see the channel:
  the space's `space:<id>` topic for a public channel, or the `user:<id>`
  topic of each person in a DM or a private channel. A private channel's
  events never reach the space's topic, so outgoing webhooks, which listen
  there, carry none of them.

Everything else that hangs off `channel_id` — messages, read markers,
reactions, replies, attachments, link previews, history windows — works on
a DM unchanged, because it never asks which kind it has.

## Sending a message

`SendMessage` is the busiest path in the codebase, and its ordering is
deliberate:

1. **Validate.** Line endings become `\n` first (`\r\n` and a lone `\r`
   alike), so stored content splits into lines the same way in every
   reader. Content is 1–4000 characters, *or* empty with at least one
   attachment. Whitespace alone counts as empty, and a NUL character is
   refused (Postgres text can't hold one). An edit needs text, by the
   same rules.
2. **Authorise** via `writableChannel` — channel membership, plus the block
   rule in a DM — then `requirePostPolicy` for an
   [announcement channel](#announcement-channels).
3. **Claim attachments** — check each id through the `FileDirectory` port
   for kind, owner and space ([files.md](files.md)).
4. **Check mentions**: keep the [tokens](#mentions) that name the
   channel's people or a group of its space.
5. **Resolve the reply parent**, which must be a message in the same
   channel, and the authors the event will carry.
6. **One transaction**: insert the message, its `message_attachments`,
   `message_links` and mention rows, bump `channels.last_message_id`, and
   mark the channel read for the author. A failure here — say a file
   already attached to another message — saves nothing and fails the send.
7. **Publish** `MessageCreated` to the channel's audience.
8. **Record activity**: mentions, then the reply target, then DM
   participants — each step skipping anyone an earlier step already told.
9. **Queue the unfurl** for any links, which will republish the message as
   `MessageUpdated` when previews land.

After step 6 nothing fails the send: the message is saved, so a failed
activity write is logged and the request still succeeds. An edit or a
reaction is the same: if the message cannot be reloaded after the save,
the request succeeds with no message and no event goes out.

## Message format

`messages.content` is a small chat-style Markdown subset, and **the
client renders it — the server never does.**

Rendering goes through a parser (`web/src/core/markdown/`) to a tree, then
to React nodes. Never `innerHTML`. That is why there is no sanitizer in the
codebase and no XSS surface to audit: user content becomes text nodes and
element props, and there is no code path where it becomes markup.

Supported: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`,
`||spoiler||`, `` `code` ``, fenced code blocks, `>` quotes, `- ` and
`1. ` lists, auto-linked URLs, `[words](https://address)` links, and `\`
escapes.

Some deliberate absences and edge rules:

- **`_italic_` is not supported**, so `@user_names` survive intact. This is
  the kind of rule that only shows up once real handles exist.
- A bullet needs a space after it, so a line starting with `*italic*` is
  still italic rather than a broken list. `\-` escapes a literal dash
  and `1\.` a literal number, so the line stays a line.
- Lists parse to a flat row list carrying a depth (two spaces per level,
  three deep, never skipping a level), which the renderer turns into nested
  `<ul>`/`<ol>` with each sub-list inside the `<li>` it belongs to.
- A bare address ends at a space, `<` or `>`, so `<https://address>`,
  as pasted from email, links the address and shows the brackets as text.
- A link's words can be styled but **can't hold an address of their
  own**, so a label never shows one address over another; such text
  stays as typed. The address is http(s) only and shows on hover. A
  preview reads the words, and the link preview is for the address.
- A spoiler renders as a **`<button>`** — a real control, keyboard
  reachable and announced as one — whose content is `visibility: hidden`
  until clicked. A `<span>` with a click handler would be invisible to
  anyone not using a mouse.

### The composer

The composer and the edit box are a rich-text editor on ProseMirror
(`web/src/components/RichEditor/`). Markers never show: the draft is a
document, and Markdown is what it sends and what it loads to edit.

- **The schema is the message format.** A quote holds lines, a list item
  holds a line and maybe a nested list, a code block holds plain text. The
  editor cannot make something the format cannot write.
- **`RichEditor/markdown.ts` converts both ways**, and its tests hold the round trip:
  Markdown loaded and written back comes out unchanged. A marker character
  typed as text goes out escaped.
- **Typing a marker pair formats it** with the format's meaning: `__` is
  underline and `_` is nothing, whatever other editors do.
- **Pasted plain text is read as Markdown**, so a message's source pastes
  back formatted. Pasted HTML goes through the schema; a paste into a code
  block stays literal.
- **A bare address stays plain text**, styled as a link, because the
  message format links it on its own.
- **The link form refuses what the format can't read back**: an address
  not starting with `http://` or `https://`, one with a space, a `<` or a
  bracket it doesn't close, and link words holding an address of their
  own. A pasted link with such an address pastes as its words.
- **A code span can't hold a backtick**, so a backtick styled as code
  goes out as an escaped backtick beside the code (and in link words, a
  bracket does too).
- **A draft stays in its conversation.** Switching channel or thread
  starts an empty box, so unsent text is never sent somewhere else.

### The server's one involvement

`plainText` (`internal/chat/markdown.go`) strips markers for reply-quote
and activity previews, including bullets and `||`, so a preview reads
as the words themselves. It is the client's parser ported to Go, not a
second set of rules, and the same test cases run on both sides: a
preview never shows an address or a word the rendered message does not.
The link extractor for previews walks the same parse, and so does the
mention check: a token counts where the parse reads it as a mention,
never by a separate scan for backticks.

Note the consequence: **a spoiler's text does appear in a preview.**
The marker hides it *in the message*; an activity preview of a blank
line would be worse than one that spoils a plot point. This is a choice,
and it is written down here so it is not later "fixed" into a blank
preview.

### Emoji

Stored as Unicode. `:shortcode:` forms are converted in the composer on
send, so nothing downstream — not the database, not the search, not the
activity preview — knows shortcodes exist. Custom per-space emoji, when
they arrive, will keep the `:name:` form and be resolved at render time,
which is a different mechanism for a genuinely different thing.

## Mentions

**Only a token mentions anyone.** `<@u:ID:handle>` names a person and
`<@g:ID:handle>` a group; `@channel` and `@here` are the two exceptions,
typed as words. Plain `@casey` is text, from a person, a bot or a hook,
so a person and a group may share a handle without either being
mistaken for the other. The web composer writes the tokens: picking from
the picker, or typing a handle in full that only one person or group
has, makes a pill. Bots and hooks write them directly
([integrations.md](integrations.md#mentions)).

`mention_tokens.go` checks every token on send and edit:

- A person token is kept if its ID can read the channel: the space's
  members in a public channel, its people in a private one, a DM's
  participants. A group token is kept if its ID is a group of the
  channel's space and the channel is public.
- A kept token's handle is rewritten to the current one, whatever the
  sender put there. It is what readers show for a person or group they
  can't find, and what search indexes, so a message is found by the
  handle it was written with.
- A token the message shows as text is saved as `@handle` text and
  reaches nobody: one in code, inline or in a block, in a spoiler, or in
  a link's words. Code shows what was written, and a spoiler and a link
  are controls of their own. The parse decides (The server's one
  involvement), so the people told are the pills the message shows. The
  composer writes text there already.
- Any other token is saved as `@handle` text and reaches nobody. **A
  mention is an address, not a permission**: one for someone outside the
  channel doesn't error, because a stale ID shouldn't fail a message.
- The 4000-character limit counts each token as its handle.
- An edit checks its tokens but tells nobody new.

`content` carries the tokens as stored, to clients, bots and outgoing
webhooks alike. Clients draw a pill from the ID with the names they
already hold. Previews are text: reply quotes, thread-root lines and
activity items read each token as its current `@handle`, or its saved
one when the person or group is gone. The handle goes in after the
markup is read, as on the web, so a handle's `__` is never underline.
One users call and one groups query cover a page.

`@channel` and `@here` are reserved usernames (auth refuses to register
them) and require the `messages.notify_entire_channel` permission. Without it the
word is plain text — not an error, just words. `@channel` wins if both
appear. `@channel` reaches the people who can read the channel: the space's
members in a public channel, its listed people in a private one.
In a DM both are plain text, since addressing "everyone" in a conversation
with one other person is meaningless.

They count where the client marks them: as words of the message's text,
read off the same parse as tokens. In code or inside an address they are
text; in a spoiler or a link's words they count, since the client marks
them there too.

`@here` resolves through the `PresenceLister` port to the members who have
a live connection right now. It is the only place chat consults the
gateway.

**Recipients are materialised** into `message_mentions` at send time, even
for `@channel`. Activity delivery then has one shape regardless of how
the mention was written, and a later membership change doesn't retroactively
rewrite who was addressed.

Open tabs refetch messages when a group changes (`groups_changed`) and
when a username does: auth calls chat's `AnnounceRename` for a rename
on the profile page, by an admin or of a bot, and chat sends
`member_updated` to each of the person's spaces and their own devices.

### Groups

A group is a set of a space's members with a name ("Garden crew") and a
handle, made by those with `members.manage`. A handle is unique only
within its space, may match a username, and `channel` and `here` are
refused.

A group works in public channels only. In a private channel or a DM a
group token is saved as text and reaches nobody. Every member of the
space can read a public channel, so the group's people are reached as
they are, minus the author, and materialised into `message_mentions`
with everyone else. When `@channel` or `@here` applies it decides alone.

### Channel links

`<#ID:name>` links a channel. It rides the mention machinery in
`mention_tokens.go` (the parse, the checks, previews) but tells nobody:
it is an address for the reader to follow, not a mention.

- A link is kept only from a public channel to a public text channel of
  the same space. Everyone who reads the message can open it, so a
  private channel's ID never reaches someone outside it. Any other link
  (to a private, voice or deleted channel, one in another space, or from
  a private channel or a DM) is saved as `#name` text. A private channel
  stays private for its whole life, so a kept link can't later point at
  one.
- The name follows the channel-name rule (`[a-z0-9_-]`, up to 32), and a
  kept link's name is rewritten to the current one. A channel whose name
  is from before the rule can't be linked until it is renamed.
- Writing a link as text can join it to what is around it into a new
  token (`<` + `#name` + `…:x>`), so the stored form is written again
  until it settles, and no token is stored that wasn't checked.
- As for mentions: one in code, a spoiler or a link's words is text, the
  limit counts it as `#name`, and previews read it as the current
  `#name`, or the saved one once the channel is gone. Previews look up
  public text channels only: a message saved before links were checked
  can hold any channel's ID as plain text.

The web client draws a kept link as a pill that opens the channel, from
the channel list it already holds; one whose channel it can't find reads
as `#name` text. In the composer, `#` opens a picker of the space's
public text channels, and a name typed in full becomes a link, as a
handle does. Neither is offered in a private channel or a DM.

## Activity

The activity feed is the record of what happened to you: every mention,
reply and direct message, newest first, with a read state. *Notification*
means only the ways Stoop asks for attention about it — desktop banners,
bold channel names, badges — and those are the reader's to turn off.

The feed is complete by design. Nothing a person configures filters what
is addressed to them,
because a feed with gaps is a feed they can't trust: a mention in a room
they muted is still in their activity, and still lights the activity pill
on the rail. That pill is a dot rather than a count — the number changes
too often to be worth reading there, and the page header carries it.
Retention still sweeps *read* items (below); "complete" means "not
filtered by settings", not "kept forever".

Four kinds: `mention`, `reply`, `dm`, `thread_reply`. Each points at where it happened
(space, channel, message) so the client can navigate there, and carries the
actor and a 140-character preview.

**Each message raises at most one activity item per person.** The ordering
in `SendMessage` enforces it: mentions first, then the reply target unless
they were mentioned, then, for a reply in a thread, the people in the
thread, then DM participants, each step skipping anyone an
earlier one told. Being mentioned in a reply in a DM is one entry, not
three.

**Blocked people raise nothing, and nobody is told about a room they're
no longer in.** `notify` filters every recipient list through
`withoutBlockers` and then `ChannelMembersAmong`, so both apply once, at
the point of delivery, rather than in each record path. A message row
outlives its author's leave, kick or ban, and a quote of it would
otherwise hand them the new message's text.

**Delivery is batched.** Each of the three goes through `notify`, which
filters blockers, writes every recipient's item, and reads their mutes in
one query each, so a `@channel` costs the same handful of queries in
any size of space.

### The DM feed collapses

The activity feed holds **one entry per conversation, not per
message**. While an entry is unread, further messages refresh its preview
and timestamp in place (`UpsertUnreadActivityItems`); once it has been
read, the next message starts a new entry.

The event still goes out for every message, so a desktop banner fires per
message unless that DM is on screen and focused. That split is intentional:
the *feed* is a list of conversations needing attention, while a *banner*
is a real-time interruption, and collapsing the second would lose messages
a person was meant to see arrive.

### Retention

Read activity items older than `STOOP_ACTIVITY_RETENTION` are removed by
the `sweep_activity` job, on the file sweep's interval
([runtime.md](runtime.md#background-work)). Unread ones are never swept.

## Reads and unreads

`channel_reads` holds one row per (user, channel): the newest message id
they have seen. It only moves forward.

Because ids are UUIDv7 and therefore ordered, **"unread" is an id
comparison** — `channels.last_message_id > channel_reads.last_read_message_id`
— not a count and not a scan. The space rail's dot, the channel's bold, and
the "anything new?" query are all that one comparison.

`ChannelRead` is published to the reader's own `user:` topic so their other
devices stay in step.

### Mutes

`SetChannelMuted` works on any channel the user can read, DMs included.
`SetSpaceMuted` works on any space the user belongs to and silences every
channel in it: a channel is *effectively muted* when it has its own mute
or its space is muted, and with two states a channel cannot be louder
than its space. Both are preferences, so membership or read access is the
only gate. A mute owns every attention surface; the activity feed is the
one thing it never touches, apart from a thread mute stopping that
thread's `thread_reply` items, which are its unread signal
([Threads](#threads)). `SetThreadMuted` is the third mute, on a thread.

| Surface | Unmuted | Muted |
| --- | --- | --- |
| Desktop banner for a mention, reply or DM there | fires | silent |
| Channel name bold when unread | yes | no |
| Text channel's row in the sidebar (its own mute) | shown | left out |
| Mention count badge on the channel row | yes | no |
| Space pill unread dot | yes | no |
| Space pill mention count badge | yes | no |
| DMs pill dot and badge (for a muted DM) | yes | no |
| Activity item written | yes | yes |
| `thread_reply` item (thread mute) | yes | no |
| Activity pill dot | shows for it | shows for it |
| Space header muted icon (space mute) | none | red muted bell |
| Mark-read on open, jump from the feed | works | works |

Mute means "don't interrupt me about the room", not "hide things
addressed to me": the mention still reaches the person through activity,
which nothing they configure filters.

The controls sit where the thing is — the channel row's menu, the space
menu in the sidebar header — and Profile → Muted lists every mute with an
Unmute beside it, so a room silenced months ago is still findable.
Profile → Notifications holds the desktop banner permission; the activity
page is only the feed. Inside a muted space the channel menu's mute item reads
"Muted by space" and is disabled, and the space name carries a red muted
bell, so the dimmed rows explain themselves.

A text channel the person muted themselves leaves the sidebar, so muting
is also how a long channel list gets shorter. While they have any in a
space, a "Muted channels" bar sits on top of the members list and opens
the list in the side panel (`components/MutedChannels`), where a name
opens the channel and Unmute puts its row back. The channel being read
has a row, dimmed and last in the list so no other row moves, until the
reader goes elsewhere. A muted space hides nothing: only a channel's own
mute does (`sidebarTextChannels` in `mutes.ts`). A thread from a muted
channel shows its own mute button as muted and disabled, with a tooltip
saying the channel is why. Muting or unmuting a text channel is
announced to screen readers, since the row's move is only visible. Voice channels and conversations stay
listed, dimmed.

Two neighbouring mechanisms are not mutes. **Do not disturb** is a
choice on the account that holds every banner, on every device, on top of mutes
([realtime.md](realtime.md)): it is about the person, mutes are about
rooms. **Blocks** are unrelated: a blocked person raises no activity at
all, filtered at delivery before any of this.

Which half derives where. `Channel.muted` and `Space.muted` each carry
the caller's own row and nothing derived, and neither is set on broadcast
events; the client combines them, including the space-over-channel rule,
in `web/src/api/mutes.ts` ([web.md](web.md#the-api-layer)) for the
surfaces that are about a room — the bold name, the row's dot, the space
pill. `has_unread` is the server's contribution there: it skips muted
channels and does not know about space mutes.

The surfaces that are about a single event do not derive at all.
`ActivityItem.muted` is the recipient's effective mute for where the item
happened, stamped by the server from both tables, and the mention badges
and the desktop banner read it. That closes a gap the client cannot: a
space's channel list only loads when the space is opened, so a fresh tab
cannot see a channel mute in a space it has never visited. It is also the
derivation push notifications will need once banners leave the browser.
The stamp is a snapshot, so the web app refetches the feed when a mute
changes. The feed itself is never filtered by it.

`ChannelMuted` and `SpaceMuted` go to the personal topic, like the read
marker, so the setting follows the person across devices.

Two states, muted or not, is a deliberate floor. What the two mute
tables leave room for, none of it started:

- **Levels.** A `level` column with a default on both tables — all,
  mentions, muted — lets a channel row override its space in either
  direction, the one thing the two-state model rules out. The derivation
  stays in `mutes.ts` and the item stamp.
- **Push.** When banners leave the browser, the server already stamps
  the effective mute on every item; the tables hold what a push sender
  needs.
- **Suppressing `@channel` separately** is a candidate level, not a new
  table.

## History

`ListMessages` pages three ways, mutually exclusive, with a default page of
50 and a maximum of 100:

| Parameter | Meaning | `has_older` / `has_newer` |
| --------- | ------- | ------------------------- |
| *(none)* | The newest page. | `len == limit` / `false` |
| `before_id` | The page older than this message. | `len == limit` / `true` |
| `after_id` | The page newer than this message, oldest-first internally then reversed. | `true` / `len == limit` |
| `around_id` | A page centred on one message: `limit/2` older, the rest newer including the target. | measured per half |

`around_id` exists so that reply quotes, activity rows and `?m=<id>` links
open at the right place **in one round trip**, rather than fetching the
newest page and then paging backwards until the message appears.

Combining parameters is an `InvalidArgument`, and `around_id` on a message
in another channel is a `NotFound` — the same answer as a message that
doesn't exist, so an id can't be probed for existence.

`channel_seq` on the response is the channel's `seq`, read before the page
query, so anything that commits after it has a higher seq and reaches the
client as a change; each row carries the `seq` it was last stamped with
([data.md](data.md#chat), [proposals/channel-log.md](../proposals/channel-log.md)).

### Catching up: `ListChanges`

`ListChanges(channel_id, since_seq, limit)` is the channel log from a
position: every row of the channel with a `seq` above `since_seq`, in
`seq` order, a default page of 100 and a maximum of 200, under the same
gate as `ListMessages` (`internal/chat/changes.go`). It is the one read
that applies no shown filter (`ListMessageChanges` in
`queries/chat/messages.sql`): a tombstone comes back as a `Message` with
`deleted` set, no content and nothing attached, exactly as a placeholder
does, and a thread reply comes back with `in_channel` false and its
`thread_root_id`. A row is in the log once, at its latest position, so a
message sent and then edited is one row with the edit's seq. The response
carries `channel_seq`, read with the channel row before the rows query,
and `has_more`, true when the page was full. `channel_seq` becomes the
client's position only once `has_more` is false: a full page says nothing
about what lies between its last row and the counter, so while `has_more`
is true the client asks again from the last row's seq and its position
does not move.

A row with no `seq` — written by an older binary during a rollback — is
never above `since_seq` and is left for the next full load; that is
accepted.

The client rule is one comparison: a held row is replaced by one that
arrives with a higher seq. A live event whose seq is exactly the next is
applied; any other gap, and every reconnect, is one `ListChanges` from the
seq held, repeated while `has_more`.

**The retention floor.** Both `ListMessages` and `ListChanges` answer
with `retention_floor_id`: the message id below which the sweep removes
top-level messages, computed as the sweep computes its cutoff
(`retentionFloor`, shared with `SweepMessages` so the two can never
disagree), empty when retention is off. The sweep keeps a pinned root and
its thread, so the client's rule follows it: on any load, drop a held row
whose id is below the floor unless it is pinned (`Message.pinned` is on
the row), and drop a reply whose root's id is below the floor unless the
root is pinned (the root row carries the flag). That is how the sweep's
hard deletes, which publish nothing and leave no tombstone, reach a
client that holds the rows; `channels.swept_seq` plays no part in it. The
floor is advisory: a setting that cannot be read is logged and the answer
carries none, and the next successful answer carries it.

The client's side of this — the single flat window, the 300-row cap, the
liveness rule — is in [realtime.md](realtime.md#history-windows).

## Message retention

`message_retention_days` is an instance setting (0 = forever), read
through chat's `InstancePolicy`. `internal/chat/retention_sweep.go` runs
hourly and deletes messages older than the period, pinned ones excepted,
DMs included. A thread goes by its root's age: an expired root takes
every reply under it, however recent, since half a thread makes no sense
on its own, and nothing is kept past the period. A pinned root keeps its
thread. Replies are never swept on their own age. Message ids are UUIDv7, so "older than" is a primary-key
range below the smallest id for the cutoff instant (`cutoffID`), with no
extra index.

Each batch of 1000 lists the attachment files of the messages and their
replies, then takes the channels touched one at a time, in id order: one
transaction per channel that locks the channel row first (the rule every
message write follows, [data.md](data.md#chat)), hard-deletes the
batch's roots there and the replies under them — tombstones included,
since a deleted row past the cutoff is just a row — raises
`channels.swept_seq` to the highest `seq` among the rows removed, and
recomputes `last_message_id`. The files go through the port once the
batch is done. Foreign keys do the rest: a reply's
`reply_to_message_id` goes `NULL`, and the thread summary, mutes and
read markers cascade. Read markers have no foreign key and compare by
id, so unread counts stay right with the marker's message gone.

No events are published. A swept message is old enough to be off almost
every screen, and it is gone on the next load. The history head says
"messages older than N days are deleted" when the setting is on, since
the status carrying it is public.

## Search

`SearchMessages` finds messages by their words within one space the
caller belongs to, newest first, 25 per page (max 50) with a `before_id`
cursor. What the code does:

- **Storage.** `messages.search` is a stored generated column,
  `to_tsvector('simple', content)`, with a GIN index (migration 00029).
  Postgres maintains it on every insert and update; a delete blanks the
  content, and the query skips tombstones besides, so nothing stale is
  found. `simple` means whole lowercased words, no
  stemming, in any language. The column is for this query's `WHERE`
  and nothing reads it back: it runs larger than the content it indexes.
  A message reaches a client through the `message_with_reply` view
  (migration 00051), which is every other column plus the reply quote,
  so listing, search, pins and resent messages share one generated row
  type. A new `messages` column goes in the view and in the few queries
  that read `messages` directly.
- **Parsing** (`search_query.go`). `from:@handle`, `in:#channel`,
  `before:YYYY-MM-DD` and `after:YYYY-MM-DD` come out as filters
  (quoted values allowed, `in:"front steps"`); the rest is websearch
  syntax — words, `"phrases"`, `-excluded`, `OR`. The last bare word of
  three or more characters becomes a prefix match, so `restart` finds
  `restarted`. A query with no words left is `InvalidArgument`; a
  channel or handle that is not in the space is `NotFound`. `in:`
  matches a name case-folded, preferring an exact match and then the
  first by position, which covers names from before the naming rule.
- **The query** (`queries/chat/search.sql`) filters by the space's
  channels first, then the text match, then the date and cursor bounds,
  and stops after the page. No ranking: recency is the order. Rows come
  from the view, joined back to `messages` for the vector, and hydrate
  through the same path as history.
- **Guards.** Per-user rate limit (`STOOP_SEARCH_RATE_LIMIT`, 30 a minute,
  `ResourceExhausted` with `Retry-After`) and a 2 s statement timeout
  in a read-only transaction (`DeadlineExceeded`). The client words both.

## Pins

A channel keeps up to 50 messages, most recently pinned first. What
the code does:

- **Storage.** `channel_pins` (migration 00030) is `message_id` (the key),
  `channel_id`, `pinned_by` and `pinned_at`. Cascades do the cleanup:
  deleting the message, the channel or the pinner's account drops the pin,
  so there is no sweep and no dangling row.
- **Permission.** `SetMessagePinned` needs `manage_channels` in the
  channel's space; every member reads `ListPinnedMessages`. Setting the
  state a message already has is a no-op and broadcasts nothing.
  Direct messages have no pins yet (`InvalidArgument`).
- **The cap.** 50 per channel, which is what makes the list one query with
  no paging. The count and the insert are one statement
  (`queries/chat/pins.sql`), so a pin cannot act on a stale count; at the
  cap a pin is `FailedPrecondition` rather than evicting the oldest.
  Concurrent pins into a nearly-full channel can overshoot by a row or
  two under `READ COMMITTED`; nothing downstream cares, and an unpin
  corrects it.
- **Reading.** `ListChannelPins` reads the same view as
  `ListMessagesBefore` and hydrates through the same path;
  `PinnedMessageIDs` stamps `Message.pinned` on each page of history, so
  the timeline marks a kept message without a join.
- **Realtime.** `MessagePinned` carries the change — ids, the flag, who
  and when — not the list, which can be fifty full messages. Clients mark
  the message and refetch the list only if they are showing it.

## Announcement channels

A text channel's `post_policy` is `everyone` (the default) or `admins`,
which the UI calls an announcement channel. There, only the space's
admins and owner (instance admins inherit admin) and bots in the space
post; everyone else reads, reacts, and deletes their own messages.
Changed with `UpdateChannel` under `manage_channels`, and carried to
clients by the ordinary `ChannelUpdated`.

A private channel can't be an announcement channel: `UpdateChannel`
refuses `admins` for one, and the app doesn't offer it.

`requirePostPolicy` checks the identity, not the credential: the
credential was already checked for `messages.post`, so an admin's token
that grants only that still posts. It guards `SendMessage` (replies
included), `EditMessage`, and the upload handler through
`ChannelSpaceToPostIn`, so a file that could never be sent isn't stored.
It stays out of `writableChannel` because reactions go through that too.
An incoming webhook posts as its bot, so one pointed at an announcement
channel just works.

Voice channels and DMs are always `everyone`.

## Edits, deletions, reactions, replies

Anything that adds to or changes what other people see — send, edit,
react — is authorised the same way, through `writableChannel`
(`accessChannel` plus the block rule in a DM). Authorship is not an
authorisation: a kicked or banned author is still the author of what they
wrote, and an edit republishes the message and fetches its links. Deletion
is the deliberate exception: your own message is yours to retract, and
taking something back is not the thing a block or a ban is protecting
anyone from.

- **Edits** set `messages.edited_at` and republish the message as
  `MessageUpdated`. The same event carries link previews when they arrive,
  so clients need one update path rather than two.
- **Deletions** leave a tombstone (`internal/chat/tombstones.go`): one
  path for a top-level message, a reply and a root, in one transaction
  that takes the channel row first. The row keeps its id, place and
  `reply_to_message_id`; `deleted_at` is set, the text goes, and its
  reactions, attachments, mentions, link rows, pin and activity items are
  deleted with it, the files through the `FileDirectory` port once the
  transaction has committed. The row is stamped like any other write, so
  the channel log carries the delete. Nobody is shown it afterwards — not
  the channel or thread pages, `around_id`, search, pins or the channel's
  newest message — except a root whose thread still has live replies,
  which the channel shows as a placeholder ([Threads](#threads)); any
  other tombstone answers every RPC as a message that does not exist.
  Clients still hear `MessageDeleted` where a row used to vanish and
  `MessageUpdated` with `deleted` set for a placeholder, until the
  channel log replaces those events
  ([proposals/channel-log.md](../proposals/channel-log.md)). Only the
  retention sweep hard-deletes message rows. `messages.moderate` covers
  other people's; your own are always yours.
- **Reactions** are `(message_id, user_id, emoji)`. `ToggleReaction` is
  idempotent by construction — the primary key decides whether it is an
  insert or a delete — and publishes `ReactionsChanged` with the message's
  full reaction set rather than a delta, because a delta that arrived out
  of order would leave a wrong count on screen forever.
- **Replies** are a nullable `reply_to_message_id` and must point within
  the same channel (and the same thread or timeline, see
  [Threads](#threads)). The response carries a `ReplyRef` — the parent's
  author, a plain-text excerpt, and its first attachment's name — so the
  quote renders without a second fetch.

## Threads

A thread is the replies under one top-level message, its root. A reply
is a message with `thread_root_id` set and `in_channel` false, so it is
in the root's thread and not in the channel's timeline
([data.md](data.md)).

- **Sending.** `SendMessage` with `thread_root_id`. The root must be a
  top-level message in the same channel and not a placeholder. One
  level only: a reply can't be a root. An announcement channel has no
  threads, for admins too (`threadRootFor` in `chat/threads.go`).
- **What a reply leaves alone.** The channel's `last_message_id` and the
  author's channel read marker, so a thread reply neither bolds the
  channel nor marks it read. It moves the author's thread read marker to
  their reply.
- **The summary.** Each send updates the root's `threads` row in the same
  transaction (`RecordThreadReply`) and publishes `ThreadChanged` with the
  whole summary, not a delta, as `ReactionsChanged` does.
- **Also send to channel.** `also_send_to_channel` with `thread_root_id`
  saves one reply with `in_channel` true, so both timelines page it. It
  does what a channel message does to the channel (newest message, the
  author's read marker) and what a reply does to the thread. It carries
  `thread_root` (the root's author and excerpt, only the id once the root
  is a placeholder) for the line saying which thread it answers.
  Deleting it recomputes the channel's newest message as well.
- **Quotes.** A quote-reply inside a thread may quote its root or another
  reply in it; a channel message may only quote messages in the channel.
- **Paging.** `ListMessages` with `thread_id` pages the replies with the
  same `before_id`, `after_id` and `around_id`. `around_id` on a reply
  without `thread_id` centres the channel on its root and names the
  thread in `thread_root_id`, so a `?m=` link to a reply opens in one
  round trip.
- **Pins.** A reply in a thread can't be pinned yet.
- **Activity.** A reply tells the people in the thread (below) who
  haven't muted it and are still in the space or conversation, after
  mentions and quote-replies (one item per person). It is a
  `thread_reply` item, one per thread while unread, refreshed by later
  replies as the DM feed collapses (`UpsertUnreadActivityItems` with a
  thread root). A `thread_reply` item is a thread's unread signal, not
  something addressed to you, so a thread mute stops it; a mention or a
  quote-reply in a muted thread is still written, marked muted, as in a
  muted channel. It lights the activity pill and the summary's "new"
  count but no red badge on the channel or space, which counts what is
  addressed to you; a mention in a thread still does. Activity items and
  search results carry `thread_root_id`, so the client can open the
  thread.
- **Who is in a thread.** Its root's author, everyone who replied, and
  everyone @mentioned by name in the root or a reply (`@channel` and
  `@here` don't count). Nothing stores it: `ThreadViewerStates` works it
  out from the messages, so there is no follow to join or leave.
- **Mutes and read markers.** `thread_mutes` and `thread_reads` mirror
  `channel_mutes` and `channel_reads`. A mute stays until it is undone;
  replying doesn't undo it. `ListMessages` fills the caller's
  `participating`, `muted` and `unread_count` into each root's summary
  (`addThreadViewerStates`); `ThreadChanged` never carries them, since
  every viewer gets the same event. `unread_count` counts others' replies
  after the marker, and is 0 unless the caller is in the thread and
  hasn't muted it. `SetThreadMuted` and `MarkThreadRead` tell the
  person's other devices with `ThreadMuted` and `ThreadRead`.
- **Deleting a reply** tombstones it and recounts its root's summary
  over the live replies, under a lock on the `threads` row so a
  concurrent send's increment and the recount can't miss each other. The
  root is stamped too, since its summary changed, and the channel hears
  `MessageDeleted` with the thread's root and then `ThreadChanged`.
  Nothing counts a deleted reply any more: not the summary's count or
  recent authors, not who is in the thread, not a thread's unread count.
- **Deleting a root** with live replies leaves it shown as a
  placeholder: the tombstone (no text, attachments, previews, reactions,
  mentions, pin or activity) stays in the channel with its summary, and
  its thread still opens. Clients get `MessageUpdated` with `deleted`
  set. Edits, reactions, pins, quotes and new replies on it are refused;
  a quote of it reads like a quote of a deleted message. When its last
  live reply goes the summary row is dropped and the placeholder is
  hidden with it — stamped again, its thread mutes and read markers
  deleted, `MessageDeleted` published for the reply and then for the
  root. A root with no replies is hidden at once, as a hard delete was.
- **Delete thread** (`DeleteThread`) is moderation: `messages.moderate`
  in the space, never in a DM. It is the bulk form of the same path: the
  live replies and then the root become tombstones in one transaction,
  each with its own seq, the summary is dropped, and the channel hears
  one `MessageDeleted` for the root.

## Direct messages

A DM is a channel with `space_id IS NULL`, `kind = 3`, its participants in
`dm_members`, and `dm_key` — every participant's id, sorted and joined —
carrying a `UNIQUE` constraint. That key is the whole model:

- **A conversation *is* its people.** `OpenDirectMessage` takes a set of
  user ids and is idempotent for any size: the same people always open the
  same conversation, whoever asks and in whatever order, because the
  second insert loses to the constraint rather than to a check that could
  interleave. There is only ever one conversation with a given set, and a
  subset is a different conversation — you and ada are not the three of
  you.
- **Membership never changes.** Nobody can be added and nobody can leave,
  so the key can never become a lie. Two people or ten, it is one rule
  with no special case, and `DirectMessage.participants` can be counted to
  tell a pair from a group.
- **Ten participants**, the caller included (`maxDMParticipants`). Past
  that the thing being asked for is a space. The cap bounds one
  conversation, not how many exist — what bounds *that* is the eligibility
  rule below, and rate limiting if an instance ever needs it.

DMs have no manager: they are never renamed, reordered or deleted, and each
person deletes only their own messages. Mentions resolve against
participants; `@channel` and `@here` are plain text.

**Who may open one:** people who share a space, or an instance admin with
anyone — checked between the caller and each person named. It follows that
a conversation can hold two people who share no space, introduced by
somebody who shares one with each; that is what an introduction is.
Nothing else about instance admins reaches into DMs — see
[permissions.md](permissions.md) for the boundary and its honest limits.
`ListDirectMessageCandidates` is that rule as a list, for the picker.

**Blocks are the whole safety story**, since nothing can be left. One rule,
two people or ten: a conversation holding somebody you blocked cannot be
started, cannot be written in, and is not listed for you. The write refusal
is symmetric — `dmBlocked` refuses both sides — but the *hiding* is only
the blocker's own view, because making the conversation vanish for the
blocked person would tell them they had been blocked, which a block
deliberately never does.

Opening one checks **every pair**, not just the caller's: a conversation
two of its people could never speak in would be worse than a refusal. The
cost is stated rather than hidden — the caller can infer that two *other*
people have blocked each other, since they can message each of them alone.
Deliberate, and the smaller of the two harms. None of the refusals names
anybody: "this person" is used only where there is exactly one other, and
a group says "these people" or "this conversation" instead.

Blocking also **deletes the blocker's existing alerts** from that person
and from every conversation they are in (`DeleteActivityForBlocked`), not
just stopping new ones. An item left behind would be a feed entry, and a dot on the
activity pill, pointing at a conversation that is no longer in the list —
nothing to open and no way to clear it. Unblocking restores the
conversation and all its messages; it does not bring the alerts back.

**Closing is list grooming, nothing more.** `SetDirectMessageClosed` sets `closed_at` on the caller's own `dm_members` row, and only theirs: the
list hides it, the badge stops counting it, and a link to it still
resolves. Nobody else's list changes, because membership never does. The
next message in the conversation clears the flag for everyone who had
closed it (`reopenDM`) and tells them the way a new conversation is told,
with `ChannelCreated` on their topic, muted or not. Opening the same set of
people again also puts it back for the caller. Mute keeps its own meaning:
whether an arrival is noisy, not whether it appears.

**The rail's DM pill counts messages, not conversations.** It sums
`channel.unreadCount` over the list (`dmUnreadTotal`), using the same
predicate a row uses, so the pill is always the sum of the badges beside
it. It deliberately does *not* come from the activity feed like the space
pills do: a conversation holds one unread feed entry however many messages
arrive — `recordDM` refreshes it rather than adding rows — so the feed
counts conversations, and two identical-looking pills would disagree in
plain sight.

On the web, `spaceId === ""` is the DM signal. `ChannelView` renders a DM
from `/dm/$channelId` with an empty space; `api/dms.ts` holds the `["dms"]`
list and `usePeople`, which hands the timeline, composer and reaction
tooltips a DM's participants *in the shape of members*, so those components
never learn there are two kinds of channel either. A group has no name, so
`dmTitle` makes one from the people in it ("ada, bea and 2 others") and
`AvatarStack` makes a face from the first two.

## Link previews

URLs in a message — at most three distinct ones, taken from the content
with fenced and inline code stripped out first, each at most 2048
characters — are recorded in `message_links` at send time. A worker then fetches each one's Open Graph
metadata through chat's `Unfurler` port (`internal/unfurl`), stores the
preview image through the `PreviewImages` port (files, kind
`link_preview`, re-encoded and bounded like every other image), and
republishes the message as `MessageUpdated`. A link straight to an image
is a preview of just that image. An animated GIF is written again frame
by frame and stays animated, at its own size rather than fitted, since a
frame that paints part of the canvas cannot be scaled on its own.

A card can be removed for everyone with `DismissLinkPreview`, by whoever
may delete the message: its author, or a moderator outside DMs. The
`message_links` row stays, marked `dismissed`, so an edit that keeps the
link keeps the card gone and doesn't fetch it again. Cards for links to
messages (below) are drawn by the reader's app and can't be removed yet.

Previews are cached per URL in `link_previews` for a week and shared by
every message linking it. **Failures are cached too**, so a dead link isn't
retried once per message that mentions it.

### Links to messages

A link to a message on this server shows the message instead of a card
for the page (`components/LinkedMessages`). The reader's own app fetches
it with `ListMessages`, so a reader who can't read the message gets no
card, and each reader sees it as they would in its channel. The app
shows none for a private channel or a direct message, even to someone in
it. The link preview setting does not apply: nothing outside the server
is contacted.

A link pasted bare, with no words of its own, reads in the message as
who said it and where — "Casey Nolan in #general" behind a speech bubble
(`components/MessageLink.tsx`), with the address on hover. It follows
the card's rule, so until the message loads, and wherever no card would
show, the address shows as written. A link given words in Markdown keeps
them.

### The server fetches, never the reader's browser

A preview card never contacts the linked site. This is a privacy property —
reading a channel does not tell every site linked in it that you read it —
and it makes Stoop an HTTP client for arbitrary URLs on members' behalf,
which is a serious thing to be. So the fetcher:

- speaks **http(s) only**;
- **resolves DNS, rejects private, loopback, link-local, CGNAT and
  multicast ranges, and dials the checked IP** — so a name that resolves
  differently the second time cannot rebind onto a local address;
- **re-checks every redirect** against the same rules;
- reads the first `link_preview_html_mb` megabytes of a page (else
  `STOOP_LINK_PREVIEW_HTML_MB`, else 2) and refuses an image over 5 MB,
  the cap chosen by the Content-Type the server announces;
- **never uses an environment proxy**, which would otherwise route the
  whole defence around itself.

### Through a proxy

A fetch shows the linked site the server's own address, which is a home
address for many operators and which any member can collect by posting a
link to a site of theirs. With `link_preview_proxy` set (else
`STOOP_LINK_PREVIEW_PROXY`), the server contacts nothing but that SOCKS5
proxy:

1. the name is looked up over HTTPS at `STOOP_LINK_PREVIEW_RESOLVER`, a
   public resolver, **through the proxy**. A lookup made by the server
   itself would reach the site's name server from the operator's
   resolver;
2. every address in the answer is checked as a direct fetch's would be;
3. the proxy is asked to connect to **the address checked**, never to the
   name, so there is no second lookup to answer differently.

The guard is therefore as exact as without a proxy, wherever the proxy
runs. A proxy or resolver that is down fails the fetch; nothing falls
back to a direct one. SOCKS5 without credentials is the only kind taken.

`STOOP_UNFURL_ALLOW_PRIVATE` relaxes this for development and for the
browser spec, which serves its own page to unfurl. It is logged loudly at
startup, because it is exactly the setting that turns the server into a
probe of the operator's LAN.

Previews are **off unless turned on**: the `link_previews` setting, else
`STOOP_LINK_PREVIEWS`, else off, because every fetch shows a linked site
the server's address. Links posted while it is off are not recorded, and
cards already fetched stay. A server that had accounts before this
default has the setting saved as on at its first start with it
(`KeepLinkPreviewsOn`), so an upgrade takes no cards away.
