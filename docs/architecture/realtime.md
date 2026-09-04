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
              gateway writes a binary frame ──► ws.ts applies it to the query cache
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
membership.

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

- Events are **best-effort**. There is no replay, no acknowledgement, no
  sequence number a client could use to detect a gap.
- **`ListMessages` is the source of truth**, always. The socket is an
  optimisation over polling, not a separate protocol with its own state.
- Recovery is uniform: on reconnect the client invalidates every query and
  lets them refetch. That path runs on every reconnect, not just after a
  drop, so it is exercised constantly rather than being a rarely-taken
  branch that rots.

Because every payload is a protobuf message, a multi-node implementation of
`Bus` — NATS, Redis — is a marshal/unmarshal wrapper behind the same
interface. That is the only concession the codebase makes to multi-node
scaling, and it costs nothing today.

## The gateway

One goroutine group per connection, in `internal/realtime`. It holds no
database handle — the linter forbids it from importing `dbgen` — so
everything it knows comes from three ports: `SessionVerifier` (auth),
`MembershipLister` and `ChannelLookup` (chat).

### Connection lifecycle

1. **Authenticate before upgrading.** `SessionVerifier.VerifyRequest` reads
   the same cookie or bearer token the Connect interceptor does. A failure
   is a plain `401`, not a WebSocket close — a client that isn't signed in
   should find out from HTTP.
2. **Resolve memberships and subscribe**, before the upgrade. The
   subscription exists from the moment the socket does, so nothing
   published during setup is missed.
3. **Accept the upgrade**, with origin patterns checked against the request
   host, `STOOP_PUBLIC_URL`'s host, and `STOOP_ALLOWED_WS_ORIGINS`.
4. **Register presence.** The first connection for a user announces them
   online to their spaces; the last one to close announces them offline.
   Intermediate connections change nothing, which is what makes several
   tabs behave like one person.
5. **Send `Ready`** — the user's id, their space ids, who is online with
   their status, and everyone currently in a voice channel. One frame that
   seeds all the ephemeral state the client needs, so there is no
   "connected but don't know anything yet" gap.
6. **Run two loops.** A read loop handles client events; the main loop
   selects over the subscription, a 30-second ping ticker, and context
   cancellation. A failed ping (10s timeout) or a read error ends the
   connection.
7. **On close**, announce the leave from any voice channel, drop presence
   if this was the last connection, and close the subscription.

### Topic membership changes mid-connection

The gateway watches the events it is already forwarding and adjusts its own
subscription:

| Event seen | Action |
| ---------- | ------ |
| `SpaceJoined` | `sub.Add("space:"+id)`, record the space in presence, announce presence into it. |
| `MemberRemoved` (this user) | Leave any voice channel there, `sub.Remove(…)`, drop the space from presence. |
| `SpaceDeleted` | Same. |
| `ChannelDeleted` | Clear anyone the gateway believed was in that voice channel. |

So joining a space mid-session starts delivering its events on the same
socket, and being kicked stops it — with no reconnect and no separate
control channel. The event stream is its own control plane.

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
| 10 | `message_created` | space / user | A `stoop.chat.v1.Message`, the same type `ListMessages` returns. |
| 11 | `message_deleted` | space / user | |
| 23 | `message_updated` | space / user | Edits, and link previews arriving after the fact. |
| 12 | `channel_created` | space | |
| 24 | `channel_updated` | space | Rename, topic. |
| 25 | `channel_deleted` | space | |
| 26 | `channels_reordered` | space | |
| 30 | `channel_muted` | user | Keeps a person's other devices in step. |
| 31 | `space_muted` | user | Same, for a whole space's mute. |
| 20 | `channel_read` | user | Same, for the read marker. |
| 13 | `space_joined` | user | Also the gateway's cue to subscribe. |
| 16 | `space_updated` | space | |
| 17 | `space_deleted` | space | |
| 18 | `member_joined` | space | |
| 14 | `member_role_changed` | space | |
| 15 | `member_removed` | space | Kick, leave, or ban. |
| 28 | `member_updated` | space | A member's profile or avatar changed; refetch them. |
| 19 | `activity_item_created` | user | |
| 21 | `presence_changed` | space | Online, offline, or a status change. |
| 22 | `user_typing` | space / user | |
| 27 | `reactions_changed` | space / user | |
| 29 | `voice_state_changed` | space | Join, leave, mute, camera, screen share. |

### ClientEvent

| # | Event | Notes |
| - | ----- | ----- |
| 3 | `pong` | Reserved, alongside `ping` above. |
| 10 | `typing` | Sent at most every couple of seconds while keys are pressed; the gateway rate-limits regardless. |
| 11 | `voice_state` | Sent after the LiveKit connection is up, and again on every reconnect — the gateway forgot it when the socket closed. |
| 12 | `set_status` | Sent after every `Ready`, from a per-browser preference, and when an idle timer fires. |

The client's surface is deliberately tiny. Everything that changes durable
state is a Connect RPC; the socket carries only things that are true of a
*connection*.

## Ephemeral state

Three kinds, all in gateway memory, none persisted.

### Presence and status

`presence` keeps `userID → {connection count, spaces, status}`.

- Online is a **connection count**, so five tabs are one presence and
  closing one of them announces nothing.
- **Status** (`ONLINE`, `AWAY`, `DND`) is set by the client with
  `SetStatus` after every `Ready` — from a per-browser preference — and
  automatically set to Away by the client after ten idle minutes. The last
  `SetStatus` from any of a user's connections wins.
- **Do not disturb is honoured by that user's own client**, which suppresses
  its desktop banners. The server does not enforce it: activity items are
  still created and still delivered. DND is a statement about this person's
  attention, not a filter other people's messages have to pass, and a
  server-side filter would silently lose things.
- `Ready.presences` snapshots it; `PresenceChanged` maintains it.

Chat reaches presence through `PresenceLister` for exactly one feature:
resolving `@here` to the members who are online right now.

### Typing

Relayed to the space — but only if the connection is actually subscribed to
that space, which is the check that stops a client claiming to type in
somewhere it can't see. In a DM the event carries an empty `space_id`, and
the gateway resolves participants through `ChannelLookup.DMParticipants`
and publishes to each `user:` topic, verifying the sender is one of them.

Rate-limited per connection per channel to one relay every two seconds.
Clients also drop a typing indicator after a few seconds unless it is
refreshed, so a client that vanishes mid-keystroke doesn't leave a ghost.

### Voice state

Who is in which voice channel is **client-reported**: after connecting to
LiveKit, the client sends `VoiceState` over the gateway socket, and the
gateway broadcasts `VoiceStateChanged` to the space.

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
connection status; on a *re*connect it calls `queryClient.invalidateQueries()`
— everything — and re-reports voice state, because the gateway forgot it.

**Events are applied directly to the TanStack Query cache.** There is no
parallel event store and no reducer layer. A `message_created` is spliced
into `["messages", channelId]`; a `member_updated` invalidates that member;
a `presence_changed` updates the connection store. Rendered state has one
source of truth, and a component that reads the cache cannot disagree with
one that listened to the socket, because there is only the cache.

This is why `ServerEvent.message_created` carries `stoop.chat.v1.Message`
rather than a realtime-specific shape: the object that arrives on the
socket is the object the cache already holds.

## History windows

The most intricate consequence of "events go into the cache" is the message
timeline, which lives in `web/src/api/history.ts`.

A channel's messages are **one flat, oldest-first array** at
`["messages", channelId]` — a contiguous *window* of the channel. Not
pages, not a map of ranges: one array, so every feature that reads the
cache sees one timeline regardless of how it got filled.

`ListMessages` fills it three ways, and they are mutually exclusive:

| Parameter | Direction | Used by |
| --------- | --------- | ------- |
| *(none)* | The newest page | Opening a channel. |
| `before_id` | Older | Scrolling up. |
| `after_id` | Newer | Scrolling down after a jump. |
| `around_id` | A page centred on one message | Reply quotes, activity, `?m=<id>` links — in one round trip. |

The response reports `has_older` and `has_newer`, so the client knows where
the window's edges are without guessing from page sizes.

**Liveness is derived, not tracked**: `isLive = !hasNewer`. A window that
reaches the newest message is live, and realtime appends to it. While it
isn't live, arrivals are *counted* on the "Jump to latest" pill rather than
spliced in — splicing into a window that has a gap above it would be a lie
about the order of the conversation. Pressing the pill, or sending a
message, refetches the newest page.

**The window is capped at 300 rows** (`WINDOW_CAP`). Paging in one
direction prunes the far end, and the pruning sets the opposite edge flag:
dropping the newest rows to prepend older ones means the window no longer
ends at the newest message, so `hasNewer` becomes true and the timeline
stops being live. That is what keeps the DOM bounded without
virtualization, and the flag bookkeeping is what keeps it *correct* while
bounded.

Following behaviour is deliberately narrow: the view follows an arrival
only when it is already at the bottom, or when the message is the reader's
own. Anything else would yank a person away from what they were reading.
