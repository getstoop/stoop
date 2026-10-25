# Drawing messages' Markdown in the phone app

Status: draft 2026-10-24, shape agreed with the operator the same day
(Decisions). Step 1 (shared values + drift check) built on branch
`mobile-markdown-values`, not yet merged; step 2 (inline marks) built on
`mobile-markdown-inline`, stacked on it, not yet merged. Plane STOOP-517, under STOOP-518 (timeline parity with web).
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
   Inline content renders as nested `<Text>` (so it wraps as one
   paragraph); blocks are `<View>`s. A code block is a horizontal
   `ScrollView`. A spoiler's revealed state is local to the component.
   Parsing is memoised per message content.

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
   `MessageLink`), if it stays small; otherwise its own PR.

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

## Later

- **Member card** (tap a person or group mention), then mention glyphs
  (person, bot, group) and current handles after renames: both need the
  app to know the channel's members, as naming who reacted does.
- **Mention autocomplete** in the plain composer, before the rich editor.
- **Rich editor**: its own proposal (native, markers hidden).
- **Received attachments inline**: step 3 of
  [mobile-attachments](mobile-attachments.md).
