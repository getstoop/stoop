# The phone's rich text composer

Status: approved 2026-10-26 (scope, design, the native editor, the
split; Decisions). The last step of the timeline parity order, after
[mobile-mentions.md](mobile-mentions.md). Design: canvas artboards
"8f · …" (Design → Artboards).

## Scope

The channel and thread composer becomes a rich text field: what you
write looks as it will be sent, and the markers never show. Markdown is
still what is sent and what an edit loads, so nothing changes on the
wire or on the server.

- Inline: bold, italic, underline, strike, inline code, spoiler, link.
- Blocks: quote, code block, bulleted and numbered lists (four levels).
- Mentions and channel links as pills in the field, a pill one unit.
- The format row (Aa) does what its buttons say, and shows what is on
  at the caret.
- Format as you type: `**x**`, `*x*`, `__x__`, `~~x~~`, `||x||`,
  `` `x` ``, `[words](https://…)`, and at a line's start `> `, `- `,
  `* `, `1. `, ```` ``` ````.
- Edit mode loads the message as rich text and saves Markdown.
- Paste reads plain text as Markdown; Copy and Cut give Markdown.

Out of scope: a web view or ProseMirror on the phone, rich (styled)
paste from other apps, pasting images as attachments, emoji
`:shortcode` suggestions, a character counter, code block languages
(kept when loaded, not offered). See Later.

## What exists

- **The composer** (`mobile/src/screens/Channel/Composer.tsx`): a plain
  `TextInput`, the draft a string in React state. Aa opens `FormatRow`,
  web's eleven buttons in web's order, which do nothing yet. A mention
  pick puts the raw token in the field (`useMentionQuery`,
  `core/mentionPicks`); on send `withTypedMentions` makes handles typed
  in full into tokens. Edit mode shows tokens as `@handle`
  (`core/editableText`, used by the phone only) and puts them back on
  Save (`withTokensRestored`). The field unmounts when the card goes
  back to the pill; the draft is kept as text.
- **The native text module** (`mobile/modules/stoop-rich-text`): draws a
  message's paragraph, never edits. iOS: an `NSLayoutManager` subclass
  (TextKit 1) drawing pill, code and spoiler fills. Android: a
  `StaticLayout` with spans. Runs are built in JS from the parser's tree
  (`components/MessageBody/native.ts`), styled from web's `--md-*`
  values (`theme` → `markdown`).
- **Web's editor** (`web/src/components/RichEditor/`), the behaviour to
  match:
  - `schema.ts`: the format and nothing more. Paragraphs; a quote holds
    lines; a list item a line and maybe a nested list; a code block
    plain text; marks link, spoiler, bold, italic, underline, strike,
    code; a mention an atom.
  - `markdown.ts`: `toMarkdown` / `fromMarkdown` between that document's
    JSON and Markdown (mark order, escaping, code that can't hold a
    backtick, bare addresses), tested in `markdown.test.ts`. Pure; its
    only ProseMirror tie is the JSON shape.
  - `plugins.ts`, `commands.ts`: the input rules above; Return (next
    item, out of an empty item or quote, out of a code block on a blank
    last line); Tab and Shift-Tab to four levels; backspace right after
    a rule undoes it; paste as Markdown; an address pasted over words
    links them; bare addresses styled; 4000 written characters at most;
    a partly styled selection is styled everywhere by a toggle.
  - `links.ts`: `checkLink` is pure; the rest works on ProseMirror
    state. `mentions.ts`: `settleMentions` makes a handle typed in full
    a pill as the word ends.
- **Core** (`web/src/core`, `@stoop/core` on the phone): the parser,
  `mentions.ts` (queries, candidates, tokens, `writtenLength`,
  `TYPED_HANDLE`), `unsent.ts` (`restoreDraft`).

## What is shared with the server

What can be shared with the server rather than written again? The
editor needs nothing from the server that it doesn't
already have, and no server change: the wire stays Markdown. What the
server and the clients do share today, and where the editor touches it:

- **The parser.** `internal/chat/markdown.go` is web's parser ported to
  Go for previews, link extraction and the mention check; the two test
  files carry the same cases, copied by hand. Go can't run in the app,
  so the code can't be shared, but the cases can: one file of cases
  (Markdown in, parse or plain text out) read by both `go test` and
  vitest, where today each side keeps its own copy. The editor adds
  round-trip cases to the same idea: what `toMarkdown` writes, the
  server reads as the same pills, links and text. Part of this work,
  as its first step (Split → 0).
- **The length limit.** The server's `maxMessageLen = 4000`
  (`internal/chat/messages.go`) counts `writtenLength` in runes (code
  points). Web hard-codes 4000 in `plugins.ts`; the phone checks
  nothing. Core's `writtenLength` counts UTF-16 units, so an emoji
  counts twice on the client: the client is stricter than the server,
  never looser. Proposed: the limit as one constant in core beside
  `writtenLength`, which counts code points as the server does; web and
  the phone read it there. It stays a constant, not an instance
  setting, since the server's is.
- **Tokens.** The grammar (`tokenLength` in Go, the regexes in core) is
  already tested on both sides; the shared case file would carry it too.
- **Blank.** Core's `isBlankMessage` is "plain text empty" (so `|| ||`
  is blank); the server refuses only whitespace. The client is stricter
  again; left as is, noted for the case file.

So: no new server code, one shared case file, one shared constant.

## Design

The editor is the composer card's field; everything else in the card
(reply strip, editing strip, attachments, Also send, buttons, the
mention list) is unchanged.

### Formatting

- **A toggle with a selection** styles it, or unstyles it when all of it
  is styled already (web's rule). Without one it changes what typing
  carries, until toggled again or the caret moves.
- **The row shows what is on**: a button is pressed while its format is
  in effect at the caret, or over all of the selection.
- **Edges**: typing at the end of styled words continues the style;
  typing at the end of a link does not.
- **Inline code** holds no other mark and no pill: a pill inside it
  reads as its words, as on web.
- **Spoilers** show their words in the field over a hatched fill
  (diagonal stripes of the raised colour), so they read apart from
  inline code; never covered. Web's editor uses a plain raised fill
  (`.rich-spoiler`); the phone differs on purpose (Later). Artboard.
- **Quote, code block, lists** act on the caret's line or every line
  the selection touches. A code block's text has no marks and no pills;
  autocorrect, smart quotes and smart dashes are off inside it.
- **Lists**: the row's Bulleted and Numbered buttons, `- `, `* `, `1. `
  and `1) ` at a line's start. Return adds the next item; Return on an
  empty item leaves the list (or goes up a level). Backspace at an
  item's start makes it a plain line. Numbers renumber themselves.
  Indent and outdent: two buttons at the start of the format row, shown
  only while the caret is in a list (Artboard); Tab and Shift-Tab on a
  hardware keyboard. Four levels, as the format reads.
- **Quote**: Return on an empty quote line leaves the quote. Backspace
  at a quote line's start makes it a plain line.
- **Code block**: Return adds a line; Return on a blank last line leaves
  the block. A line of only ```` ``` ```` inside one would end the
  block when read back: the format has no longer fence to write around
  it (web's editor shares the limit). Step 6 decides what the field
  does with one (Later).
- **Format as you type**: the rules in Scope, as web's. Backspace
  straight after one puts the markers back. None fire inside a code
  block, and none while the keyboard is composing a word (CJK, Android's
  underlined word, dictation).
- **Hardware keyboard**: ⌘B, ⌘I, ⌘U, ⌘K (link), Tab, Shift-Tab. Return
  still adds a line.

### Links

- The row's Link button, or ⌘K, opens the link dialog: Text and Address,
  web's checks (`checkLink`) and wording, Save, and Remove when editing.
  With words selected the dialog opens with them; with the caret in a
  link, with that link. Artboard.
- A tap on a link in the field puts the caret there (it never opens);
  the Link button then shows pressed and edits it.
- An address pasted over selected words links them.
- A bare address is styled as a link and stays text (the format links
  it).

### Mentions

- A pick (list or @ button) puts a pill, then a space. A `@handle` or
  `#name` typed in full that exactly one person, group or channel has
  becomes a pill as the word ends (web's `settleMentions`), and on send
  (as now).
- A pill is one character to the field: the caret can't go inside,
  backspace deletes it whole, a selection takes it whole. A screen
  reader reads its words.
- Pills look as they do in the timeline (the accent-soft fill).

### Editing a message

The message loads through `fromMarkdown`: pills, lists, quotes, code
blocks (with their language, kept). Save writes `toMarkdown`. "Nothing
changed, nothing sent" compares the saved Markdown with the message's
content read back the same way (`toMarkdown(fromMarkdown(content))`),
since the two can differ in form while meaning the same. `editableText`
and `withTokensRestored` go (the phone was their only user).

### The draft

- The draft is held as Markdown, as the composer holds a string now.
  Closing the card unmounts the field; opening it loads the Markdown
  again. What typing would carry (a toggled mark at the caret) is not
  kept across that.
- The pill shows the draft as plain text (`plainText`), never markers.
- A refused send puts its words back ahead of anything typed since
  (`restoreDraft`, which joins with a new line). `toMarkdown` closes
  every block it opens (a fence always has its closing line), so two
  drafts joined by a line read back as the two.
- Over 4000 written characters: Send dims and a line under the field
  says how many over, as the error line does. No keystroke is refused.

### Paste, copy

- **Paste** takes the clipboard's plain text and reads it as Markdown:
  a message's source pastes back formatted; `@handle`s with one owner
  become pills. Pasted into a code block it stays literal. Styled text
  from other apps comes in as its plain text (Later). One line merges
  into the line it lands in.
- **Copy and Cut** put Markdown on the clipboard, pills as their words
  (`@priya`, `#reading-list`), not tokens, which would read as noise in
  another app. Pasted back, the words become pills again.

### Screen readers

- The field reads its words; pills as their words.
- A toggle announces the change ("Bold, on"); the row's buttons keep
  their pressed state.
- Formats at the caret are not read out on every move (later, if asked).

### Artboards

On the canvas after the mentioning ones, iOS and Android each, with a
theme toggle:

- **"8f · Channel, formatting"**, a `state` toggle: *inline* (bold
  at the caret, Bold pressed; strike, italic, inline code, underline,
  a spoiler, a link, a pill), *in a list* (a nested item, Bulleted
  pressed, Outdent and Indent at the row's start), *in a code block*
  (a quote above, the caret in the block, Code block pressed, the
  inline formats dimmed). The spoiler is hatched (a `spoiler` toggle
  still shows web's plain fill beside it).
- **"8f · Link dialog"**, iOS and Android, a `state` toggle: new,
  editing (with Remove), address refused (web's wording). A dialog on
  both, each in its platform's form: iOS Cancel and Save side by side
  under the fields, Remove link a row above them; Android Remove at the
  left of its buttons.

## Tech

### Native owns the text

A new native view in `stoop-rich-text`, `StoopRichEditor`: a
`UITextView` subclass on iOS, built on TextKit 1 (`usingTextLayoutManager:
false`, iOS 16+) so the fills and block decorations reuse
`RichLayoutManager`'s drawing; an `AppCompatEditText` on Android, spans
as in `RichSpans.kt`.

The view holds the text and its styles. Each keystroke stays native and
never waits on JS: autocorrect, predictive text, swipe typing,
dictation, CJK composition, the selection handles and the system text
menu behave as in any app. JS never sets the text while you type (the
mentions work showed what that costs: iOS moved the caret).

What crosses, all offsets in UTF-16 units (JS, `NSString` and Java
strings share them):

- **Props**: placeholder, theme values (the `markdown` export, as the
  timeline uses), editable, and the names a handle typed in full may
  become a pill for (people, groups, channels), as the composer holds
  them now.
- **Events from the view**: `onChange` (the document as lines, below,
  the caret, and the text before the caret for
  the mention list), `onSelection` (caret, active formats),
  `onHeight` (content height: the card grows to six lines, then the
  field scrolls), `onPaste` (the clipboard's plain text and the range
  it replaces), `onCopy` (the range, and whether it was Cut), focus and
  blur.
- **Commands to the view**: `load(lines)`, `format(name)`,
  `insertMention(ref)`, `setLink(text, href)`, `insertLines(lines)`,
  `focus`, `blur`, `commitPending` (apply a pending autocorrection
  before Send reads the document).

### The document as lines

```ts
type EditorLine = {
  block: "paragraph" | "quote" | "bullet" | "ordered" | "code";
  depth: number; // lists, 0–3
  group: number; // lines of one code block share it
  lang?: string; // a code block's
  runs: EditorRun[];
};
type EditorRun =
  | { text: string; marks: Mark[]; href?: string }
  | { mention: MentionRef; marks: Mark[] };
```

A native paragraph is one line; each carries its block in a paragraph
attribute (iOS) or span (Android), each run its marks. Core converts
lines to and from web's document JSON (`linesToDoc`, `docToLines`), so
`toMarkdown` and `fromMarkdown` are web's, unchanged, moved to core with
their tests. A pill is its words (`@priya`) carrying the mention as an
attribute (iOS) or span (Android): drawn as a pill by the same drawing
as inline code, read by a screen reader as the words it shows, and
kept one unit by the view (the caret steps over it, a backspace takes
it whole; step 4). A character standing in for it (U+FFFC with a drawn
attachment) was the first idea; words keep the screen reader, copy and
the caret's geometry right with no drawing of our own.

The field joins React Native's focus registry while it is focused
(`fieldFocus.ts`), so a tap on the timeline, a drag, or
`Keyboard.dismiss()` puts it away as it would a `TextInput`.

### Where each behaviour lives

All editing behaviour is native, in Swift and in Kotlin, rather than
shared in TypeScript: it should change little once built, nothing then
waits on JS, and native CI is planned (Decisions).

- **Native, both platforms**: the format row's toggles (marks over a
  selection or at the caret, quote, lists, code block, indent and
  outdent), what typing carries, format as you type and its undo by
  backspace, Return and Backspace in lists, quotes and code blocks,
  renumbering, pills as one unit and a typed-in-full handle becoming
  one (from the names the composer passes in), no autocorrect in code,
  a link over a range, an address pasted over words, bare addresses
  styled, undo (iOS; Android has no system undo).
- **JS asks, native does**: a toolbar tap sends `format(name)`; a
  mention pick `insertMention(ref)`; the link dialog `setLink(text,
  href)` over the range it opened with. The view acts on its own text
  and selection as they are when the command lands, so nothing is
  worked out against a stale copy.
- **Markdown stays in core**, at the edges, where nothing races typing:
  loading a draft or an edit (`fromMarkdown` → `load(lines)`), the
  draft and Send (`onChange` lines → `toMarkdown`), Copy and Cut (the
  view hands JS the range; JS writes Markdown with `expo-clipboard`,
  already a dependency), and paste (the view hands JS the clipboard's
  text and holds the range; JS answers `insertLines(lines)`, a frame or
  two after the tap). One Markdown reader and writer, shared with web
  and checked against the server's cases (Split → 0); moving it native
  would add a Swift and a Kotlin parser to the Go and TypeScript ones.

### How the native half is organised

The text view's own attributed text is the document. Each character
carries its meaning as attributes: its marks (bits), a link's address,
the mention a pill names, and its line's block; the look (fonts,
colours, fills, indents) is worked out from those by a styler and never
read back. One feature owns each attribute and every rule about it, in
one file of the same name on each platform, with the same functions in
the same order, so the two can be read side by side:

- **Document** (`EditorDocument`): the plain line model JS hands over
  and reads back, the line walking everything else uses, the order the
  invariants run in after an edit (`settle`), the formats at the caret
  for the row, the text before the caret for the mention list.
- **Marks** (`EditorMarks`): the bits, what typing carries, the marks
  common to a selection, the parts of a range a mark can go on (words,
  not code blocks), a toggle by web's rule, the marker pairs typed
  around words, and the look each mark asks for.
- **Links** (`EditorLinks`): the link around a caret or selection, what
  the dialog opens with and what Save and Remove do, an address the
  format reads whole, bare addresses, `[words](https://…)` typed in
  full.
- **Mentions** (`EditorMentions`): the pill around a position, a range
  grown to whole pills, where a selection's edge rests, a pill whose
  words changed becoming words, the text with pills masked.
- **Blocks** (`EditorBlocks`): the lines a selection touches, set,
  toggle, lists and their levels, Return and Backspace at a block's
  edge, the markers typed at a line's start, the invariants (one block
  per line, code lines plain, levels in step, the holder below), and
  what each block draws (which lines share a box or a bar, each item's
  marker).
- **Input rules** (`EditorInputRules`): the dispatch after a typed
  character (blocks, then a link, then a marker pair) and the backspace
  that puts the markers back.
- **Clipboard** (`EditorClipboard`): what a paste does, where pasted
  lines land, what Copy hands over.

These files import Foundation (`android.text`) only, so they run as
unit tests without a simulator: `swift test` in the module on a Mac
(`Package.swift`), and Robolectric on Android (`./gradlew
:stoop-rich-text:testDebugUnitTest`). The tests are a few cases per
feature, each a behaviour the composer shows; the Maestro flows check
the same from the outside.

Around them, the platform layer: the records that cross the bridge
(`EditorRecords`), the styler that draws each feature's look
(`EditorStyler`), the decorations under the words (`EditorDecorations`),
the text view subclass that takes paste, copy and the hardware keys
(`EditorTextView` / `EditorText`), and the view itself
(`RichEditorView`), which is wiring: what the text view reports comes
in, a feature decides, the edit is made there, and the events go out.

Cross-feature rules live with the feature that owns the constraint and
are called by name: a code block strips marks, links and pills (Blocks);
a link strips pills (Links). "A code block holds plain text" is written
once per platform.

**The holder.** An empty line at the end of the text has no character
to carry its block, and neither platform can indent one: Android's
layout ignores paragraph spans on a zero-length last line, so the caret
sat at the margin while typed words landed at the indent, and iOS could
not draw a block on an empty field. So an empty last line in a block
holds one zero-width space (U+200B), and only that: it carries the
block, is never shown, never sent (`lines` leaves it out), never has
the caret before it, goes as soon as words are typed beside it (they
take its place), and comes back when the line is emptied again. A
paragraph needs none.

**Android's keys.** The soft keyboard's Return and Backspace reach the
field through its input connection (`commitText`, `deleteSurroundingText`,
`sendKeyEvent`), where the view answers them itself when a block's edge
is involved, so the keyboard's view of the text stays in step; hardware
keys come through `onKeyDown`. Marks are put on inserted text by the
view (Android has no typing attributes), and no meaning span stretches:
every one is exclusive at both ends and re-cut after each edit.

- **The checks** are the unit tests above and Maestro flows on the real
  field, one per step, each typing or tapping and then reading the sent
  message back over RPC, so a behaviour is held to the Markdown it
  produces. The same flows run on iOS and Android.

### The composer

`Composer.tsx` swaps `TextInput` for the editor; `draft` becomes the
Markdown from `onChange`. `useMentionQuery` reads the caret and text
before it from the events instead of `onSelectionChange`, and a pick
sends `insertMention`. Send: `commitPending`, then
`toMarkdown`, then `withTypedMentions` as now. `FormatRow` gets `active`
and `onFormat`, as web's `FormatToolbar` has. New files beside the
composer: `RichField.tsx` (the editor's React face), `LinkDialog.tsx`.

## Split

Each step its own pull request, stacked where it needs the one before.
Fresh-agent review before each opens; Maestro flows for each step's
visible result (the sent message read back over RPC, as the mention
flows do); single flows only, the suite once at the end with the
operator's OK.

0. **Shared cases with the server**: the parser's cases in
   one file read by Go and vitest; the length constant and code-point
   `writtenLength` in core. Independent of the rest. Carries this spec.
1. **Core**: `toMarkdown` / `fromMarkdown` and `checkLink` move to core
   (web imports them, unchanged); `EditorLine`, `linesToDoc`,
   `docToLines`, round-trip tests.
2. **The editor**: the native view on both platforms, holding and
   drawing the whole format (marks, links, mentions, quotes, lists,
   code blocks) so an edit keeps what it loads, typing plain, replacing
   `TextInput` at parity (focus, height, the mention list, send, refused
   send, the keyboard put away by a tap). Edit mode loads the message
   through `fromMarkdown` and saves what the field holds;
   `editableText` and `withTokensRestored` go. The controls come in the
   steps after.
3. **Inline marks**: the row's six mark buttons, pressed state, typing
   attributes, the spoiler fill.
4. **Pills**: picks and typed-in-full handles as pills, one unit to the
   caret and backspace.
5. **Links**: the dialog, ⌘K, paste over words, bare addresses styled.
6. **Quote and code block.**
7. **Lists**, with indent and outdent.
8. **Format as you type, paste, copy**, hardware keys.

## Decisions

- 2026-10-26: our own native editor, not `react-native-enriched-html`
  (it supports React Native 0.81–0.86, we run 0.88; it writes HTML, not
  our Markdown).
- 2026-10-26: format as you type, as web.
- 2026-10-26: lists included, buttons and typing, since edit and paste
  must hold them anyway.
- 2026-10-26: the spoiler in the field, the link dialog and the list
  indent controls get artboards.
- 2026-10-26: spoilers in the field are hatched.
- 2026-10-26: indent and outdent placement to be judged in testing.
- 2026-10-26: the link form is a dialog on both platforms, not a sheet
  on iOS.
- 2026-10-26: Copy gives Markdown, pills as their words.
- 2026-10-26: step 0 (the parser's cases shared with the server, the
  length constant) is part of this work.
- 2026-10-26: no CI job compiling Swift or Kotlin yet (slow and
  costly); the native half's tests run locally and with the hand-run
  `mobile-native.yml`.
- 2026-10-26: all editing behaviour native (Swift and Kotlin), not
  shared in TypeScript: it should change little, nothing waits on JS,
  and native CI is planned. Markdown in and out stays in core.
- 2026-10-27: the native half rewritten as one file per feature on each
  platform (Tech → How the native half is organised), with unit tests
  (`swift test`, Robolectric) kept to a few cases per feature; the
  first build, which held every feature in the view class, is replaced
  rather than refactored. An empty last line in a block holds a
  zero-width space (the holder).

## Later

- Web's editor drawing spoilers hatched too, if the phone's reads
  better.
- Undo and redo of a pill on iOS: undo brings back a pill's words as
  plain words, since the pill is put on outside the text view's undo.
  On send they still go as the token (`withTypedMentions`) when typed in
  full with one owner.
- Styled paste from other apps (RTF/HTML to our marks).
- Images pasted as attachments.
- A character counter before the limit.
- Choosing a code block's language.
- A code block that can hold a line of only ```` ``` ````: longer fences
  in the format, read the same by the client and the server's parsers
  (and in the shared cases).
- Emoji `:shortcode` suggestions in the mention panel.
- Reading the formats at the caret to a screen reader on request.
