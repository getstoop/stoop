# Coding conventions

How the code is laid out, so that a file stays something a person can hold
in their head. Add to this when a new rule earns its place.

## Web: one component per file

- **A `.tsx` file is its main component, named after the file, plus at
  most a few small supporting components** that exist only to serve it —
  a status block, a row, a section. They are not exported. The test:
  if you scroll past components looking for the one the file is named
  for, it is time to split.
- **A component that outgrows that becomes a directory.**
  `components/Foo/index.tsx` exports `Foo` and owns the state; each part
  gets its own file beside it (`Foo/BarSection.tsx`); logic that does not
  render — the state model, pure helpers — goes in `.ts` files there
  (`Foo/fields.ts`). Importers keep writing `../components/Foo`.
  `components/ReachabilityForm/` is the model.
- **Anything used by more than one feature lives at the top of
  `components/`** (`LearnMore.tsx`, `Avatar.tsx`), never inside another
  feature's directory. Pure helpers shared across the app go in
  `src/api/` (`errors.ts`, `formatting.ts`).
- **Routes follow the same rule.** `routes/Channel.tsx` should be the
  page's layout and data wiring; the parts it lays out are components.
- **Icon collections are the exception.** `Icons.tsx` and
  `VoiceIcons.tsx` are many tiny SVG components in one file, and that is
  the readable form for them.
- **Known debt:** `routes/Setup.tsx` holds five components. Split it when
  it is next touched; do not add components to it. `routes/Admin/` and
  `routes/Profile/` are the model.

## Web: one stylesheet per feature

- **`web/src/styles/` holds one file per page or feature**
  (`messages.css`, `voice.css`, `reachability.css`, …); `styles/index.css`
  imports them all and is the only stylesheet `main.tsx` loads. Colour
  tokens stay in `web/src/themes.css`, one block per theme, and nothing
  under `styles/` names a colour literal (`docs/architecture/web.md` →
  Themes).
- **A rule goes in the file of the feature it styles**, even when it is
  written months later. There is no "small fixes" section: a fix to the
  admin page goes in `admin.css`. A new feature gets a new file, added to
  `index.css` before `mobile.css`.
- **Shared controls go in the kit** — `controls.css`, `fields.css`,
  `surfaces.css` (next section); page furniture and utilities (`.muted`,
  `.small`, `.hint`, `.eyebrow`, `.error`, `.empty-state`) in `base.css`. A class the
  second feature wants to reuse moves there.
- **Order is the cascade.** `index.css` runs general → specific: `tokens`,
  `base`, the kit, then pages and features, then `mobile.css` last. Ties on
  specificity are broken by file order, so a rule that must beat one in
  another file belongs in a later file — or, better, gets a more specific
  selector so the order stops mattering.
- **Every phone-width override lives in `mobile.css`**, in its one media
  query, so there is one place to look for what changes below 768px.
- Keep a file under ~300 lines. `messages.css` is at the limit; if the
  channel view grows, split the composer's row styles or the toolbar out
  rather than appending.

## Web: design tokens and the kit

- **Non-colour tokens live in `web/src/tokens.css`** — radius (`--radius-sm`
  … `--radius-pill`), type (`--text-xs` … `--text-display`, `--tracking-caps`,
  `--font-ui`, `--font-mono`, `--leading-tight`, `--leading-ui`,
  `--leading-body`), motion (`--dur-fast`, `--dur`, `--ease`), focus
  (`--focus-ring`), stacking (`--z-sticky` … `--z-modal`), the disabled
  opacity (`--disabled`) and layout widths (`--rail-w`, `--sidebar-w`).
  Themes stay colour-only.
- **Status tints are derived there too** — `--ok-soft`, `--warn-soft`,
  `--danger-soft`, `--danger-border`, mixed from the theme's colours in a
  second block on `:root, [data-theme]`. Use them instead of an inline
  `color-mix()` of a status colour.
- **No bare radius, font family, font size, weight, line height, z-index
  or duration in a feature sheet.** Use the token; if none fits, add one
  and say why in its comment. Weights are 400, 600 and 700. `font-family`
  is `--font-ui`, `--font-mono` or `inherit`; `line-height` is a
  `--leading-*` token, `1`, `normal` or `inherit`. A component's own
  stacking (a toolbar over its row) may use `z-index: 1` or `2`; anything
  fixed uses the ladder.
- **Opacity is `0`, `1` or `var(--disabled)`.** Anything disabled or
  inactive uses `--disabled`; an opacity that means something else (a
  keyframe step, a decorative dim) keeps its value with an `off-scale:`
  comment.
- **Spacing is written in px on the scale 2 4 6 8 12 16 20 24 32.** There
  are no spacing tokens — `gap: 8px` reads better than a variable. Padding
  pairs use two values from the scale. A value that must break the scale
  (an avatar gutter, an indent that lines up under a checkbox) carries a
  comment on the line before it containing `off-scale:` and the reason;
  the same marker excuses the one colour literal (the video letterbox).
- **The kit — `controls.css`, `fields.css`, `surfaces.css` — owns the
  parts every feature reaches for:** `button.primary`, `.chip`,
  `button.link`, `.option`, `.icon-button`, `.badge`, `.avatar`,
  `.eyebrow` (the small uppercase heading, in `base.css`); text inputs,
  selects and textareas (styled at zero specificity with `:where()`, so any
  feature rule wins), the words-above-field label and `label.toggle-row`;
  `.card`, `.card-row`, `.callout`, `.modal`, `.popover`, `.dots-menu`,
  `.tooltip`. A feature sheet styles layout and the feature's own parts; it never
  declares an input or a button from scratch, and a control the second
  feature wants moves to the kit before the second feature uses it.
- **Which button:** `button.primary` is the view's one main action;
  `.chip` is its partner (Cancel), a repeated row action, or one of a
  choose-one set; `button.link`
  leaves the flow; `.option` is a row that is a button (a menu item, a
  picker option, a list member), with `.selected` for the row the keyboard
  is on, `.danger`, and `aria-disabled="true"`. A feature adds the class
  and keeps only what differs: a denser padding, a muted colour.
- **A standing message in a box is `.callout`** — a warning about a
  setting, a secret shown once; `.callout.warn` when it is a caution. A
  feature keeps only its margin and inner parts. An error from a submit is
  not a callout: it stays a `.error` line.
- **A "Copy" chip is `<CopyButton text>`** (`components/CopyButton.tsx`):
  it says "Copied!" for a moment and raises a `notice` when the clipboard
  refuses. Don't call `navigator.clipboard` beside a hand-made chip;
  `InviteModal`, which also copies a new invite's code on create, is the
  one that still does.
- **A user avatar is `<Avatar>`, sized by `size`.** `.avatar` in
  `controls.css` owns the circle, the fill, the initials and the bot face;
  `.small`, `.medium` and `.large` set `--avatar-size` to 24, 40 and 64px
  with each size's font size, and no modifier is 40px at the inherited
  size. A feature sheet places the avatar (a grid row, a ring, a cut-out
  border) and overrides `--avatar-size` when it must; it never redeclares
  the circle. The phone's 36px `medium` is one such override, in
  `mobile.css`.
- **No `text-transform: uppercase` outside `base.css` and `controls.css`.**
  Put `eyebrow` on the element and keep only layout, or a differing
  colour or weight, in the feature rule.
- **No `box-shadow: var(--shadow)` outside `surfaces.css`.** A floating
  panel takes `popover` and keeps its own position, `z-index`, padding and,
  where it differs, radius. Either rule gives way to an `off-scale:`
  comment with the reason (a pseudo-element, a lifted row).
- **No browser dialogs.** `window.confirm`, `prompt` and `alert` are
  replaced by `confirm`, `prompt` and `notice` from `stores/dialogs.ts` —
  the same promise shape, rendered by `components/DialogHost.tsx` at the
  root route on the `Modal` frame (`components/Modal.tsx`), which every
  other modal uses too. Specs answer them with `acceptDialog` from
  `e2e-pw/lib.ts`.
- **Focus is global** (`:focus-visible` in `base.css`); fields swap the ring
  for an accent border. A feature overrides it only for a stated reason
  (the composer's overlay border is one).
- **An inline `style` in a `.tsx` file carries computed geometry only:**
  `left`, `top`, `right`, `bottom`, `width`, `height`, `min`/`max` of
  both, `transform`, `transition`, and CSS custom properties (`"--name"`).
  Anything else is a class in the feature's sheet. A value only the
  component knows reaches the sheet as a custom property; one that can't
  carries an `off-scale:` comment on the line before. Only object literals
  are judged: `style={position}` passes. `scripts/check-tsx-styles.mjs`
  enforces it in `make lint`.
- **`scripts/check-styles.mjs` enforces all of the above** in `make lint` and in CI's Web job.
  **`/kit` (dev builds only, `routes/Kit/`) renders every shared part**, with
  a theme switch, so a kit change is checked in every theme before it
  ships. `styles/kit.css` is loaded by that route, not `index.css`, so it is
  never in the binary.

## Go: one file per entity or concern

- A module (`internal/chat`, `internal/instance`, …) is a directory of
  small files, one per entity or concern (`spaces.go`, `channels.go`,
  `reachability.go`); `service.go` holds only wiring, ports and shared
  helpers. Queries and protos follow the same split
  (`internal/db/queries/<module>/<entity>.sql`,
  `proto/stoop/<module>/v1/<entity>.proto`).
- Module boundaries are enforced by the linter and described in
  `docs/architecture/modules.md`; a new feature adds a file, not a section.

## Comments: short and concise

- Comments should be concise and limited to the scope of the code they are addressing.
- Large explanations and how-tos belong in documentation, not in code.
- If a piece of code's outcome cannot be predicted by reading the code
  itself, consider changing the code to be more readable.
