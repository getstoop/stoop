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
reactions, replies, attachments, link previews, history pages and the
channel log — works on a DM unchanged, because it never asks which kind it
has.

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

### The phone's rows

The phone draws a message natively, from the same parser, with no web
view and no Markdown library: one component,
`mobile/src/components/MessageBody/`, used by the channel rows, the
thread and the message menu's card, and later by search and pins. It
follows web's `MessageBody` rule for rule: marks as text styles, inline
code on the raised fill, links in the accent, a spoiler covered until
tapped, an emoji-only message at twice the size.

- **The paragraph is our own native view** (`mobile/modules/
  stoop-rich-text`, the module that also holds the composer's field):
  TextKit 1 on iOS, a `StaticLayout` on Android. JS turns the parse into
  styled runs (`MessageBody/native.ts`), never Markdown, and the view
  paints web's rounded, padded boxes behind pills, inline code and
  spoilers, which nested React Native `Text` can't (a nested run takes
  no padding or corners). A person's or a group's mention ends with
  web's glyph for it, a run of its own that the view draws in the pill's
  colour (a bot's has the person's for now: the row has no member list
  to tell them apart by). A covered spoiler is drawn clear on its fill
  and never reaches a screen reader. Anything without the module draws
  nested `Text` with the pills flat and no glyph.
- **Measured before it is laid out.** The view lays out at a width it is
  given and reports a height, so a row is the right height the first
  time: a synchronous call measures the runs at the window's width less
  the place's inset (`MessageBody/insets.ts`, one entry per place that
  draws a message) and the block's own room. A wrong inset still draws
  right, a frame later, once `onLayout` reports the real width.
- **Blocks are views around paragraphs** (`MessageBody/blocks.ts`): a
  quote is a bar beside a muted paragraph; a list is its rows, each one
  paragraph at its depth's indent behind a marker that is plain `Text`,
  outside and uncapped as a browser draws it, hidden from screen
  readers and read by the row before its words; blocks are spaced as a
  browser collapses their margins. A code block is `Text` in a
  horizontal `ScrollView`, not the native view, since it never wraps
  and the view lays out at a given width; a drag up or down on it
  scrolls the list.
- **Touch.** A tap opens a link, opens a channel pill's channel (when
  it is a public text channel of the space the app has listed; otherwise
  the pill reads as `#name` and takes no tap) or reveals a spoiler for
  as long as the row is on screen. A person or group pill opens nothing:
  a member card is a screen still to design. A long press anywhere,
  links and code included, is the row's and opens the message menu.
- **A screen reader** finds the paragraph as one element read as the
  message (a covered spoiler as "spoiler, double tap to reveal"), after
  a link element for each link and channel pill, so touching a link
  finds it; a code block reads as its text. On Android these are
  `ExploreByTouchHelper` virtual nodes, and the paragraph offers a
  double tap only while something in it is covered.
- **"(edited)"** follows the last words when the message ends in a
  paragraph and is a line of its own after a quote, a list or a code
  block; with files or preview cards under the message it goes after
  them, where web's row puts it.
- **The look is web's, from one place.** The values web's message rules
  use are named in the `--md-*` block at the top of
  `web/src/styles/markdown.css` (code padding, the quote bar, the list
  indent, the pill, the preview card) and carried into
  `mobile/src/theme/generated.ts` by `make mobile-theme`: a number as a
  number, a `var(--x)` as the theme key to look up, an `em` size as a
  scale of the body size. `make lint` fails when the generated file is
  stale, so the two can't drift. The layout itself (a quote is a bar
  beside muted text) is written in each app, and fonts are the
  platform's, so lines break in different places and a long message can
  come out a pixel apart.
- **Not yet**: a tap on a person or group (the member card) and mention
  glyphs; a message link read as who said it and where (STOOP-520; the
  address shows as a link, with no card); right-to-left text (the view
  lays out left to right, so a box's pad can land on its wrong side);
  measuring in a Fabric shadow node, which would do away with the
  insets.

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
- **A draft stays in its conversation, and is there on return.**
  Switching channel or thread saves the words under the account and the
  conversation they were typed in and shows that conversation's own
  draft, so unsent text is never sent somewhere else, and a switch, a
  reload or an ended session no longer loses it. Drafts live on the
  device (`localStorage`; the rules in `web/src/core/drafts.ts`, the
  store in `web/src/api/drafts.ts`), signing out deletes them, and one
  untouched for seven days expires. The phone keeps its own the same way
  ([mobile/README.md](../../mobile/README.md)).
- **What a draft is not.** It is the words and their quote: files picked
  and an edit in progress still go with the screen. Each device keeps its
  own, so nothing reaches the server or another device, and no list
  marks the conversations that hold one. Emptying the field is how one
  is discarded. An ended session keeps its drafts until they expire, so
  the words are there after signing in again; the cost, accepted, is
  that "Log out everywhere" from another device leaves them readable on
  this one, and an expired draft is only removed when the app next
  starts, so on a device never opened again it stays. In the desktop
  app a draft sits in its server's partition
  ([desktop.md](desktop.md#sessions)); removing a server there clears
  nothing of its own, and since that partition is never opened again
  nothing sweeps it, so the drafts stay on disk. Accepted. Two smaller ones are accepted too: a send cut off
  after the server took the message brings the words back beside it, and
  a draft whose quoted message is outside what is loaded comes back
  without the quote.

### The phone's field

The phone's composer is a native field of our own (`mobile/modules/
stoop-rich-text`: `RichEditorView.swift`, `RichEditorView.kt`), not a
web view: a `UITextView` on TextKit 1 and an `AppCompatEditText`, so the
keyboard, autocorrect, dictation and the selection handles are the
system's. Markers never show, and Markdown stays what is sent and what an
edit loads.

- **Native owns the text; Markdown stays in core.** The text view's
  attributed string (the Editable's spans on Android) is the document:
  each character carries its marks, a link's address, the mention a pill
  names, and its line's block, and a styler draws the look from those.
  Typing never waits on JS. The field reports each change as lines
  (`core/editor/lines.ts`, `EditorLine`: a block, a list level, a code
  group, styled runs), and core turns lines into web's document and
  back (`linesToDoc`, `docToLines`), so `toMarkdown` and `fromMarkdown`
  are shared with web and checked against the server's cases. JS asks
  the field to do things (`format`, `insertMention`, `setLink`,
  `insertLines`, `load`) and the field acts on its own text as it stands.
- **One file per feature, the same on both platforms.** The document
  (lines in and out, the line walking, the order the invariants run in
  after an edit), marks, links, mentions, blocks, the typing shortcuts
  and the clipboard each own one attribute and every rule about it, with
  the same functions in the same order in Swift and Kotlin. Cross-feature
  rules live with the feature that owns the constraint: a code block
  strips marks, links and pills (blocks); a link strips pills (links);
  inline code holds no pill (marks). The platform layer around them (the
  bridge records, the styler, the decorations under the words, the text
  view subclass, the Expo view) is wiring.
- **An empty last line in a block holds a zero-width space, the
  holder.** Neither platform can indent a line with no character, and
  Android's layout ignores paragraph spans on a zero-length last line;
  the holder carries the block, is never shown or sent, never has the
  caret before it, and goes as words are typed beside it. It is put in
  where a line is made or emptied (a Return at a block's end, a block
  given to the empty last line, a block's last line emptied) and the
  field's repair only ever takes a stray one out.
- **Android's keys and spans.** Return and Backspace reach the field
  through its input connection, where it answers them itself at a
  block's edge; no meaning span stretches (all exclusive, re-cut after
  each edit), and marks are put on typed text by the view, which has no
  typing attributes. A word Gboard takes out to put back changed keeps
  its line's block through the holder, and the keyboard is not restarted
  between the two halves. While words are selected the field pads below
  its last line, since the selection handles sit in windows of their own
  over the format row.
- **The row shows what is on at the caret**, the link form is a dialog
  on both platforms (drawn in the screen's own window on Android, so the
  keyboard stays), a spoiler in the field is hatched, Copy and Cut give
  Markdown with pills as their words, and paste reads the clipboard as
  Markdown. Over the limit, Send dims and a line says by how much.
- **Checks.** The feature files import Foundation (`android.text`) only
  and run as unit tests without a device: `swift test` in the module and
  Robolectric on Android (`mobile/README.md` → Tests). A Maestro flow per
  behaviour reads each sent message back over RPC. CI does not compile
  the native code; the hand-run `mobile-native.yml` does.
- **Not yet**: undo of a pill on iOS gives its words back as words;
  styled paste from other apps; images pasted as attachments; a
  character counter; choosing a code block's language; a line of only
  ```` ``` ```` inside a code block; emoji suggestions; reading the
  formats at the caret to a screen reader.

### The server's one involvement

`plainText` (`internal/chat/markdown.go`) strips markers for reply-quote
and activity previews, including bullets and `||`, so a preview reads
as the words themselves. It is the client's parser ported to Go, not a
second set of rules, and the same test cases run on both sides, from one
file (`web/src/core/markdown/shared-cases.json`, read by vitest and by
`internal/chat/shared_cases_internal_test.go`): a preview never shows an
address or a word the rendered message does not.
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

### Slash commands

A command is the apps' own: the server never reads a leading `/`, and
every command ends in an ordinary RPC it already checks. The list, and
the two functions that read a draft against it, are
`web/src/core/commands.ts`, shared with mobile; each entry has a name,
an argument hint, a one-line description and where it is offered.

- **The list.** While the whole draft is `/` and letters (the Markdown,
  so code, a quote or a list item never counts), a list of the commands
  offered here opens over the composer, beside the `@`, `#` and `:`
  lists and shut where they are (in code or a link's words). Letters
  filter it, nothing matching shuts it, and after a space it stays on
  the one command so named. On web, arrows move when there is more than
  one entry (with one they stay the caret's), Enter or Tab picks, and
  Escape closes it and keeps the text; it stays shut until the draft
  stops being a command, so a question typed after the name is left
  alone. On mobile it is touch only, drawn over the composer's card as
  the mention list is (`useCommandQuery`, `CommandList.tsx`), with no
  row chosen ahead: a tap picks and Return makes a new line. Nothing
  closes it but the draft ceasing to be a command or the card going
  down. A pick reads the draft exactly as a send does.
- **On send.** A draft starting with a known name, then a space or the
  end, opens that command's form and posts nothing. The command's words
  leave the field and are not put back if the form is cancelled; files
  and a reply waiting in the composer stay (on mobile Send opens the
  form even while those files upload). The words after the name
  go into the form's first field as one plain line (`plainText`, with
  any run of spaces, tabs, line breaks or control characters made one
  space). An
  unknown `/word` is an ordinary message, so a path still sends, and so
  is anything formatted as code. A thread's composer offers no command
  and sends one as typed; editing a message never runs one.
- **`/poll [question]`** opens the poll form ([Polls](#polls)) where the
  poll button (on mobile, Poll in the attach sheet) shows, with the
  question filled and cut to its limit.

Built: web and mobile.

## Mentions

**Only a token mentions anyone.** `<@u:ID:handle>` names a person and
`<@g:ID:handle>` a group; `@channel` and `@here` are the two exceptions,
typed as words. Plain `@casey` is text, from a person, a bot or a hook,
so a person and a group may share a handle without either being
mistaken for the other. The web composer writes the tokens: picking from
the picker, or typing a handle in full that only one person or group
has, makes a pill. The phone's field makes the pill as the handle's
word ends (`typedMentionEnding` in `core/mentions.ts`, the editor's
rule for a handle typed in full) and writes the token for any still
words on send and save (`withTypedMentions`). Bots and hooks write them directly
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
- The 4000-character limit counts each token as its handle, and each
  character (code point) once. Clients read it as `MAX_MESSAGE_LENGTH`
  in `core/mentions.ts`; the shared cases hold the two to one number.
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

**The phone's list** (`mobile/src/screens/Channel/MentionList.tsx`,
`useMentionQuery.tsx`) is web's picker over the composer's card: it
floats above the card, in the card's surface, as tall as its rows up to
four and a half, while the caret ends a `@` or `#` query that has a
candidate (`mentionQueryAt`, `channelQueryAt`, `mentionCandidates`:
`@channel` and `@here`, then groups, then people, eight at most). No row
is chosen ahead, since Return makes a new line: only a tap picks, and a
pick puts the pill in the field. An @ button after Aa types `@` at the
caret, after a space when a letter or digit is before it, which opens
the list the same way. The dock draws the list through a context
(`composerAbove.ts`), not the card's own view, outside whose bounds
Android delivers no taps. Opening it announces how many suggestions
there are. The names come with the channel's header
(`core/channelHeader.ts` `headerMentionNames`): the space's members, a
private channel's own people (only those are offered there, which web
doesn't do yet), its groups in a public channel, and the linkable
channels; member and group events carry only IDs, so the header is
loaded again for them (`changesMentionNames`), once per burst.

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
as `#name` text. In the composer, on web and on the phone, `#` opens a
picker of the space's public text channels, and a name typed in full
becomes a link, as a handle does. Neither is offered in a private
channel or a DM.

## Activity

The activity feed is the record of what happened to you: every mention,
reply and direct message, newest first, with a read state. *Notification*
means only the ways Stoop asks for attention about it — desktop banners,
bold channel names, badges — and those are the reader's to turn off. The
feed's own `unread_count` and the activity dot on the rail are the feed's;
the badges on channels and spaces are not read off it but counted from
the read markers ([Alert counts](#alert-counts)).

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
actor and a 140-character preview. An item goes read when the feed marks
it read, or when the read marker of the timeline its message is in passes
it: the channel's for a message the channel shows, the thread's for a
reply, and only the thread's for a `thread_reply`
([Reads and unreads](#reads-and-unreads)). An item for a message the
reader's marker has already passed is born read, `read_at` set as it is
written and carried on its `ActivityItemCreated`: the message is
published before its activity is recorded, so a client with the channel
or thread on screen can move the marker in between.

**On the web the feed is an inbox** (`routes/Activity/`): a New section
of unread items, newest first, with Mark activity read on its heading
(it reads the feed alone; the badges clear when the channel or thread
is read), and a
Read section of read ones with a rule between each, the first row of a
day carrying the day, loading older pages as the list reaches its end.
The first page is the newest items whatever their state, so while the
server counts more unread than the page holds, it loads older pages on
its own until New holds everything counted, up to ten pages
(`core/activity` `needsOlderPageForNew`); past that the person scrolls.
A row is the actor with the kind as a glyph on
the avatar's corner (@, a reply arrow, a thread bubble, an envelope), a
verb line ("mentioned you", "replied to you", "replied in a thread",
"sent you a direct message") with the channel beside it, the space
when the reader belongs to more than one, and the muted bell when they
silenced the room, then two lines of preview with the reader's handle and
@channel lit. Mutes never hide a row.

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
message**. While an entry is unread, further messages refresh it
(`UpsertUnreadActivityItems`): the newest preview and time, and a new id,
so that it reads as new and sorts to the top of a feed ordered by id
rather than staying where the first unread message put it. Once it has
been read, the next message starts a new entry. Because the id changes,
a channel's coalescing writes run one after the other, under an advisory
lock per channel (`LockActivityPlace`), with the new ids minted once the
lock is held: two at once would otherwise leave the second re-checking
an id the first had already changed, and its refresh lost, or moving the
entry to an id older than the one just published. The old id is gone with
the refresh (`ActivityItemCreated` carries the new one), so a client
coalesces by conversation, or by thread for a `thread_reply`, never by
id: the arriving item replaces the unread entry it holds for the same
place, and an older page still carrying the old row drops it
(`withActivityItem`, `withoutRefreshed` in `core/activity.ts`). Events
are published once the lock is released, so they can cross: an unread
arrival older than the held entry is the row that refresh took away,
and is dropped; a read arrival is a row the server keeps (a refresh
only ever takes an unread one), and is kept in its place by id.
`MarkActivityRead` with an id that no longer exists reads nothing and
loses nothing: the entry is read on the next tap or by the marker. A
refreshed entry is born read by the same rule as a new one, when the
recipient's marker has already passed the new message.

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
the "anything new?" query are all that one comparison. A quiet
[system message](#system-messages) is never the channel's last message
and is left out of `unread_count`, so it changes none of them.

`ChannelRead` is published to the reader's own `user:` topic so their other
devices stay in step.

**A read marker reads the activity it passes.** When a marker moves,
the same transaction marks read the person's activity items about
messages at or before the stored marker in that timeline:

| Kind | Channel marker clears it | Thread marker clears it |
| --- | --- | --- |
| `mention`, `reply` | when its message is in the channel (`in_channel`: top-level, or a reply also sent there) | when its message is a reply in the thread |
| `dm` | when its message is in the conversation | when its message is a reply in the thread |
| `thread_reply` | never | when the reply it points at is passed |

The channel's marker moves with `MarkChannelRead` and with the author's
own message in `SendMessage` (`MarkChannelActivityRead`); a thread's with
`MarkThreadRead` and with the author's own reply
(`MarkThreadActivityRead`). A `thread_reply` item stands for every unread
reply in its thread, most of which the channel never shows, so only the
thread reads it. A `dm` item stands for the whole conversation but goes
with where its newest message is; one that was also standing for an
earlier reply in a thread clears with the channel's marker, though that
reply was never seen.

The stored marker is the bound, not the request's target: the marker
only moves forward, and an item written after the read is born read by
the same rule (`CreateActivityItems`, `UpsertUnreadActivityItems`), since
`MessageCreated` goes out before the activity is written and a live
client may have read the message by then. Only a credential that covers
`activity.read` clears anything: a token that posts or reads as the
person leaves their feed as it was. So a mention clears when its message
is read, however far down the feed it sits; `MarkActivityRead` remains
for the feed itself. Clients
learn of it from the `ChannelRead` or `ThreadRead` event, or from their
own `MessageCreated`, and refetch the feed when it holds an unread item
there or the server counts unread items past the cached page.

### Alert counts

The badge on a channel row, and the one on a space pill, show
`Channel.alert_count` and `Space.alert_count`: not the feed's unread
items but **messages past the reader's marker that are addressed to
them**, counted by `CountAlerts` (`internal/db/queries/chat/alerts.sql`)
whenever a channel list or a space list is answered. A message counts
for a person when every one of these holds:

- it is in a text channel of a space they can read (`channel_readers`)
  and is not deleted — a placeholder root with a living thread counts
  for `unread_count` but not here;
- someone else wrote it, and not someone they have blocked;
- it is addressed to them: a `message_mentions` row (which is how
  `@channel` and `@here` reach people, and never names the author), or
  its `reply_to_message_id` is a message of theirs;
- it is past their marker — the channel's when the channel shows it
  (`in_channel`: a top-level message, or a reply also sent to the
  channel, which counts against the channel's marker only), the thread's
  for a reply only its thread shows;
- they have not muted the channel, its space, or, for a reply in a
  thread, the thread.

A direct message's `alert_count` is always 0: every message there is
addressed to the reader, so `unread_count` is the number, and a client
counts a conversation as one alert while it has unread messages. A
space's count is the sum of its channels'. Both are the caller's own,
like `unread_count` and `muted`, and never set on broadcast events.

The count is driven by rows about the person — their mentions
(`message_mentions_user_idx`) and their own messages
(`messages_author_idx`, then `messages_reply_to_idx` for the replies to
them) — so its cost follows what they have been told and have said, not
the length of any channel. The rules live in that one query; the
per-channel `unread_count` in `ListChannelsBySpace` is kept apart from it
on purpose. Reading clears it the way it clears `unread_count`: the
channel or thread marker moves, and the next list answers with the
messages still past it, so a mention older than the feed's first page,
or sixty of them, is counted as it is rather than as what a page holds.

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
| Alert count badge on the channel row (`alert_count`) | yes | no |
| Space pill unread dot | yes | no |
| Space pill alert count badge (`alert_count`) | yes | no |
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
channels and does not know about space mutes. The badges are the server's
alone: `Channel.alert_count` and `Space.alert_count` already apply all
three mutes ([Alert counts](#alert-counts)).

The surfaces that are about a single event do not derive at all.
`ActivityItem.muted` is the recipient's effective mute for where the item
happened, stamped by the server from both tables, and the desktop banner
reads it. That closes a gap the client cannot: a
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
([data.md](data.md#chat), [channel-log.md](channel-log.md)).

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
client that holds the rows. The floor is advisory: a setting that cannot be read is logged and the answer
carries none, and the next successful answer carries it.

The client's side of this — one log per channel merged by seq, views as
ranges over it, the liveness rule and the 2,000-row cap — is in
[realtime.md](realtime.md#the-channel-log-on-the-client).

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
since a deleted row past the cutoff is just a row — and recomputes
`last_message_id`. The files go through the port once the
batch is done. Foreign keys do the rest: a reply's
`reply_to_message_id` and a system message's `reference_message_id` go
`NULL`, and the thread summary, mutes and read markers cascade. Read markers have no foreign key and compare by
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
  that read `messages` directly. Only what someone wrote is searched,
  a message (`kind = 0`), a [poll](#polls) by its question
  (`kind = 7`) and a delivered [reminder](#reminders) by its text
  (`kind = 9`): any other [system message](#system-messages) has no
  text, and a query of nothing but negations matches exactly that.
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
- **In the timeline.** A pin also records a system row, "pinned a
  message", that goes to the message ([System messages](#system-messages)
  → Pins). Unpinning records nothing: the row says something was pinned,
  not what is pinned now. Deleting the message removes its rows.

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

## System messages

A system message is a row in `messages` that records something that
happened in its channel: members added to a private channel, a member
gone from one, the channel renamed, its topic changed, a message pinned,
announcement mode switched. It is a message row so that paging, the
channel log, live delivery and retention carry it with no second stream
to merge. `UpdateChannel` records the three channel changes, a private
channel's membership calls record who was added and who left, every way
of leaving a space records "left" in its private channels, and `pin`
records a pin. A [poll](#polls), its closing row and a delivered
[reminder](#reminders) are system messages too, and the three kinds that
differ from the rest: they carry words someone wrote and they are not
quiet.

| Kind | Name | Records | `quiet` | `pinnable` | `authorDeletes` | `content` |
| ---- | ---- | ------- | ------- | ---------- | --------------- | --------- |
| 1 | `members_added` | people added to a private channel | yes | no | no | empty |
| 2 | `member_left` | someone gone from a private channel | yes | no | no | empty |
| 3 | `channel_renamed` | the channel's old and new name | yes | no | no | empty |
| 4 | `topic_changed` | the new topic | yes | no | no | empty |
| 5 | `message_pinned` | a pin, the message in `reference_message_id` | yes | no | no | empty |
| 6 | `post_policy_changed` | announcement mode on or off | yes | no | no | empty |
| 7 | `poll` | a [poll](#polls) | no | yes | yes | the question |
| 8 | `poll_closed` | a poll's close and its outcome | no | no | no | the question |
| 9 | `reminder` | a [reminder](#reminders) whose time came | no | no | yes | the text |

- **The row.** `kind` is 0 for a message someone wrote and the kind's
  number otherwise; `data` is the kind's own values as JSON (user ids,
  old and new names, the topic), `'{}'` for a kind that carries nothing
  and `NULL` only on kind 0. `author_id` is who did it, or who left.
  `content` is empty, except on a poll and its closing row, which keep
  the question there, and on a reminder, which keeps its text there and
  nothing in `data`; `reply_to_message_id` is null and the row is
  top-level. `reference_message_id` is the message the row is about (the
  pinned one), `ON DELETE SET NULL`. Two checks hold the columns
  together ([data.md](data.md#chat)).
- **Quiet.** `quiet` says the row marks nothing unread. It is written
  once at insert, from the kind, and stored so that SQL and both clients
  filter on it without knowing the list of kinds; a row keeps the
  behaviour it was written with. The six kinds that record housekeeping
  are quiet; the two [poll](#polls) kinds and a
  [reminder](#reminders) are not, and count as a message does. A quiet row is
  left out of `unread_count` (`ListChannelsBySpace`,
  `ListDMChannelsByUser`) and never becomes `channels.last_message_id`
  (`recordEvent` does not set it, `RecomputeChannelLastMessage` skips
  it), which is what the space's `has_unread` and a conversation's
  preview read. So `MarkChannelRead` with no id lands on the last
  message, below any quiet rows after it, and that is everything read.
  A server rolled back past this change knows none of it and can point
  a channel's last message at a quiet row; back on this version the
  space then shows unread beside a count of zero until someone posts
  there or marks the channel read.
  Alert counts, activity and push need nothing: they come from mentions,
  replies and activity items, and a quiet row has none.
- **Writing one** (`internal/chat/system_messages.go`). The registry
  `systemKinds` lists each kind's number, whether it is quiet, and
  whether it can be pinned (a poll alone) and deleted by its author (a
  poll and a reminder);
  each kind has an event type whose JSON is the row's `data`, and which
  says what goes in `content` (nothing, but for the poll kinds and a
  reminder).
  `recordEvent(ctx, qtx, channel, actorID, event)` runs inside the
  transaction of the action it records, so the two succeed or fail
  together: it takes the channel's next seq, inserts the row, sets the
  channel's last message only when the row is not quiet, and returns the
  row. The caller takes the channel row before any other row it writes
  (`LockChannel`, `LockChannelNoKey` on the membership paths, or a
  `NextChannelSeq` that is the transaction's first statement, as `pin`
  does; the rule in `seq.go`, whose one exception is a departure from
  the space taking the person's membership row first) and publishes
  `MessageCreated` after its commit, in seq order with anything else it
  publishes. The
  message it publishes is `loadMessage` of the row, which is the row as
  `ListMessages` returns it; `toProtoMessage` alone fills neither the
  event nor the reference.
  `recordEvent` marks nothing read, records no activity, writes no
  mentions, and is not subject to the channel's post policy; a caller
  whose row is not quiet does those itself (`CreatePoll`, `ClosePoll`,
  `deliverReminder`).
  It refuses an event with nothing in it to store: a pin with no
  message, a message that is not shown in the same channel, a member
  that is not a user id, a closing row about anything but a closed poll
  (the event's `checkAbout`).
  The view joins a reference only within the row's own channel besides.
  A pin's message id lives in `reference_message_id` and not in `data`,
  so a pin event decoded from a row does not carry it.
- **On the wire.** `Message.event` is a `SystemEvent`, a `oneof` with a
  case per kind; `Message.quiet` is the flag; `Message.reference` is a
  `ReplyRef`, the type a reply's quote uses. The server sends no wording
  for the row: every word a client draws in it is the client's, built
  from `event` (a poll's question and options are in its event as they
  were typed). The one-line previews of a poll and its closing row are
  the exception, worded on the server ([Polls](#polls) → Previews).
  People in an event are
  stored as ids and sent as `MessageAuthor`, resolved when the row is
  read like any author, so a renamed or deleted account shows as it is
  now. The reference's excerpt reads mentions as current handles and
  falls back to the first attachment's name, as a quote does, and reads
  "Poll: " and the question when the message is a poll (the view's
  `reference_kind` says so); a row
  whose message is deleted is sent its id alone (the pin rows go with
  the message, so only a row from before that is), and once the
  retention sweep has removed it there is no reference (the foreign key
  clears the column, with no new seq). A kind the server does not know,
  written by a newer one before a rollback, is sent as an event with no
  case set.
- **Readers.** History, `ListChanges`, pins and resent messages carry
  the new columns through the `message_with_reply` view. Search matches
  only kind 0, a poll (kind 7, by its question) and a reminder (kind 9,
  by its text): any other system row
  has no text, but a query of nothing but negations matches a row with
  no text. The retention sweep takes system
  rows with the messages around them. No code may assume a system row's
  `content` is empty: a server rolled back past this change lets the
  author edit one.
- **What a system row refuses.** Everything that assumes a person wrote
  the message: editing it, reacting to it, starting or replying in a
  thread under it (`threadRootFor`), quoting or replying to it
  (`checkQuote`, one path for both), muting or reading its thread
  (`readableRoot`), `DeleteThread` and `DismissLinkPreview`.
  Each asks `refuseSystemRow`, which tests `kind <> 0` rather than a list
  of kinds, so a new kind is refused all of them with nothing to add. The
  answer is `FailedPrecondition`, as for a placeholder. Pinning one is
  refused the same way unless the registry marks its kind `pinnable`
  (`refuseUnpinnable`), which only a poll is.
- **Deleting one** is moderation alone, unless the registry marks its
  kind `authorDeletes`, which a poll and a reminder are: that row is
  deleted as a message is, by its author or a moderator. For every other kind
  `messages.moderate` covers it,
  as it covers other people's messages, and inside a private channel
  only for someone in it, as for any message. Being the row's author
  grants nothing: without `messages.moderate` nobody deletes the record
  of their own action, and with it anyone deletes any row, one they
  caused included. A direct message has no moderator, so nobody deletes
  one there. The reason to delete one is usually the
  text it holds (a topic, a channel name), so the tombstone keeps the
  row's kind but not its event: `data` becomes `'{}'` and
  `reference_message_id` is cleared. Like any tombstone it is shown in no
  history afterwards, and `ListChanges` carries it as `deleted` with the
  kind's event empty.
- **Outgoing webhooks** never deliver a system row
  ([integrations.md](integrations.md#outgoing)).

- **Channel changes** (`UpdateChannel`, `channels.go`). One transaction
  locks the channel row, reads the values it holds, writes the update,
  and records a row for each value that actually changed, in the order
  name, topic, post policy: a rename (old and new name), a topic (the
  new one, `""` when cleared), announcement mode (the new
  `post_policy`). Saving a value the channel already has records
  nothing; a refused update (a name already taken) records nothing,
  since the rows go in its transaction. After the commit the channel's
  `channel_updated` goes out, then each row's `message_created` in seq
  order, to whoever may read the channel.
- **Membership** (`channel_members.go`, private channels only; a public
  channel holds everyone in the space, so nobody joins or leaves it).
  `addMembers`, behind `AddChannelMembers` and a webhook's bot
  (`AddBotToChannel`), holds the channel row first, inserts the people, and
  records one "added" row by the caller naming only those it put in:
  someone already in is left out, and a call that puts nobody in
  records nothing. An admin outside the channel who adds only
  themself is the row's author and its one member, which reads
  "joined". After the commit each new member is sent the channel
  (`channel_created`) and the join, and only then does the row go to
  everyone in it, so a new member's client has the channel when the row
  arrives. `removeFromChannel`, behind `LeaveChannel`,
  `RemoveChannelMember` and `RemoveBotFromChannel`, holds the channel
  row before it deletes the member and their activity (a send by the
  same person takes the channel row and then marks their activity read,
  so the other order deadlocks), and records a "left" row whose author
  is the person who went. Both hold it `FOR NO KEY UPDATE`
  (`LockChannelNoKey`), as a departure from the space does: an alert
  being written for someone else in the channel, which may hold the
  departing person's alert, gets its foreign-key check through rather
  than wait on the removal. A removal records exactly what a leave does:
  nothing stores or shows who removed them. The people who remain, read
  in the same transaction, get `channel_member_left` and then the row;
  the person who went gets only `channel_deleted`. Making a
  private channel records nothing, as its maker is in it from the
  start.
- **Departures from the space** (`removeMember`, `members.go`). Leaving
  the space, a kick, a ban, a bot's removal and an account deletion
  (`RemovePerson`, once per space) all end there, and each records one
  "left" row (`memberLeft`, no data) in every private channel of the
  space the person was in, text or voice, with the person as its
  author. Nothing on the row says why they went or who removed them; a
  public channel records nothing. The one transaction first holds the
  person's own membership row (`LockSpaceMember`), so nobody can add
  them to a private channel meanwhile: an add checks that row (the
  `channel_members` foreign key), so it either finished first and is
  listed, or waits and is then refused as not a member. Then it lists
  their private channels (`ListPrivateChannelsOfMember`), since deleting
  the membership cascades their `channel_members` rows away, and
  locks them in id order, the order every transaction holding more than
  one channel row takes them in (`seq.go`; `ReorderChannels` writes its
  positions in id order for this), so two removals sharing channels, or
  a removal and a reorder, never wait on each other in a circle. The
  channels are held `FOR NO KEY UPDATE` (`LockChannelNoKey`): every
  other writer of the channel waits, but a foreign-key check does not,
  so an alert being written for someone else there goes through rather
  than wait on the removal while holding the departing person's alert.
  Taking the membership row before the channel rows is the one
  exception to `seq.go`'s rule. After its locks the removal waits only
  on rows its own statements and cascade take (the person's alerts,
  channel memberships and group memberships), and nothing holding one
  of those then waits on a departing person's membership: saving a
  group (`UpdateGroup`), the one writer of them that also checks
  memberships, writes only the difference, never touching a member who
  stays, and adds its new members before it deletes any row, so it
  holds none while it waits. A space delete waits
  behind a removal: its cascade reaches the membership before the
  channels. It reads the list again under the locks, dropping a channel
  deleted or left meanwhile. Then it deletes the activity and the
  membership and records the rows. A removal that fails takes its rows
  back with it; a ban writes the ban first, in its own statement, and
  the rows go in the removal's transaction. After the commit, the people
  who remain in each channel get `channel_member_left` and then the
  row's `message_created`: membership before the row, as a removal from
  the one channel sends it and as an add sends the join before its row.
  Then the space gets `member_removed`. The person who left is sent none
  of it. An account deletion publishes the rows before the account is
  marked deleted, so they go out with the old name; the web client
  corrects it when `member_removed` has it refetch the profile (the
  mobile app shows the row's name as it was sent),
  and history reads the author as deleted from then on. Every "added"
  row naming someone who then leaves the space is followed by their
  "left" row.
  Accepted, each failing one transaction whole with a deadlock error
  (`seq.go` lists them): the person taken out of a listed channel and
  added straight back before the removal locks it (a window that
  includes waiting on lower-id channels); a space delete against
  anything that holds a channel or group row and then checks a
  membership, or holds channels in another order (a reorder, an add to
  a private channel, a group save), since the delete's cascade takes
  them in its own order; and a ban whose removal is the one that fails, which leaves the
  person banned but still a member until the ban is made again.
- **Pins** (`pin`, `pins.go`). One transaction stamps the pinned message
  (its seq, the first statement, takes the channel row), creates the pin
  and records a row by the
  pinner whose reference is the message. The message is stamped first,
  so after the commit `message_pinned` goes out before the row's
  `message_created`, the two seqs one after the other. Pinning a message
  already pinned, a refused pin and unpinning record nothing. The row
  outlives the pin, but not the message: deleting it (Delete, Delete
  thread, or a root kept as a placeholder) tombstones its pin rows in
  the same transaction, each stamped after the message, as a
  moderator's delete of a system row does (`removeRowsAbout` in
  `tombstones.go`, which takes a poll's closing row the same way), and
  after the commit each row's `message_deleted` follows the message's
  own event. Quiet, they leave the channel's
  last message and unread counts as the message's delete leaves them.
  A client holding the rows drops them as the message's deletion lands
  (`withQuotesBlanked` in `core/channelLog/tombstone.ts`), and the
  deleter's own view at once (`withOwnDelete`). A pin row whose
  reference has no author, which is how the wire says the message is
  gone (from before this, or left by the retention sweep), is hidden
  (`isHiddenSystemRow`); a live message's reference always names its
  author, since its excerpt can be empty (an empty code block), and
  that row reads "pinned a message" with View. The sweep removing the message clears the
  reference with no seq, so a client already holding the row keeps the
  excerpt until it reloads
  ([channel-log.md](channel-log.md#known-and-left-as-is)).
- **The wording** is the clients', from one place both share:
  `web/src/core/systemMessages.ts` turns a row into a glyph name and a
  list of parts (plain text, a person, a channel name, the excerpt of
  the message a row is about, and "N others" holding the people a long
  list leaves out), and `systemText` reads the parts as one line of
  words. A list of people names up to three and otherwise the first two
  and a count, as a group conversation's title does; one person added
  who is the row's author reads "joined". The count unfolds:
  `systemLine(message, true)` names everyone, and the line's `fold`
  says whether it has a long list and which way it is drawn, so each
  client offers "N others" to unfold it and "Show fewer" to fold it. A
  pin row whose message is gone shows nothing, and a kind the client does not
  know shows nothing when the row is quiet (`withoutHiddenSystemRows`,
  applied where each client builds its list, before grouping, and not
  in the channel log's `isShown`, which range edges and the cap count
  on) and otherwise one line asking the reader to update Stoop.
- **In a list** a system row never continues a message nor is continued
  by one (`continues` in `core/grouping.ts`), and the "New messages"
  line skips quiet rows, so it sits above the first unread message
  someone wrote. A quiet row arriving beyond a range that stops short
  of the newest is not counted on the pill (`placed` in
  `core/channelLog/views.ts`), and the web's own arrival count skips one
  too. Code that asks "is the newest row mine" (following the bottom on
  my own send, ArrowUp to edit my last message) skips system rows.
- **Delete** is offered to someone with `messages.moderate` alone,
  with its own confirm, on web (the row's toolbar) and on mobile (a
  long press opens a menu with Delete only, `mobile/README.md`); being
  the row's author grants nothing on either.
- **A pin row goes to its message**: on web its View uses the message
  list's in-list jump, the one a quote uses, which loads the page around
  a message the list does not hold; on mobile tapping the excerpt (or
  View after it, or the row's View message action for a screen reader)
  uses the channel engine's `jumpTo` with the handling opening at a
  message has (one the server no longer has is said over the composer).
  Once the message is deleted the row is gone with it.

Adding a kind: a case in `SystemEvent`, an entry in `systemKinds` with
its event type, a `recordEvent` call in the action's transaction, and
its wording and glyph in `core/systemMessages.ts`.

## Polls

A poll is a question with 2 to 10 options that the people in a
conversation vote on by name. It is built on
[system messages](#system-messages): the poll is a row of kind 7
(`poll`) by whoever asked, and its closing row is kind 8 (`poll_closed`)
by whoever closed it, referring to the poll. Neither kind is quiet, so
unread counts, the "New messages" line and a channel's last message
treat both as a message, with no code of their own. The code is
`internal/chat/polls.go` and `queries/chat/polls.sql`.

Built: the server side, web and mobile. A poll is created, read with
its votes, voted on, closed, pinned and deleted over the API. Web
creates one from the composer's poll button, draws it as a card that
votes, closes and deletes, and draws the closing row as a system line
([web.md](web.md) → The message list). Mobile creates one from Poll in
the composer's attach sheet, draws it as a card that votes, with a
votes sheet, and closes, pins and deletes it from its long-press menu
([mobile/README.md](../../mobile/README.md) → Realtime). Both apps share
what is not drawing: `core/polls.ts` (reading a poll, the selection a
press sends, the results and who may do what), `core/pollForm.ts` (the
form's rules) and the closing row's wording (`systemLine`). The mobile
app needs a server of 0.23.0 or newer, the release that carries polls.

- **The poll row.** `data` is the definition, which never changes, and
  the closed state: `{question, options: [{id, text}], multiple,
  closed_at, closed_by}`, the last two `null` while it is open. An
  option's `id` is 1 to 10, given in order at creation and never reused;
  it is what a vote names. `content` holds the question as well, as
  plain text: the search column is generated from `content`, and a
  preview needs no `data`.
- **The closing row.** `data` is a snapshot of the outcome,
  `{question, winners: [{text, votes}], voters}`, so the row draws with
  no read of the poll and cannot drift. `reference_message_id` is the
  poll and `content` the question.
- **Votes** are `poll_votes (message_id, user_id, option_id)`, one row
  per person and option, and not in the row's `data`: they change often
  and are per person, as reactions are. `hydrateMessages` reads them
  with one query for the live polls on a page, and none when the page
  holds no poll (`addPollVotes`), so every path that hands a message to
  a client carries them. They are sent as `PollOption.voters`: people
  (`MessageAuthor`), resolved on the server like any author, in the
  order they voted. A client holds only a space's current members, so
  ids alone would lose the name of someone who left; a vote stays
  counted and named when its voter leaves the channel or the space or
  deletes their account. `Poll.voter_count` is distinct people, which
  in a poll of several choices is fewer than the votes. Deleting the
  poll deletes its votes (`TombstoneMessage`), and the retention sweep's
  hard delete takes them by cascade.
- **Creating one** (`CreatePoll`). The checks are `SendMessage`'s:
  `writableChannel`, then the post policy, so whoever may post here may
  ask. The question is 1 to 200 characters and each option 1 to 80,
  trimmed, with at least one visible character and no control
  character (a line break, a tab, a NUL) or text direction override;
  empty options are dropped, 2 to 10 must remain, and no two may be the
  same ignoring case, normalisation form and invisible format
  characters. Validation runs before access is known, so it stops at
  the first option past ten and its work does not grow with the
  request. One
  transaction locks the channel row, records the row (`recordEvent`,
  which makes it the channel's last message) and moves the author's
  read marker to it (`markChannelRead`). After the commit a closed
  conversation is put back on its lists (`reopenDM`), the row goes out
  as `message_created`, and in a direct message or group conversation
  the other participants get the `dm` activity item a message would
  give them (`recordActivity`, whose conversation step is the only one
  with anything to do). In a channel a poll marks unread and alerts
  nobody. An `@name` in a question is plain text and mentions no one.
- **Voting** (`SetPollVote`, `poll_votes.go`). The request is the
  caller's whole selection, as option ids: it replaces what they chose
  before, and an empty one takes the vote back, so a swap on a poll of
  one choice is one write and a repeat changes nothing. The access check
  is `writableChannel` alone, what a reaction asks, and not the post
  policy, so a member of an announcement channel votes. A request naming
  more than ten options is refused before anything is read. After the
  access check the row must be a live, open poll (`FailedPrecondition`
  for a closed poll, a message or any other system row; a deleted poll
  is not found, like any tombstone), and the selection must be one the
  poll takes (`InvalidArgument` for an id it does not have, an id twice,
  or more than one on a poll of one choice). One transaction stamps the
  poll, which takes the channel row, reads the row again and refuses a
  poll closed or deleted meanwhile, deletes the caller's votes that are
  not in the selection and inserts the ones that are new. A vote that
  changes nothing returns `errUnchanged` from inside the transaction, so
  the stamp rolls back: no seq is spent and nothing is published, and
  the answer is the poll as it stands. Otherwise the poll goes out whole
  as `message_updated`, reloaded after the commit but carrying the seq
  this vote's transaction took, as `reactions_changed` does: two votes
  that overlap each publish their own seq, where the reloaded row's seq
  would send the newer one twice and the older never, and every client
  into a catch-up. The answer is the same row. A vote marks nothing
  unread, records no activity, alerts nobody, reopens no conversation
  and leaves the channel's last message alone. A new vote's
  `created_at` is the clock's time at the insert, under the channel
  lock, so an option's voters are listed in the order they were let in
  (`created_at`, then user id); an option someone keeps across a change
  keeps its place.
- **Closing** (`ClosePoll`, `poll_close.go`). `writableChannel` comes
  first, since authorship is not access: an author removed from a
  private channel, or behind a block in a direct message, closes
  nothing. Then the caller must be the poll's author or, in a space,
  hold `messages.moderate`; a conversation has no moderator, so there it
  is the author alone. The post policy is not asked: a member closes
  their own poll in what has since become an announcement channel, as
  they may delete it. One transaction locks the channel row, reads the
  live row and refuses one that is not an open poll (a second close is
  `FailedPrecondition`, and nothing reopens a poll), counts the votes,
  writes `closed_at` and `closed_by` into the poll's `data` (the
  `ClosePoll` query, which takes only a live row of kind 7), stamps the
  poll, records the closing row (`recordEvent`, the next seq) and moves
  the closer's read marker to it. Under the lock no vote lands between
  the count and the close, so a racing vote is either in the outcome or
  refused. The outcome is every option with the most votes when that is
  at least one, in the poll's order, each with that count, and the
  number of distinct people who voted; with no votes `winners` is an
  empty list. After the commit a closed conversation is put back on its
  lists, the poll goes out as `message_updated` and then the closing row
  as `message_created`, each at the seq the transaction gave it, and in a direct message or group conversation
  the other participants get a `dm` activity item for the closing row,
  as for a new poll. In a channel a close marks unread and alerts
  nobody. `recordEvent` refuses a closing row about anything but a
  live, closed poll in the same channel (`checkAbout`), so nothing but
  this transaction can write one.
- **Deleting.** A poll is deleted through `DeleteMessage`, and takes its
  votes, its pin, and every row about it with it: its pin rows and its
  closing row, tombstoned in the same transaction, oldest first, each on
  the seq after the last (`removeRowsAbout` in `tombstones.go`, over
  `ListLiveRowsAbout` with both kinds). After the commit
  `message_deleted` goes out for the poll and then for each of those
  rows in that order. A closing row is not quiet, so the channel's last
  message is read again once they are gone. Deleting the closing row
  alone is moderation's, as for any system row, and nobody's in a
  conversation; the poll stays closed and takes no vote or second
  close. The retention sweep removes an old poll and leaves its closing
  row with no reference, as it leaves a pin row.
- **Previews.** Wherever a row is shown as one line, a poll reads
  "Poll: " and its question and a closing row "Poll closed: " and the
  question, built from the row's `kind` and `content` (`previewOf`): the
  Activity feed and what push sends (`ListActivity` and
  `GetPendingActivityItem`, which stay column for column the same), the
  live `activity_item_created`, a conversation's line in the list
  (`ListDMLastMessages`), and the excerpt of the message a system row is
  about (a pinned poll's pin row). The question is shown exactly as
  typed: it is not Markdown, so it skips `plainText`, and a token-like
  run in it is not renamed (`typedAsIs`).
- **Search** matches a poll by its question and returns it with its
  votes. Options are not searched, nor the closing row, which only
  repeats the question.
- **What the rows take.** Both refuse what every system row refuses
  (edit, reaction, thread, quote, link preview). The registry's two
  flags set them apart:

  | Kind | `quiet` | `pinnable` | `authorDeletes` |
  | ---- | ------- | ---------- | --------------- |
  | the six housekeeping kinds | yes | no | no |
  | `poll` | no | yes | yes |
  | `poll_closed` | no | no | no |
  | `reminder` ([Reminders](#reminders)) | no | no | yes |

  A poll is pinned by whoever may pin a message, open or closed, in a
  space channel only, and deleted by its author or with
  `messages.moderate`; in a conversation only by its author. A closing
  row is deleted as any system row is. A refused write on a poll says it
  is a poll (`errPollRow`), where every other kind says the row records
  something that happened.

## Reminders

A reminder is a line of text someone asks the server to post in a
channel or conversation at a later time. It waits in its own table,
`reminders`, where nobody else sees it, and at its time a job posts it
as a [system message](#system-messages) of kind 9 (`reminder`) by the
person who set it and deletes the waiting row. The code is
`internal/chat/reminders.go` and `queries/chat/reminders.sql`.

Built: the server side. Web and mobile draw a delivered reminder with
the system row they have (a bell, "Reminder from", the name and the
text); the form that sets one, the notice with Undo and the row's own
look are not built yet.

- **Setting one** (`CreateReminder`). The checks are `CreatePoll`'s, in
  its order: the text and the time first, which cost nothing, then
  `writableChannel`, then the post policy, so whoever may post here may
  set one and nobody else learns the channel exists. The text is one
  line of 1 to 200 characters under a poll question's rules
  (`pollLine`): trimmed, at least one visible character, no control
  character or text direction override. It is plain text, so an `@name`
  in it mentions no one. A person has at most 50 waiting, across every
  channel: the count and the insert run in one transaction under a
  per-person advisory lock (`LockReminderOwner`), so two requests
  cannot both take the last place. Messages have no rate limit, so this
  cap is the table's only bound. The answer is the reminder's id and
  the instant as stored (`remind_at`). Nothing is posted, published or
  marked, and there is no thread field: a reminder is always top-level.
- **When** (`reminder_time.go`). The request says what time is meant
  and the server works out the instant from its own clock; a client
  never sends an instant. A device whose clock is wrong, by minutes or
  by a day, then still sets the reminder its person asked for, and
  "at least a minute ahead" is judged by the one clock that will
  deliver it. The request carries exactly one of:
  - `preset`: `IN_20_MINUTES`, `IN_1_HOUR` or `IN_3_HOURS`, which are
    the server's now plus that wait (a span, so a clock change in
    between moves the reading and not the wait), or `TOMORROW_AT_9`,
    which is 09:00 on the day after today in `time_zone`, today being
    the server's now read in that zone;
  - `local_time`: a reading of the clock in `time_zone` with no offset,
    `2026-12-02T09:00`, as a date-and-time field holds it. Seconds may
    follow and are ignored. It must be at least one minute and at most
    one calendar year ahead by the server's clock.

  `time_zone` is an IANA name (`America/New_York`). `TOMORROW_AT_9` and
  `local_time` need it; the three waits do not use it, but one that is
  sent must still name a zone. `Local` is refused: it would mean the
  server's zone. Where the zone's clock changes there is one rule
  (`wallClock`), the one a browser's `Date` follows, so the web form
  and the server agree: a time the clock skips is read as the clock
  shows it after the change (02:30 on a morning that goes from 02:00 to
  03:00 is 03:30), and a time it shows twice is the first of the two.
  Go's `time.Date` promises neither, so the rule is written out and
  tested. The instant is stored rounded down to the whole minute, as a
  `timestamptz`; neither the zone nor the preset is stored, so a
  reminder does not move if the zone's rules change later. The zone
  database is in the binary (`time/tzdata`), so a host with none still
  knows every zone.

  | Refused | Code |
  | ------- | ---- |
  | no text, too long, a line break, a control character, a direction override, nothing visible | `InvalidArgument` |
  | neither `preset` nor `local_time`, or both; a preset the server does not know | `InvalidArgument` |
  | no `time_zone` where one is needed; a zone the server does not know | `InvalidArgument` |
  | a `local_time` that is not `YYYY-MM-DDTHH:MM`, or names no real date and time | `InvalidArgument` |
  | a `local_time` less than a minute ahead, or more than a year ahead | `InvalidArgument` |
  | 50 already waiting | `ResourceExhausted` |
  | not in the space, an announcement channel, a block in a direct message, a token without the grant or out of bounds | `PermissionDenied` |
  | a private channel the caller is not in, a hidden voice channel, no such channel | `NotFound` |

- **Taking one back** (`DeleteReminder(id)`). It deletes a waiting
  reminder of the caller's own and nothing else: someone else's, an id
  that names none and one already posted are all `NotFound`, and so is
  one in a channel a bounded token does not reach. It asks nothing of
  the channel, so someone who has since left it still takes theirs
  back. There is no list of waiting reminders (`ListReminders` does not
  exist): the app's notice with Undo is the one way to it, and the
  table keeps what a list would need. A reminder already posted is
  deleted as a message is.
- **Delivery** (`DeliverReminders`, the `deliver_reminders` job every 30
  seconds, [runtime.md](runtime.md#background-work)). A run reads the
  reminders due now without locking them, oldest first and at most 500,
  and takes each in turn:
  1. The person is looked up through `UserDirectory`, and an identity
     is built for them as a session of theirs would carry it, so that
     `writableChannel` and `requirePostPolicy` read them as the caller
     with nothing changed: space membership, private channels,
     conversations, blocks, announcement mode and bots are the checks a
     send meets. A job has no caller of its own. An account that is
     gone, deleted or deactivated posts nothing; a deleted person stays
     a participant of their conversations, and a deactivated one a
     member of their spaces, so neither is caught by the other checks.
  2. One transaction locks the channel row and only then claims the
     reminder with `DELETE ... RETURNING` (`ClaimReminder`). The order
     is `seq.go`'s rule and matters here: a channel delete holds the
     channel and cascades into `reminders`, so taking the reminder
     first would deadlock with it. No channel means its delete took the
     reminder with it; no row back means an Undo or another dispatcher
     got there first. Either way there is nothing to do.
  3. A reminder whose person was refused in step 1 is dropped: the
     claim commits and nothing is posted. Otherwise the transaction
     asks once more, under the lock, that the person can still read the
     channel (one statement, for a removal that landed since step 1),
     reads the channel's people, and records the row (`recordEvent`).
  4. After the commit a closed conversation is put back on its lists
     (`reopenDM`), the row goes out as `message_created`, and in a
     direct message or group conversation the other participants get
     the `dm` activity item a message would give them
     (`recordActivity`), as for a poll.

  Step 1 runs before the transaction, as a request's checks do, because
  it reads through the pool and the ports: a transaction that held the
  channel row while it waited for a second connection would stall
  behind the senders waiting for that row. So a removal between step 1
  and the lock is caught only by step 3's one question; a change of
  announcement mode or a block in that window still posts.
- **Dropped or kept.** A reminder is dropped, with no word to anyone,
  only when the refusal is the person's standing: `NotFound`,
  `PermissionDenied` or `FailedPrecondition` from the checks above
  (left or removed, a private channel they are no longer in, an
  announcement channel, a block, the account deleted or deactivated, a
  voice channel's chat while voice is off). Any other error is taken to
  be passing: the transaction rolls back, the reminder stays and the
  next run takes it again. A failure is logged and the run goes on to
  the next reminder, then ends in an error naming how many failed, so
  it shows on the Diagnostics tab. Someone removed and added back
  before the time gets their reminder.
- **Timing.** A reminder is never early. Normally it is posted within
  one interval (30 seconds) plus the dispatcher's poll (`STOOP_JOBS_POLL`,
  2 seconds) of its minute beginning. Three cases are later. On a fresh
  install the job's first run is two minutes after the server first
  started, since a new schedule row is due then. If the dispatcher was
  not running at the time (the server down, or `STOOP_JOBS=external`
  with no `stoop jobs`), it is posted once one runs. And if the
  dispatcher is killed in the middle of a run, no new run starts until
  that run's lease lapses, 10 minutes by default
  ([runtime.md](runtime.md#background-work)). A run that finds more
  than 500 due leaves the rest for the next.
- **Who is told.** In a channel it is the channel's last message and is
  unread for everyone, and alerts nobody. In a conversation it reopens
  it and alerts the others. Nobody's read marker moves, the person's
  own included: they are not at the keyboard, and marking the channel
  read for them would pass over messages they have not seen. So the row
  is unread for the person who set it as it is for anyone, and both apps
  agree with the server: a delivered reminder is not the reader's own
  send (`isOwnSend` in `core/unreads.ts`, the one question every such
  place asks). Live, it counts as unread for them and leaves their
  marker alone unless they are looking at the channel, in which case it
  is read as it lands and the server is told, as for anyone's row; the
  "New messages" line can sit above it; and it reads none of their
  activity. That unread mark is all the notice they get: no activity
  item is written for them, it is never an alert (`addressesMe`), and
  nothing is pushed. In a conversation the unread conversation counts
  once on their badge total, as any unread conversation does. The list
  does not follow it to the bottom as it follows their send
  (`isOwnPost`).
- **The row.** `content` is the text and `data` is `{}`: the event type
  keeps the text out of its JSON (`json:"-"`) and hands it to `content`,
  as a pin keeps its message in `reference_message_id`. On the wire the
  event is `Reminder {}`; a client reads the text from `Message.content`
  and the person from `Message.author`, and shows the text as typed: it
  is not Markdown and a token-like run in it is nobody's mention.
- **Previews** read "Reminder: " and the text, exactly as typed
  (`previewOf`, `typedAsIs`), wherever a poll's are worded: the Activity
  feed and push, the live `activity_item_created` and a conversation's
  line in the list.
- **Search** finds a delivered reminder by its text.
- **What the row takes.** It refuses what every system row refuses
  (edit, reaction, thread, quote, link preview) and cannot be pinned.
  Its author deletes it, and so does `messages.moderate` in a space; in
  a conversation its author alone.
- **Deleting the channel** deletes its waiting reminders (the foreign
  key cascades). Leaving a space or a channel deletes none: they are
  dropped at their time unless the person is back by then.
- **Rollback.** A server rolled back past this leaves kind 9 rows in
  `messages`, which it sends as an event with no case, and both apps
  ask the reader to update. Migration 00079's Down takes the waiting
  reminders with the table.

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
  reactions, attachments, mentions, link rows, pin, activity items and,
  for a poll, votes are
  deleted with it, and its pin rows and a poll's closing row become
  tombstones too ([System messages](#system-messages) → Pins,
  [Polls](#polls) → Deleting), the files through the
  `FileDirectory` port once the transaction has committed. The row is stamped like any other write, so
  the channel log carries the delete. Nobody is shown it afterwards — not
  the channel or thread pages, `around_id`, search, pins or the channel's
  newest message — except a root whose thread still has live replies,
  which the channel shows as a placeholder ([Threads](#threads)); any
  other tombstone answers every RPC as a message that does not exist.
  Clients hear `MessageDeleted`, carrying the tombstone's `seq`, where a
  row used to vanish, and `MessageUpdated` with `deleted` set for a
  placeholder; the events keep their kinds because outgoing webhooks
  forward them ([realtime.md](realtime.md#serverevent),
  [channel-log.md](channel-log.md)). Only the
  retention sweep hard-deletes message rows. `messages.moderate` covers
  other people's; your own are always yours, except a
  [system message](#system-messages), which only `messages.moderate`
  deletes, whoever caused it, unless it is a [poll](#polls).
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
  thread root), under a new id each time so the thread sorts to the top;
  a client coalesces them by thread root, not by id. A `thread_reply`
  item is a thread's unread signal, not
  something addressed to you, so a thread mute stops it; a mention or a
  quote-reply in a muted thread is still written, marked muted, as in a
  muted channel. It lights the activity pill and the summary's "new"
  count but no red badge on the channel or space, whose `alert_count`
  counts what is addressed to you; a mention in a thread, or a reply to
  your message there, still does until the thread is read. Activity items and
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
  a quote of it reads like a quote of a deleted message. Each handler
  checks that before its transaction, and a delete can commit in
  between, which no foreign key stops now that a delete is a tombstone:
  so a reply's send and a pin read the row again once they hold the
  channel row (`liveMessage` in `chat/tombstones.go`) and refuse the
  same way, spending no seq; a thread mute is written only for a root
  still shown and `ListThreadMutes` lists only those; and the activity
  inserts write nothing for a message that is a tombstone by the time
  the send records them. When its last
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
it. A conversation's `alert_count` is always 0 ([Alert
counts](#alert-counts)): every message there is addressed to the reader,
so `unread_count` is the number. It deliberately does *not* come from the
activity feed: a conversation holds one unread feed entry however many
messages arrive — `recordDM` refreshes it rather than adding rows — so
the feed counts conversations, and two identical-looking pills would
disagree in plain sight.

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

The phone draws the cards as web's row does
(`mobile/src/components/LinkPreviews/`), under the words and the files
and not on the menu's card, by rules shared in `core/linkPreviews.ts`,
which web's `LinkPreviews` uses too: which cards show (`shownPreviews`:
the server's, in the message's order, less a link to a message on this
server), a card's shape (`previewShape`: the image alone when there is
no title, landscape from 1.3 times wider than tall) and its first line
(`previewSite`: the site's name, else the host without `www.`). A
browser sizes the image from the file; React Native needs the size up
front, so `layout.ts` works it out from the size the server measured,
as a browser lays out `link-previews.css`, and an image the server gave
no size for is the thumbnail. The card is one link element, a tap opens
the address, a long press is the row's, and the × shows without a hover
for whoever may remove the card, behind the system's confirm.

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
them. The phone draws no card for such a link and shows the address as
written, opening in the browser; reading it as who said it and where
waits on the channel screen landing on a message (STOOP-520).

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
