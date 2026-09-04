# Coding conventions

How the code is laid out, so that a file stays something a person can hold
in their head. Add to this when a new rule earns its place; every rule
here was written after a file got too big to work in.

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
- **Known debt** (component counts on 2026-08-31): `routes/Setup.tsx`
  (5). Split it when it is next touched; do not add components to it.
  `routes/Admin/` and `routes/Profile/` (2026-08-30),
  `routes/SpaceSettings/` and `routes/Channel/` (2026-08-31) were split
  this way and are the model for the rest.

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
  `.small`, `.hint`, `.error`, `.empty-state`) in `base.css`. A class the
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
  … `--radius-pill`), type (`--text-xs` … `--text-display`, `--tracking-caps`),
  motion (`--dur-fast`, `--dur`, `--ease`), focus (`--focus-ring`) and
  stacking (`--z-sticky` … `--z-modal`). Themes stay colour-only.
- **No bare radius, font size, weight, z-index or duration in a feature
  sheet.** Use the token; if none fits, add one and say why in its comment.
  Weights are 400, 600 and 700. A component's own stacking (a toolbar over
  its row) may use `z-index: 1` or `2`; anything fixed uses the ladder.
- **Spacing is written in px on the scale 2 4 6 8 12 16 20 24 32.** There
  are no spacing tokens — `gap: 8px` reads better than a variable. Padding
  pairs use two values from the scale. A value that must break the scale
  (an avatar gutter, an indent that lines up under a checkbox) carries a
  comment on the line before it containing `off-scale:` and the reason;
  the same marker excuses the one colour literal (the video letterbox).
- **The kit — `controls.css`, `fields.css`, `surfaces.css` — owns the
  parts every feature reaches for:** `button.primary`, `.chip`,
  `.icon-button`, `.badge`; text inputs, selects and textareas (styled at
  zero specificity with `:where()`, so any feature rule wins), the
  words-above-field label and `label.toggle-row`; `.card`, `.card-row`,
  `.modal`, `.dots-menu`, `.tooltip`. A feature sheet styles layout and the feature's own parts; it
  never declares an input or a button from scratch, and a control the
  second feature wants moves to the kit before the second feature uses it.
- **No browser dialogs.** `window.confirm`, `prompt` and `alert` are
  replaced by `confirm`, `prompt` and `notice` from `stores/dialogs.ts` —
  the same promise shape, rendered by `components/DialogHost.tsx` at the
  root route on the `Modal` frame (`components/Modal.tsx`), which every
  other modal uses too. Specs answer them with `acceptDialog` /
  `dismissDialog` from `e2e/lib.mjs`.
- **Focus is global** (`:focus-visible` in `base.css`); fields swap the ring
  for an accent border. A feature overrides it only for a stated reason
  (the composer's overlay border is one).
- **`scripts/check-styles.mjs` enforces all of the above** in `make lint`.
  **`/kit` (dev builds only, `routes/Kit/`) renders every shared part**, with
  a theme switch, so a kit change is checked in all ten themes before it
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
