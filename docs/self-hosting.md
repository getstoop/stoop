# Self-hosting Stoop

Stoop is designed to run on whatever you have — an old laptop, a VPS, a
Raspberry Pi (4 or newer). The stack is three containers: the Stoop server
(one static binary with the web UI embedded), Postgres, and LiveKit for
voice. LiveKit is optional: without it Stoop is a text-only chat server.

## Quick start (Docker Compose)

```sh
mkdir stoop && cd stoop
curl -fLO https://raw.githubusercontent.com/getstoop/stoop/main/deploy/docker-compose.yml
curl -fLO https://raw.githubusercontent.com/getstoop/stoop/main/deploy/livekit.yaml
curl -fL -o .env https://raw.githubusercontent.com/getstoop/stoop/main/deploy/.env.example
# edit .env — at minimum set POSTGRES_PASSWORD
docker compose up -d
```

Voice and video work out of the box: the server mints its own LiveKit key
pair on first boot and hands it to the sidecar, so there is no secret to
generate or copy. What voice still needs from you is a reachable path for
its media — see [Voice](#voice).

Open http://localhost:8080. A fresh instance walks you through setup: create
the admin account (the first account operates the server), create your first
space, and copy an invite link for your people. Later, the Invite button in a
space's header makes more.

Database migrations run automatically at startup — upgrading is
`docker compose pull && docker compose up -d`. The compose file pins
LiveKit to an exact version that this Stoop release was tested against;
release notes say when that pin moves, and `docker compose pull` picks the
new one up with the rest.

If a release misbehaves, put the previous image tag back and start it
again. Each release keeps its schema readable by the release before it, so
a one-step rollback needs no restore. Stoop refuses to start against a
database that a much newer release has reshaped, and says so plainly,
rather than misbehaving.

## Reaching your server

Stoop listens on one plain HTTP port (`8080` in the compose file). How
people reach it from outside your machine is up to you, and Stoop is
deliberately agnostic: put whatever you already use in front of it. One
rule governs every option, so it's worth stating first:

> **Your front door carries chat and voice *signaling*. Voice *audio* does
> not go through it.** Audio is WebRTC, straight from each browser to
> LiveKit's media ports (or to a TURN relay). A tunnel or proxy that only
> forwards HTTP carries everything *except* the audio — joining a voice
> channel then fails after ~15 s with "Couldn't establish an audio
> connection". See [Voice](#voice) for what each path needs.

The setup wizard asks about this (step 3, "Reaching your server") and
the same form lives under **Server admin → Hosting** afterwards. It is a
short list of independent settings — the **public address** invite links
are built from, the **trusted proxies** in front, the built-in
**Tailscale** listener, and a **voice relay** (Cloudflare's TURN or your
own) — each optional, each behind a checkbox where it needs one. Nothing
makes you choose between them: a tailnet node and a relay can both be on
at once. One **Save changes** covers the form, but the request carries
only what you actually edited, so saving an address can't disturb a
relay. At the bottom, a line reports what the saved settings add up to
for voice. What you save there overrides the environment variables
below, and clearing a value falls back to them. Either way, three
settings matter for any front door:

- **`STOOP_PUBLIC_URL`** — the address people use to reach you, e.g.
  `https://chat.example.com`. Invite links are built from it (otherwise
  from whatever address the person copying the link happens to be on —
  an admin on the LAN would hand out a `192.168.…` link), and its host
  is always an allowed WebSocket origin. With the built-in Tailscale
  listener it defaults to the tailnet address.
- **Trusted proxies** — the addresses of anything that forwards requests
  to Stoop: your reverse proxy, a tunnel daemon, whatever sits in front.
  Set them under **Server admin → Hosting → Trusted proxies** (CIDR
  ranges or single addresses, comma-separated); they apply immediately,
  with no restart. Only requests arriving *from* those addresses have
  their `X-Forwarded-For` and `X-Forwarded-Proto` believed. This matters
  twice over:
  - session cookies are marked `Secure` for requests the proxy says
    arrived over HTTPS, and
  - **rate limits are per client address**, so without it every user
    arrives from the proxy's address and shares one sign-in budget (20
    attempts a minute — the whole household locked out together after a
    few typos).

  A proxy *appends* to `X-Forwarded-For` rather than replacing it, so
  the client is the rightmost address in that header that isn't one of
  your proxies — anything further left was typed by the caller. List
  every hop, not just the last one: with Cloudflare in front of a local
  nginx, name both the Cloudflare ranges and nginx's address, or the hop
  you left out is read as the client.

  Never name an address that isn't really your proxy. Whoever is at it
  can then claim any client address, which hands them an unlimited
  supply of fresh sign-in budgets. The older `STOOP_TRUST_PROXY=true`
  believes *every* caller's headers and is kept only for servers set up
  before addresses could be named; with nothing to tell a proxy from a
  client it takes the rightmost address as given, which is honest only
  if your proxy sets or appends that header itself rather than passing
  the caller's through unchanged. Naming addresses replaces it.
- **HTTPS is required for voice from other devices.** Browsers only allow
  microphone access (and desktop notifications, and the clipboard) on a
  secure origin. `http://localhost` counts; `http://192.168.x.x` does not.

WebSocket origins need no configuring in the usual case: Stoop accepts
connections whose `Origin` matches the request's own `Host`, and every
proxy listed below forwards `Host` by default. `STOOP_ALLOWED_WS_ORIGINS`
exists for a proxy that rewrites it.

If your ISP doesn't give you a public IPv4 address (CGNAT: Starlink,
cellular home internet, many providers abroad), you can't forward ports
at all. Then the reverse-proxy row below is off the table, and voice
audio needs either a TURN relay (Cloudflare's is the easy one, see
below) or Tailscale, which traverses CGNAT on its own.

| Front door | People need | Chat | Voice audio | Who can read your traffic |
| --- | --- | --- | --- | --- |
| Reverse proxy you already run + your domain | nothing | ✓ | ✓ direct — forward LiveKit's media ports too | nobody but your server |
| Cloudflare Tunnel | nothing | ✓ | ✓ with Cloudflare TURN (free tier, one setting); ✗ otherwise | Cloudflare sees chat and signaling; voice audio stays encrypted past it |
| Tailscale (built into Stoop, or Serve) | the Tailscale app | ✓ | ✓ — the built-in node carries LiveKit's media ports too; one setting (`NODE_IP`) completes it | nobody but your server |
| Tailscale Funnel | nothing | ✓ | ✗ unless a TURN server is reachable — Funnel carries HTTP only | nobody: TLS ends on your node; Tailscale's relays carry ciphertext |
| Just your LAN, plain HTTP | nothing | ✓ | listen-only: no microphone without HTTPS | anyone on the LAN (no encryption) |

### Privacy: who sees what

Two different things travel through a front door, and they are encrypted
differently.

- **Voice audio is encrypted between each browser and your LiveKit
  server**, always (WebRTC's SRTP, keyed by a DTLS handshake the relay is
  not part of). A TURN relay — Cloudflare's or anyone's — forwards
  packets it cannot decrypt; it sees addresses, packet sizes and timing,
  not sound. What it is *not* is person-to-person encryption: your
  LiveKit server decrypts to forward between participants, so the person
  running the box can hear the room. That's Stoop's trust model — the
  operator is one of the group — and end-to-end encryption is a deferred
  feature, not a hidden gap.
- **Chat, invite links, and voice signaling are ordinary HTTPS**, so
  whoever terminates TLS reads them. With your own reverse proxy or
  Tailscale (Serve *or* Funnel — the certificate lives on your node and
  Tailscale's relays only carry WireGuard ciphertext) that is only your
  server. With **Cloudflare Tunnel**, TLS terminates at Cloudflare's edge
  and is re-established to `cloudflared`, so Cloudflare's servers see
  every message and the LiveKit tokens in the signaling stream in
  plaintext. That is what the product is, and for many self-hosters an
  accepted trade — but it's the difference between the two "friends
  install nothing" options, so choose knowingly.

### A reverse proxy you already run

Point it at Stoop's HTTP port with WebSocket support on. Both `/ws` and
`/livekit` are WebSocket upgrades. Then forward LiveKit's media ports —
`7881/tcp` and `50000-50100/udp` — from your router straight to the
machine (not through the proxy; they aren't HTTP).

Caddy (automatic Let's Encrypt):

```
chat.example.com {
    reverse_proxy stoop:8080
}
```

Nginx Proxy Manager: a Proxy Host with scheme `http`, forward host
`stoop`, port `8080`, **Websockets Support** enabled, and a Let's Encrypt
certificate on the SSL tab.

Traefik, as labels on the `stoop` service:

```yaml
labels:
  - traefik.http.routers.stoop.rule=Host(`chat.example.com`)
  - traefik.http.routers.stoop.tls.certresolver=letsencrypt
  - traefik.http.services.stoop.loadbalancer.server.port=8080
```

Then set `STOOP_PUBLIC_URL=https://chat.example.com` in `.env` (or the
public address on the Hosting tab), and add the proxy's address under
Trusted proxies.

Stoop sends its own security headers (see [Security headers](#security-headers));
your proxy should not add or strip any of them.

### Cloudflare Tunnel

`cloudflared` works for chat exactly like any other proxy — an ingress
rule `hostname: chat.example.com`, `service: http://stoop:8080` — with
WebSockets on by default; set `STOOP_PUBLIC_URL` and name `cloudflared`'s
address under Trusted proxies as above. **Voice audio does not go through the tunnel**:
Cloudflare's public hostnames carry HTTP and WebSocket traffic only, and
WebRTC media is neither. Signaling works, but the join fails after ~15 s
with "Couldn't establish an audio connection" — unless browsers are
offered a relay. The natural one is
**Cloudflare's own TURN service**, which lives outside the tunnel at
`turn.cloudflare.com` (including TURN over TLS on 443, so it works from
strict networks) and needs no port forwarding on your side, so it also
works behind CGNAT. Standalone TURN has a free tier of 1,000 GB of
egress per month and costs $0.05/GB after that; voice audio is ~50 kbps
per stream, so a friend group stays well inside the free tier. (The
"free with the SFU" clause on Cloudflare's pricing page refers to using
their SFU in place of LiveKit, which isn't this setup.) Create a TURN key
in the Cloudflare dashboard (Realtime → TURN) and put its id and token in
`.env` — see [TURN](#turn-when-media-ports-cant-be-reached).

Without a relay, the only alternative is to **forward the media ports
anyway** (`7881/tcp`, `50000-50100/udp`): direct and best quality, but it
exposes your home IP, needs the port forwarding the tunnel was meant to
avoid, and isn't possible behind CGNAT.

Cloudflare's "private network" mode (WARP on every device) does carry
UDP, but that's the Tailscale model with different branding — it's not
"click a link".

### Tailscale, built in

Stoop can join your tailnet by itself — no Tailscale installed on the
server, no port forwarding, works behind CGNAT — and serve HTTPS with a
real certificate at `https://stoop.<tailnet>.ts.net`. Only devices on
your tailnet can reach it: invite your people to the tailnet, or
[share the node](https://tailscale.com/kb/1084/sharing) with theirs. TLS
ends inside Stoop, so nobody in between reads anything.

1. Once per tailnet: enable **HTTPS Certificates** under
   [DNS settings](https://login.tailscale.com/admin/dns). Without it the
   node joins but browsers can't connect (Stoop logs a warning saying so).
2. Turn it on from the setup wizard or **Server admin → Hosting →
   Tailscale → "Join my tailnet"**, optionally with a node
   name (default `stoop`) and an auth key from
   [the keys page](https://login.tailscale.com/admin/settings/keys).
   Without a key the page shows a login link to open once. The listener
   starts immediately — no restart — and the node identity is kept under
   `STOOP_STORAGE_DIR/tailscale`, so it survives restarts and upgrades.
   The same settings exist as `STOOP_TAILSCALE=true`,
   `STOOP_TAILSCALE_HOSTNAME`, `STOOP_TAILSCALE_AUTHKEY` in `.env` for
   people who prefer that; what's saved on the page overrides them.
3. The page shows `Running at https://…` (and the log
   `tailscale: serving url=https://…`). The plain HTTP port keeps working
   on the LAN at the same time; cookies issued over the tailnet address
   are Secure automatically, and invite links use the tailnet address
   unless a public address is set.
4. **Voice rides the tailnet too.** The node carries LiveKit's media
   ports (7881/tcp and the UDP range) as well as the web app: a packet
   addressed to one of them arrives on the node and is relayed to
   LiveKit, so a phone on cellular reaches voice and video with nothing
   installed on the server and no ports forwarded from a router. Devices
   on the same LAN as the server keep connecting to LiveKit directly.

   There is nothing to configure. A browser reaches LiveKit at whatever
   addresses LiveKit offers it, and LiveKit builds that list at startup
   from the interfaces it can see — the built-in node is not one of them,
   because it lives inside Stoop. So LiveKit has to be handed the
   address, and Stoop hands it over: it writes the address to the volume
   the two already share for the API key pair, and `livekit-entrypoint.sh`
   starts LiveKit with it. When the address appears or changes, that
   script exits, and the compose restart policy brings LiveKit straight
   back advertising the new one — the same policy that already covers a
   first start before the key file exists.

   So enabling Tailscale is the whole job. LiveKit bounces once, a few
   seconds after you save, and voice works for tailnet devices; the
   Hosting page's LiveKit section shows it back up. If you run LiveKit
   some other way than this compose file it won't restart itself, and
   `docker compose restart livekit` (or your equivalent) is what picks
   the address up. Setting `NODE_IP` in `.env` pins an address yourself,
   which wins and switches the watch off; `rtc.node_ip` in `livekit.yaml`
   does the same if you configure LiveKit that way.

   LiveKit advertises a *single* address, so a server people also reach
   straight from the internet cannot offer both. Pin the tailnet address
   for tailnet devices and add a
   [TURN](#turn-when-media-ports-cant-be-reached) relay for the rest.
   **If the server already runs the Tailscale client** and LiveKit is on
   the host network (the bare binary, or the compose file's
   `network_mode: host` variant), none of this applies: LiveKit offers
   every interface on the machine, the tailnet one included, and pairs
   with the phone's Tailscale interface by itself. Carrying media can be
   switched off with `STOOP_TAILSCALE_VOICE=false`; `STOOP_LIVEKIT_MEDIA_HOST`,
   `STOOP_LIVEKIT_TCP_PORT` and `STOOP_LIVEKIT_UDP_PORTS` say where
   LiveKit is and default to the compose sidecar's ports;
   `STOOP_LIVEKIT_NODE_IP_FILE` moves the file Stoop writes, which
   otherwise sits beside the key file.

   Bandwidth: the node is userspace WireGuard in Go, so tailnet traffic
   is encrypted in this process rather than by the kernel, and media
   crosses it like everything else. Voice for a handful of people is
   nothing; a 1080p screen share to several viewers is the case to watch
   on small hardware. A LAN or a host Tailscale client avoids the hop
   entirely.

"Publish this Stoop node to public internet (Funnel)" in the same
section — or `STOOP_TAILSCALE_FUNNEL=true` — additionally publishes the
same address to the internet through
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel), so people need
nothing installed. Ticking it is a request, not a switch: Tailscale
refuses to publish the node until your tailnet policy grants it the
`funnel` node attribute, and until then the node stays private. The page
says so where you tick it, and the Tailscale status below it repeats the
fix (with a link to the policy editor) if the listener is refused. Like Cloudflare Tunnel it carries HTTP only, so voice audio
needs a reachable [TURN](#turn-when-media-ports-cant-be-reached) server.
"I run a custom control server" — or `STOOP_TAILSCALE_CONTROL_URL` —
points the node at a self-hosted [Headscale](https://headscale.net)
instead of Tailscale's control plane. The auth key has to come from
whichever one you point at; a `tskey-auth-…` from Tailscale won't
authorise a node dialling Headscale.

What the node opens on the machine: two UDP ports (random numbers) for
WireGuard — those are how tailnet devices connect directly — and one TCP
port on a random number for Tailscale's peer API, which the embedded
network stack forwards tailnet traffic to; connections to it from the
LAN are ignored. None of them need forwarding on your router.

Already running the Tailscale client on the server? `tailscale serve --bg 8080`
does the same job from outside (same HTTPS-certificates prerequisite). For
voice, LiveKit on the host network offers the machine's tailnet address by
itself; a LiveKit container on the compose bridge network can't see that
interface, so give it `NODE_IP` from `tailscale ip -4` — that is the case
Stoop's own node handles for you.

### A LAN without HTTPS

Everything except the microphone works over plain `http://<lan-ip>:8080`.
For voice on a LAN without a domain, Caddy can terminate TLS with its own
certificate authority:

```
chat.lan {
    tls internal
    reverse_proxy stoop:8080
}
```

Trust Caddy's root certificate on each device once (`caddy trust`, or
export `/data/caddy/pki/authorities/local/root.crt`), point `chat.lan` at
the server in your router's DNS or each device's hosts file, and set
`STOOP_PUBLIC_URL=https://chat.lan`, and name Caddy's address under
Trusted proxies.

## Voice

Voice rooms run on the LiveKit sidecar. Stoop hands the browser a
short-lived room token, proxies LiveKit's signaling connection at
`/livekit` on its own origin, and the audio flows directly between each
browser and LiveKit over WebRTC. Three things have to be true:

1. **Keys — nothing to do.** Stoop mints a LiveKit API key pair on its
   first boot, keeps it with its other settings, and writes it to the
   `livekit-keys` volume; the compose file starts LiveKit with
   `--key-file`, so the pair lives in one place and there is no secret to
   copy. (It used to be yours to generate and paste into two files, which
   is how installs ended up with working chat and a voice join that died
   after ~15 s.)

   Set `STOOP_LIVEKIT_API_KEY` / `STOOP_LIVEKIT_API_SECRET` in `.env` only
   to reuse a pair you already have — a LiveKit you run elsewhere, or
   LiveKit Cloud. Those win over the minted pair, and Stoop still writes
   the key file, so the sidecar needs no change either way. Voice stays
   off entirely when `STOOP_LIVEKIT_URL` is empty; joining then fails with
   "voice is not configured".
2. **Media ports reachable.** Browsers must reach `7881/tcp` and
   `50000-50100/udp` (the range in `livekit.yaml`) on the machine. Port
   7880 is only used by Stoop's proxy and is not published by the compose
   file. `use_external_ip: true` in `livekit.yaml` lets LiveKit discover
   the public address to advertise; on a LAN-only install, or over
   Tailscale, set `rtc.node_ip` instead.
3. **HTTPS**, as above.

### TURN, when media ports can't be reached

When browsers can't reach the media ports directly — Cloudflare Tunnel,
Tailscale Funnel, or a network that blocks UDP — WebRTC falls back to a
TURN relay *if one is offered*. The relay has to be reachable itself, so
it can't hide behind the same tunnel. Two ways to offer one:

- **LiveKit's built-in TURN** (`turn:` in `livekit.yaml`: `enabled: true`,
  a `domain` with a certificate, `tls_port: 5349`, `udp_port: 3478`).
  Browsers then only need one TCP port, which is friendlier to forward
  than a UDP range — but it's still a forwarded port on the machine.
- **Cloudflare TURN — the one-setting option.** In the Cloudflare
  dashboard create a TURN key (Realtime → TURN) and paste its id and
  token under **Server admin → Hosting → Voice relay → "Cloudflare's TURN
  relay"**, in the wizard or afterwards (or put them in
  `.env` as `STOOP_CLOUDFLARE_TURN_KEY_ID` and
  `STOOP_CLOUDFLARE_TURN_API_TOKEN`). Stoop mints short-lived credentials
  through Cloudflare's API (one batch a day, shared by every join) and
  hands them to the browser; nothing to forward, nothing in
  `livekit.yaml`, works behind CGNAT. If Cloudflare's API is ever
  unreachable, joins still go ahead without the relay rather than
  failing.
- **Your own TURN server with fixed credentials** — coturn on a cheap
  VPS, or a hosted service that issues long-lived credentials — under
  "I run my own TURN relay" on the same page, or in `.env`: `STOOP_TURN_URLS` (comma-separated, e.g.
  `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349`),
  `STOOP_TURN_USERNAME`, `STOOP_TURN_CREDENTIAL`, and `STOOP_STUN_URLS`
  (coturn answers STUN on the same port: `stun:turn.example.com:3478`).
  Include STUN: when Stoop supplies ICE servers, browsers use that list
  instead of LiveKit's, and without STUN they can't find a direct path.
- **LiveKit's own configuration** (`rtc.turn_servers`, or its built-in
  TURN under `turn:`) still works when Stoop supplies nothing; see the
  [LiveKit self-hosting docs](https://docs.livekit.io/home/self-hosting/deployment/).

Both Stoop options may be set at once — browsers try every server they
are given. Audio is ~50 kbps per stream, so a relay's bandwidth bill is
small whichever you pick.

### Video and screen share: what it costs

Cameras and screen shares ride the same LiveKit paths as audio — same
ports, same TURN relay — so if voice works, video works. What changes is
bandwidth. LiveKit is a selective forwarding unit: every viewer gets
their own copy from the server, so a 1080p screen share watched by five
people is roughly **10–12 Mbps *up* from your server**, and a camera in
the spotlight is 3–4 Mbps per viewer. Two things keep that in check:
cameras publish three layers (1080p, 360p, 180p) and a viewer only
receives the layer their tile is actually showing, and a layer nobody is
looking at isn't sent at all — so the tile strip is cheap and only the
spotlight costs full rate. Behind Cloudflare Tunnel the relay carries
that traffic too, so it counts against the TURN allowance. A residential
uplink handles a share for a handful of people; for more, put the server
somewhere with real upstream. Screen sharing isn't available from phone
browsers (they lack the capture API); cameras are.

### Troubleshooting voice

| Symptom | Cause |
| --- | --- |
| Joining fails with "voice is not configured" | `STOOP_LIVEKIT_*` not set on the Stoop side |
| Joining fails with an error mentioning the microphone; or you join but the mic button is stuck muted | Not a secure origin — you need HTTPS off `localhost` |
| Joining fails after ~15 s with "Couldn't establish an audio connection" | Media ports unreachable from that network: not forwarded, wrong `node_ip`, or an HTTP-only tunnel with no TURN. `docker compose logs livekit` shows "removing participant without connection" with the ICE candidates it tried |
| Everyone shows as connected, nobody hears anyone | The same, but the media path broke after the join (a network change); leave and rejoin, then check the row above |
| A participant lingers after their tab closed | Their WebSocket to Stoop hadn't dropped yet; it clears when it does (seconds) |

### Voice in development

Browsers hide their local IP addresses behind mDNS names, and nothing
inside a Docker bridge network can resolve those — so a containerised
LiveKit never gets a media connection from a browser on the same machine,
even with every port published. `make dev-services` therefore runs LiveKit
on the host network: natively on macOS (`brew install livekit`; log in
`tmp/livekit.log`, `make dev-services-stop` stops it) and as a
`network_mode: host` container on Linux (compose profile `linux`). Both use
`deploy/livekit.dev.yaml`, and `.env.dev` points the server at it with
`STOOP_LIVEKIT_URL` only — no key pair. Development runs the same path a
self-hoster gets: the server mints a pair on first boot and writes
`data/livekit/keys.yaml`, and LiveKit is started against that file with
`--key-file`. Because `make dev-services` starts LiveKit before the server,
it waits for the file to appear on a fresh checkout; wiping the database
(`make dev-reset`, or an e2e run) leaves the file in place and the server
adopts the pair it finds rather than minting one the running LiveKit would
reject. Testing from a second device on the LAN needs one of the
HTTPS setups above; for a quick check, Chrome's
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` with
`http://<lan-ip>:8091` does the job on that one device.

## Bare binary (no Docker)

Release binaries are static with the web UI embedded — no runtime
dependencies beyond Postgres (and a LiveKit server if you want voice):

```sh
STOOP_DATABASE_URL=postgres://stoop:secret@localhost:5432/stoop ./stoop
```

`./stoop --version` prints the release and commit; the same appears in
the first log line and, for admins, under Server admin → Server.

For voice, point it at your LiveKit with `STOOP_LIVEKIT_URL` and start
LiveKit against the key file Stoop writes:

```sh
STOOP_LIVEKIT_URL=http://127.0.0.1:7880 ./stoop      # mints on first boot
livekit-server --config livekit.yaml \
  --key-file ./data/livekit/keys.yaml                 # same pair, no copying
```

LiveKit refuses a key file others can read, so leave it `0600` as written.
Start Stoop first: LiveKit exits if the file isn't there yet.

## Configuration reference

| Variable                   | Default                     | Purpose                          |
| -------------------------- | --------------------------- | -------------------------------- |
| `STOOP_DATABASE_URL`       | (required)                  | Postgres connection string       |
| `STOOP_LISTEN_ADDR`        | `:8080`                     | HTTP bind address                |
| `STOOP_PUBLIC_URL`         | (empty)                     | The address people use to reach the server; invite links use it, its host is an allowed WS origin. Defaults to the tailnet address with the built-in Tailscale listener |
| `STOOP_TRUST_PROXY`        | `false`                     | Believe `X-Forwarded-For` / `X-Forwarded-Proto` from **every** caller, taking the header's rightmost address as the client. Blunt, and spoofable unless the proxy sets or appends the header itself; prefer naming your proxy's address under Server admin → Hosting → Trusted proxies, which overrides this |
| `STOOP_SECURE_COOKIES`     | `false`                     | Force session cookies Secure on every listener. Rarely needed: TLS listeners and trusted HTTPS proxies get it automatically |
| `STOOP_ALLOWED_WS_ORIGINS` | `localhost:*,127.0.0.1:*`   | Extra WebSocket origin patterns. The request's own host (and `STOOP_PUBLIC_URL`'s) is always allowed, so this is only needed behind a proxy that rewrites `Host` |
| `STOOP_AUTH_RATE_LIMIT`    | `20`                        | Sign-in and registration attempts allowed per client address per minute. `0` disables (dev/e2e only). The per-account lockout after 5 wrong passwords is always on |
| `STOOP_SIGNALING_RATE_LIMIT` | `30`                      | New voice signaling connections per client address per minute (the LiveKit proxy is unauthenticated; this keeps it from being an open relay). `0` disables |
| `STOOP_REGISTRATION`       | `invite`                    | Seeds the registration policy on first boot only (`open`, `invite`, `closed`); change it later from the admin page |
| `STOOP_INSTANCE_NAME`      | (random, e.g. `Chalk Avenue`) | The server's name, shown in the browser tab. Unset, a random two-word name is picked on first boot and kept, so several instances never all call themselves "Stoop". The admin page's saved value overrides it |
| `STOOP_STORAGE`            | `fs`                        | File storage backend. `fs` is the only one today; any other value (including `s3`) refuses to start |
| `STOOP_STORAGE_DIR`        | `./data`                    | Directory for uploaded files (compose: `/data` on the `stoop-data` volume) |
| `STOOP_LIVEKIT_KEY_FILE`   | `<STOOP_STORAGE_DIR>/livekit/keys.yaml` | Where to write the LiveKit key pair for a sidecar started with `--key-file`. Written on every boot (minted or from the environment); the file is `0600` in a `0700` directory because LiveKit refuses a key file others can read |
| `STOOP_LINK_PREVIEWS`      | `true`                      | Fetch Open Graph cards for links in messages. The server fetches (readers' browsers never contact the site); set `false` if the server should make no outbound requests on members' behalf |
| `STOOP_FILE_SWEEP_INTERVAL` | `6h`                       | How often unreferenced uploads, stray blobs and old read activity items are removed; `0` turns the timer off (the admin page can still sweep) |
| `STOOP_FILE_SWEEP_GRACE`   | `24h`                       | How old an unreferenced file must be before the sweep takes it |
| `STOOP_ACTIVITY_RETENTION` | `720h`                      | Read mention/reply/DM activity items older than this are removed on the sweep timer; `0` keeps them forever |
| `STOOP_UNFURL_ALLOW_PRIVATE` | `false`                   | Let link previews fetch private/loopback addresses. **Dev and tests only** — it is what stops the server being used as a proxy into your LAN |
| `STOOP_LIVEKIT_URL`        | (empty)                     | LiveKit sidecar address the app proxies signaling to, e.g. `http://livekit:7880` (voice) |
| `STOOP_LIVEKIT_API_KEY`    | (empty)                     | LiveKit API key (voice is off until key and secret are set) |
| `STOOP_LIVEKIT_API_SECRET` | (empty)                     | LiveKit API secret               |
| `STOOP_TURN_URLS`          | (empty)                     | Comma-separated TURN URLs of your own relay (voice); needs the two below |
| `STOOP_TURN_USERNAME`      | (empty)                     | Credentials for `STOOP_TURN_URLS` |
| `STOOP_TURN_CREDENTIAL`    | (empty)                     | |
| `STOOP_STUN_URLS`          | (empty)                     | STUN URLs offered alongside your relay |
| `STOOP_CLOUDFLARE_TURN_KEY_ID` | (empty)                 | Cloudflare TURN key id; Stoop mints credentials per join (voice through HTTP-only tunnels / CGNAT) |
| `STOOP_CLOUDFLARE_TURN_API_TOKEN` | (empty)              | Its API token; set together with the key id |
| `STOOP_TAILSCALE`          | `false`                     | Join a tailnet from inside the binary and serve HTTPS on the tailnet address (see Tailscale, built in). Settings saved on the admin page override these |
| `STOOP_TAILSCALE_HOSTNAME` | `stoop`                     | Node name on the tailnet         |
| `STOOP_TAILSCALE_AUTHKEY`  | (empty)                     | Pre-authorise the node; otherwise a login URL is logged on first start |
| `STOOP_TAILSCALE_CONTROL_URL` | (empty)                  | Self-hosted control server (Headscale) |
| `STOOP_TAILSCALE_FUNNEL`   | `false`                     | Also expose the tailnet address publicly via Funnel (HTTP only — voice needs TURN) |
| `STOOP_OIDC_ISSUER`        | (empty)                     | One OIDC login provider from the environment: the issuer URL exactly as its discovery document states it. The admin page's saved list overrides this |
| `STOOP_OIDC_CLIENT_ID`     | (empty)                     | The provider's client id; set together with the secret and issuer |
| `STOOP_OIDC_CLIENT_SECRET` | (empty)                     | The provider's client secret |
| `STOOP_OIDC_NAME`          | `Continue with single sign-on` | The sign-in button's entire text |
| `STOOP_OIDC_ID`            | `sso`                       | The provider's stable id; part of the callback URL, and identities link under it |
| `STOOP_PASSWORD_SIGN_IN`   | `everyone`                  | Who may use the username/password form: `everyone`, `admins`, or `off` (sign in through login providers instead). The admin page's saved value overrides it; admins are always honoured as a fallback |

## Themes

Nothing to configure: each person picks their own look under
**Profile → Appearance** (ten palettes, or "follow the system's
light/dark setting"), and the choice is kept in their browser. Neither
the server nor a space admin sets anyone's theme.

## File storage

Uploaded files — avatars, space icons, and message attachments (up to
100 MB each by default, ten per message) — are stored on the local filesystem under
`STOOP_STORAGE_DIR` — `./data` relative to the server's
working directory for the bare binary, `/data` on the `stoop-data` volume
in the compose file. Files are served by Stoop itself at `/files/{id}`
with the same session checks as everything else, so nothing in that
directory needs to be reachable by the web.

Files attached to a message are deleted with it. Two things are not
cleaned up yet and simply take disk: uploads that were never sent (the
user picked a file and closed the tab), and attachments in a channel or
space that was deleted. A sweep for both is planned; until then they are
harmless and small.

### Video and audio

Video and audio attachments play in the message, straight from the
uploaded bytes: the server does no transcoding and makes no thumbnails
(both would need ffmpeg next to the binary), it serves the file with
HTTP Range support so the browser can stream and seek. What plays is
therefore what the viewer's browser can decode. Safe everywhere: MP4
with H.264 video and AAC audio, WebM with VP8/VP9/AV1, MP3, and M4A. An
iPhone's `.mov` is served as QuickTime and plays where the browser
supports its codecs — Safari always; Chrome and Firefox only when the
clip is H.264 rather than HEVC ("High Efficiency" in the iPhone's camera
settings). A clip the browser can't play shows as a download card.

The 100 MB cap is deliberate and stops there. Uploads are one HTTP
request, and Cloudflare Tunnel on the free plan (the [front door](#reaching-your-server)
most installs use) rejects request bodies above 100 MB; raising the cap
means chunked uploads, which is planned but not built. Long videos are
best shared as a link.

You can come *down* from it: the admin page's Storage tab sets **Maximum
size per file**, the cap on one attachment, and a Pi with a small card
wants a number well below the ceiling. It is per file, not per message —
ten of them can still ride on one message. The composer refuses a bigger file before
uploading it, and the server refuses it regardless. Avatars and space
icons are resized by the server and are not measured against it.

There is no object-storage option yet. `STOOP_STORAGE` exists so the
choice has a home, but `fs` is the only value it accepts: setting `s3`
makes the server exit at startup with a message saying so, rather than
silently keeping files on disk. An S3-compatible backend (AWS, B2, R2,
or a self-run MinIO/Garage) is on the roadmap.

## Backups

Two things hold your data: the Postgres database and the uploads directory
(`STOOP_STORAGE_DIR`; the `stoop-data` volume in the compose file), which
holds avatars, space icons, and message attachments. Back up both — a
database dump alone restores every message but points at files that are
gone. The `docker compose` volumes are `postgres-data` and `stoop-data`.
LiveKit holds no state.

## Upload storage: the sweep and the quota

Uploads that are never sent, attachments of deleted channels and spaces,
and replaced avatars and icons are removed by a sweep that runs an hour
after start and then every `STOOP_FILE_SWEEP_INTERVAL` (default `6h`;
`0` turns the timer off). Only files older than `STOOP_FILE_SWEEP_GRACE`
(default `24h`) qualify, so a draft's attachment is never taken from
under it. The admin page's Storage tab shows usage and sets the **Upload storage
limit** on total upload storage (0 = unlimited); past it, uploads are
refused with a message that says how full the server is. Next to it,
**Maximum size per file** caps one attachment, so a single upload cannot
take the whole quota (see [File storage](#file-storage)). **Clean up disk**
runs the sweep on demand.

The same timer also prunes **activity**: mention, reply and DM
items that have been read for longer than `STOOP_ACTIVITY_RETENTION`
(default `720h`, thirty days; `0` keeps them forever) are removed. Unread
ones are never touched.

## Privacy of direct messages

Direct messages are private *in the app*: nothing lets a server admin
list or read a conversation they are not part of, and a file sent in a
DM is served only to the people in it. They are not private from the
machine. Like every message, DMs sit in Postgres in plaintext and in
your backups, readable by anyone with the database password or the
disk. Stoop does not do end-to-end encryption today; tell your people
that before they assume otherwise.

## Security headers

Stoop sets these on every response; there is nothing to configure.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | see below |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone and screen share for Stoop itself; everything else refused |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000`, **only** over HTTPS |

HSTS is a one-year promise a browser will not let you take back, so it
is sent only when the request actually arrived over TLS — directly, or
with `X-Forwarded-Proto: https` from an address you named under Trusted
proxies. A LAN or tailnet install reached over plain HTTP never gets it,
and it is deliberately *not* `includeSubDomains`: a Stoop server is
usually one name among several on your domain.

The content policy is "everything comes from this server". The app
serves its own bundles, styles, avatars, attachments and the link-preview
images it fetched, so `default-src 'self'` covers almost all of it. The
exceptions:

- `script-src` names the SHA-256 of the one inline script in
  `index.html` — the theme stamp, which has to run before the first
  paint. Every other inline script is refused.
- `style-src` allows inline styles, which React writes for a few
  positioned popovers and the storage bar.
- `img-src`/`media-src` allow `blob:` and `data:` for a picked file's
  preview before it is uploaded.
- `worker-src` allows `blob:` for `livekit-client`.
- `connect-src` allows the websockets on this same origin — the realtime
  gateway and the LiveKit signaling proxy.

If you put a reverse proxy in front, leave these alone: adding a second
`Content-Security-Policy` header does not replace Stoop's, it applies
*both*, and the intersection blocks part of the app. Do not add
`includeSubDomains` or `preload` on Stoop's behalf either unless you own
every name under that domain.

## Keeping people out

Two tools, at two levels:

- **Kick and ban** (space owners and admins): both live in *Space
  settings → Members* — a profile card never carries them, so nobody
  removes someone with a stray click. A kick only removes: they can
  come back with any invite link. A ban removes them *and* refuses
  every invite link until someone unbans them under *Space settings →
  Banned*. Either one also disconnects them from the space's voice
  channels; if the LiveKit sidecar is unreachable the removal is logged
  as a warning and they stay in the call until they hang up.
- **Block** (anyone): from a person's card, undone from your profile
  page. No direct messages either way, and no mention, reply or DM
  alerts from them. Their messages in shared channels still show.

Neither tells the other person why. Deleting someone's account outright
is the server admin's job on the admin page.

## Who can create accounts

By default new accounts need a space invite code (the first account, created
during setup, is exempt and becomes the server admin). The admin can change
this at runtime under **Server admin** (the ⚙ in the rail): *Invite only*,
*Open*, or *Closed* (admin-created accounts only). `STOOP_REGISTRATION=open|invite|closed`
only seeds the initial value on first boot.

An invite link works for newcomers and existing accounts alike: the
landing page asks "new here, or already have an account?", and someone
who is a member of another space on the server just logs in and joins.
Under *Closed*, only the log-in path is offered.

The policy covers login providers too: "Continue with Google" from an
invite link creates the account and redeems the invite in one go, and
under *Closed* a provider only signs in accounts that already exist (or
were linked from a profile).

## Signing in with an identity provider

People can sign in — and, policy permitting, create their account — with
an identity they already have, instead of a Stoop password. Any OIDC
provider works: a self-hosted IdP (Authentik, Authelia, Keycloak,
Pocket ID), Google, or Microsoft (with a tenant id; the `common`
pseudo-tenant is not supported). Configure it under **Server admin →
Login**:

1. Set a public URL first (Hosting tab) — the provider console needs the
   exact callback URL, `https://<public url>/auth/callback/<id>`, which
   the Login tab shows with a copy button.
2. Create an "OAuth2/OpenID" application in your provider's console with
   that callback (redirect) URL, and paste the issuer URL, client id, and
   client secret into the Login tab. The secret is write-only: the server
   never shows it again.
3. The login page now offers "Continue with …". An existing account can
   attach the provider from **Profile → Linked accounts**; an account
   created through a provider has no password until it sets one on the
   profile page (do that — it keeps you out of trouble if the provider
   goes away, and it's required before unlinking the only identity).

One provider can also come from the environment (`STOOP_OIDC_*` below);
the admin page's saved list overrides it, same as reachability. Sign-ins
survive a server restart, but a sign-in *in flight* across one is
abandoned with "sign-in took too long" — just click the button again.
The public URL's scheme must match how people actually reach the server
(https behind a proxy or tunnel), or the sign-in state cookie is lost on
the way back.

### Turning passwords off

Once a provider works, **Server admin → Login → Password sign-in** can
restrict the username/password form to *Server admins only* or turn it
*Off*, so the server stops being a password store. Members then sign in
(and, policy permitting, sign up) only through providers. The server
refuses to restrict it while no provider is configured.

Admins are the break-glass: the server always honours an admin's
password, and `/login?password=1` shows the hidden form. Mind that an
admin who signed up *through* a provider has no password — set one on
your profile (the card stays visible to admins) or, if the provider is
down and nobody can log in, use the CLI on the server:
`stoop admin password-login everyone` flips the setting back and
`stoop admin reset-password <username>` gives any account a temporary
password.

Privacy: the provider learns that this person signs in to *this server*
(the callback URL names it) and when. A self-hosted IdP keeps that
knowledge at home. The server stores which provider identity belongs to
which account and nothing else — no provider tokens.

## Forgotten passwords

There is no email, so nobody can reset their own password. If a login
provider is linked, "Continue with …" still works. Otherwise a server admin
resets it for them: Server admin → Accounts → **Reset password** sets a
temporary password, shows it once (copy it and pass it on), and signs the
account out everywhere; the person then picks a new one on their profile
page. If the admin is the one locked out, use the CLI below.

## Locked out of admin?

The binary doubles as a maintenance CLI: `stoop` with `admin` as its first
argument runs the command and exits instead of serving. It reads
`STOOP_DATABASE_URL` from the same environment and talks to the database
directly, so the server can keep running:

```
stoop admin list
stoop admin promote <username>
stoop admin demote <username>
stoop admin reset-password <username>
```

It refuses to demote the last active admin. With the bare binary, run it
by path (`./stoop admin list`) or put it on your `PATH`. In Docker the
image installs it at `/usr/local/bin/stoop`, so:
`docker compose exec stoop stoop admin promote <username>` (the first
`stoop` is the compose service, the second the command).
