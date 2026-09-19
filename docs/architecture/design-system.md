# The design system

The web client's look is four things, each in one place:

- **A colour contract.** `web/src/themes.css` holds one block per theme,
  each the same sixteen colour tokens and nothing else
  ([web.md](web.md#themes)).
- **Non-colour tokens.** `web/src/tokens.css`: radius, type, leading,
  motion, focus, stacking, layout widths, the disabled opacity, and four
  status tints derived from the theme's colours.
- **The kit.** `styles/controls.css`, `fields.css` and `surfaces.css`, with
  the utilities in `base.css`. A part is a CSS class first. It becomes a
  React component only where there is behaviour to share: `Modal`,
  `DialogHost`, `DotsMenu`, `Tooltip`, `CopyButton`, `Avatar`, `DataTable`,
  `SettingRow`, `SettingsFrame` (all in `web/src/components/`).
- **The lint that holds it.** Three scripts under `scripts/`, run by
  `make lint` and CI.

The rules themselves are a terse list in
[../conventions.md](../conventions.md) (Web: design tokens and the kit).
This document is the model behind them: what sits on what, which part to
reach for, and why.

## Grounds: what sits on what

Four tokens are backgrounds, and each has a job. A feature picks the ground
by what the element *is*, not by which shade looks right in one theme —
the order of the four differs between light and dark themes, so only the
role is portable.

| Token | What it is for | Where it shows |
| ----- | -------------- | -------------- |
| `--canvas` | The frame behind the app. | The space rail, the desktop title bar, the login page behind its card, the voice stage. |
| `--surface` | The page. | `body`, so the message pane and settings content. Also anything cut *into* a panel: a field is a hole in the panel, as are the list rows inside a card or modal (`.user-row`, `.invite-row`). |
| `--panel` | Something with an edge that sits on the page. | The channel sidebar and settings nav, `.card`, `.modal`, `.popover`, the login card, the message toolbar, a table's box. |
| `--raised` | A small thing sitting on a panel or the page, and a control under the pointer. | `.chip`, a hovered `.option` or `.icon-button`, table headers, inline code, reaction chips. |

The rest of the colour contract follows from that:

- **`--hover` is a wash, not a ground.** It is translucent, for a wide row
  that lights up under the pointer without changing what it sits on
  (`.message:hover`, activity and search rows). A control hovers to
  `--raised` instead.
- **`--border` goes between neighbours**: a panel and the page, a field and
  its panel. It is how a panel reads as separate when a theme's grounds are
  close together.
- **`--shadow` is only for things that float.** `.popover` owns it; nothing
  else declares it except three marked exceptions that float without being
  popovers (the jump-to-present pill, a dragged table row, the phone
  drawer). A card does not float, so it has a border and no shadow.
- **`--scrim` dims what is behind.** The modal backdrop, the phone drawer's
  backdrop, and the labels laid over video on the stage.
- **`--accent` is the one colour that means "this one"**: the primary
  button, links, the focus ring, an avatar's fill. `--on-accent` is text on
  it. `--accent-soft` is its tint, for a selected thing that must stay
  readable: the active channel, `.chip.active`, a badge, a callout, a
  field's focus halo.
- **`--ok`, `--warn`, `--danger` are status.** As text or a border they are
  used directly. As a fill they are too strong, so `tokens.css` derives
  `--ok-soft`, `--warn-soft`, `--danger-soft` and `--danger-border` with
  `color-mix()`, and a sheet uses those rather than mixing its own.

The tints are declared on `:root, [data-theme]`, not on the root alone. A
custom property resolves its `var()` where it is declared, so a tint
declared only on `:root` would be mixed from the root theme's colours and
inherited, already computed, into the theme picker's preview cards — each
of which scopes a different theme to its subtree. Repeating the block on
every theme scope makes each card derive its own.

`scripts/check-themes.mjs` checks the contract where it matters most:
`--text`, `--accent` and `--text-muted` against both `--surface` and
`--panel`, and `--on-accent` on `--accent`.

## Type, spacing, shape, motion, stacking

**Type.** `--text-body` (15px) is the default, set on `body`. `--text-ui`
is labels, hints, chips and menus; `--text-sm` is meta such as times and
sizes; `--text-xs` is eyebrows and badges, always 600 and uppercase with
`--tracking-caps`. `--text-lg`, `--text-xl` and `--text-display` are
headings. Weights are 400, 600 and 700. Leading has three steps:
`--leading-tight` for headings and large glyphs, `--leading-ui` for fields
and short copy, `--leading-body` for everything else.

**Themes never touch type.** The composer draws its Markdown highlighting
in an overlay laid exactly over the textarea
([messaging.md](messaging.md#the-composer-overlay)). A theme that moved a
glyph would pull the two apart. That is why type lives in the first block
of `tokens.css`, which no theme can reach.

**Spacing is literal px on the scale 2 4 6 8 12 16 20 24 32.** There are no
spacing tokens: `gap: 8px` reads better than a variable, and the scale is
small enough to hold in the head. The lint keeps `gap` and `padding` on it.

**Shape.** `--radius-sm` for inline marks (mentions, code); `--radius` for
rows, menu items and small buttons; `--radius-md` for buttons, fields and
popovers; `--radius-lg` for cards, modals and the composer; `--radius-pill`
for chips and badges. Circles are `50%`.

**Motion.** `--dur-fast` for colour, opacity and hover washes; `--dur` for
anything that moves or resizes; one `--ease`. Because every transition
reads a token, `base.css` honours reduced motion by zeroing the two
durations.

**Stacking.** Anything fixed or absolute that escapes its parent takes a
step on the ladder: `--z-sticky`, `--z-drawer-backdrop`, `--z-drawer`,
`--z-popover`, `--z-modal`, `--z-modal-popover` (a dropdown opened from
inside a modal). A component's own layering, such as a toolbar over its
row, uses `1` or `2`. The ladder is why a popover never lands over a modal
by accident.

## Which part when

A feature adds the class and keeps only what differs. If the feature rule
still declares a border, a fill and a radius, it has not adopted the part.

### Actions

- **`button.primary`** is the view's one main action. `.danger` when it
  destroys something. Not for a second action beside it, and not repeated
  down a list.
- **`.chip`** is everything secondary: the Cancel beside a primary, a
  repeated row action (Copy, Revoke), or one of a choose-one set with
  `.active` on the chosen one. `.chip.danger` for a destructive row action.
- **`button.link`** leaves the flow: it reads as a link because it takes
  the user somewhere else (`LinkHandoff`'s way on). Not for an action that
  changes something in place.
- **`.icon-button`** is a square hit target around a glyph, and always
  carries an `aria-label`. Features add size and state on top.
- **`.option`** is a row that is a button: a menu item, a picker option, a
  list member. `.selected` is the row the keyboard is on, `.danger` a
  destructive item, and `aria-disabled="true"` a row that is shown but
  does nothing. Not for a row that only displays.

### Labels and marks

- **`.eyebrow`** is the small uppercase heading over a group. It is the
  only way to get uppercase outside the kit.
- **`.badge`** is one short word about a thing: a role, a status. `.ok`,
  `.warn` and `.danger` pick the tint, so status colour is never a
  per-feature decision. Not for counts — unread pills belong to their
  features.
- **`<Avatar>`** renders `.avatar`, with `size` of `small` (24px),
  `medium` (40px) or `large` (64px). A feature places it and may override
  `--avatar-size`; it never redraws the circle.

### Surfaces

- **`.card`** is a bordered group on a settings page, with `.card-row` for
  a line of controls inside it and `.card.danger-zone` for the group of
  irreversible actions.
- **`.modal`** is only ever rendered by `<Modal>`, which supplies the
  scrim, the header, Escape, scrim-click and focus handling. `small` is
  the one-question size.
- **`.popover`** is the look of anything that floats: border, `--panel`,
  `--radius-md`, shadow. The adopter keeps its own position, `z-index` and
  padding. The pickers, the pins panel, the user card and the live popover
  all wear it.
- **`<DotsMenu>`** (`.dots-menu`) is the ⋮ menu: a popover of `.option`s,
  fixed to the viewport so a scrolling parent cannot clip it. Use it when a
  row has more than two actions.
- **`<Tooltip>`** (`.tooltip`) describes a control. It never takes the
  pointer, so it cannot hold anything clickable.
- **`.callout`** is a standing message in a box: a note about a setting, a
  secret shown once. `.callout.warn` when it is a caution. Not for the
  result of a submit.

### Fields

Text inputs, selects and textareas are styled once in `fields.css` inside
`:where()`, so the rule has zero specificity and any feature rule wins
without a fight. A feature never declares an input from scratch; it
overrides the one property that differs. `aria-invalid="true"` turns the
border to `--danger`.

`.field` is words above the field (with `.field-label-row` when a counter
sits beside the words). `label.toggle-row` is a checkbox beside its words.
On a settings page, a `<SettingRow>` inside a `.card` lays out title,
description and control; `<SettingsFrame>` is the page around them
([web.md](web.md#the-settings-frame)).

### Tables

Anything with columns is a `<DataTable>` ([web.md](web.md#tables)).
`data-table.css` owns the toolbar, the box, headers, the pager, the
expanding row, the drag handle and the row error. A feature declares
columns and cells; it does not style a `<table>`.

### Feedback

| Situation | Pattern |
| --------- | ------- |
| A submit failed | A `.error` line in the form, rendered conditionally with `role="alert"` so it is announced. |
| A field's standing note in danger colour | A static `.error`, no role. |
| Something the user should keep in mind while here | `.callout` / `.callout.warn`. |
| A question, or an error with no form to carry it | `confirm`, `prompt` or `notice` from `stores/dialogs.ts`. They return promises, queue, and render through `DialogHost` on the `Modal` frame. A destructive `confirm` focuses Cancel. |
| Copying | `<CopyButton text>`: "Copied!" for a moment, a `notice` if the clipboard refuses. |
| An action on a table row failed | `rowError` on the `DataTable`; the message appears on that row. |

Loading and empty states are plain text, shaped by where they sit:

- **A whole pane**: `<div className="centered muted">Loading…</div>`. An
  empty pane is `.centered` around an `.empty-state`.
- **A scrolling pane**: the message sits where the content would, muted
  (`.muted.empty-state` in Activity and Search; the history head's
  "Loading earlier messages…").
- **A list, form section or popover**: one `.muted` line (`.muted.small` in
  a dense list).
- **A table**: `rows` undefined draws skeleton rows; an empty array shows
  the section's `empty` line.

## How a part gets into the kit

**A control the second feature wants moves to the kit before the second
feature uses it.** Not earlier. The kit is what the app already does twice,
not what it might need.

In practice that has meant *not* building several parts that looked
obvious on paper:

- A quiet text button. Every Cancel already was a `.chip`.
- A status line, a generic skeleton, a structured empty state with an
  action, and a Loading component. The shapes above were already
  consistent, and a component would have wrapped one line of markup.

So, before adding a part:

1. **Read the adopters.** Find every place the pattern occurs and see what
   they really share. Often the answer is an existing class.
2. **Adopt a class only when the feature rule shrinks to layout or
   disappears.** If the feature still overrides most of it, the part is
   wrong for that use.
3. **Keep a deliberate difference as an override** — a denser padding, a
   muted colour — in the feature's sheet, beside the class. The kit does
   not grow a modifier for one caller.
4. **Make it a component only for behaviour**: focus handling, measuring,
   a timer, a clipboard call. Looks alone stay a class.

## What holds it

Three scripts, all line-based and run by `make lint` and by CI's Web job
(`pnpm check:themes`, `check:styles`, `check:tsx-styles`):

- **`scripts/check-themes.mjs`** — every theme block passes WCAG contrast
  for text, muted text and accent on `--surface` and `--panel`, and for
  `--on-accent` on `--accent`.
- **`scripts/check-styles.mjs`** — every sheet under `styles/` builds on
  the tokens: no literal radius, font family, size, weight, line height,
  opacity, z-index, duration or colour; `gap` and `padding` on the spacing
  scale; no `text-transform: uppercase` outside `base.css` and
  `controls.css`; no `box-shadow: var(--shadow)` outside `surfaces.css`.
- **`scripts/check-tsx-styles.mjs`** — an inline `style` object in a
  `.tsx` file sets computed geometry and custom properties only.

**The escape is a comment containing `off-scale:` and the reason**, on the
line before the declaration or on it. It is legitimate when the value is
forced by something the scale cannot know: a gutter that must equal an
avatar plus its gaps, an indent that lines up under a checkbox, a keyframe
opacity, the black behind video, a pseudo-element that cannot take a
class. It is not for "this looked better at 10px". The reason is read in
review.

**`/kit`** (`routes/Kit/`, dev builds only) renders the foundations,
buttons, fields, surfaces and small parts on one page with a theme switch.
A change to a kit sheet is checked there, in several themes of each tier,
before it ships. Its sheet, `styles/kit.css`, is imported by the route and
never reaches the binary.

Two rules live in the docs only, because a line-based script cannot check
them honestly: a feature sheet must not redeclare the avatar's circle, and
a conditionally rendered `.error` must carry `role="alert"`. Both are
review items.

## Known gaps

- The rail's space pill and the voice stage's tile also carry the class
  name `avatar`, for their own reasons. The kit selector excludes them
  (`.avatar:where(:not(.space-pill, .stage-tile))`). Tracked as STOOP-319.
- "Saved" feedback is two patterns: a `.hint` reading "Saved." beside the
  button (Server admin, About, Hosting) and the button's own label turning
  to "Saved" (Profile, space rename).
- Most failed queries render no failure state; the pane stays on
  "Loading…" or shows nothing. Only a few places read a query's error (the
  user card, the storage section, the invite preview on login).
- `InviteModal` keeps its own copy buttons and clipboard call rather than
  `CopyButton`, because it also copies a new invite's code on create.
- `--z-sticky` is on the ladder but no sheet uses it yet.
