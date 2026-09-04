# Messaging

Everything in this document belongs to `internal/chat` — the largest
module, and the only one whose surface is big enough that its files are
organised by entity rather than by layer (`spaces.go`, `channels.go`,
`messages.go`, `mentions.go`, `activity.go`, `reactions.go`,
`invites.go`, `bans.go`, `blocks.go`, `dms.go`, `links.go`,
`permissions.go`, `markdown.go`).

## The container model

**Space → channel → message**, with one twist: a channel does not need a
space.

- A **space** is a community: a name, a description (public, shown to an
  invited stranger), a welcome (Markdown, shown to people who joined), an
  icon, members with roles, and an ordered list of channels.
- A **channel** is `kind` 1 (text), 2 (voice), or 3 (direct message), with
  a position, a topic, and a `last_message_id`.
- A **message** is content, an author, a channel, and optional replies,
  attachments, reactions, mentions and links.

The chat module tells a space channel and a DM apart in exactly **two
places**, and nowhere else:

- **`accessChannel`** loads a channel the caller may read — a member of its
  space, or a participant in the DM. Every message RPC starts there, so
  there is one authorisation check for reading, not one per operation.
- **`publishChannel`** delivers an event to whoever can see the channel:
  the space's `space:<id>` topic, or each participant's `user:<id>` topic.

Everything else that hangs off `channel_id` — messages, read markers,
reactions, replies, attachments, link previews, history windows — works on
a DM unchanged, because it never asks which kind it has. That is the whole
reason DMs were cheap to add.

## Sending a message

`SendMessage` is the busiest path in the codebase, and its ordering is
deliberate:

1. **Validate.** Content is 1–4000 characters, *or* empty with at least one
   attachment.
2. **Authorise** via `writableChannel` — channel membership, plus the block
   rule in a DM.
3. **Claim attachments** — check each id through the `FileDirectory` port
   for kind, owner and space ([files.md](files.md)).
4. **Resolve mentions** against the channel's people.
5. **Resolve the reply parent**, which must be a message in the same
   channel.
6. **One transaction**: insert the message, insert `message_attachments`,
   record `message_links`. A claim that fails — the file is already
   attached to another message, caught by a `UNIQUE` constraint — must not
   leave a bare message behind.
7. **After commit**: insert mention rows, bump `channels.last_message_id`,
   and mark the channel read for the author (who has, self-evidently, read
   their own message).
8. **Record activity**: mentions, then the reply target, then DM
   participants — each step skipping anyone an earlier step already told.
9. **Publish** `MessageCreated` to the channel's audience.
10. **Queue the unfurl** for any links, which will republish the message as
    `MessageUpdated` when previews land.

Steps 7–10 are outside the transaction on purpose. An activity item that
failed to write should not roll back a message that was successfully sent;
the message is the thing that matters, and the rest is best-effort
delivery with a durable record to fall back on.

## Message format

`messages.content` is a small Discord-style Markdown subset, and **the
client renders it — the server never does.**

Rendering goes through a parser (`web/src/api/markdown.ts`) to a tree, then
to React nodes. Never `innerHTML`. That is why there is no sanitizer in the
codebase and no XSS surface to audit: user content becomes text nodes and
element props, and there is no code path where it becomes markup.

Supported: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`,
`||spoiler||`, `` `code` ``, fenced code blocks, `>` quotes, `- ` and
`1. ` lists, auto-linked URLs, and `\` escapes.

Some deliberate absences and edge rules:

- **`_italic_` is not supported**, so `@user_names` survive intact. This is
  the kind of rule that only shows up once real handles exist.
- A bullet needs a space after it, so a line starting with `*italic*` is
  still italic rather than a broken list. `\-` escapes a literal dash.
- Lists parse to a flat row list carrying a depth (two spaces per level,
  three deep, never skipping a level), which the renderer turns into nested
  `<ul>`/`<ol>` with each sub-list inside the `<li>` it belongs to.
- A spoiler renders as a **`<button>`** — a real control, keyboard
  reachable and announced as one — whose content is `visibility: hidden`
  until clicked. A `<span>` with a click handler would be invisible to
  anyone not using a mouse.

### The composer overlay

The composer shows the draft live-styled while it is typed. It is not a
rich-text editor: the textarea stays a plain textarea holding the raw
source, and what gets sent is exactly what was typed.

The styling comes from a second parse — `parseStyledMarkdown`, the same
parser keeping each marker's exact characters — that drives an
`aria-hidden` overlay rendered *under* the textarea
(`web/src/components/ComposerOverlay.tsx`). Markers are dimmed, content
between them is styled, and **every character is reproduced**, so the
overlay lines up with the textarea glyph for glyph.

This is the reason `themes.css` contains colour and nothing else, and the
reason inputs are 16px below the mobile breakpoint (iOS Safari zooms into
anything smaller, and the overlay has to zoom with it). A theme that
changed a font size would visibly desynchronise the overlay from the text.

### The server's one involvement

`plainText` (`internal/chat/markdown.go`) strips markers for reply-quote
and activity previews, including bullets and `||`, so a preview reads
as the words themselves.

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

`@handle` is matched at a word boundary against auth's username rules
(3–32 of `[a-z0-9_]`), case-insensitively, and resolved to **people in the
channel** — a space's members, or a DM's participants — excluding the
author.

Handles that don't resolve are silently ignored. **A mention is an address,
not a permission**: writing `@casey` in a space Casey isn't in does not
reach them, and does not error either, because a typo shouldn't fail a
message.

`@everyone` and `@here` are reserved usernames (auth refuses to register
them) and require the `mention_everyone` permission. Without it the token
is plain text — not an error, just words. `@everyone` wins if both appear.
In a DM both are plain text, since addressing "everyone" in a conversation
with one other person is meaningless.

`@here` resolves through the `PresenceLister` port to the members who have
a live connection right now. It is the only place chat consults the
gateway.

**Recipients are materialised** into `message_mentions` at send time, even
for `@everyone`. Activity delivery then has one shape regardless of how
the mention was written, and a later membership change doesn't retroactively
rewrite who was addressed.

## Activity

The activity feed is the record of what happened to you: every mention,
reply and direct message, newest first, with a read state. *Notification*
means only the ways Stoop asks for attention about it — desktop banners,
bold channel names, badges — and those are the reader's to turn off.

The feed is complete by design. Nothing a person configures filters it,
because a feed with gaps is a feed they can't trust: a mention in a room
they muted is still in their activity, and still lights the activity pill
on the rail. That pill is a dot rather than a count — the number changes
too often to be worth reading there, and the page header carries it.
Retention still sweeps *read* items (below); "complete" means "not
filtered by settings", not "kept forever".

Three kinds: `mention`, `reply`, `dm`. Each points at where it happened
(space, channel, message) so the client can navigate there, and carries the
actor and a 140-character preview.

**Each message raises at most one activity item per person.** The ordering
in `SendMessage` enforces it: mentions first, then the reply target unless
they were mentioned, then DM participants unless either already told you.
Being mentioned in a reply in a DM is one entry, not three.

**Blocked people raise nothing.** `withoutBlockers` filters every recipient
list, so a block is applied once, at the point of delivery, rather than in
each of the three record paths.

### The DM feed collapses

The activity feed holds **one entry per conversation, not per
message**. While an entry is unread, further messages refresh its preview
and timestamp in place (`RefreshActivityItem`); once it has been read, the
next message starts a new entry.

The event still goes out for every message, so a desktop banner fires per
message unless that DM is on screen and focused. That split is intentional:
the *feed* is a list of conversations needing attention, while a *banner*
is a real-time interruption, and collapsing the second would lose messages
a person was meant to see arrive.

### Retention

Read activity items older than `STOOP_ACTIVITY_RETENTION` are removed by
a sweeper sharing the file sweep's timer. Unread ones are never swept.

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
one thing it never touches.

| Surface | Unmuted | Muted |
| --- | --- | --- |
| Desktop banner for a mention, reply or DM there | fires | silent |
| Channel name bold when unread | yes | no (row dimmed) |
| Mention count badge on the channel row | yes | no |
| Space pill unread dot | yes | no |
| Space pill mention count badge | yes | no |
| DMs pill dot and badge (for a muted DM) | yes | no |
| Activity item written | yes | yes |
| Activity pill dot | shows for it | shows for it |
| Space header muted icon (space mute) | none | red muted bell |
| Mark-read on open, jump from the feed | works | works |

Mute means "don't interrupt me about the room", not "hide things
addressed to me": the mention still reaches the person through activity,
which nothing they configure filters.

The controls sit where the thing is — the channel row's menu, the space
menu in the sidebar header — and Profile → Notifications lists every mute
with an Unmute beside it, so a room silenced months ago is still findable.
That tab also holds the desktop banner permission; the activity page is
only the feed. Inside a muted space the channel menu's mute item reads
"Muted by space" and is disabled, and the space name carries a red muted
bell, so the dimmed rows explain themselves.

Two neighbouring mechanisms are not mutes. **Do not disturb** is a
presence status that silences every banner while set, on top of mutes
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
marker, so the setting follows the person across devices. They are the
presence-ish preferences that are persisted, precisely because they are
about a room rather than about a connection.

Two states, muted or not, is a deliberate floor. What the two presence
tables leave room for, none of it started:

- **Levels.** A `level` column with a default on both tables — all,
  mentions, muted — lets a channel row override its space in either
  direction, the one thing the two-state model rules out. The derivation
  stays in `mutes.ts` and the item stamp.
- **Push.** When banners leave the browser, the server already stamps
  the effective mute on every item; the tables hold what a push sender
  needs.
- **Suppressing `@everyone` separately** is a candidate level, not a new
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

The client's side of this — the single flat window, the 300-row cap, the
liveness rule — is in [realtime.md](realtime.md#history-windows).

## Search

`SearchMessages` finds messages by their words within one space the
caller belongs to, newest first, 25 per page (max 50) with a `before_id`
cursor. The design and the cost reasoning are in
[proposals/message-search.md](../proposals/message-search.md); what the
code does:

- **Storage.** `messages.search` is a stored generated column,
  `to_tsvector('simple', content)`, with a GIN index (migration 00029).
  Postgres maintains it on every insert and update; deletes are hard, so
  nothing stale stays. `simple` means whole lowercased words, no
  stemming, in any language.
- **Parsing** (`search_query.go`). `from:@handle`, `in:#channel`,
  `before:YYYY-MM-DD` and `after:YYYY-MM-DD` come out as filters
  (quoted values allowed, `in:"front steps"`); the rest is websearch
  syntax — words, `"phrases"`, `-excluded`, `OR`. The last bare word of
  three or more characters becomes a prefix match, so `restart` finds
  `restarted`. A query with no words left is `InvalidArgument`; a
  channel or handle that is not in the space is `NotFound`.
- **The query** (`queries/chat/search.sql`) filters by the space's
  channels first, then the text match, then the date and cursor bounds,
  and stops after the page. No ranking: recency is the order. Rows carry
  the same reply columns as `ListMessagesBefore` and hydrate through the
  same path.
- **Guards.** Per-user rate limit (`STOOP_SEARCH_RATE_LIMIT`, 30 a minute,
  `ResourceExhausted` with `Retry-After`) and a 2 s statement timeout
  in a read-only transaction (`DeadlineExceeded`). The client words both.

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
- **Deletions** remove the row and, through the `FileDirectory` port, its
  attachments' files. `delete_any_message` covers other people's; your own
  are always yours.
- **Reactions** are `(message_id, user_id, emoji)`. `ToggleReaction` is
  idempotent by construction — the primary key decides whether it is an
  insert or a delete — and publishes `ReactionsChanged` with the message's
  full reaction set rather than a delta, because a delta that arrived out
  of order would leave a wrong count on screen forever.
- **Replies** are a nullable `reply_to_message_id` and must point within
  the same channel. The response carries a `ReplyRef` — the parent's
  author, a plain-text excerpt, and its first attachment's name — so the
  quote renders without a second fetch.

## Direct messages

A DM is a channel with `space_id IS NULL`, `kind = 3`, participants in
`dm_members`, and `dm_key` (the two user ids, sorted) making "open a DM
with X" idempotent: two people opening the same conversation at once get
the same row, because the second insert loses to a `UNIQUE` constraint
rather than to a check that could interleave.

`dm_members` is a *table* rather than two columns on the channel so group
DMs can follow without a migration, though v1 is 1:1 only.

DMs have no manager: they are never renamed, reordered or deleted, and each
person deletes only their own messages. Mentions resolve against
participants; `@everyone` and `@here` are plain text.

**Who may open one:** two people who share a space, or an instance admin
with anyone. Nothing else about instance admins reaches into DMs — see
[permissions.md](permissions.md) for the boundary and its honest limits.

On the web, `spaceId === ""` is the DM signal. `ChannelView` renders a DM
from `/dm/$channelId` with an empty space; `api/dms.ts` holds the `["dms"]`
list and `usePeople`, which hands the timeline, composer and reaction
tooltips a DM's participants *in the shape of members*, so those components
never learn there are two kinds of channel either.

## Link previews

URLs in a message — at most three distinct ones, taken from the content
with fenced and inline code stripped out first, each at most 2048
characters — are recorded in `message_links` at send time. A worker then fetches each one's Open Graph
metadata through chat's `Unfurler` port (`internal/unfurl`), stores the
preview image through the `PreviewImages` port (files, kind
`link_preview`, re-encoded and bounded like every other image), and
republishes the message as `MessageUpdated`.

Previews are cached per URL in `link_previews` for a week and shared by
every message linking it. **Failures are cached too**, so a dead link isn't
retried once per message that mentions it.

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
- caps bodies at 1 MB of HTML and 5 MB of image;
- **never uses an environment proxy**, which would otherwise route the
  whole defence around itself.

`STOOP_UNFURL_ALLOW_PRIVATE` relaxes this for development and for the
browser spec, which serves its own page to unfurl. It is logged loudly at
startup, because it is exactly the setting that turns the server into a
probe of the operator's LAN. `STOOP_LINK_PREVIEWS=false` turns the feature
off entirely, for operators who would rather the server made no outbound
requests at all.
