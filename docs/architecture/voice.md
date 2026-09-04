# Voice, video, and screen share

**Stoop never proxies media.** That single sentence explains most of this
document. Voice and video are WebRTC between the browser and a LiveKit
SFU; the Stoop process mints a token, proxies the signaling socket, and
otherwise stays out of the path.

The consequence is stated up front because it has bitten every operator who
skipped it: **a front door that only carries HTTP gives a silent room.**
Chat works, the voice channel populates, and nobody can hear anybody, until
a reachable TURN relay is configured. See "Front doors" below and
`docs/self-hosting.md`.

Voice is optional. With `STOOP_LIVEKIT_*` unset, `JoinVoiceChannel` returns
`Unavailable` and Stoop is a text-only chat server that ships one binary
and needs no sidecar.

## Joining

`JoinVoiceChannel` is the whole server-side surface. It:

1. Refuses immediately if voice is not configured.
2. Checks **membership before channel kind**, through
   `voice.ChannelDirectory` (backed by chat) — so a non-member gets
   "not a member" for every channel id and cannot probe which ones exist.
3. Looks up the display name through `voice.UserDirectory` (backed by
   auth), because LiveKit shows a participant name to other participants.
4. Mints a short-lived room token.
5. Returns the signaling path, the token, and any ICE servers.

The response's `livekit_url` is an **origin-relative path** (`/livekit`),
not an absolute URL. The client resolves it against the page origin, so
`ws:` follows `http:` and `wss:` follows `https:` with no configuration and
no way for a saved absolute URL to go stale behind a changed hostname.

## Tokens

LiveKit access tokens are plain HS256 JWTs carrying a `video` grant. Stoop
mints them with the standard library (`internal/voice/token.go`) rather
than depending on `livekit/protocol` for a single claim struct and its
dependency tree. The two room-management calls below are authorized by the
same tokens with a different grant, so they did not flip that trade.

- **Room = channel id. Identity = user id.** No mapping table, no
  reconciliation, and a room that stops existing when its channel does.
- **TTL is 90 seconds**, and it covers negotiation only. The client opens
  its microphone *before* it asks for a token, so the human-paced part of
  a join — a first-time browser's permission prompt, which a person can
  sit on for as long as they like — happens outside the token's life.
  Mint first and the TTL would have to be long enough for someone to go
  and find the button, which is why it used to be ten minutes.
- The grant permits publishing **any source**, which is why video and
  screen share need no separate token, no separate RPC, and no additional
  server-side concept.

## Leaving, when it isn't your idea

LiveKit checks a participant's right to be in a room **once, when the token
is minted**, and never asks again. So deleting a membership row and
broadcasting `MemberRemoved` removes a kicked member from the sidebar and
from nothing else: they go on hearing and publishing until they hang up.

Ending a call therefore has to be said out loud, to the SFU, on every path
that ends a right to be in one — `KickMember`, `BanMember`, `LeaveSpace`,
`DeleteChannel`, and `DeleteSpace`. Chat does that through
`chat.VoiceRooms`, a port backed by `internal/voice` and wired in
`internal/app`, so the direction of the dependency matches every other pair
of modules and neither imports the other.

- **A kick clears every voice channel in the space, not the one the
  gateway thinks they are in.** Voice presence is client-reported (see
  below); a client that simply never sends `VoiceState` would otherwise
  stay in the call.
- **Channel and space deletion close the room** rather than removing
  people one at a time, which also disposes of a room whose channel no
  longer exists.
- **It is best-effort.** The membership change has already committed by
  then, and a `Kick` that returned an error because the sidecar was down
  would tell an admin that nothing happened when the row is already gone.
  Failures are logged; a room or participant that isn't there is not a
  failure at all.
- **It does not run on the caller's context.** Every one of these calls
  happens after its commit, so a moderator whose browser hangs up in that
  window would otherwise cancel the enforcement and leave the person in
  the call — silently, since the reply they would have retried is gone
  too. `cleanupCtx` detaches the work and puts a single deadline over it,
  however many rooms it covers, so an unreachable sidecar costs one
  timeout rather than one per channel.
- **Every room call happens twice.** LiveKit has no revocation, so a kick
  does not invalidate a token already in someone's hand: they could
  reconnect on it and stay. `internal/voice` therefore repeats each
  removal and each room close once `TokenTTL` has passed and the last
  token that could have been minted before the kick is dead. The wait is
  padded against clock skew, and the repeat is what actually ends the
  right to be there — the immediate call just makes it quick.
  `Service.Close` abandons repeats still waiting, so a shutdown doesn't
  block on one; the cost is at most one stale participant, whom the next
  kick removes.

`internal/voice/rooms.go` makes those calls directly: LiveKit's
RoomService is Twirp over HTTP, and two endpoints are not worth an SDK.
`RemoveParticipant` carries a `roomAdmin` grant for the one room,
`DeleteRoom` a `roomCreate` grant, both on 30-second tokens.

## The signaling proxy

The browser opens LiveKit's signaling WebSocket at `/livekit` on the app
origin, and Stoop reverse-proxies it to `STOOP_LIVEKIT_URL`. One hostname
and one certificate cover the whole app; the operator configures one
upstream in their reverse proxy, not two.

The proxy is **deliberately unauthenticated**. LiveKit validates the room
token on every connection, and that token is what `JoinVoiceChannel`
gates — putting a second check in front would mean duplicating LiveKit's
own authorisation and getting it subtly wrong. But an unauthenticated
handler that opens a connection to another service is an open relay if
nothing bounds it, so it is the one plain handler behind a rate limiter
(`STOOP_SIGNALING_RATE_LIMIT`, → `429`).

`httputil.ReverseProxy` passes the WebSocket upgrade through unchanged.
LiveKit's own URL may be written `ws://` or `wss://`; the proxy rewrites
those to `http`/`https` since it speaks HTTP and upgrades.

## Media, and where it actually goes

After signaling, WebRTC connects **directly to the LiveKit sidecar's
ports** — UDP in the configured range, with TCP 7881 as a fallback. Those
ports must be reachable from the browser, or the media must be relayed.

This is not something Stoop can paper over. The reverse proxy in front of
the app carries HTTP; it does not carry UDP, and a tunnel that speaks only
HTTP cannot carry it either.

## ICE and TURN

`JoinVoiceChannel` may return `ice_servers`, which the client passes to the
Room's `rtcConfig`. That **replaces LiveKit's own list**, so any source
must include STUN as well as TURN — a list with only a relay and no
candidate-gathering server is worse than no list at all.

Two sources, in `internal/voice/ice.go`:

- **A static relay** from `STOOP_TURN_*` — coturn, or a hosted service that
  issues long-lived credentials. `STOOP_STUN_URLS` sits alongside; coturn
  answers STUN on the same port, so `stun:<host>:3478` is the usual value.
- **Cloudflare's TURN service**, whose credentials are short-lived by
  design. Stoop mints them through Cloudflare's API per join and caches
  them for a day, rather than asking an operator to paste a password that
  expires.

Both may be configured; the lists concatenate. **A failing source is logged
and skipped, never fatal to the join** — a TURN outage should degrade voice
for the people who needed a relay, not refuse the call for everyone.

The relay in force is read **per join** through `voice.RelayProvider`
(backed by instance), so changing it on the admin page applies to the next
join with no restart. The Cloudflare source object is kept across joins
because it caches minted credentials, and is replaced only when the key
changes.

## Credentials are minted, not configured

The single most common way to end up with working chat and a voice join
that dies at 15 seconds is a LiveKit API key pair that exists in two places
and disagrees. So Stoop settles it in one place, at startup
(`internal/app.livekitKeys`):

1. **Environment wins**, for anyone who already configured a pair by hand.
2. Otherwise, **a saved pair** from the `livekit` instance setting is
   reused.
3. Otherwise, if a **key file already exists with a valid pair, adopt it**.
   This is the wiped-database case — development, or Postgres restored from
   an older backup — where minting a fresh pair would produce keys the
   still-running sidecar rejects until someone restarted it.
4. Otherwise, **mint one** (`voice.GenerateKeys`) and save it.

**The file is rewritten every boot**, not only when minting, so an
environment-configured server also feeds its sidecar from one place.

The file is `0600` in a `0700` directory, because LiveKit refuses a key
file others can read ("key file others permissions must be set to 0"), and
a container sidecar running as root reads it regardless of owner. Failing
to write it **warns rather than aborting startup** — a sidecar configured
its own way still works, and refusing to boot over a key file would be a
worse failure than saying so.

Nothing is minted while LiveKit is unconfigured: no URL, no voice, no keys.

## Video and screen share

Same token, same signaling proxy, same media paths. **Nothing server-side
distinguishes them** beyond two boolean flags on the voice-state broadcast
(`camera`, `screen_sharing`), which exist so the sidebar can show a share
to people who haven't joined yet.

Watching means joining. There are no spectators — a person receiving media
is a participant, and pretending otherwise would need a second token shape
and a second permission.

Recording and media E2EE are not attempted.

### The client's track registry

The voice store keeps `tracks`, keyed by participant and source (camera or
screen, our own included for the self-view), filled by `api/voice.ts` from
LiveKit's subscribe and publish events. `components/VoiceStage.tsx` renders
it above the voice channel's chat while connected: a spotlight — the newest
share, or a pinned tile — and a strip of tiles, which are cameras where
available and avatars with a speaking ring where not.

The Room runs with `adaptiveStream` and `dynacast`. Cameras capture at
1080p with 360p and 180p simulcast layers; a screen share is 1080p at
15 fps with `contentHint: "detail"`. A tile therefore only receives the
layer its rendered size needs, and a layer nobody is watching is not sent
at all — which on a home upstream is the difference between a call working
and not.

### Stage layout

With nobody sharing, the tiles *are* the stage. `fitTiles` picks the
largest 16:9 tile that fits by sizing every candidate row count against
whichever axis runs out first, and hands out **only a width** — the strip
is `flex-wrap`, so where the row breaks is the browser's decision, not a
computed one.

Because the head count changes that width, a join re-sizes and relocates
every tile at once, which reads as a glitch rather than as an arrival. So
`hooks/useTileFlip.ts` animates it: the layout still snaps in one step —
`adaptiveStream` sees one resize per tile, not one per frame — and each
tile is then transformed back to where it was and animated to identity.

It animates on a change of *who is on stage* or of *arrangement* (grid
versus the spotlight's carousel), and **not** on a window resize, a divider
drag, or entering fullscreen, which move tiles for reasons the eye can
already account for. Duration comes from `--dur`, so reduced motion drops
it entirely.

Mute shows on the tile beside the name rather than in the sidebar, which
keeps it next to the face. Deafen stays a sidebar flag, having no tile of
its own.

### Speaking rings

Two sources, merged in `hooks/useSpeaking.ts`.

Remote participants come from LiveKit's `ActiveSpeakersChanged`, which the
server computes from audio levels: accurate, but trailing the voice by the
server's detection window plus a hop back down.

Our own ring would trail our own microphone the same way for no reason —
the signal is already in the browser — so `api/voiceLevel.ts` meters the
local mic with a Web Audio analyser. Metering subscribed *remote* audio the
same way, so that a ring lights when the voice reaches the speakers rather
than when the server noticed it, is tracked as STOOP-122.

## Presence in a voice channel

Who is in which voice channel is **client-reported**: after connecting to
LiveKit the client sends `ClientEvent.VoiceState` over the gateway
WebSocket, the gateway keeps it in memory beside presence, and broadcasts
`VoiceStateChanged` to the space. It is dropped when that WebSocket closes,
and re-reported on every reconnect.

Each entry records the connection that owns it, so a second tab closing
does not evict a voice session the first tab established.

LiveKit webhooks are a possible later reconciler, not a dependency. The
cost of being wrong is a stale name in a sidebar until the next reconnect,
which is the right amount of wrong for a hint — and nothing that enforces a
kick reads it, precisely because it is one.

## Front doors, and the one thing they all share

Stoop serves one plain HTTP listener and stays agnostic about what sits in
front of it — a reverse proxy, a Cloudflare Tunnel, Tailscale Serve. See
[runtime.md](runtime.md).

**Every front door carries chat and voice *signaling*, and none of them
carries voice *audio*.** Audio is WebRTC to LiveKit's media ports, or to a
TURN relay. An HTTP-only tunnel therefore gives a silent room unless a
reachable TURN server is configured. This must be said plainly wherever
setup guidance appears, including the setup wizard.

Exposure is made easier by two complementary pieces, both shipped and
described for operators in `docs/self-hosting.md`:

- **TURN support in Stoop** — static credentials, or Cloudflare TURN
  credentials minted per join and returned from `JoinVoiceChannel` — so
  that an HTTP-only tunnel (Cloudflare Tunnel in particular, which many
  self-hosters are pushed into by CGNAT) still gets voice with nothing
  installed on friends' devices.
- **The embedded Tailscale listener** (`internal/tailnet`), for private
  access with real certificates and no third party in the path. It carries
  LiveKit's media ports as well as HTTPS, so voice rides the tailnet with
  nothing extra installed on the server.

Both stay optional. The plain HTTP listener behind whatever proxy the
operator already runs remains the baseline.

## Development

LiveKit runs on the **host network** in development, never in a bridge
network: browsers hide their local addresses behind mDNS names, and nothing
inside a Docker bridge can resolve those, so a containerised LiveKit never
gets a media connection from a browser on the same machine even with every
port published. `make dev-services` runs it natively on macOS and as a
`network_mode: host` container on Linux.

Development also runs the same key path a self-hoster gets: `.env.dev` sets
`STOOP_LIVEKIT_URL` and no key pair, so the server mints one on first boot
and LiveKit is started against that file with `--key-file`. Wiping the
database leaves the file in place, and the adoption branch above is what
stops the next boot minting a pair the running LiveKit would reject.

The voice E2E spec is opt-in (`STOOP_E2E_VOICE=1 pnpm e2e voice`) because
it needs a running LiveKit; CI skips it.
