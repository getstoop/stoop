# Realtime: the bus, the gateway, and the wire

Chat is only realtime if something pushes. Stoop's push path is two pieces
that do not know about each other: an in-process **events bus** that
modules publish to, and a **WebSocket gateway** that subscribes on behalf
of each connected client.

```
  chat.SendMessage ──► bus.Publish("space:<id>", ServerEvent{message_created})
                                      │
                       ┌──────────────┴───────────────┐
                       ▼                              ▼
        Subscription (Casey's tab)     Subscription (Ada's phone)
                       │                              │
              gateway writes a binary frame ──► ws.ts applies it to the channel log
```

`internal/chat` does not import `internal/realtime`, and the gateway does
not import chat. They agree on `stoop.realtime.v1.ServerEvent` and nothing
else.

## The bus

`internal/events` is about 170 lines and its interface is two methods:

```go
type Bus interface {
    Publish(topic string, ev *realtimev1.ServerEvent)
    Subscribe(topics ...string) *Subscription
}
```

**Two topic shapes, and only two.** `space:<id>` reaches everyone in a
space; `user:<id>` reaches one person across all their connections. Every
connection subscribes to its own `user:` topic plus one `space:` topic per
membership. `events.SpaceTopic` and `events.UserTopic` build the
names.

That there is no `channel:` topic is a design decision with real
consequences. Channel-level fan-out would mean the gateway tracking which
channel each tab is looking at, and re-subscribing on every navigation. A
space's members are already entitled to a space's events, so sending them
all and letting the client decide what to render is both simpler and
correct. It also gives direct messages a free ride: a DM event is published
to each participant's `user:` topic, which every connection already
subscribes to, so **the gateway has no DM bookkeeping at all**.

**`events.Stamp`** fills in the envelope's `event_id` (a UUIDv7) and
timestamp in place. Every publisher goes through it, so every event on the
wire is identified and ordered.

### Delivery guarantees, and why there are so few

Each subscription has a **256-event buffer**. If a publisher finds it full,
the subscription is **dropped**: its channel is closed and it is removed
from every topic. The publisher does not block, and does not retry.

This is the right trade for a chat service. The alternative — blocking a
publisher until the slowest tab catches up — makes one wedged connection
everyone's problem. A dropped subscription is visible to the gateway as a
closed channel, which closes the socket with `StatusTryAgainLater`; the
client reconnects and refetches. So:

- Events are **best-effort**. There is no replay and no acknowledgement:
  an event that was dropped is never resent. What every event about a
  message does carry is the row's position in its channel's log, `seq`
  (`Message.seq` on `message_created` and `message_updated`, a `seq`
  field on `message_deleted`, `reactions_changed`, `message_pinned` and
  `thread_changed`;
  [proposals/channel-log.md](../proposals/channel-log.md)). Positions are
  monotonic per channel but not dense — a rolled-back write leaves a gap
  — so a client cannot tell a lost event from a gap in the numbering. It
  can, and the socket guarantees nothing else, apply events by "higher
  seq wins" and ask `ListChanges` for everything after the seq it holds
  ([messaging.md](messaging.md#history)). Events about anything other than
  a message carry no position.
- **The RPCs are the source of truth**, always: `ListMessages` for a
  window, `ListChanges` for what has happened since. The socket is an
  optimisation over polling, not a separate protocol with its own state.
- Recovery is uniform: on reconnect the client asks `ListChanges` for
  every channel it holds, from the seq it holds, and refetches every
  other query. That path runs on every reconnect, not just after a drop,
  so it is exercised constantly rather than being a rarely-taken branch
  that rots ([The channel log on the client](#the-channel-log-on-the-client)).

Because every payload is a protobuf message, a cross-process
implementation of `Bus` is a marshal/unmarshal wrapper behind the same
interface. The one that exists is below; a multi-node one — NATS, Redis —
would be the same shape, and that is the only concession the codebase
makes to multi-node scaling.

### Across processes

The bus is one `InProcBus` per process, and the gateway lives only in the
server. A job that runs in a `stoop jobs` process
([runtime.md](runtime.md#background-work)) publishes to that process's
bus, which nothing subscribes to; without a relay, an avatar the
`normalise_image` job finished would change for nobody until they
reloaded. `internal/eventrelay` carries those publishes to the server
over Postgres `NOTIFY`, the channel the dispatcher is already woken by.

- **The runner's bus is wrapped.** `app.NewRunner` builds its modules on
  an `eventrelay.Publisher`: every `Publish` reaches the local bus as
  before and also raises `NOTIFY stoop_events` on the pool, with the topic
  and the marshalled `ServerEvent` in one text-safe payload. `NOTIFY`
  carries 8000 bytes. An event over that is sent as up to eight pieces in
  one transaction, so they arrive together and in order, and the listener
  rebuilds it, holding one unfinished event at most and dropping it if
  anything else arrives first; the one event a job publishes that can need this is
  `space_updated`, whose welcome may run to 4000 characters of a script
  that takes several bytes each. An event larger still is logged and
  dropped, never truncated.
- **The server listens.** `app.New` builds its modules on a plain
  `InProcBus` and runs an `eventrelay.Listener` on one connection outside
  the pool, reconnecting with backoff like the dispatcher's listener (both
  on `internal/restart`). Each notification is decoded and published on
  the server's bus with the runner's `event_id` and timestamp intact, so
  the gateway and the webhook subscriber see it as any other event.
- **The server never notifies.** Its own publishes stay on its bus, so
  embedded mode publishes once and nothing is relayed twice: a server
  beside an external runner hears the runner and never echoes itself.
  Nothing flows the other way; the runner has no subscribers.

What crosses is whatever a job publishes: `member_updated` from
`normalise_image`, `space_updated` from the icon pointer swap it asks chat
for, `credential_revoked` from `sweep_credentials`. What the server
publishes does not cross. No module subscribes in both processes — the
gateway and the webhook subscriber run only in the server — so a relayed
event is handled once.

The relay keeps the bus's guarantees and adds none. `NOTIFY` is at most
once: a notification raised while the listener is reconnecting is lost,
and nothing replays it. Clients refetch what these events are about on
reconnect and the RPCs stay the source of truth, so a lost relayed event
costs a stale picture until the next load, not correctness.

## The gateway

One goroutine group per connection, in `internal/realtime`. It holds no
database handle — the linter forbids it from importing `dbgen` — so
everything it knows comes from four ports: `SessionVerifier` and
`DoNotDisturbLookup` (auth), `MembershipLister` and `ChannelLookup` (chat).

### Connection lifecycle

1. **Authenticate before upgrading.** `SessionVerifier.VerifyRequest` reads
   the same cookie or bearer token the Connect interceptor does and returns
   the identity with its credential. No session is a plain `401`, not a
   WebSocket close — a client that isn't signed in should find out from
   HTTP; a check that fails (the database down) is a `503`. Anything but a
   session is a `403`
   ([Credentials](#credentials) below).
2. **Resolve memberships and subscribe**, before the upgrade. The
   subscription exists from the moment the socket does, so nothing
   published during setup is missed.
3. **Accept the upgrade**, with origin patterns checked against the request
   host, `STOOP_PUBLIC_URL`'s host, and `STOOP_ALLOWED_WS_ORIGINS`.
4. **Register presence.** The first connection for a user announces them
   online to their spaces; the last one to close announces them offline.
   A later connection announces only a space no other connection has
   recorded yet (one joined moments ago), which is what makes several
   tabs behave like one person.
5. **Send `Ready`** — the user's id, their space ids, who is online, who
   is on do not disturb, and everyone currently in a voice channel. One frame that
   seeds all the ephemeral state the client needs, so there is no
   "connected but don't know anything yet" gap.
6. **Run two loops.** A read loop decodes client events and hands them
   to the main loop, which selects over them, the subscription, a
   30-second ping ticker, and context cancellation. Only the main loop
   changes the connection's state, so a voice report can't land after a
   kick or after the cleanup in step 7. A failed ping (10s timeout) or a
   read error ends the connection.
7. **On close**, announce the leave from any voice channel, drop presence
   if this was the last connection, and close the subscription.

### Topic membership changes mid-connection

The gateway watches the events it is already forwarding and adjusts its own
subscription:

| Event seen | Action |
| ---------- | ------ |
| `SpaceJoined` | `sub.Add("space:"+id)`, record the space in presence, announce presence into it, then send this connection who is online and in voice there — `Ready` only covered the spaces held at connect time. |
| `MemberRemoved` (this user) | Leave any voice channel there, `sub.Remove(…)`, drop the space from presence. |
| `SpaceDeleted` | Same. |
| `ChannelDeleted` | Clear anyone the gateway believed was in that voice channel. Someone taken out of a private channel hears the same event while the channel lives on; then only they are cleared. |

So joining a space mid-session starts delivering its events on the same
socket, and being kicked stops it — with no reconnect and no separate
control channel. The event stream is its own control plane.

### Credentials

Only a session opens the socket. A personal token and a bot token are
refused with `403`: they act through Connect calls, and a script that
needs to hear events uses an outgoing webhook
([integrations.md](integrations.md)). So every connection hears
everything its person may, and all of a person's connections reach the
same spaces.

**Revocation closes the socket.** Every path that deletes a session —
logout, a password change, an admin reset, deactivation, the expiry
sweep — publishes `CredentialRevoked` to the holder's topic. The gateway
forwards it only to the connection opened with that session, then closes
it with code **4001**. It goes over the bus rather than a direct
call so it works the same way a `MessageCreated` does, on every node there
might one day be. A tab signed out from another tab is therefore told at
once, and goes to the login page.

**And the session is re-verified with every ping** (every 30 s), with
the same close code when it no longer verifies; a check that fails closes
it with `1013` (try again later), so the client reconnects instead of
signing out. That is what catches what
the bus can't carry: a session past its expiry that the sweep has not
reached, a reset from the CLI (a separate process with no bus), or a
revocation published in the gap between verifying the upgrade and
subscribing.

## The wire format

Binary protobuf frames. `ServerEvent` server → client, `ClientEvent`
client → server, both single-`oneof` envelopes with `event_id` and `ts` on
the server side.

**Numbering convention: 3–9 are protocol events, 10+ are domain events.**

### ServerEvent

| # | Event | Topic | Meaning |
| - | ----- | ----- | ------- |
| 3 | `ready` | — | Connection established; carries the initial snapshot. |
| 4 | `ping` | — | Reserved. Liveness today is a WebSocket control ping every 30 s with a 10 s timeout; the envelope pair exists for clients that cannot see control frames. |
| 5 | `credential_revoked` | user | The credential this socket was opened with is gone; the socket closes with code 4001 right after. Never forwarded to a socket opened with another credential. |
| 10 | `message_created` | space / user | A `stoop.chat.v1.Message`, the same type `ListMessages` returns, with its `seq`. |
| 11 | `message_deleted` | space / user | Ids and the tombstone's `seq`. |
| 23 | `message_updated` | space / user | Edits, link previews arriving after the fact, and a root becoming a placeholder; the full row with its `seq`. |
| 12 | `channel_created` | space / user | To each participant for a new or reopened DM. |
| 24 | `channel_updated` | space | Rename, topic, post policy. |
| 25 | `channel_deleted` | space | |
| 26 | `channels_reordered` | space | |
| 30 | `channel_muted` | user | Keeps a person's other devices in step. |
| 31 | `space_muted` | user | Same, for a whole space's mute. |
| 33 | `do_not_disturb_changed` | user | Do not disturb set on any device, so every other device holds alerts alike. Also how the gateway learns of it. |
| 20 | `channel_read` | user | Same, for the read marker. |
| 13 | `space_joined` | user | Also the gateway's cue to subscribe. |
| 16 | `space_updated` | space | |
| 17 | `space_deleted` | space | |
| 18 | `member_joined` | space | |
| 14 | `member_role_changed` | space | |
| 15 | `member_removed` | space | Kick, leave, or ban. |
| 28 | `member_updated` | space | A member's avatar or username changed; refetch them (the rows read their name from the members list). |
| 39 | `groups_changed` | space | A group was created, changed or deleted; refetch the space's groups. |
| 19 | `activity_item_created` | user | |
| 21 | `presence_changed` | space | Online, offline (after the grace period), do not disturb turning on or off, including when it ends on its own, or moving between only mobile and anything else. |
| 22 | `user_typing` | space / user | |
| 27 | `reactions_changed` | space / user | The message's full reaction list and its new `seq`. |
| 32 | `message_pinned` | space | Ids, the flag, who and when, and the message's new `seq`; not the list. |
| 34 | `thread_changed` | space / user | A root's full thread summary after a reply lands or goes, and the root's new `seq`. |
| 29 | `voice_state_changed` | space / user | Join, leave, mute, camera, screen share. |

### ClientEvent

| # | Event | Notes |
| - | ----- | ----- |
| 3 | `pong` | Reserved, alongside `ping` above. |
| 10 | `typing` | Sent at most every couple of seconds while keys are pressed; the gateway rate-limits regardless. |
| 11 | `voice_state` | Sent after the LiveKit connection is up, and again on every reconnect — the gateway forgot it when the socket closed. |
| 12 | *(reserved)* | Do not disturb is set with `AuthService.SetDoNotDisturb`, not over the socket. |

The client's surface is deliberately tiny. Everything that changes durable
state is a Connect RPC; the socket carries only things that are true of a
*connection*.

## Ephemeral state

Three kinds, all in gateway memory. None is persisted except do not
disturb, which lives on the account.

### Presence and do not disturb

`presence` keeps `userID → {connection count, how many of them are
mobile, spaces, do not disturb}`.

- Online is a **connection count**, so five tabs are one presence and
  closing one of them announces nothing. Nothing else is presence: there
  is no away, and no client announces one.
- **Offline waits out a grace period** (`STOOP_PRESENCE_GRACE`, 30 s by
  default). The last connection closing arms a timer; a connection back
  before it fires cancels it, and nobody hears anything. A reload, a
  dropped network or the mobile app going to the background reads as
  staying online. A socket closed because its session ended (sign-out,
  revocation, expiry: close code 4001) skips the wait.
- **Mobile is a connection's own report**: the app opens `/ws?client=mobile`.
  Someone is *online on mobile* while every connection they hold is
  mobile. A computer connecting ends that at once; the computer leaving
  them only on mobile waits out the same grace, so a reloading tab
  doesn't flicker the mark. The report changes nothing but the person's
  own mark, so it is taken as given, like a voice report.
- **Do not disturb is stored on the account** (`users.dnd`,
  `users.dnd_until`) and set with `AuthService.SetDoNotDisturb`. The gateway
  reads it through the `DoNotDisturbLookup` port on every connect, follows
  `DoNotDisturbChanged` on the person's own topic after that, and keeps a
  timer only while it has an end, announcing when it runs out.
- **It is honoured by that person's own clients**, which hold their desktop
  banners. The server does not enforce it: activity items are still created
  and still delivered. It is a statement about this person's attention, not
  a filter other people's messages have to pass, and a server-side filter
  would silently lose things.
- `Ready.presences` snapshots it; `PresenceChanged` maintains it.
- **The web app draws it as a shape, not only a colour**
  (`styles/presence.css`): a filled dot for online, a small phone for
  online on mobile, an empty ring for offline, a dot with a bar through
  it for do not disturb, each with an accessible name saying the state
  ("online on mobile" is said only there, never written on screen).
  Offline wins over do not disturb, which wins over mobile: the dot is
  whether the person can be reached, then whether they want to be.

Chat reaches presence through `PresenceLister` for exactly one feature:
resolving `@here` to the members who are online right now.

### Typing

Relayed to the space — but only if the connection is actually subscribed to
that space, which is the check that stops a client claiming to type in
somewhere it can't see. In a DM or a private channel the gateway resolves
the people in it through `ChannelLookup.ChannelPeople` and publishes to
each `user:` topic, verifying the sender is one of them. Which kind a
channel is comes from that lookup, never from the `space_id` the client
sent. A connection remembers the channels it found to be public, so a
public channel costs one lookup per connection: a channel is private from
the day it is made or never.

Rate-limited per connection per channel to one relay every two seconds,
counted from the last relay the sender was allowed. Every client frame,
voice reports included, also passes a per-connection limit of five a
second in bursts of twenty; frames over it are dropped.
Clients also drop a typing indicator after a few seconds unless it is
refreshed, so a client that vanishes mid-keystroke doesn't leave a ghost.

### Voice state

Who is in which voice channel is **client-reported**: after connecting to
LiveKit, the client sends `VoiceState` over the gateway socket, and the
gateway broadcasts `VoiceStateChanged` to the space.

A private voice channel's roster goes to its people instead, each on
their own topic: a report from someone not in it is ignored, the
snapshot in `Ready` and after `SpaceJoined` leaves it out for anyone
else, and someone added to it is sent who is already there. A public
channel asks nothing about people.

Each entry records the **connection id** that owns it, so a second tab
disconnecting doesn't evict a voice session established by the first. State
is dropped when its owning connection closes.

LiveKit is the actual source of truth for media; this is a hint so the
sidebar can show a populated voice channel to someone who hasn't joined.
LiveKit webhooks would be a possible later reconciler — they are not a
dependency, and voice works with none configured.

## The client side

`web/src/api/ws.ts` is the whole realtime client.

**One socket, exponential backoff to 15 s.** On open it records the
connection status; when the gateway's Ready lands it refetches every
query fetched before it (`api/stale.ts`), asks every held channel log for
the changes since the seq it holds (`reconnected()` in
`api/channelLog.ts`), and re-reports voice state, because the gateway
forgot it.
A close with code 4001 (credential revoked) is the one close it does not
simply retry: it asks the server who it is, directly and a few times a
moment apart, since the tab that replaced the session may not have its
new cookie yet. Signed in: the browser holds a newer session than the
one the socket was opened with (another tab confirmed it's the person,
which replaces the session: identity.md → Confirm it's you), and the
socket reconnects with it, reporting voice state again. Signed out: the
`me` query is refetched, fails, and the shell goes to the login page. No
answer at all: the usual backoff.

**Events are applied directly to the one place that holds what they are
about** ([web.md](web.md#state-one-source-of-truth)): an event about a
message to its channel's log, every other event to the TanStack Query
cache; there is no parallel event store. This is why
`ServerEvent.message_created` carries `stoop.chat.v1.Message` rather than
a realtime-specific shape: the object that arrives on the socket is the
object the log already holds, and its `seq` says whether it is newer.

## The channel log on the client

The most intricate consequence of events carrying a position is the
message timeline, which lives in the channel log store
(`web/src/api/channelLog.ts`, `channelLogStore.ts`, `channelLogCatchUp.ts`,
the model in `web/src/core/channelLog/`;
[web.md](web.md#state-one-source-of-truth) has the parts, this section
has the behaviour).

**One log per channel.** A `ChannelLog` holds every row known by id,
tombstones included, and `seq`, the position through which every change
is known. The channel's timeline and each open thread of it are *views*:
a range of two ids over the same rows, with `hasOlder` and `hasNewer`
from the server's last answer for that edge. One row, however many views
list it, so an edit reaches the root in the channel and the same root
above its replies in one write.

**Merge by seq.** Every row that arrives — a page's, an event's, a
catch-up's, the answer to the reader's own send or edit — replaces the
held copy when its `seq` is higher, and the server's whole row (a page, a
catch-up, an answer) also wins a tie, since an event may have patched the
held copy partially under that seq (a reaction on top of an edit the
socket missed). That one comparison replaces the old client's request
bookkeeping: a page that was out while an edit landed cannot put the old
text back, because the page's copy carries a lower seq. A deletion is a
row too, a tombstone, so a stale copy cannot bring a deleted message
back. The reader's own changes before the server
answers (a reaction, a pin, their own delete hidden at once) are written
at the row's *own* seq (`patchRow`), so the event that follows, at a
higher seq, replaces them and a refusal is reverted the same way.

**Events by position.** An event whose seq is exactly the next one is
applied and the position moves. One further on is applied too (higher
wins) but marks a gap: a `ListChanges` from the held seq is owed. One at
or below the position is ignored; one about a row that isn't held, when
it carries only part of the row (a reaction, a pin, a summary), marks a
gap too, so the catch-up brings the whole row. Before the first page the
position is 0 and events are kept without judgement; the page's
`channel_seq`, read by the server before the page query, sets it (to 0
again for a channel with no messages yet, so whether a page has been
taken is kept apart from the position, `hasPage`). The log also keeps
`seenSeq`, the highest seq any event carried: a load that sets the
position below it (the server read its seq before the rows) leaves the
catch-up owed, so an event missed while the first page or a catch-up was
out is still fetched.

**Catch-up, not refetch.** A gap, and every reconnect (the gateway's
Ready, which `api/ws.ts` turns into `reconnected()` for every held log),
is one `ListChanges(channel_id, since_seq)` loop per channel
([messaging.md](messaging.md#catching-up-listchanges)): every row with a
higher seq, tombstones and thread replies included, merged by seq, a row
new to the log placed in the views that list it (shown inside a range or
beyond a live range's end, counted on the pill beyond a range that stops
short), the position moving to the channel's seq on the last page. A
message posted while this page's socket was down appears when the socket
is back, without a reload, and nothing the reader had paged in is
dropped. The loop is shared by concurrent callers, retried with backoff
capped at 15 s while the socket is open, and ended by a refusal that
won't change (no access, not found, signed out). A reconnect's catch-up
is followed by one more `ListMessages` per view with a page (the channel's
newest page, each open thread's, and an open thread's root), because a
thread's reads and mutes changed on another device meanwhile bump no seq
and come with no change; the pages refresh the rows on screen, and older
rows are put right when paged in again.

**The floor.** Retention hard-deletes rows with no tombstone and no
event, so `ListMessages` and `ListChanges` both carry the sweep's
`retention_floor_id` and the client drops a held row below it unless it
is pinned, and a reply whose root is below it unless the root is pinned
(the sweep spares a pinned root and its thread). The floor never tightens
a view's range, since a pinned row may still lie below it.

**Views.** Opening a channel asks for the newest page and makes it the
channel view's range; `before_id` and `after_id` pages grow it one page
per direction at a time; a jump (a reply quote, an activity row, `?m=`)
asks `around_id` and *replaces* the range, moving the view's generation
so a page out for the old range is dropped when it answers. **Liveness is
derived, not tracked**: `isLive = !hasNewer`. While a view stops short of
the newest row, arrivals beyond it are held and *counted*
(`pendingNewer`) on the "Jump to latest" pill rather than shown —
splicing into a range with a gap above it would be a lie about the order
of the conversation. Pressing the pill, or sending a message, replaces
the range with the newest page.

**The cap.** A view holds at most `LOG_CAP` (2,000) shown rows; past
that the end away from the reader is pruned and that end's flag set, so
paging far back makes the view stop being live. The cap is about memory;
the DOM is bounded on its own by the virtualised list
([web.md](web.md#the-message-list)). A row pruned from a view leaves the
map unless another view still lists it.

**What stays in the query cache.** Search, pins, activity and the
one-message copies fetched on their own (a linked message's card, a
thread's root before the log holds it) are request/response queries. An
event about such a message makes the client fetch the copy again; a
reconnect refetches these queries as before (`api/stale.ts`). Nothing
else about a message is in the cache, and nothing invalidates
`["messages"]` any more: `member_updated` and `groups_changed` refetch
the members and groups, which the rows read their author's name and a
group's handle from.

Following behaviour is deliberately narrow: the view follows an arrival
only when it is already at the bottom, or when the message is the reader's
own. Anything else would yank a person away from what they were reading.
