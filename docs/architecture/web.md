# The web client

React 19, TypeScript, Vite, TanStack Router and Query, Zustand, and the
generated Connect client. No component library, no CSS framework, no state
management library beyond Zustand's small stores. The whole app is compiled
into `web/dist` and embedded in the Go binary with `go:embed`, so **there
is no separate front-end deployment** and no version skew between the API
and the client that calls it.

## Layers

```
routes/       pages: layout and data wiring
components/   everything a page lays out
hooks/        behaviour shared across components
api/          the seam with the server: clients, queries, event handling, pure helpers
stores/       ephemeral client state (zustand)
gen/          generated protobuf + service descriptors — never edited
styles/       one stylesheet per feature; themes.css and tokens.css above them
```

The rule that keeps this readable is one component per file, and a
component that outgrows that becomes a directory
(`components/ReachabilityForm/`, `routes/Channel/`). The full set of layout
rules lives in [../conventions.md](../conventions.md); this document covers
what the app *does*, not how its files are named.

## The transport

One Connect transport, same-origin, in `api/clients.ts`:

```ts
const transport = createConnectTransport({
  baseUrl: "/",
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});
```

`credentials: "include"` is required because the session is an `HttpOnly`
cookie. In development Vite proxies `/stoop.*`, `/files`, `/ws` and
`/livekit` to the Go server on `:8091`; in production the Go binary serves
both the SPA and the API, so the same relative base URL works unchanged.

Connect RPC routes live under `/<proto package>.<Service>/<Method>`, which
is why one `"/stoop."` prefix covers every service in the dev proxy.
`/files` is proxied too — without it the dev server answers those with
`index.html` and every uploaded image renders blank, which is a confusing
enough failure to be worth a comment in the config.

## Routing

TanStack Router, with a pathless `app` layout route beneath the root.
`AppShell` is that layout, and **it is where the auth guard lives** — every
route beneath it is signed-in territory, and there is one place that
decides so. It also owns the realtime connection's lifecycle (`startRealtime`
in an effect) and renders the space rail, so the socket exists for exactly
as long as there is a signed-in session to carry it.

When the session check fails it navigates to `/login`, remembering where the
person was headed — an invite link, say — in `?redirect=`. That location is
read once rather than subscribed to: the shell stays mounted while the
transition is in flight, and reacting to the intermediate location would
loop, nesting the redirect parameter each time.

```
/login                          public
/setup                          public, first-run
/kit                            dev builds only
└── app (AppShell — auth guard)
    /                           home
    /admin           ?tab=accounts|hosting|login|storage
    /activity
    /profile         ?tab=appearance|notifications|security
    /join/$code      ?space=<name>
    /dm
      /                         conversation list
      /$channelId    ?m=<id>    ChannelView with an empty space
    /s/$spaceId/settings   ?tab=about|channels|members|banned|owner
    /s/$spaceId
      /                         space index
      /c/$channelId  ?m=<id>    ChannelView
```

Two things are worth pulling out.

**Search parameters are validated, and validation returns the key
explicitly even when it rejects.** A route's search is merged over its
parent's *raw* search, so omitting a rejected key would let the unvalidated
value through — a subtle enough trap that `safeRedirect` and every
`validateSearch` in `router.tsx` are written to always return the key.

`safeRedirect` itself refuses anything that isn't a same-origin absolute
path, and refuses `/login` in particular: a redirect back to the login page
would leave someone stuck on the form after a successful sign-in.

**`?m=<id>` is the deep link into history.** An activity row, a shared link,
or a reply quote opens the channel *around* that message in one round trip
— see [messaging.md](messaging.md#history).

**The kit route is dev-only** by construction: `import.meta.env.DEV` gates
the route array, so the import is dead code in production and Vite drops
it. `styles/kit.css` is loaded by that route rather than by `index.css`, so
it is never in the binary.

## State: one source of truth

**Server data lives in the TanStack Query cache. Ephemeral client state
lives in Zustand. Nothing lives in both.**

This is the most important structural decision in the client, and realtime
is why. Events from the WebSocket are applied *directly to the query cache*
(`api/ws.ts`) rather than to a parallel event store. A `message_created` is
spliced into `["messages", channelId]`; a `member_updated` invalidates that
member; a `reactions_changed` replaces a message's reaction set.

The alternative — an event store that components merge with fetched data —
means every component has two sources that can disagree, and the disagreement
only shows up under a race. Here there is one array, and a component that
reads it cannot be behind a component that listened to the socket.

The stores, and what each is for:

| Store | Holds |
| ----- | ----- |
| `connection` | Socket status, our user id, the channel currently on screen, who is online and their status, our own status, and typing hints with expiry. |
| `voice` | The LiveKit room, the track registry keyed by participant and source, participants from the gateway, mute/deafen/camera/screen flags. |
| `history` | Per-channel window metadata: `hasOlder`, `hasNewer`, `loading`, `pendingNewer`, and where to land after a jump. |
| `layout` | `drawerOpen`. That is the entire mobile navigation state. |
| `dialogs` | The promise-shaped `confirm` / `prompt` / `notice` queue. |

`connection.activeChannelId` deserves a note: it is what lets a realtime
handler tell "a message arrived in the channel I am reading" from "a
message arrived somewhere else", which is the difference between marking
something read and raising a badge.

## The api/ layer

Pure helpers and query definitions, deliberately outside components so they
are testable and reusable:

- `queries.ts`, `channels.ts`, `dms.ts`, `invites.ts`, `activity.ts` —
  query keys and fetchers.
- `history.ts` — the message window state machine
  ([realtime.md](realtime.md#history-windows)).
- `ws.ts` — the realtime client and the event → cache mapping.
- `markdown.ts` — the parser, in both its rendering and marker-preserving
  forms.
- `unreads.ts` — the unread/badge derivations, which route an empty space
  id to the DM list instead of a space's channels.
- `mutes.ts` — the one place the effective mute is derived for the
  room-shaped surfaces. The wire carries raw per-space and per-channel
  flags; `isMuted` combines them, and the dimmed rows, the bolding in
  `unreads.ts` and the pill dots ask here. `undefined` means the cache is
  cold and callers treat it as unmuted. The surfaces about a single event
  do not ask: the badge counts in `activity.ts` and the desktop banner in
  `ws.ts` read the server's `item.muted` stamp, which is right even on a
  cache that has never loaded the space.
- `permissions.ts` — the client-side mirror of the permission table, used
  only to hide controls. The server still enforces.
- `theme.ts`, `status.ts`, `emoji.ts`, `shortcodes.ts`, `formatting.ts`,
  `errors.ts`, `loginErrors.ts`, `dates.ts`.

`errors.ts` maps Connect codes to human sentences, so a server-side error
string is never load-bearing for what a person reads.

## Themes

**Colour is a token contract.** `web/src/themes.css` holds one block per
theme, each a complete set of the same sixteen colour tokens — `--canvas`,
`--surface`, `--panel`, `--raised`, `--hover`, `--border`, `--text`,
`--text-muted`, `--accent`, `--accent-soft`, `--on-accent`, `--ok`,
`--warn`, `--danger`, `--shadow`, `--scrim` — **and nothing else.**

Never type, never spacing. A theme that changed a font size would visibly
desynchronise the composer overlay from the textarea underneath it, because
that overlay depends on glyph metrics staying put
([messaging.md](messaging.md#the-composer-overlay)).

Nothing under `styles/` names a colour literal; every component reads
tokens. So **a new theme is a forty-line block that works with every
feature**, including features written after it.

Everything that is not colour — radius, type, motion, focus, stacking — is
one block in `web/src/tokens.css`, shared by every theme.

**The choice is per client and never the server's business.** It lives in
`localStorage` under `stoop.theme`, is stamped on `<html data-theme>` by an
inline script in `index.html` *before anything paints* (which is why the
CSP hashes that one inline script rather than allowing inline scripts
generally), and is managed by `api/theme.ts` afterwards. "Follow system" is
a preference over a dark/light pair, resolved by `prefers-color-scheme` and
followed live.

Nothing a space or an admin sets can recolour someone's client — decided
2026-08-27, and worth restating because it is the kind of feature that gets
requested.

`[data-theme]` blocks are plain attribute selectors, so the Appearance
picker's cards can scope a theme to their own subtree and preview it with
the real CSS rather than an approximation.

Ten themes ship: Brownstone (the default, and the original look), Daylight
(the light default), Dusk, Bodega, Newsprint, Blackout, Fire Escape,
Nightcap, Night Bus, and Mailbox. Adding one is four touches — a block in `themes.css`,
an entry in `THEMES` (`api/theme.ts`), its id in `index.html`'s pre-mount
list, and the expected card list in `web/e2e/themes.mjs` — and `make lint`
refuses it until it passes contrast: `scripts/check-themes.mjs` rejects a
theme whose text, accent, or muted text fail WCAG contrast on its surfaces.

## The kit

`controls.css`, `fields.css` and `surfaces.css` own the parts every feature
reaches for: `button.primary`, `.chip`, `.icon-button`, `.badge`; text
inputs, selects and textareas (styled at zero specificity with `:where()`,
so any feature rule wins without a specificity fight); the words-above-field
label and `label.toggle-row`; `.card`, `.card-row`, `.modal`, `.dots-menu`,
`.tooltip`.

A feature sheet styles layout and its own parts. It never declares an input
or a button from scratch, and a control the second feature wants moves to
the kit *before* the second feature uses it.

**No browser dialogs.** `window.confirm`, `prompt` and `alert` are replaced
by `confirm`, `prompt` and `notice` from `stores/dialogs.ts` — the same
promise shape, rendered by `components/DialogHost.tsx` on the same `Modal`
frame every other modal uses. E2E specs answer them with `acceptDialog` /
`dismissDialog`, which is only possible because they are real DOM.

`scripts/check-styles.mjs` enforces the token rules in `make lint`, and
`/kit` (dev builds only) renders every shared part with a theme switch, so
a kit change is checked in every theme before it ships.

## The settings frame

Profile, space settings and server admin share one frame
(`styles/settings.css`). Decided 2026-09-02, reasoning and mockups in
[../proposals/settings-layout.md](../proposals/settings-layout.md): a
settings nav column in the channel sidebar's slot (it replaces the
channel sidebar on `/s/:id/settings`), a content column up to 960px,
and inside it flat groups built from setting rows (title and
description left, control right) and list grids with columns (Accounts,
Members, Banned, Channels). Below 768px the nav is a scrolling chip
strip under the header, rows stack, and lists fold to a two-line row,
all from `mobile.css`. `components/SettingsFrame.tsx` is the frame;
each page passes it a header, its section links and the section on
show. Space settings is routed beside the space layout, not inside it,
which is how its nav takes the sidebar's place. A single setting is a
`SettingRow` (`components/SettingRow.tsx`): title and description on
the left, control on the right, stacked on a phone; a page groups rows
in one `section.card`; a page with several fields is one form with one
"Save changes", disabled until something differs from the server. A list
of people, channels or providers is a
`ul.user-list.table` (`styles/lists.css`): a header row from
`components/ListHead.tsx`, then a grid row per item with `.user-cell`
columns, folding back into a plain row on a phone. The Hosting form is
the same rows with `stack` for the groups that hold several controls;
it also serves the setup wizard, where the rows fall to one column
because the two columns belong to `.settings-content`.

## Layout on small screens

**The app is one DOM at every size.** Above 768px it is the three-column
desktop layout: a 68px space rail, a 232px channel sidebar, and the channel
view. At phone widths — or in any window under 480px tall, which is a phone
on its side — the rail and sidebar are fixed-positioned off-canvas and
slide in together as a drawer over the content.

Nothing is re-parented. The only state is `drawerOpen`, toggled by the
`MenuButton` every page header carries (hidden by CSS on wide screens) and
rendered as `.app-shell.drawer-open`.

Following a link inside the drawer closes it (`closeDrawerOnLink`, an
`onClickCapture` on the sidebar and the rail's footer); tapping a space
pill does *not*, so the new space's channel list is there to pick from. The
scrim and Escape close it too.

Two consequences of "same DOM, transformed" that have to be respected:

- Anything `position: fixed` rendered *inside* the sidebar — the invite
  modal is — is contained by the sidebar's transform while the drawer is
  closed or moving. So **a drawer must not be closed programmatically while
  such an overlay is open.**
- Message rows carry `tabIndex={-1}` so a tap focuses them and the
  hover-only toolbar appears via `:focus-within`. Touch has no hover, and a
  toolbar that only exists on hover is a toolbar that does not exist on a
  phone.

Inputs are 16px below the breakpoint because iOS Safari zooms into anything
smaller, and the composer overlay inherits the same size so its glyph
metrics stay matched to the textarea. Everything else in
`styles/mobile.css` is spacing, in one media query, so there is one place
to look for what changes below 768px.

## Accessibility choices worth knowing

- Spoilers are `<button>` elements, not styled spans — keyboard reachable
  and announced as controls.
- The composer overlay is `aria-hidden`; the textarea stays the accessible
  input, and what is sent is the raw source.
- Focus is global (`:focus-visible` in `base.css`); fields swap the ring
  for an accent border, and a feature overrides it only for a stated
  reason.
- Reduced motion drops `--dur` and `--dur-fast` in `base.css`, which turns
  off the voice-stage tile animation and every transition at once.

## Build and embedding

```
pnpm build              → web/dist          (tsc -b, then vite build)
make build-web          → internal/webui/dist
make build              → bin/stoop with the SPA inside
```

`build-web` copies the Vite output into `internal/webui/dist` and restores
a tracked `.gitkeep`, so `//go:embed all:dist` always matches something on
a fresh checkout — CI's lint and cross-compile jobs never build the web
app, and an embed directive matching nothing is a compile error.

`internal/webui` serves it with the standard SPA caching rule: `index.html`
is revalidated on every load (otherwise a tab keeps running the previous
build after an upgrade, or points at bundles that no longer exist), while
hashed assets under `assets/` are `immutable` for a year because a new
build references new names. Unknown paths fall through to `index.html` so
client-side routes survive a refresh.

**Rebuild after any web change.** The binary embeds `web/dist`; a Go-only
rebuild ships the previous front end.

## The browser suite

`web/e2e/*.mjs`, puppeteer driving a local Chrome against a running server,
with a spec per feature and shared helpers in `lib.mjs`.

It is a real browser because most of what it protects is browser behaviour:
the drawer's transform containment, iOS's input zoom, the composer
overlay's glyph alignment, `Range` requests during video playback, focus
management in modals. None of that is reachable from a unit test.

**The runner wipes the database** in `STOOP_E2E_DATABASE_URL` before each
spec. `make e2e` points it at a throwaway one; anything else pointed at
the dev database needs `make dev-reset` afterwards, and, by the
maintainer's rule, their go-ahead before.
