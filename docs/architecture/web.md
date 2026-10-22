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
core/         pure helpers the phone app shares as source: no DOM, stores or React
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

One Connect transport in `api/clients.ts`:

```ts
const transport = createConnectTransport({
  baseUrl: serverOrigin(),
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});
```

`credentials: "include"` is required because the session is an `HttpOnly`
cookie. Every absolute URL the app builds for the server — the
transport, the `/ws` socket, the LiveKit signaling socket, the upload
request, invite links — comes from `api/origin.ts`, which today returns the page's own origin: in
development Vite proxies `/stoop.*`, `/files`, `/ws` and `/livekit` to the
Go server on `:8091`; in production the Go binary serves both the SPA and
the API. A client hosted somewhere other than the server would change
that one file.

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

When the session check says `Unauthenticated` it navigates to `/login`; any
other failure is retried, and the shell says it can't reach the server
meanwhile. It remembers where the
person was headed — an invite link, say — in `?redirect=`. That location is
read once rather than subscribed to: the shell stays mounted while the
transition is in flight, and reacting to the intermediate location would
loop, nesting the redirect parameter each time.

```
/login                          public
/setup                          public, first-run
/auth/desktop/complete          public, the desktop sign-in hand-off
/auth/desktop/return            public, back to the desktop app
/confirm-email   ?token=<t>     public, an email's confirmation link
└── app (AppShell — auth guard)
    /                           home
    /admin           ?tab=accounts|spaces|hosting|login|storage|integrations
    /activity
    /profile         ?tab=appearance|notifications|muted|security
    /join/$code      ?space=<name>
    /dm
      /                         conversation list
      /$channelId    ?m=<id> ?t=<root>  ChannelView with an empty space
    /s/$spaceId/settings   ?tab=about|channels|members|banned|integrations|owner
    /s/$spaceId
      /                         space index
      /search        ?q=<words>  message search
      /c/$channelId  ?m=<id> ?t=<root>  ChannelView
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
— see [messaging.md](messaging.md#history). For a reply that shows only in
its thread the server centres the channel on the root and names the
thread, and the timeline opens it in the side panel at that reply.
`?t=<root>` (with `?m=` for one reply) is a thread's own link: the side
panel opens it and then takes both out of the address.

**The kit workspace is not a route.** Storybook (`make storybook`) is its
own dev server over the same Vite config; no app module imports a story,
so nothing of it reaches the binary
([design-system.md](design-system.md#what-holds-it)).

## State: one source of truth

**Server data lives in the TanStack Query cache, except messages, which
live in the channel log store. Ephemeral client state lives in Zustand.
Nothing lives in two places.**

This is the most important structural decision in the client, and realtime
is why. Events from the WebSocket are applied *directly to the one place
that holds the thing they are about* (`api/ws.ts`) rather than to a
parallel event store. A `member_updated` invalidates that member's query;
a `channel_read` patches the channel's record in its list; every event
about a message goes to its channel's log, where a `message_created`
takes its place among the rows and a `reactions_changed` replaces a
message's reaction set.

The alternative — an event store that components merge with fetched data —
means every component has two sources that can disagree, and the disagreement
only shows up under a race. Here each fact has one home, and a component
that reads it cannot be behind a component that listened to the socket.

Messages have a home of their own because the query cache is the wrong
shape for them. A query is one request's answer, refetched whole; a
channel's messages are one growing, sparsely read log, and what the
reader has in view is a range over it that pages at both ends, jumps,
and takes events by position. Holding that as a cached array meant
request bookkeeping (events kept per in-flight request, a reconnect
counter) and a reconnect that refetched everything. The channel log
([../proposals/channel-log.md](../proposals/channel-log.md)) is a store
built for it: one log per channel, rows merged by the `seq` the server
stamps on every change, and a reconnect that asks `ListChanges` for what
was missed from the seq it holds. Nothing about a message is in the
query cache except the one-message copies fetched on their own (a linked
message's card, a thread's root before the log holds it), which an event
about the message makes the client fetch again.

The stores, and what each is for:

| Store | Holds |
| ----- | ----- |
| `connection` | Socket status, our user id, the channel currently on screen, who is online, who is on do not disturb, and typing hints with expiry. |
| `voice` | The LiveKit room, the track registry keyed by participant and source, participants from the gateway, mute/deafen/camera/screen flags. |
| `channelLog` (in `api/channelLogStore.ts`) | The channel logs held: one per channel on screen, with the rows, the position (`seq`), the channel's view and one per open thread, and beside each view whether a page is out (`loading`) and where to land after a jump (`landOn`). The section below. |
| `layout` | `drawerOpen`. That is the entire mobile navigation state. |
| `sidePanel` | What the side panel shows, or nothing, saved per tab ([The side panel](#the-side-panel)). |
| `dialogs` | The promise-shaped `confirm` / `prompt` / `notice` queue. |
| `announcer` | The sentence a screen reader is told about a change that only shows on screen; `announce()` sets it and `components/Announcer.tsx` is the hidden live region that speaks it. |

`connection.activeChannelId` deserves a note: it is what lets a realtime
handler tell "a message arrived in the channel I am reading" from "a
message arrived somewhere else", which is the difference between marking
something read and raising a badge.

### The channel log store

One **log per channel**, not per view: the channel's timeline and each
open thread of it are ranges over the same rows, so an edit reaches the
root in the channel and the same root above its replies in one write.

`core/channelLog/` is the pure model. A `ChannelLog` holds `seq`, the log
position through which every change is known; `seenSeq`, the highest seq
any event has carried; `rows`, every row known by id, tombstones
included; a `View` for the channel and one per open thread (a range of
two ids with `hasOlder` and `hasNewer`, a `pendingNewer` count for the
pill, and a `generation`); the retention `floor`; and `needsCatchUp`. Its
rules, one file each, all pure:

- **Merge by seq** (`rows.ts`): a copy replaces the held row with a
  higher seq; the server's copy (a page, a `ListChanges` page, an RPC's
  answer) also wins a tie, because it is the whole row while an event may
  have patched the held one partially and stamped it with that seq (a
  reaction on top of an edit the socket missed). An event's copy at an
  equal seq is ignored. A tombstone is a row with `deleted` set: it stays
  in the map, hidden, so a stale copy cannot bring it back, and shows only
  as the placeholder root of a thread that still has replies.
- **Events** (`events.ts`): each of the five message events yields a row at
  the event's seq, and every one moves `seenSeq`. The next seq advances
  the position; one further on is applied too (higher wins) but marks a
  gap; one at or below is ignored. A partial event (a reaction, a pin, a
  thread summary) about a row that isn't held covers nothing of its seq,
  so it marks a gap too and the catch-up brings the whole row. Before the
  first page rows are kept and the page decides; `hasPage` (`pages.ts`)
  is what says a page has been taken, since a channel with no messages
  yet is at 0 after its page as before it.
- **Position** (`position.ts`): a load that sets the position (the first
  page, a catch-up's last page) covers the changes through the seq the
  server read before its rows, so an event seen above it was not covered
  and leaves `needsCatchUp` set, rather than the load clearing it; the
  loader then runs another pass. That is how a message missed while the
  first page or a catch-up was out is still fetched.
- **Pages** (`pages.ts`): `opened` and `jumped` replace a view's range and
  move its generation, so a page out for the old range is dropped when it
  answers; `paged` grows the range. The first page a log sees sets its seq;
  later pages never move it.
- **Prune** (`prune.ts`): a view holds at most `LOG_CAP` (2000) shown rows.
  Past that the end away from the reader goes and that end's flag is set
  (paging older makes the view stop being live). A dropped row leaves the
  map unless another view still lists it.
- **Catch-up** (`catchUp.ts`, `floor.ts`): a `ListChanges` page merges
  every row, places a row new to the log as an event would, and drops what
  is below the retention floor, sparing pinned roots and their threads as
  the sweep does. The position moves only on the last page, to the
  channel's seq or the highest row's. Every answer's rows are judged
  against the floor held or the answer's, whichever is higher, so a page
  asked for before a sweep cannot bring back a row a catch-up since
  dropped. `refreshed` merges a view's newest page asked for again after
  a reconnect, moving neither the range nor the position.
- **Overlay** (`overlay.ts`): the reader's half of a root's thread summary
  (`participating`, `muted`, `unreadCount`) is not a row fact and has no
  seq; `withThreadOverlay` patches it on the held copy, for the app's own
  read and mute events.
- **Items** (`items.ts`): `channelItems` and `threadItems` remember their
  last answer per view and hand it back while the rows are the same map,
  or while every item is still the same object, so a change to rows a
  list does not show leaves its identity alone.

The reader's own send is not in the model: the composer awaits
`SendMessage` and the answer's row (a `Message` with a seq) is merged like
an event's.

`api/channelLog.ts` is the loader: a Zustand store of logs by channel
(`api/channelLogStore.ts`, with each view's `loading` and `landOn` and the
hooks `useChannelItems`, `useThreadItems`, `useRow`, `useView`,
`useViewStatus`), and `openChannel`, `openThread`, `loadOlder` and
`loadNewer` (one request per view per direction), `jumpTo`,
`jumpToLatest` (which opens a view not yet held on its newest page: the
fallback when a landing's message is gone), `applyEvent`, `patchThread`,
`reconnected` and `forget` (which also ends the epoch a page still out
was asked in, so its answer is dropped). `reconnected` owes every held
log a catch-up and, once it is done, asks for the newest page of each
view that has one again (the channel's, each open thread's, and an open
thread's root, which a thread's page never lists), merged with the server
winning a tie: a thread's reads and mutes changed on another device while
the socket was down are per-viewer facts that bump no seq, so
`ListChanges` carries nothing for them, and the pages refresh them on the
rows the reader is most likely looking at. The limit is deliberate: a row
outside those pages keeps its old reader's half until it is paged in
again. Two more are for what the app has in hand before the
server's event: `holdRow` merges a row by seq exactly as an event's (the
answer to a send or an edit, a thread's root fetched for the panel), and
`patchRow` changes a held row at its own seq (a reaction or a pin before
the server answers, the reader's own delete hidden at once), so the event
that follows, at a higher seq, replaces it, and a refusal is reverted
with another patch.
`api/channelLogCatchUp.ts` runs one `ListChanges` loop per channel, shared
by concurrent callers, retried with backoff capped at 15 s while the
socket is open, and run again while a pass leaves the log owing (an event
seen above where the pass settled); a refusal that won't change (no
access, not found, signed out, a bad request) ends it with `needsCatchUp`
still set.

**Who holds a log.** `useOpenView(view, landing?)` in `api/channelLog.ts`
is how a page or a panel takes a channel: it holds the log while mounted
and opens the view on its newest page (asked for again a few times when
the request fails, as the query it replaced was), unless the caller is
landing on a message (a `?m=` link, a thread's focused reply), in which
case the list's jump brings the page around it instead, so no second
page races the first. The channel page holds the channel it shows and
each open thread holds its channel too; the log is forgotten when the
last holder leaves, so what is held is what is on screen, as the old
store forgot a window when the cache let go of it. Memory is bounded by
`LOG_CAP` per view, with rows outside every view bounded only by the
retention floor until the log goes (the proposal's known leftovers).

**What goes where.** `MessageList` draws `useChannelItems` or
`useThreadItems` and reads `useView` for the edges and the pill's count
and `useViewStatus` for `loading` and `landOn`. The composer `holdRow`s
the send's answer, or `jumpToLatest` when the view stops short of the
newest row. `api/reactions.ts` and `api/pins.ts` `patchRow` before the
server answers. `api/threads.ts` keeps the reader's half of a root's
thread summary (`participating`, `muted`, `unreadCount`, which are not
row facts and carry no seq) through `patchThread`, computing it from the
held root before the `thread_changed` event is applied and only when the
log applied it, so a copy the catch-up already brought is never counted
twice. A row's author is drawn through `core/author.ts`, which overlays
the member from the members list the sidebar already holds on the row's
embedded author, so `member_updated` and `groups_changed` refetch the
members and groups and never the messages; someone no longer a member
is shown from their profile (`GetUserProfile`, `api/authors.ts`, one
request per departed author held for the session and asked again on
`member_updated` and `member_removed`), which is what carries the mark
that the account was deleted.

## The api/ layer

Pure helpers and query definitions, deliberately outside components so they
are testable and reusable:

- `queries.ts`, `channels.ts`, `dms.ts`, `invites.ts`, `activity.ts` —
  query keys and fetchers.
- `channelLog.ts`, `channelLogStore.ts`, `channelLogCatchUp.ts` — the
  channel logs: the store, the requests that fill a view, and the
  catch-up ([realtime.md](realtime.md#the-channel-log-on-the-client)).
- `ws.ts` — the realtime client and the event → store mapping. An event
  about a message goes to its channel's log (`applyEvent`); every other
  event is applied to the query cache.
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
- `theme.ts`, `presence.ts`, `emoji.ts`, `shortcodes.ts`, `formatting.ts`,
  `errors.ts`, `loginErrors.ts`, `mentionClasses.ts`.

`core/` holds the helpers that need no browser, so the phone app imports
them as source instead of keeping copies (`mobile/README.md` → Code shared
with web). `scripts/check-core.mjs` refuses any import from outside
`core/`, `gen/` and `@bufbuild/protobuf`:

- `markdown/` — the message format's parser: blocks a line at a time
  (`blocks.ts`), inline syntax with a cursor (`inline.ts`), and the
  plain-text and link readers (`text.ts`).
- `mentions.ts` — mention and channel-link tokens, and the autocomplete's
  matching. The pills' class names stay web's, in `api/mentionClasses.ts`.
- `permissions.ts` — reads `Space.my_permissions` (and `GetMe`'s permissions
  through `useMyPermissions` in `api/queries.ts`) to decide which controls
  to show; it keeps no copy of the role table. The server still enforces.
- `channelLog/` — the channel log's model ([State](#state-one-source-of-truth)).
- `author.ts` — who a message is shown as being from: the member as the
  members list has them now, over the row's embedded author.
- `messageList.ts`, `channelTimeline.ts`, `timelineState.ts`,
  `timelinePaging.ts`, `timelineEvents.ts` and `timelineItems.ts` — the
  timeline reducer the web app ran before the channel log. **The web app
  no longer imports them**; they stay, each headed with a note saying so,
  because the mobile app's channel screen runs them until it re-points
  at `core/channelLog` (channel-log.md step 7). What they are:
- `messageList.ts` — what a new message, an edit, a deletion or a reaction
  does to a list of messages.
- `channelTimeline.ts` — a window of a channel's messages, or of one
  thread's replies: what a realtime event does to it, and how a
  reconnect's newest page joins the history already held.
- `timelineState.ts` — a timeline as a reducer, which the app's channel
  screen runs. It holds what is
  shown (a window of messages, with an optional header beside it), the
  requests out under ids the caller picks — an open (a new window: the
  newest page, or one around a message), a catch-up after a reconnect, a
  refresh, an older or a newer page — and the events each has kept
  while out. Its rules: those events are replayed over that request's
  answer alone; only the latest load counts, and a refresh gives way to
  an open asked for since the last reconnect; an open drops every page
  still out, and a reconnect drops one asked for before it; a failed load
  keeps what is shown when it was for that window (a catch-up, a refresh,
  or an open naming the same channel). A new message beyond a window that
  stops short of the newest is counted (`pendingNewer`), not shown, and
  the count clears once a load reaches the newest message. The caller does the fetching and
  dispatches each start, answer and failure.
- `timelinePaging.ts` — the pages either side of what is held: one at a
  time, none while an open is out, a new message replayed over a newer
  page only once it reaches the newest, and the cap that drops the far
  end and sets that end's flag.
- `timelineEvents.ts` — what a realtime event does to what a timeline
  holds: its messages, and its header if it carries one (the channel,
  its space, the member count, who is reading). A rename changes the
  header; a member count changes live, never on a replay. A timeline that
  gets its header elsewhere, or a thread's, carries none.
- `timelineItems.ts` — a channel's rows, oldest first: the messages, the
  day lines, the "New" line (sharing a day's line as "Today · New") and
  which message continues the one before.
- `grouping.ts` — where a day line goes, which message continues the one
  before (same author, same minute), and the first message under the
  "New messages" line.
- `unreads.ts` (`badgeCount`, `isUnread`), `reactions.ts`
  (`toggledReactions`), `dates.ts`, `emojiText.ts`, `identity.ts`.

`errors.ts` maps Connect codes to human sentences, so a server-side error
string is never load-bearing for what a person reads.

## Themes

**Colour is a token contract.** `web/src/themes.css` holds one block per
theme, each a complete set of the same sixteen colour tokens — `--canvas`,
`--surface`, `--panel`, `--raised`, `--hover`, `--border`, `--text`,
`--text-muted`, `--accent`, `--accent-soft`, `--on-accent`, `--ok`,
`--warn`, `--danger`, `--shadow`, `--scrim` — **and nothing else.**

Never type, never spacing.

Nothing under `styles/` names a colour literal; every component reads
tokens. So **a new theme is a forty-line block that works with every
feature**, including features written after it.

Everything that is not colour — radius, type, motion, focus, stacking — is
one block in `web/src/tokens.css`, shared by every theme. A second block
there derives the four status tints (`--ok-soft`, `--warn-soft`,
`--danger-soft`, `--danger-border`) from the theme's colours, on every
theme scope.

**The choice is per client and never the server's business.** It lives in
`localStorage` under `stoop.theme`, is stamped on `<html data-theme>` by an
inline script in `index.html` *before anything paints* (which is why the
CSP hashes that one inline script rather than allowing inline scripts
generally), and is managed by `api/theme.ts` afterwards. "Follow system" is
a preference over a dark/light pair, resolved by `prefers-color-scheme` and
followed live.

Nothing a space or an admin sets can recolour someone's client.

`[data-theme]` blocks are plain attribute selectors, so the Appearance
picker's cards can scope a theme to their own subtree and preview it with
the real CSS rather than an approximation.

Twenty-seven themes ship, in three tiers. Light: Daylight (the light
default), Newsprint, Subway Tile, Pigeon, Laundromat, Boardwalk, Whiteout,
Library, Ginkgo. Dim, grounds a step lighter than any dark, for a lit
room, one per hue family: Rooftop, Water Tower, Scaffolding, Sidewalk
Chalk. Dark: Brownstone (the default), Dusk, Bodega, Blackout, Fire Escape, Nightcap, Night Bus,
Mailbox, Streetlight, Neon, Ferry, Bike Lane, Crosswalk, Concrete.

The picker shows one filter at a time rather than the whole wall: the
three tiers, Accessible, or All. Each `THEMES` entry carries a `tier`
(what it files under and what its card prints), `kind` (the dark-or-light
half it can be under Follow system; dim is dark here), and optionally
`tags: ["accessible"]` with a `why` line the Accessible filter shows under
the card. Five carry that tag: Whiteout and Blackout for contrast,
Crosswalk for red-green colour blindness (its status colours are the
Okabe-Ito blue, yellow-green and vermilion), Concrete for no tint, Library
for low glare. The picker opens on the tier of the theme in use, so the
highlighted card is on screen; the filter is not remembered.

Adding one is four touches — a block in `themes.css`, an entry in
`THEMES` (`api/theme.ts`), its id in `index.html`'s pre-mount list, and
the expected card list in `web/e2e-pw/themes.spec.ts` — and `make lint`
refuses it until it passes contrast: `scripts/check-themes.mjs` rejects a
theme whose text, accent, or muted text fail WCAG contrast on its surfaces.
`api/theme.test.ts` fails if the pre-mount list or `themes.css` falls out
of step with `THEMES`.

## The kit

`controls.css`, `fields.css` and `surfaces.css` own the parts every feature
reaches for: `button.primary`, `.chip`, `.icon-button`, `.badge`; text
inputs, selects and textareas (styled at zero specificity with `:where()`,
so any feature rule wins without a specificity fight); the words-above-field
label, `label.toggle-row` and `input.switch` (`<Switch>`, an on/off
setting); `.card`, `.card-row`, `.modal`, `.dots-menu`,
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
Storybook (`make storybook`, dev only) renders every shared part with a
theme switch, so a kit change is checked in every theme before it ships.

## The settings frame

Profile, space settings and server admin share one frame
(`styles/settings.css`): a
settings nav column in the channel sidebar's slot (it replaces the
channel sidebar on `/s/:id/settings`), a content column up to 960px,
and inside it flat groups built from setting rows and `DataTable`s. Below 768px the nav is a scrolling chip
strip under the header, rows stack, and tables fold to a labelled stack,
all from `mobile.css`. `components/SettingsFrame.tsx` is the frame;
each page passes it a header, its section links and the section on
show. Space settings is routed beside the space layout, not inside it,
which is how its nav takes the sidebar's place.

- A single setting is a `SettingRow` (`components/SettingRow.tsx`): title
  and description on the left, control on the right.
- A page groups rows in one `section.card`; a page with several fields is
  one form with one "Save changes", disabled until something differs from
  the server.
- A list of people, channels or webhooks is a `DataTable`
  ([Tables](#tables)).

The Hosting form is
the same rows with `stack` for the groups that hold several controls.
The setup wizard shows each group's fields on a screen of its own
(`TunnelFields`, `TailscaleFields` and the relay fields), sharing the
form's draft through `useReachabilityDraft`.

## Tables

Every list with columns on the settings pages is a
`components/DataTable` (styles in `data-table.css`, the phone fold in
`mobile.css`).

- A section declares `columns` and hands over `rows`. `rows` undefined
  means loading; an empty array shows the section's `empty` line.
- Search, sort and paging are
  [TanStack Table](https://tanstack.com/table) v9, registered once in
  `DataTable/features.ts` and kept inside the component. Everything is
  client-side: each list is already fully loaded.
- The markup is a real `<table>` with `table-layout: fixed`, so every
  row shares the header's columns. The first column takes what is left;
  the others give a width in `meta.width`.
- `columns` must be stable between renders (module scope or `useMemo`):
  a cell is mounted as a component, so a new cell function remounts it
  and an input inside loses focus. Cells that need this render's state
  read it through a ref (`ChannelTable`).
- A sortable column needs an `accessorFn` that returns the value to sort
  by: a rank or a timestamp, not the printed text. Columns sort unless
  they say `enableSorting: false`. A list whose order is the data
  (Channels) passes `ordered`: no sorting, no paging.
- `search` adds the filter box and count. `pageSize` defaults to 25 and
  the pager shows only past one page.
- A row takes at most two inline actions; more go in a `DotsMenu` in a
  column marked `meta.actions`. Members puts every action in the menu.
- An ordered table whose order is editable passes `reorder`: each row
  gains a drag handle in a leading column and rows are dragged with
  [dnd-kit](https://dndkit.com) (`DataTable/Sortable.tsx`), which also
  moves a row from the keyboard — focus the handle, Space to pick it up,
  the arrows to move it, Space to drop. `reorder` needs `ordered` and no
  `search`, so the ids it hands back are the whole list — given either,
  the handles do not appear rather than hand back part of an order. The
  section owns the save: Channels reorders the query's rows first so the
  drop holds, refetches if the call fails, and chains one save after the
  next, since two overlapping reorders can commit in either order.
- A row that owns a list (an account's tokens) opens it in a full-width
  row underneath: pass `detail`, and rows that can open get a chevron.
  The list inside is a `table.dt-sub`, so its columns line up from one
  parent to the next. One level deep, never nested twice. A section
  that opens rows itself (Test opens the delivery log) passes
  `expanded` and `onExpandedChange` and owns that state.
- On or off is a `StateCell`: a dot, the word, and the reason beside it.
  Identifiers (URLs, key hints) take `.dt-truncate`; prose wraps.
- A plain yes or no about a row (Channels' Announcements only) is a tick
  (`.dt-yes`) or a dash, both named for a screen reader. The column says
  what is true; the row's menu is what changes it.
- Dead rows (deactivated bots, deleted accounts) hide behind a counted
  switch in the toolbar: pass `hidden`. A search still finds them.
- A failed action is reported on its row through `rowError`.
- An inactive row dims its cells but not its actions.

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

Inputs, the message editor included, are 16px below the breakpoint
because iOS Safari zooms into anything smaller. Everything else in
`styles/mobile.css` is spacing, in one media query, so there is one place
to look for what changes below 768px.

## The message list

`routes/Channel/MessageList/` draws a view of the channel log
([State](#state-one-source-of-truth)): the channel's, or with a
`threadRoot` that thread's, in the side panel. It is virtualised with
`@tanstack/react-virtual`: only the rows near the viewport are in the DOM,
each positioned at its measured offset inside `.message-list-body`, which
is as tall as the whole view. `.message-list` stays an ordinary
top-to-bottom scroll container that starts at the bottom. Below, "the
window" is what the view's range holds.

- **One item per row** (`MessageList/items.ts`): the head (the window's
  older edge — "Loading earlier messages…", the beginning marker with the
  first-run card, or a thread's root above its reply count), a day line,
  the "New messages" line, each message, and the foot (the newer edge).
  Dividers are rows beside the messages, never wrappers round them
  (`.new-divider + *` is still the message it introduces). The head and
  foot carry the list's top and bottom padding, so the body's height is
  the rows' alone, and a divider's spacing is padding in this list
  (`styles/virtual-list.css`), since a row's measured height is its border
  box. Rows are keyed by message id, so a page prepended keeps every
  measured height; a row that grows later (an image arriving, a link
  preview) is re-measured by the virtualiser's `ResizeObserver`. The row
  being edited stays mounted wherever the view is — a `rangeExtractor`
  adds its index (the head's, when a thread's root is edited there) to the
  virtualiser's range, since the editor holds the draft — and starting an
  edit brings the row on screen.
- **The view does not move when the window changes at an edge.** Before
  a page is asked for, the list notes where the edge's message sits on
  screen; once the window has changed (a page prepended or appended, the
  far end pruned) a layout effect puts it back there from the row's
  measured offset in the new window, before anything is painted. The
  anchor is noted only for a page that will be asked for, says which edge
  it is for, and is consumed only when that edge's message changes
  (`anchorMoved`): a change elsewhere while the page is out — someone
  posting, editing or deleting — leaves it pending, with its top
  refreshed from the row on screen. It is dropped if the page brings
  nothing, or an arrival later would restore a stale position. While an
  anchor is pending the list asks for no page: a row measured as the page
  mounts can run the edge check before the layout effect has put the
  view back, and it would read the edges from the position about to be
  replaced (seen on CI, where a row's height differs from its estimate).
  (The virtualiser's own `anchorTo: "end"` is not used: it anchors on
  whatever row is at the top of the view, which at `scrollTop` 0 is the
  head, so a prepend would leave the view at the top showing the new
  rows.) A row re-measured later (an image arriving) keeps the view in
  place when it is above it, and at the bottom when the view is there
  (`shouldAdjustScrollPositionOnItemSizeChange`); a row's first
  measurement keeps the virtualiser's rule, since the rows a landing is
  settling over must not each move the view.
- **Landing is by index.** `scrollToIndex` centres a jumped-to row
  (`landOn`, a reply quote, a deep link) and `scrollToEnd` lands at the
  bottom; the virtualiser keeps retargeting as rows around the target are
  measured. A jump to a row the window holds but the DOM doesn't scrolls
  to it, and the row flashes once it renders; only a row outside the
  window asks the server (`jumpTo` in `api/channelLog.ts`). In a
  thread, a jump to the root lands on the head when the head shows it.
  A deep link is the same jump: the view is not opened on its newest page
  for it (`useOpenView`), so the page around the message is the first
  the reader sees; a message that isn't there opens the newest page.
- **Edge loading is by the rows on screen** (`MessageList/edges.ts`): on
  each of the virtualiser's changes, the rows at the list's own
  `scrollTop` and its bottom edge are looked up, and when they come within
  `EDGE_LEAD` rows of the window's first or last item, `loadOlder` or
  `loadNewer` runs. The element's position is read rather than the
  virtualiser's range because a row measured as it mounts reports before
  a landing scroll, from wherever the view was. It is armed by the first
  landing (a list renders at its top before it lands at the bottom) and
  paused while a replaced window has yet to land.
- **Following is unchanged:** an arrival (the window extended by one at
  its end, `newestChange`) moves the view only when it is already within
  `NEAR_BOTTOM` of the bottom or the message is the reader's own; otherwise
  it counts on the "Jump to latest" pill.
- **What the window holds is on the list element:** `data-rows` and
  `data-oldest`. A browser spec reads those rather than counting
  `.message` elements, which are only the rows near the viewport.

The view is bounded by the log's `LOG_CAP` (2,000 shown rows,
`core/channelLog/types.ts`), which is about memory rather than the DOM:
past it the end away from the reader is pruned, and that end's flag is
set, so paging far back makes the view stop being live until "Jump to
latest".

## The side panel

`components/SidePanel` is the right-hand column any page can open. It
shows one kind of content at a time, and is shared so each feature does
not build its own.

- **Where it is.** `AppShell` renders it after the route, so it sits beside
  space channels, DMs and any later page.
- **Its state belongs to the app, not the URL.** `stores/sidePanel.ts` holds
  the open kind and its params and saves them per tab in `sessionStorage`.
  The panel stays open across channel and space changes until it is closed
  or replaced, and a reload keeps it.
- **A link only opens it.** A kind can claim a search parameter in the
  registry (`components/SidePanel/registry.ts`). When a link carries it, the
  panel opens and the parameter leaves the address bar (`links.ts`).
- **Content draws itself in `SidePanelFrame`.** The frame has the title,
  a subtitle naming where the content came from, Close, the scrolling
  body and an optional footer. Focus moves to the title when it opens and
  back to whatever opened it when it closes, and Escape closes it while
  focus is inside. `SidePanelUnavailable` is what content shows when it
  can no longer be read.
- **It slides in and out.** On close the container keeps the last panel on
  screen, marked `leaving`, until the frame's exit animation ends (a timer
  stands in if it never reports, and reduced motion skips it). Replacing
  the content does not animate.
- **On a phone it is a screen of its own.** `mobile.css` makes it full
  screen and swaps Close for Back, one DOM as everywhere else.
  `narrowHistory.ts` adds one history entry while it is open, so the
  device's Back closes it, and going to another page closes it too. On a
  wide screen history is left alone, and Back never closes the panel.

Adding a kind is a registry entry and its component. The muted channels
list (`components/MutedChannels`) is the simplest. The first was a
thread (`routes/Channel/ThreadView.tsx`): its root, fetched as a
one-message page under the channel's key so realtime writes reach it,
then its replies through the same `MessageList` as the channel, and a
`Composer` that replies into it.

The summary under a root carries the reader's own half (`participating`,
`muted`, `unreadCount`), which `ThreadChanged` never does, since every
viewer gets the same event. `api/threads.ts` keeps it: a new summary
keeps the cached half and adds others' replies to the count of a thread
the reader is in and hasn't muted, and a first reply works that out from
the cached root. `MessageUpdated` and the `EditMessage` answer carry
only the shared half too, so `replaceMessage` (`api/ws.ts`) keeps the
cached half when it swaps in an edited root. The open thread marks
itself read once the window has attention (`useMarkThreadRead`), and
reads its own activity items; the channel reads only items outside
threads.

A reply also sent to the channel is one message in both timelines
(the reducer puts it in each, `core/channelTimeline.ts`). In the channel it carries a line
naming its thread (`Message.thread_root`) that opens the thread on it;
in the thread it is tagged "Also sent to #channel". The thread's box
offers the choice as a checkbox, cleared after each send.

## Accessibility choices worth knowing

- Spoilers are `<button>` elements, not styled spans — keyboard reachable
  and announced as controls.
- The message editor is a contenteditable with `role="textbox"`,
  `aria-multiline` and its placeholder as `aria-placeholder`.
- Focus is global (`:focus-visible` in `base.css`); fields swap the ring
  for an accent border, and a feature overrides it only for a stated
  reason.
- Reduced motion drops `--dur` and `--dur-fast` in `base.css`, which turns
  off the voice-stage tile animation and every transition at once.

## Keyboard shortcuts

App-wide bindings are declared in one table, `api/shortcuts.ts`, and
dispatched by one `keydown` listener (`useShortcutListener`, mounted in
`routes/Root.tsx`).

| Key | Does | Held by |
| --- | --- | --- |
| Cmd/Ctrl+Shift+M | Mute or unmute | `Root`, while in a call |
| Cmd/Ctrl+Shift+D | Deafen or undeafen | `Root`, while in a call |
| F | Full screen the stage | `VoiceStage`, while it is on screen |
| Ctrl+` (held) | Push to talk | `Root`, while in a call with push to talk on, in a browser |

- **The table owns the key; the component owns the action.** A component
  calls `useShortcut(id, handler)` while it is mounted. A binding nobody
  holds does nothing and the key passes through, so "not in a call" and
  "no stage" need no checks of their own.
- **`isTypingTarget` is the one answer to "is the user typing?"** A
  binding without a modifier never fires from a field; one with a
  modifier says so with `whileTyping`.
- **Keys a field owns stay with the field.** The composer's formatting
  keys, Enter, and Up arrow in an empty composer (edit your last message)
  depend on the field's own state and are handled in its `onKeyDown`.
- **The desktop shell holds the mute and deafen keys** once it speaks
  bridge 4: its Voice menu binds them so they reach the call from any
  server it has open, and the page leaves them unbound
  ([desktop.md](desktop.md)).
- **Push to talk is held, not pressed**, so it is not in the table: the
  key is matched in `api/shortcuts.ts` and listened for on keydown and
  keyup by `usePushToTalk`. It is the physical key above Tab
  (`event.code`), with Ctrl on every platform, since Cmd+` is macOS's own
  "next window". See [voice.md](voice.md#push-to-talk).
- **A browser tab cannot have** Cmd/Ctrl+N, T, W, L, R, 1–9, or
  Cmd/Ctrl+Shift+N, T, P, I, J. Do not bind them.
- There is no "only if nothing else took the key" rule yet: Escape
  handlers across the app do not mark the event as handled. Build that
  when a binding needs it.

## The platform seam

`api/platform.ts` is the only place the app knows about what is hosting
it. The desktop shell injects a `window.stoop` object from its preload
script; the app feature-detects that object and never reads the user
agent, so a browser, an installed PWA and the shell all run the same
bundle. `BRIDGE` there is the contract level this build speaks and is
published by `GET /version`; it moves together with
`internal/webui/bridge.go`.

What goes through it today: the desktop-notification permission (the
shell grants it itself, and may be reaching a LAN server over plain HTTP,
so the HTTPS rule does not apply), the unread badge (`routes/Root.tsx`
reads `alertingCount` off the activity cache and calls `setBadge`, a
no-op in a browser), and global shortcuts the shell captured while the
window was not focused. The full contract is in
[desktop.md](desktop.md).

Two things follow the theme without the bridge at all. `theme.ts` keeps
the `theme-color` meta in step with the picked theme's canvas colour, so
an installed app's title bar and the shell's window match the page — and
the shell reads the theme's token values off `:root` for its own pages,
which [desktop.md](desktop.md) lists. And
`routes/Root.tsx` draws an empty strip above every route, sized by
`env(titlebar-area-height)`: inside the shell, which opens windows with
no native title bar, that is the drag region the OS puts its window
controls over, in the rail's colour; in a browser it is zero height.

## Build and embedding

`web/public/` holds the files served as-is from the root: the manifest,
the favicon and the icon set. The manifest is what lets Chrome and Edge
install Stoop as an app (`display: standalone`, start URL `/`). There is
deliberately no service worker: the app is not useful offline, and a
worker that cached the SPA shell would keep an old build running against
a new server, the version skew the embedded build exists to prevent.

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

`web/e2e-pw/*.spec.ts`, Playwright driving Chromium against a running
server, with a spec per feature and shared helpers in `lib.ts`. The
instance each one starts from is built over RPC by `web/e2e/seed.mjs`
rather than through the signup wizard.

It is a real browser because most of what it protects is browser behaviour:
the drawer's transform containment, iOS's input zoom, the composer
overlay's glyph alignment, `Range` requests during video playback, focus
management in modals. None of that is reachable from a unit test.

**The runner wipes the database** in `STOOP_E2E_DATABASE_URL` before each
spec. `make e2e` points it at a throwaway one; anything else pointed at
the dev database needs `make dev-reset` afterwards, and, by the
maintainer's rule, their go-ahead before.
