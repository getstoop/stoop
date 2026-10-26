# Mention autocomplete in the phone composer

Status: approved 2026-10-26 (placement, raw tokens in the field, the @
button, handles typed in full become tokens on send, scope, the split).
Follows [mobile-markdown.md](mobile-markdown.md) and
[mobile-attachments-inline.md](mobile-attachments-inline.md) in the
timeline parity order; the native rich text editor comes next, as its
own proposal, and will redo how the field shows a mention.
Design: canvas artboards "8e · Channel, mentioning (iOS)" and
"8e · Channel, mentioning (Android)", at the end of the "On a server"
row, each with a `state` toggle: typing @, typing #, picked.

## Scope

Typing `@` or `#` in the channel and thread composer suggests who or
what to name, as web's composer does, and a pick puts the mention in
the field. A message sent from the phone mentions the people it names.

- People, groups, `@channel` and `@here`, and `#channels`, with web's
  rules for which are offered where (`core/mentions.ts`).
- A pick puts the stored form in the field: the token itself
  (`<@u:ID:handle>`, `<@g:ID:handle>`, `<#ID:name>`), or the words
  `@channel` / `@here`.
- On send, a `@handle` or `#name` typed in full that exactly one person,
  group or channel has becomes its token, as web's editor does.

Out of scope: drawing a mention as a mention in the field (the rich
editor), guards for editing inside a token, edit mode (unchanged), emoji
`:shortcode` suggestions, ranking candidates, presence in the list,
hardware-keyboard navigation, direct messages (the phone has none). See
Later.

## What exists

- **The wire.** Only a token mentions anyone; `@ada` as text reaches
  nobody. The server keeps a person token only when that person can read
  the channel, group tokens and channel links only in public channels,
  and saves any other token, or one in code, a spoiler or a link's
  words, as text. It rewrites a kept token's handle to the current one
  ([messaging.md → Mentions](../architecture/messaging.md#mentions)).
- **Web.** `core/mentions.ts` (shared with the phone): `mentionQueryAt`
  and `channelQueryAt` find the query at the caret; `mentionCandidates`
  lists `@channel`/`@here` (when `canMentionEntireChannel`), then groups,
  then people, by prefix of handle or name, eight at most;
  `channelCandidates` the space's linkable channels; `candidateMention`
  the reference a pick makes; `soleMention` and `soleChannel` the one
  person, group or channel a handle typed in full names.
  `components/MentionPicker.tsx` draws the list over the composer;
  `components/RichEditor/mentions.ts` turns a pick into a pill and a
  handle typed in full into one (`settleMentions`; `TYPED_HANDLE`,
  `TYPED_CHANNEL`, `ADDRESS`).
- **The phone composer** (`mobile/src/screens/Channel/Composer.tsx`) is
  a plain `TextInput` that tracks no caret. A new message is sent as
  typed, so **a message written on the phone mentions nobody today**.
  Edit mode shows tokens as `@handle` and restores them on save
  (`core/editableText`).
- **The phone's data.** `loadHeader` (`mobile/src/api/messages.ts`)
  calls `ListMembers` (public channel) or `ListChannelMembers` (private)
  and keeps only the count. The header holds the space with
  `myPermissions` and the linkable channels, kept current by channel
  events (`core/channelHeader.ts`). Groups are not loaded. The channel
  and its threads share one engine (`channelEngine.ts`), so both
  composers can read what it holds.

## Design

The artboards show it; in words:

- **Where.** A panel floating 8pt above the composer card, the card's
  width, in the card's surface: Liquid Glass on iOS 26, the theme's
  panel, border and light shadow on Android. It covers the timeline and
  moves nothing. It is as tall as its rows, up to about four and a half
  (so a cut-off row says it scrolls), and scrolls to the eighth.
- **Rows**, 52pt, web's order and words. A person: avatar (32), display
  name, `@username` muted. A group: a people mark, the name and its count
  ("Organisers (3)"), `@handle`. `@channel` / `@here`: an `@` mark, the
  word, "Everyone in this channel" / "Everyone online in this channel".
  A channel: a `#` mark, the name, its topic. No row is preselected:
  Return adds a line, as it does now, and only a tap picks.
- **When.** Open while the caret ends a query (`@`, `@pr`, `#re`), with
  at least one candidate. Closed when the caret leaves the query, a
  character ends it, nothing matches, the field loses focus, or a pick
  is made. `#` only where channels can be linked (a public channel).
- **The @ button**, in the card's toolbar right after Aa (40pt round,
  like Aa; "Mention someone"), types `@` at the caret, with a space
  before it when the character before is a letter or digit, so the
  query counts. The list then opens as if the `@` had been typed; the
  field keeps focus and the keyboard stays up. It is in the card only
  (the resting pill has no toolbar), editing included.
- **A pick** replaces the query (from its `@` or `#` to the caret) with
  the token, or `@channel ` / `@here `, then a space, and puts the caret
  after it. The field shows the token as it is stored
  (`<@u:6f1c…:priya>`); looking like a mention waits for the rich
  editor.
- **Screen readers.** Each row is a button labelled with what it shows
  ("Priya Shah, at priya"; "Organisers, 3 people, at organisers";
  "channel reading-list"). Opening the list announces how many
  suggestions there are (`announceForAccessibility`, on both).
- **Threads** use the same composer, so the same list.
- **Editing** keeps its behaviour. The list works in the field there
  too, and a pick inserts a token beside the `@handle` words edit mode
  shows; Save is unchanged.

## Tech

### On send: handles typed in full become tokens

A pure function in core, beside the helpers web already uses:

```ts
// The text with each @handle or #name typed in full that exactly one
// person, group or linkable channel has written as its token.
withTypedMentions(text, { members, groups, channels }): string
```

- Matches web's typed-in-full rule: `TYPED_HANDLE` and `TYPED_CHANNEL`
  move from `web/src/components/RichEditor/mentions.ts` to core with
  `ADDRESS`, and web imports them from there (no change to web's
  behaviour). On send everything is typed in full, so the end of the
  text counts.
- Skips: tokens already in the text (a pick's), anything inside a web
  address, `@channel` and `@here`, and a handle that a person and a
  group share (`soleMention` gives null; it stays words, as on web).
- Doesn't parse Markdown: a token in code, a spoiler or a link's words
  is saved as text by the server, the same outcome as web's editor not
  making one there.
- Tests in core beside `mentions.test.ts`: a person, a group, a channel,
  a shared handle, an unknown handle, `@channel`, inside an address,
  beside a picked token, handle case, punctuation after a handle, a
  handle at the end.

The composer calls it on the trimmed draft for a new message (channel
and thread), not on Save.

### The mention data, held by the channel engine

Loaded with the header, so the list is ready at the first `@`:

- **People.** `ListMembers` always (names, avatars). In a private
  channel `ListChannelMembers` as well, and only its people are offered
  (web offers the whole space there, and a pick of someone outside
  becomes text on the server; Later).
- **Groups.** `ListGroups`, offered in public channels only.
- **Channels.** The header's linkable channels, already held; offered
  in public channels only, as web's `useLinkableChannels`.
- **`@channel` / `@here`.** `canMentionEntireChannel(header.space)`.

The members and groups ride in the header (`ChannelHeader.members`,
`.groups`; `headerMentionNames` gives the composer what it may name).
These events carry only IDs, so the header is loaded again for them
(`changesMentionNames`): `memberJoined`, `memberUpdated`,
`memberRemoved` and `groupsChanged` in the space, and
`channelMemberJoined` / `channelMemberLeft` for this channel when it is
private. A burst of events loads it once more after the load out, not
once each; they are rare. A reconnect already loads the header again.
The header's own count keeps its event patching (`withHeaderEvent`).

In step 2 the composer is also told `channelAndHere`, the rest of web's
`MentionContext`, and runs `mentionCandidates` /
`channelCandidates` on it.

### The field

- `onSelectionChange` tracks the caret; the query is
  `mentionQueryAt(draft, caret) ?? channelQueryAt(draft, caret)` (the
  latter only with linkable channels), worked out from the newest text
  and caret together, since the two events arrive in either order.
- A pick sets the text and a controlled `selection` once, then lets the
  field own the caret again. The risk is iOS: a programmatic change
  against autocorrect's pending word, and the caret landing. The first
  Maestro flow proves both before the rest is built.
- The panel is a sibling above the card in `ComposerDock`, so it rides
  the keyboard with it; it is laid out from the card's measured height.
  The composer hands it to the dock through a context
  (`composerAbove.ts`): drawn inside the card's own view it would sit
  outside that view's bounds, where Android delivers no taps.
- New files: `screens/Channel/MentionList.tsx` (the panel and rows),
  `screens/Channel/useMentionQuery.tsx` (caret, query, candidates, pick),
  `screens/Channel/Surface.tsx` (the card's glass or panel, now shared),
  `core/mentionPicks.ts` (what a pick and the @ button write).

## Split

Two pull requests off main, the second stacked on the first if you want
both open together.

1. **Typed mentions on send, and the data.** Core `withTypedMentions`
   with tests; the regexes shared with web; the channel engine loads
   members, channel people and groups and keeps them fresh; the composer
   converts a new message's handles on send. Visible result: "@dee hi"
   sent from the phone mentions dee. Maestro: a flow sends a typed
   handle and a script reads the message back over RPC to check it is
   stored as a token. Carries this spec.
2. **The list.** Caret tracking, the panel and rows, picks for all four
   kinds, the @ button, screen reader labels and the announcement.
   Maestro: `@` opens the list, so does the @ button, a typed prefix narrows it, a pick puts the token in the
   field and the sent message mentions; `#` lists channels and a pick
   links one. Unit tests for anything pure added to core. iOS
   simulator verified; Android drawn but unverified on a device, as
   before.

Each: fresh-agent review before it opens; new tests and Maestro
assertions shown to fail without the change; single flows only, the
whole suite once at the end with your OK.

## Decisions

- 2026-10-26: the list floats above the composer card, not in a sheet
  or inside the card.
- 2026-10-26: a pick puts the raw token in the plain field; how a
  mention looks in the field is the rich editor's job.
- 2026-10-26: edit mode stays as it is.
- 2026-10-26: a handle typed in full with one owner becomes a token on
  send (web's rule).
- 2026-10-26: no guards for editing inside a token; the rich editor will
  change that behaviour anyway.
- 2026-10-26: all four kinds in this step.
- 2026-10-26: an @ button after Aa types `@` at the caret, which opens
  the list.

## Later

- The rich editor: mentions as pills in the field, a token edited as one
  unit, edit mode without `editableText`.
- Web offering only a private channel's people, as the phone will.
- Emoji `:shortcode` suggestions in the same panel.
- Presence in the rows (the phone holds no one else's presence yet).
- Ranking candidates (recent authors, people in the thread).
- A pick while editing: Save restores the original's tokens by position
  (`withTokensRestored`), so a picked token placed before an original
  `@handle` of the same name can leave that one as words. Rare; the rich
  editor drops the restore.
- Timeline mentions drawn with the current handle (`currentHandle`) now
  that the phone holds members and groups.
