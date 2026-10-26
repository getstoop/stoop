# Drawing messages' Markdown in the phone app

Status: draft 2026-10-24, shape agreed with the operator the same day
(Decisions). Steps 1 (shared values + drift check) and 2 (inline marks,
drawn by our own native view: TextKit on iOS, a `StaticLayout` on
Android) are merged. Step 3 (blocks) is built on branch
`mobile-markdown-blocks`, not yet merged (Tech → 8). Step 4 (link
previews; the pasted message link left for its own PR) is built on
branch `mobile-markdown-extras`, on top of step 3, not yet merged
(Tech → 9). Plane STOOP-517,
under STOOP-518 (timeline parity with web).
Design: no new artboards. The look is web's, carried over through shared
values (step 1), and checked on the phone.

## Scope

Draw a message's Markdown in the channel and thread timelines the way
web's `MessageBody` does, as native components, from the shared parser.
One component, used by channel rows, the thread screen and the long-press
menu's card, and later by search, pins and activity.

Out of scope: the composer (it stays plain text until the rich editor,
[its own proposal](#later)), mention autocomplete, and showing received
attachments inline.

## What exists

- **Parser, shared**: `@stoop/core/markdown` (`parseMarkdown`) gives
  blocks (`lines`, `quote`, `list` with flat depth-tagged items,
  `codeblock`) of inlines (`text`, `mention`, `code`, `link`, `bold`,
  `italic`, `underline`, `strike`, `spoiler`). Web's `MessageBody.tsx`
  renders it; tested in `markdown.test.ts`.
- **Shared helpers**: `emojiOnly` and `splitEmoji` (`core/emojiText`),
  `splitEveryone` and `currentHandle` (`core/mentions`).
- **Mobile today**: `screens/Channel/MessageText.tsx` runs the parser
  but draws everything plainly: marks as their words, lists and quotes
  as lines, spoilers permanently covered. Mentions are highlighted (the
  reader's own filled in), links open in the browser, "(edited)" follows
  the words, a link takes the row's long press.
- **Styles**: colours, radii, text sizes and line heights already reach
  the app: `scripts/gen-mobile-theme.mjs` (`make mobile-theme`) writes
  `mobile/src/theme/generated.ts` from web's `themes.css` and
  `tokens.css`. What doesn't are the values each piece of Markdown uses,
  written straight into `web/src/styles/markdown.css` and
  `messages.css` (code padding, quote bar, list indent, mention pill,
  emoji-only size). Nothing checks that `generated.ts` is current.

## Design

Native React Native components built from the parser's tree, no web view
and no Markdown library. Rules follow web's `MessageBody`:

- **Inline marks**: bold, italic, underline, strike as text styles; inline
  code on the raised fill in the platform's monospace; links in the accent,
  underlined, opening in the browser.
- **Spoilers** are covered until tapped; a tap reveals that one spoiler
  for as long as the row is on screen. Inside a spoiler, mentions and
  links are plain words (as today and on web), so nothing shows through
  or takes a tap while covered.
- **Mentions** are pills (the accent-soft fill, the accent fill for the
  reader). `@channel` and `@here` are pills filled in when the message
  carries `mentions_entire_channel` / `mentions_here` (core
  `splitEveryone`), as on web. A **channel mention** opens that channel
  when it is one of the current space's public text channels the app has
  listed; otherwise it reads as `#name` without a tap. A **person or group
  mention** draws as a pill but opens nothing: a member card is a screen
  of its own to design.
- **Emoji**: a message that is only emoji (`emojiOnly`) is drawn at twice
  the size, as on web. Emoji among words get web's slightly larger size
  if it doesn't raise the line on the phone; otherwise leave them at text
  size (checked on the phone).
- **Blocks**: quotes with the bar and muted text; bulleted and numbered
  lists with web's indent and nesting from the items' depth; code blocks
  on the raised fill with a border, **scrolling sideways**, never
  wrapping. A code block's horizontal scroll must not steal the list's
  vertical scroll or the row's long press.
- **Long press**: a touch on a link, a pill, a spoiler or a code block
  still opens the message menu on long press, as links do today.
- **The menu's card** uses the same component, compact: it draws the
  same marks with spoilers kept covered and nothing tappable.
- **Accessibility**: links and channel pills are links; a covered spoiler
  reads "spoiler, double tap to reveal"; a code block reads its text.

## Tech

1. **Shared values (web keeps its look).** At the top of
   `web/src/styles/markdown.css`, a `:root` block names the values the
   message rules use, e.g. `--md-code-pad-x: 4px`,
   `--md-code-bg: var(--raised)`, `--md-quote-bar: 3px`,
   `--md-quote-color: var(--text-muted)`, `--md-list-indent: 24px`,
   `--md-pre-pad-y: 8px`, `--md-pre-pad-x: 12px`,
   `--md-emoji-only-scale: 2`, and the mention pill's fill and padding
   (moved there from `messages.css`). The web rules use the variables
   instead of the literals, so the browser looks exactly the same.
   `gen-mobile-theme.mjs` reads that block into a `markdown` object in
   `generated.ts`: plain numbers come across as numbers (px dropped), a
   `var(--x)` comes across as the theme key `x` (camel-cased), for the
   app to look up in the current theme. Anything else fails the generator.
   `em`-relative sizes (`0.9em` code) are named as a ratio
   (`--md-code-scale: 0.9`) so the app can multiply its body size.
2. **Drift check.** A CI step (in `make lint`) runs the generator and
   fails if `generated.ts` changes, so web and app can't drift apart
   without a red build.
3. **Not shared, by nature**: the layout (React Native flexbox, not CSS
   rules, so "a quote is a bar plus muted text" is written in each app),
   hover and cursor states, `user-select`, web's CSS-mask mention glyphs
   (the app draws its own icons if it adds glyphs), and fonts (the app
   uses the platform fonts, as the generator already does).
4. **Component**: `mobile/src/components/MessageBody/` (it is reused
   beyond the channel screen), replacing `screens/Channel/MessageText.tsx`.
   Blocks are `<View>`s; a code block is a horizontal `ScrollView`. A
   spoiler's revealed state is local to the component. Parsing is
   memoised per message content.
5. **The paragraph: our own native view.** A local Expo module,
   `mobile/modules/stoop-rich-text`, for iOS (Swift) and Android
   (Kotlin), one JS interface (`index.ts`). JS turns the parser's tree into
   styled runs (`MessageBody/native.ts`, unit-tested with web's Vitest):
   the marks resolved, never Markdown. On iOS the view draws them with a
   TextKit 1 layout manager that paints web's rounded, padded boxes
   behind pills, inline code and spoilers; a line that starts with a box
   is indented by its padding, as a browser does. Covered spoilers are
   drawn clear on their fill, as on web, and never reach a screen reader.
   On Android a `StaticLayout` of a `SpannableString` lays the same runs
   out, and the view paints the boxes behind it in `onDraw` from the
   layout's line and offset positions, so code and spoilers wrap as
   words do. A box's padding is a no-break space at each end, sized to
   the pad: it glues to the box (Unicode line breaking keeps a no-break
   space with its neighbours) and, at a line's start, is the indent iOS
   gets from its text container. Every line is the doc's line height in
   whole pixels, the body font centred in it.
   - **Height:** a synchronous JSI function, `measure(doc, width)`, lays
     the runs out at the width the row will give them before the first
     render, so the row is the right height at once. Both platforms
     build the same layout to measure as to draw and round the height up
     to a whole point (dp on Android). That width is the window's less a
     per-place inset listed in `MessageBody/insets.ts` (the channel or
     thread row, the menu's card); a new place that draws messages adds
     its inset there. If the guess is wrong, `onLayout` reports the real
     width and the row is measured again (one jump).
   - **Touch:** a tap recognizer (on Android, `onTouchEvent`) opens links
     and channel pills and reveals covered spoilers; a touch anywhere
     else is not the view's. A long press stays the row's `Pressable`,
     and a press held 500ms is no tap.
   - **Accessibility:** the paragraph is one element read as the
     message's label (covered spoilers as "spoiler, double tap to
     reveal"), after a link element for each link and channel pill over
     its words on each line (first, so touching a link finds it). A
     reveal keeps the reader on the message and reads it again. On
     Android these are `ExploreByTouchHelper` virtual nodes in the same
     order; the paragraph is clickable (TalkBack's double tap) only while
     something in it is covered, and never in the menu's card. A link's
     element is keyed by an id from its node's path in the parse, so a
     reveal or the channel list arriving doesn't move a screen reader's
     focus.
6. **Anything without the module** draws the paragraph with nested
   React Native `<Text>`, as one wrapping paragraph, its pills flat
   (nested text takes no padding or rounded corners). `MessageBody`
   picks the renderer by whether the native module is there.
7. **Where the platforms differ.** Fonts are the platform's (SF and
   Menlo on iOS, Roboto and the system monospace on Android), so lines
   break in different places. iOS keeps fractional line heights and
   rounds the total up; Android rounds each line to whole pixels, so a
   long message can come out a pixel or two apart. A pad on iOS is
   kerning on the character before a box and the container's indent at
   a line's start; on Android it is a sized no-break space, which also
   stops a line breaking between a box and a word glued to it. TalkBack
   offers the paragraph's double tap only while something is covered;
   VoiceOver's always answers, doing nothing when nothing is.
   `markdown.yaml` runs on the Android emulator up to its "Back" tap,
   which is iOS's back button label (Android's reads "Navigate up").
8. **Blocks (step 3).** A message is a column of blocks
   (`MessageBody/blocks.ts`, from the parser's): lines, a quote, a list,
   a code block, spaced as a browser collapses their margins (the larger
   of two neighbours'). A line break with nothing after it before
   another block draws no line, as in a browser.
   - **Quotes and lists are Views around paragraphs.** Each block's
     words are one paragraph (`Paragraph`: our native view, or nested
     Text without the module), measured at the place's width less the
     block's own room: the quote's bar and padding (`QUOTE_INDENT`) or a
     row's indent (`rowIndent`), the one source for both the View and
     the measure (`insets.ts` `paragraphWidth`). A quote's words are in
     `--md-quote-color`; its pills and links keep theirs.
   - **Lists** are their flat rows, each one paragraph at its depth's
     indent, nested and numbered as web's `List` builds them: a row
     never more than one level below the one before; numbers count from
     one within a run of numbered siblings (a bulleted sibling starts a
     new list); bullets are the browser's disc, circle and square by how
     many lists a row is inside. A top-level switch between numbers and
     bullets is two lists on web, so that row gets the list margin above
     it; nested lists sit tight. The marker is React Native Text, one
     line, ending where the row's words start with a no-break space after
     it, as a browser draws an outside marker: as wide as it needs, so
     "100." at a large text size spills left of the indent, into the
     avatar's gutter and, at the largest sizes, past the screen's edge,
     rather than wrapping. It is hidden from screen readers (on Android
     no marker is in the accessibility tree), and the row's paragraph
     says it before its words ("1. ", or "• ", read as "bullet", at any
     depth).
   - **Code blocks are React Native Text in a horizontal ScrollView**,
     not our native view: the view lays out at a width it is given and
     reports only a height, so it can't size a line that never wraps,
     and a code block has no pills or spoilers for it to draw. The text
     is exactly as written, less one last line break (a `<pre>` draws
     none for it), and reads as itself. On iOS a ScrollView
     won't start its drag while an ancestor holds the touch (Fabric's
     `_shouldDisableScrollInteraction`), and the row's `Pressable` takes
     every touch, so the code's own `Pressable`, inside the scroll, takes
     the row's long press. A drag up or down on a code block scrolls the
     list. Long-pressing code doesn't tint the row as pressed first. On
     both platforms the Text is the code block's one screen reader
     element, read as the code; the Pressable is out of the tree, so
     nothing offers a double tap that does nothing.
   - **Paths** start with the block's index in the parse, so spoilers
     and link ids are unique across blocks and stable; spoilers'
     revealed state is the message's, shared by all its paragraphs.
   - **"(edited)"** follows the last words when the message ends in a
     paragraph, and is a line of its own after a quote, a list or a code
     block, where web's inline marker lands after a block element. Its
     leading space stays as the gap there (web's 6px margin isn't a named
     value), but it is read as "(edited)".
   - Every value was already named in `markdown.css` (`--md-pre-*`,
     `--md-quote-*`, `--md-list-*`); web is unchanged.
9. **Link previews (step 4).** `mobile/src/components/LinkPreviews/`,
   drawn by the row (`MessageRow`) after the files, not by
   `MessageBody`: web's row draws `LinkPreviews` beside `MessageBody`,
   and web's other places that draw a message (pins, search, a linked
   message's card) draw no cards, so the menu's card draws none either.
   - **Rules shared with web** in `core/linkPreviews.ts`, which web's
     `LinkPreviews` now uses too: which show (`shownPreviews`: the
     server's, in the message's order, less a link to a message on this
     server, which web reads as that message), the shape
     (`previewShape`: image-only with no title, landscape from 1.3 times
     wider than tall) and the first line (`previewSite`: the site's
     name, else the host without `www.`). `linkedMessage` moved from
     web's `api/shareLinks.ts` into `core/shareLinks.ts` for it, with
     `serverOrigins` (the address reached, plus `public_url`). The app
     reads `public_url` from the `GetInstanceStatus` the channel and
     thread already asked for the upload cap (`api/instance.ts`
     `useServerStatus`, replacing `useUploadCap`).
   - **Values**: `link-previews.css`'s literals are named in
     `markdown.css`'s block as `--md-previews-*` (the column) and
     `--md-preview-*` (a card), and the generator carries them over; web
     computes the same styles and boxes as before (checked in Chromium,
     every element of every card shape). The × keeps web's
     `.icon-button` padding and 18 icon as literals, being the kit's,
     not the card's.
   - **Image size**: a browser sizes the image from the file; React
     Native needs it up front, so `layout.ts` works it out from the
     size the server measured, as Chromium draws `link-previews.css`
     (measured): a squarish image is the 80 thumbnail beside the words;
     a wide one under them is stretched to the card's width (up to 520,
     less padding and bar) whatever its own size, its height by its
     shape up to 260, cropped to fill; an image alone is up to 400 wide,
     a wide one stretched to that and capped the same, any other at its
     own size, shrunk to fit. Widths come from `BODY_INSETS.row`. An
     image the server gave no size for is drawn as the thumbnail. The
     image is React Native's `Image` from `/files/<id>` with the bearer
     token, as `Avatar` loads one (no new dependency); one that fails is
     left out.
   - **Touch**: the card is one link element, read as its site, title
     and description (an image alone as its site); a tap opens the link
     in the browser, a long press is the row's (the menu).
   - **Remove**: as on web, the author or whoever moderates the space
     (`canDeleteAnyMessage`, DeleteMessage's rule) gets a × over each
     card's corner, always shown (web shows it without hover on touch
     screens); it asks "Remove this preview?" in the system's confirm,
     then `DismissLinkPreview`, an RPC the server already has, and the
     message's update redraws the row. A refusal is said over the
     composer. There is no remove for the reader alone; web has none.
   - **"(edited)"** stays after the words, above the cards; web's marker
     comes after the cards. Left as is (Decisions).
   - **Flow**: `link-previews.yaml`, on a channel the seed fills while
     it serves a page from 127.0.0.1 and turns previews on (then off, so
     no other flow's links are fetched); the server runs with
     `STOOP_UNFURL_ALLOW_PRIVATE`. It asserts the three cards, no card
     for the link to a message here, the long press, and the remove. It
     uses no "Back", so it runs whole on the Android emulator too.

## Split

One PR each, in order:

1. **Shared values + drift check.** The `markdown.css` variables, the
   generator change and the CI check. Web looks the same (checked in the
   browser); the app gets the values but draws nothing new yet.
2. **Inline marks.** The new `MessageBody` component: bold, italic,
   underline, strike, inline code, links, mention pills (yours,
   `@channel`/`@here`, channel mentions open the channel, person and
   group mentions inert), spoilers revealed on tap, emoji-only drawn big.
   Used by channel rows, thread rows and the menu's card.
3. **Blocks.** Quotes, lists (nesting, numbering) and code blocks that
   scroll sideways.
4. **Small extras.** Link previews under the message (the server already
   sends `link_previews`; web's `LinkPreviews`), and a pasted link to a
   message on this server read as who said it and where (web's
   `MessageLink`), if it stays small; otherwise its own PR. Built:
   link previews, with remove (Tech → 9). The message link is its own
   PR (Later).

Each PR: a Maestro flow asserting what it draws (seeded messages with the
marks), one assertion proved to bite, and the operator's phone check.

## Decisions

- **Native, not a web view or a library** (operator, 2026-10-24).
- **Spoilers reveal on tap; code blocks scroll sideways; emoji-only draws
  big by web's `emojiOnly` rule** (operator, 2026-10-24).
- **One reusable component** for channel, thread and the menu's card,
  later search, pins and activity (operator, 2026-10-24).
- **Mentions**: `@channel` and `@here` (not `@everyone`) highlighted;
  channel mentions open the channel; person/group mentions inert until a
  member card exists (operator, 2026-10-24).
- **Styles come from web, in one place**: values named once in web's CSS
  and carried over by the generator, not copied by hand and not a
  CSS-to-React-Native translator (operator, 2026-10-24).
- **Split**: shared values → inline → blocks → extras (operator,
  2026-10-24).
- **Message text on iOS is drawn by our own native view**
  (`mobile/modules/stoop-rich-text`, TextKit) for web-style pills
  (operator, 2026-10-24), after trying inline Views (VoiceOver can't
  reach links) and react-native-enriched-markdown (square pills, read
  covered spoilers aloud, long press on links broken). The same engine is
  meant to carry the rich editor later.
- **Android draws message text with the same view, in Kotlin**
  (`StaticLayout`, boxes painted in `onDraw`, `ExploreByTouchHelper`)
  (operator, 2026-10-24); the React Native renderer stays only as the
  fallback for anything without the module.

- **Blocks: paragraphs native, code and list markers React Native
  Text** (step 3, 2026-10-25; Tech → 8): a code block never wraps, and
  our view can only lay out at a given width; the module is unchanged.
  Open for the operator's review.
- **A long press on a code block doesn't tint the row first; fine for
  now** (operator, 2026-10-25).
- **List markers stay outside markers, uncapped**: at the largest
  accessibility text sizes a three-digit marker runs past the screen's
  left edge, as web's does in a narrow window; left as is (operator,
  2026-10-25).

- **Link previews are drawn by the row, not `MessageBody`**, and not on
  the menu's card, following web (step 4, 2026-10-25; Tech → 9). Open
  for the operator's review.
- **Remove a preview is in step 4**: one RPC the server has, behind the
  system's confirm, for the author or a moderator, as on web (step 4,
  2026-10-25). Open for the operator's review.
- **"(edited)" stays with the words, above the cards** (web's is under
  them): moving it out of `MessageBody` only for messages with cards
  isn't worth it now (step 4, 2026-10-25). Open for the operator's
  review.
- **The pasted message link is its own PR** (step 4, 2026-10-25): web's
  `MessageLink` swaps the address for "who in #channel" once three
  lookups land (the spaces, that space's channels, the message by
  `ListMessages` around it). The app has no shared cache to hold those
  across rows, so each row would ask again; the paragraph's words would
  change after it is measured (a jump per link); web's chat-bubble glyph
  would be a new kind of run for both native views (a native rebuild);
  and a tap should land on the message, which the channel screen can't
  do yet (it opens at its newest or its "New" line). Not small.

## Later

- **A pasted link to a message on this server** read as who said it and
  where (web's `MessageLink`), and under it the message's card (web's
  `LinkedMessages`), with only the RPCs the app already uses
  (`ListSpaces`, `ListChannels`, `ListMessages` around it). Needs
  landing on a message in the channel (`?m=`) first. Until then the
  address shows as a link, which opens in the browser, and its preview
  card is left out, as on web.

- **Member card** (tap a person or group mention), then mention glyphs
  (person, bot, group) and current handles after renames: both need the
  app to know the channel's members, as naming who reacted does.
- **Mention autocomplete** in the plain composer, before the rich editor.
- **Rich editor**: its own proposal (native, markers hidden).
- **Received attachments inline**: step 3 of
  [mobile-attachments](mobile-attachments.md).
- **Measure in a Fabric ShadowNode**: a custom shadow node whose
  `measureContent` lays the runs out at the width Yoga gives it, so the
  per-place insets and the `onLayout` correction go away.
- **Right-to-left text**: the view lays out and indents left to right
  only. Words in a right-to-left script still get their boxes (on
  Android one per bidi piece of a box on its line), but a box's pad can
  land on the wrong side of it.
