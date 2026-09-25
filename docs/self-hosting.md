# Self-hosting Stoop

Stoop is designed to run on whatever you have — an old laptop, a VPS, a
Raspberry Pi (4 or newer). The stack is three containers: the Stoop server
(one static binary with the web UI embedded), Postgres, and LiveKit for
voice. LiveKit is optional: without it Stoop is a text-only chat server.

## Quick start (Docker Compose)

```sh
mkdir stoop && cd stoop
R=https://github.com/getstoop/stoop/releases/latest/download
curl -fLO $R/docker-compose.yml
curl -fLO $R/livekit.yaml
curl -fLO $R/livekit-entrypoint.sh
curl -fL -o .env $R/env.example
# edit .env — at minimum set POSTGRES_PASSWORD
docker compose up -d
```

The four files come from the release itself, so they always match the
image the compose file pins. The compose file needs Docker Compose 2.20 or
newer (`docker compose version`).

Open http://localhost:8080. A fresh instance walks you through setup: create
the admin account (the first account operates the server), create your first
space, and copy an invite link for your people. Later, the Invite button in a
space's header makes more.

`docker compose ps` shows `stoop` as healthy once it has migrated the
database and is answering. Container logs are capped at 30 MB a service.

To let people in from outside the machine, see
[Reaching your server](#reaching-your-server). Voice works once its media
has a reachable path: see [Voice](#voice).

### Upgrading

Fetch the `stoop` binary for the machine once, then run its `upgrade`
verb from the install directory whenever a release is out:

```sh
curl -fsSL https://github.com/getstoop/stoop/releases/latest/download/stoop_linux_amd64.tar.gz | tar -xz stoop
./stoop upgrade
```

(`stoop_linux_arm64.tar.gz` and `stoop_darwin_arm64.tar.gz` are the
other builds.) It fetches the newest release's compose file, shows what
that release's migrations will do to the database and which releases can
still start against it afterwards, lists settings the release's
`env.example` has that your `.env` does not, and asks. Then it backs up
the database and the uploads into `backups/`, keeps the old compose file
as `docker-compose.yml.prev`, puts the new one in place and starts it. If
the new release does not come up healthy it prints the log and the way
back. `./stoop upgrade --plan` stops after showing; `--to 0.4.0` picks a
release; `--yes` skips the question. The copy you fetched keeps working
for later releases: the judgment about the database comes from the new
image, not from this binary.

Release notes say when the LiveKit or Postgres pin moves. Moving to a new
Postgres major is the one thing the tool refuses to do; see
[Supported Postgres and LiveKit versions](#supported-postgres-and-livekit-versions).

**Going back.** `./stoop upgrade rollback` puts the previous compose file
back and restarts. Each release keeps its schema readable by the release
before it, so this needs no restore, unless the upgrade ran a contract
migration: the tool says so before it upgrades, and `rollback` refuses
afterwards and points at the backup it took
([Restoring in place](#restoring-in-place)). Stoop refuses to start
against a database that a much newer release has reshaped, and says so
plainly, rather than misbehaving.

**By hand.** The tool only runs compose commands you can run yourself.
Fetch the new release's compose file, ask the new image what it will do
while the old one is still running, then restart on it; migrations run at
startup, so there is no separate step:

```sh
curl -fLO https://github.com/getstoop/stoop/releases/latest/download/docker-compose.yml
docker compose run --rm --no-deps stoop migrate plan
docker compose pull && docker compose up -d
```

`migrate plan` lists the migrations that will run and says which
releases can still start against the database afterwards, which is the
rollback you will have. It changes nothing. Exit status 2 means there is
something to run, 3 that the release is older than the database. Rolling
back by hand is putting the previous image tag back in the compose file
and `docker compose up -d` again.

Coming from 0.2.0, add `COMPOSE_PROFILES=bundled-postgres` to `.env`
first. Without it the bundled Postgres does not start, and the log says
`lookup postgres: no such host`.

An image tag of the form `0.2` follows patch releases of that minor;
`latest` follows everything. Both exist for people who prefer them to the
pinned tag.

### Supported Postgres and LiveKit versions

Stoop is tested on Postgres 16, which the compose file runs. Other majors
that Postgres itself still supports should work, but are not tested; if
you run one and something breaks, that is a bug worth reporting. A patch
or minor release of Stoop never raises the minimum Postgres major; if a
future release has to, the notes say so one minor ahead.

Moving to a newer Postgres major is the one upgrade `docker compose pull`
cannot do, because Postgres does not read a data directory written by an
older major. Dump with the old container, switch the image tag, restore:

```sh
docker compose exec postgres pg_dump -U stoop -Fc stoop > stoop.dump
docker compose down
docker volume ls | grep postgres-data     # then remove that one volume, and only that one
docker volume rm <name>_postgres-data
# edit docker-compose.yml: postgres:16-alpine → postgres:17-alpine
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U stoop -d stoop < stoop.dump
docker compose up -d
```

Keep `stoop.dump` until the restored instance has been used for a while;
the `stoop-data` volume with the uploads is untouched by all of this.

LiveKit is pinned in the compose file to the exact version a Stoop
release was tested against, and Stoop needs nothing newer than that pin.
The pin moves only in a minor release and the notes say when.

### Using your own Postgres

In `.env`, take `bundled-postgres` out of `COMPOSE_PROFILES` and name your
server:

```sh
COMPOSE_PROFILES=
STOOP_DATABASE_URL=postgres://stoop:secret@192.168.1.20:5432/stoop?sslmode=require
```

Then `docker compose up -d`. The bundled Postgres no longer starts, and
`POSTGRES_PASSWORD` is unused.

- Create the database and its role first. Stoop creates tables, not
  databases.
- The bundled URL says `sslmode=disable` because it never leaves the
  compose network. A remote server usually wants `require`.
- A Postgres on the same machine is `host.docker.internal` on Docker
  Desktop and the machine's LAN address on Linux; `localhost` is the
  container itself.
- [Backups](#backups) of that database are then yours: the `pg_dump`
  lines there run against your server instead of `docker compose exec
  postgres`. The `stoop-data` volume still holds the uploads.

### Where the data lives

To keep uploads and the database on a disk you already back up, set the
paths in `.env` and run Stoop as the user that owns the uploads path:

```sh
STOOP_DATA_PATH=/mnt/tank/stoop/data
POSTGRES_DATA_PATH=/mnt/tank/stoop/postgres
PUID=1000    # id -u
PGID=1000    # id -g
```

```sh
mkdir -p /mnt/tank/stoop/data /mnt/tank/stoop/postgres
chown 1000:1000 /mnt/tank/stoop/data
docker compose up -d
```

- A path starts with `/` or `./`; anything else is read as a volume name.
- Postgres owns its path itself. Give it a directory nothing else uses.
- `PUID` and `PGID` go with `STOOP_DATA_PATH`. On the default `stoop-data`
  volume, leave them unset.
- If the owner is wrong, uploads fail and Server admin → Diagnostics →
  File storage says the directory is not writable.
- [Backups](#backups) and the restore runbook then mean those two paths,
  in place of the `stoop-data` and `postgres-data` volumes.

To move an existing install, stop the stack and copy each volume out
before setting the path:

```sh
docker compose stop
docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v /mnt/tank/stoop/data:/to busybox cp -a /data/. /to
```

The database copies the same way, from the `postgres` container's
`/var/lib/postgresql/data`.

### Tuning the bundled Postgres

Put `postgres -c` flags in `POSTGRES_ARGS` in `.env`, then
`docker compose up -d`:

```sh
POSTGRES_ARGS=-c shared_buffers=256MB -c max_connections=50
```

Postgres's defaults are right for a chat database of this size, so most
installs leave this unset. A misspelt setting stops the container, and
`docker compose logs postgres` names it.

## Reaching your server

Stoop listens on one plain HTTP port (`8080` in the compose file). Put
whatever you already use in front of it.

> **Your front door carries chat and voice *signaling*. Voice *audio* does
> not go through it.** Audio goes from each browser straight to LiveKit's
> media ports, or to a TURN relay. Behind a tunnel or proxy that only
> forwards HTTP, joining a voice channel fails after ~15 s with "Couldn't
> establish an audio connection" unless a relay is set. See [Voice](#voice).

Pick a front door:

| Front door | People need | Chat | Voice audio | Who can read your traffic |
| --- | --- | --- | --- | --- |
| [Reverse proxy you already run](#a-reverse-proxy-you-already-run) + your domain | nothing | ✓ | ✓ direct — forward LiveKit's media ports too | nobody but your server |
| [Cloudflare Tunnel](#cloudflare-tunnel) | nothing | ✓ | ✓ with Cloudflare TURN (free tier, one setting); ✗ otherwise | Cloudflare sees chat and signaling; voice audio stays encrypted past it |
| [Tailscale](#tailscale-built-in) (built into Stoop, or Serve) | the Tailscale app | ✓ | ✓ — the built-in node carries LiveKit's media ports too | nobody but your server |
| Tailscale Funnel | nothing | ✓ | ✗ unless a TURN server is reachable — Funnel carries HTTP only | nobody: TLS ends on your node; Tailscale's relays carry ciphertext |
| [Just your LAN](#a-lan-without-https), plain HTTP | nothing | ✓ | listen-only: no microphone without HTTPS | anyone on the LAN (no encryption) |

No public IPv4 address, or no way to forward ports? Use Cloudflare Tunnel
with Cloudflare TURN, or Tailscale.

The setup wizard (step 3, "Reaching your server") and **Server admin →
Hosting** hold the same form. What you save there overrides the
environment variables, and clearing a value falls back to them. Whatever
the front door, set these:

- **Public address** (`STOOP_PUBLIC_URL`) — the address people use to
  reach you, e.g. `https://chat.example.com`. Invite links are built from
  it; without it they use whatever address the person copying the link is
  on, so an admin on the LAN hands out a `192.168.…` link. With the
  built-in Tailscale listener it defaults to the tailnet address.
- **Trusted proxies** (`STOOP_TRUSTED_PROXIES`) — the addresses of
  anything that forwards requests to Stoop: your reverse proxy, a tunnel
  daemon. CIDR ranges or single addresses, comma-separated; a list saved
  on the page applies at once, with no restart. **Never** name an address
  that isn't really your proxy. Only requests from those addresses have
  `X-Forwarded-For` and `X-Forwarded-Proto` believed, which is what marks
  cookies `Secure` behind an HTTPS proxy and keeps rate limits per person
  rather than one budget shared by everyone behind the proxy. The proxy
  should *append* to `X-Forwarded-For`, not replace it.
- **HTTPS**, for voice from other devices. Browsers only allow the
  microphone (and desktop notifications, and the clipboard) on a secure
  origin. `http://localhost` is an exception; `http://192.168.x.x` is not.

WebSocket origins need no configuring: Stoop accepts connections whose
`Origin` matches the request's own `Host`. `STOOP_ALLOWED_WS_ORIGINS` is
for a proxy that rewrites `Host`.

### A reverse proxy you already run

Point it at Stoop's HTTP port with WebSocket support on (`/ws` and
`/livekit` are WebSocket upgrades). Then forward LiveKit's media ports —
`7881/tcp` and `50000-50100/udp` — from your router straight to the
machine, not through the proxy; they aren't HTTP.

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

Then set the public address to `https://chat.example.com` and add the
proxy's address under Trusted proxies. Don't add or strip
[security headers](#security-headers) in the proxy; Stoop sends its own.

### Cloudflare Tunnel

Stoop runs Cloudflare's connector (`cloudflared`) itself; the Docker image
includes it.

1. In Cloudflare's dashboard (Zero Trust → Networks → Tunnels), create a
   tunnel and copy its token (the `eyJ…` string at the end of the install
   command it shows).
2. In the setup wizard or **Server admin → Hosting → Cloudflare Tunnel**,
   tick "Run a Cloudflare Tunnel", paste the token and save. This also adds
   `127.0.0.1` and `::1` to Trusted proxies, which is where the connector
   calls from.
3. Back in Cloudflare, give the tunnel a public hostname whose service is
   Stoop as `cloudflared` reaches it. With the compose file that is
   `http://localhost:8080`, because `cloudflared` runs inside the Stoop
   container. If you route it through a proxy of your own instead, name
   that proxy under Trusted proxies too.
4. Put that hostname, as `https://chat.example.com`, in **Public address**
   on the same page. Invite links and sign-in callbacks use it; Stoop does
   not learn it from the tunnel.
5. Set up a [voice relay](#turn-when-media-ports-cant-be-reached):
   **voice audio does not go through the tunnel.** Cloudflare's own TURN
   service is the closest one and needs nothing forwarded.

The status reads "Running" once connected. In `.env` the same settings are
`STOOP_CLOUDFLARE_TUNNEL=true`, `STOOP_CLOUDFLARE_TUNNEL_TOKEN` and
`STOOP_PUBLIC_URL`; name `127.0.0.1, ::1` in `STOOP_TRUSTED_PROXIES`
yourself there.

Running the bare binary, install `cloudflared` so it is on `PATH`, or set
`STOOP_CLOUDFLARED_PATH`.

Running `cloudflared` yourself works like any other proxy: an ingress rule
for `http://stoop:8080`, `STOOP_PUBLIC_URL`, and its address under Trusted
proxies.

### Tailscale, built in

Stoop can join your tailnet by itself — no Tailscale installed on the
server, no port forwarding, works behind CGNAT — and serve HTTPS with a
real certificate at `https://stoop.<tailnet>.ts.net`. Only devices on
your tailnet can reach it: invite your people to the tailnet, or
[share the node](https://tailscale.com/kb/1084/sharing) with theirs.

1. Once per tailnet: enable **HTTPS Certificates** under
   [DNS settings](https://login.tailscale.com/admin/dns). Without it the
   node joins but browsers can't connect (Stoop logs a warning saying so).
2. In the setup wizard or **Server admin → Hosting → Tailscale**, tick
   "Join my tailnet", optionally with a node name (default `stoop`) and an
   auth key from
   [the keys page](https://login.tailscale.com/admin/settings/keys).
   Without a key the page shows a login link to open once. The listener
   starts at once, with no restart.
3. The page shows `Running at https://…`. Invite links use that address
   unless a public address is set, and the plain HTTP port keeps working
   on the LAN.

Voice rides the tailnet too: the node carries LiveKit's media ports, so a
phone on cellular reaches voice and video with nothing forwarded from a
router and nothing to set. A 1080p screen share to several viewers is the
load to watch on small hardware, because the node encrypts tailnet
traffic in this process.

The node's identity is kept under `STOOP_STORAGE_DIR/tailscale`, so it
survives restarts and upgrades. In `.env` the same settings are
`STOOP_TAILSCALE=true`, `STOOP_TAILSCALE_HOSTNAME` and
`STOOP_TAILSCALE_AUTHKEY`; what's saved on the page overrides them.

**Funnel.** "Publish this Stoop node to public internet (Funnel)", or
`STOOP_TAILSCALE_FUNNEL=true`, also publishes the address to the internet
through [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), so
people need nothing installed. Your tailnet policy must also grant the
node the `funnel` attribute; until it does the node stays private. Funnel
carries HTTP only, so voice audio needs a
[TURN](#turn-when-media-ports-cant-be-reached) server.

**Headscale.** "I run a custom control server", or
`STOOP_TAILSCALE_CONTROL_URL`, points the node at a self-hosted
[Headscale](https://headscale.net). The auth key has to come from
whichever control server you point at.

**A Tailscale client already on the machine** does the same job as the
built-in node. For voice, a LiveKit container on the compose bridge
network can't see the tailnet interface, so set `NODE_IP` in `.env` to
the output of `tailscale ip -4`.

### A LAN without HTTPS

Everything except voice works over plain `http://<lan-ip>:8080`.
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
the server in your router's DNS or each device's hosts file, set the
public address to `https://chat.lan`, and name Caddy's address under
Trusted proxies.

### Who can read your traffic

- **Chat, invite links and voice signaling are ordinary HTTPS**, so
  whoever terminates TLS reads them. With your own reverse proxy or
  Tailscale (Serve or Funnel) that is only your server. With Cloudflare
  Tunnel, TLS ends at Cloudflare's edge, so Cloudflare's servers see every
  message in plaintext.
- **Voice audio is encrypted between each browser and your LiveKit
  server**, always. A TURN relay, Cloudflare's or anyone's, forwards
  packets it cannot decrypt. LiveKit itself decrypts to forward between
  participants, so whoever runs the server can hear the room: there is no
  end-to-end encryption.

## Voice

Voice rooms run on the LiveKit sidecar, and audio flows directly between
each browser and LiveKit. Voice needs three things:

1. **A LiveKit server.** The compose file runs one, and Stoop mints the
   key pair the two share on first boot; there is nothing to set. With
   `STOOP_LIVEKIT_URL` empty, voice is off and joining fails with "voice is
   not configured". To use a LiveKit you run elsewhere, or LiveKit Cloud,
   set `STOOP_LIVEKIT_URL` and that server's pair in
   `STOOP_LIVEKIT_API_KEY` / `STOOP_LIVEKIT_API_SECRET`.
2. **Media ports reachable**, or a [TURN relay](#turn-when-media-ports-cant-be-reached).
   Browsers must reach `7881/tcp` and `50000-50100/udp` on the machine.
   To move them, set `STOOP_LIVEKIT_TCP_PORT` and `STOOP_LIVEKIT_UDP_PORTS`
   in `.env`; nothing else needs editing. LiveKit discovers the public address to
   advertise (`use_external_ip: true`); on a LAN-only install, set
   `NODE_IP` in `.env` to the machine's LAN address instead.
3. **HTTPS**, as [above](#reaching-your-server).

### TURN, when media ports can't be reached

When browsers can't reach the media ports, WebRTC falls back to a TURN
relay if one is offered. The relay has to be reachable itself, so it can't
sit behind the same tunnel. Set either or both under **Server admin →
Hosting → Voice relay**; browsers try every server they are given.

- **Cloudflare's TURN relay.** In the Cloudflare dashboard create a TURN
  key (Realtime → TURN) and paste its id and token under "Cloudflare's
  TURN relay" (or `STOOP_CLOUDFLARE_TURN_KEY_ID` and
  `STOOP_CLOUDFLARE_TURN_API_TOKEN` in `.env`). Nothing to forward, and it
  works behind CGNAT. Voice audio is ~50 kbps per stream, so a friend
  group stays well inside the free tier. If Cloudflare's API is
  unreachable, joins go ahead without the relay rather than failing.
- **A TURN relay I run myself.** Tick it and fill in the fields, or in
  `.env`: `STOOP_TURN_URLS` (comma-separated, e.g.
  `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349`),
  `STOOP_TURN_USERNAME`, `STOOP_TURN_CREDENTIAL`, and `STOOP_STUN_URLS`
  (coturn answers STUN on the same port: `stun:turn.example.com:3478`).

LiveKit's own TURN (`turn:` or `rtc.turn_servers` in `livekit.yaml`) also
works when Stoop supplies nothing, but it is still a port forwarded to the
machine; see the
[LiveKit self-hosting docs](https://docs.livekit.io/home/self-hosting/deployment/).

### Video and screen share: what it costs

If voice works, video works: cameras and screen shares use the same ports
and the same relay. What changes is bandwidth. Every viewer gets their own
copy from the server, so a 1080p screen share watched by five people is
roughly **10–12 Mbps *up* from your server**, and a camera in the
spotlight is 3–4 Mbps per viewer. A 40 Mbps uplink runs out past a few
video viewers. Behind Cloudflare Tunnel that traffic goes through the
relay and counts against the TURN allowance. Screen sharing isn't
available from phone browsers; cameras are.

### Troubleshooting voice

| Symptom | Cause |
| --- | --- |
| Joining fails with "voice is not configured" | `STOOP_LIVEKIT_URL` not set |
| Joining fails with an error mentioning the microphone; or you join but the mic button is stuck muted | Not a secure origin — you need HTTPS off `localhost` |
| Joining fails after ~15 s with "Couldn't establish an audio connection" | Media ports unreachable from that network: not forwarded, wrong `NODE_IP`, or an HTTP-only tunnel with no TURN. `docker compose logs livekit` shows "removing participant without connection" with the ICE candidates it tried |
| Everyone shows as connected, nobody hears anyone | The same, but the media path broke after the join (a network change); leave and rejoin, then check the row above |
| A participant lingers after their tab closed | Their WebSocket to Stoop hadn't dropped yet; it clears when it does (seconds) |

## Bare binary (no Docker)

Release binaries are static with the web UI embedded — no runtime
dependencies beyond Postgres (and a LiveKit server if you want voice).
Each [release](https://github.com/getstoop/stoop/releases) carries
`stoop_linux_amd64.tar.gz`, `linux_arm64` and `darwin_arm64`
archives and a `checksums.txt` to verify them against:

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

Set any of these in `.env`; the compose file passes that file through to
the server. Two are pinned by the compose file itself and ignore what
`.env` says: `STOOP_STORAGE_DIR` and `STOOP_LIVEKIT_KEY_FILE`.
`STOOP_DATABASE_URL` defaults to the bundled Postgres; set it only when
[using your own](#using-your-own-postgres).

| Variable                   | Default                     | Purpose                          |
| -------------------------- | --------------------------- | -------------------------------- |
| `STOOP_DATABASE_URL`       | (required)                  | Postgres connection string       |
| `STOOP_DATABASE_POOL_MAX`  | `0`                         | Most connections Stoop opens to Postgres. `0` is the larger of 4 and the CPU count; otherwise at least 2. Keep it under Postgres `max_connections`, less what backups and `psql` need. Wins over `pool_max_conns` in the URL |
| `STOOP_LISTEN_ADDR`        | `:8080`                     | HTTP bind address                |
| `STOOP_PUBLIC_URL`         | (empty)                     | The address people use to reach the server; invite links use it, its host is an allowed WS origin. Defaults to the tailnet address with the built-in Tailscale listener |
| `STOOP_TRUST_PROXY`        | `false`                     | Believe `X-Forwarded-For` / `X-Forwarded-Proto` from **every** caller, taking the header's rightmost address as the client. Blunt, and spoofable unless the proxy sets or appends the header itself; prefer `STOOP_TRUSTED_PROXIES`. Can't be combined with it |
| `STOOP_TRUSTED_PROXIES`    | (empty)                     | Comma-separated addresses or CIDR ranges of your reverse proxy or tunnel (`172.18.0.0/16, 192.168.1.5`); only those callers' `X-Forwarded-*` headers are believed. A list saved under Server admin → Hosting → Trusted proxies overrides it |
| `STOOP_SECURE_COOKIES`     | `false`                     | Force session cookies Secure on every listener. Rarely needed: TLS listeners and trusted HTTPS proxies get it automatically |
| `STOOP_ALLOWED_WS_ORIGINS` | `localhost:*,127.0.0.1:*`   | Extra WebSocket origin patterns. The request's own host (and `STOOP_PUBLIC_URL`'s) is always allowed, so this is only needed behind a proxy that rewrites `Host` |
| `STOOP_AUTH_RATE_LIMIT`    | `20`                        | Sign-in and registration attempts allowed per client address per minute. `0` disables (dev/e2e only). The per-account lockout after 5 wrong passwords is always on |
| `STOOP_SIGNALING_RATE_LIMIT` | `30`                      | New voice signaling connections per client address per minute (the LiveKit proxy is unauthenticated; this keeps it from being an open relay). `0` disables |
| `STOOP_SEARCH_RATE_LIMIT`  | `30`                        | Message searches per user per minute. `0` disables |
| `STOOP_REGISTRATION`       | `invite`                    | Seeds the registration policy on first boot only (`open`, `invite`, `closed`); change it later from the admin page |
| `STOOP_INSTANCE_NAME`      | (random, e.g. `Chalk Avenue`) | The server's name, shown in the browser tab. Unset, a random two-word name is picked on first boot and kept, so several instances never all call themselves "Stoop". The admin page's saved value overrides it |
| `STOOP_STORAGE`            | `fs`                        | File storage backend. `fs` is the only one; any other value (including `s3`) refuses to start |
| `STOOP_STORAGE_DIR`        | `./data`                    | Directory for uploaded files (compose: `/data` on the `stoop-data` volume) |
| `STOOP_LIVEKIT_KEY_FILE`   | `<STOOP_STORAGE_DIR>/livekit/keys.yaml` | Where to write the LiveKit key pair for a sidecar started with `--key-file`. Written on every boot (minted or from the environment); the file is `0600` in a `0700` directory because LiveKit refuses a key file others can read |
| `STOOP_LINK_PREVIEWS`      | `true`                      | Fetch Open Graph cards for links in messages. The server fetches (readers' browsers never contact the site); set `false` if the server should make no outbound requests on members' behalf |
| `STOOP_FILE_SWEEP_INTERVAL` | `6h`                       | How often unreferenced uploads, stray blobs and old read activity items are removed; `0` turns the timer off (the admin page can still sweep) |
| `STOOP_FILE_SWEEP_GRACE`   | `24h`                       | How old an unreferenced file must be before the sweep takes it |
| `STOOP_ACTIVITY_RETENTION` | `720h`                      | Read mention/reply/DM activity items older than this are removed on the sweep timer; `0` keeps them forever |
| `STOOP_UNFURL_ALLOW_PRIVATE` | `false`                   | Let link previews fetch private/loopback addresses. **Dev and tests only** — it is what stops the server being used as a proxy into your LAN |
| `STOOP_WEBHOOKS`           | `true`                      | `false` stops every incoming webhook post and outgoing delivery, whatever the admin settings say; nothing is deleted |
| `STOOP_WEBHOOK_RATE_LIMIT` | `60`                        | Posts per minute one incoming webhook may make; `0` removes the limit |
| `STOOP_WEBHOOK_DELIVERY_RETENTION` | `168h`              | How long finished outgoing webhook deliveries are kept in the log; `0` keeps them forever |
| `STOOP_DEV_WEB_URL`        | (empty)                     | Serve the web app from a Vite dev server at this address instead of the embedded build, allowing inline scripts for its hot reload. **Development only** — `make dev` sets it |
| `STOOP_LIVEKIT_URL`        | (empty)                     | LiveKit sidecar address the app proxies signaling to, e.g. `http://livekit:7880` (voice) |
| `STOOP_LIVEKIT_API_KEY`    | (empty)                     | Only to reuse an existing LiveKit key pair; empty, the server mints one |
| `STOOP_LIVEKIT_API_SECRET` | (empty)                     | The secret of that pair          |
| `STOOP_TURN_URLS`          | (empty)                     | Comma-separated TURN URLs of your own relay (voice); needs the two below |
| `STOOP_TURN_USERNAME`      | (empty)                     | Credentials for `STOOP_TURN_URLS` |
| `STOOP_TURN_CREDENTIAL`    | (empty)                     | |
| `STOOP_STUN_URLS`          | (empty)                     | STUN URLs offered alongside your relay |
| `STOOP_CLOUDFLARE_TUNNEL`  | `false`                     | Run `cloudflared` as a child process; needs the token. Also on Server admin → Hosting |
| `STOOP_CLOUDFLARE_TUNNEL_TOKEN` | (empty)                | The remotely managed tunnel's token |
| `STOOP_CLOUDFLARED_PATH`   | (empty)                     | Where `cloudflared` is; empty looks on `PATH`. The Docker image includes it |
| `STOOP_CLOUDFLARE_TURN_KEY_ID` | (empty)                 | Cloudflare TURN key id; Stoop mints credentials per join (voice through HTTP-only tunnels / CGNAT) |
| `STOOP_CLOUDFLARE_TURN_API_TOKEN` | (empty)              | Its API token; set together with the key id |
| `STOOP_TAILSCALE`          | `false`                     | Join a tailnet from inside the binary and serve HTTPS on the tailnet address (see Tailscale, built in). Settings saved on the admin page override these |
| `STOOP_TAILSCALE_HOSTNAME` | `stoop`                     | Node name on the tailnet         |
| `STOOP_TAILSCALE_AUTHKEY`  | (empty)                     | Pre-authorise the node; otherwise a login URL is logged on first start |
| `STOOP_TAILSCALE_CONTROL_URL` | (empty)                  | Self-hosted control server (Headscale) |
| `STOOP_TAILSCALE_FUNNEL`   | `false`                     | Also expose the tailnet address publicly via Funnel (HTTP only — voice needs TURN) |
| `STOOP_TAILSCALE_VOICE`    | `true`                      | The built-in node also carries LiveKit's media ports, so voice rides the tailnet. `false` serves HTTPS over the tailnet only |
| `STOOP_LIVEKIT_MEDIA_HOST` | `127.0.0.1` (`livekit` in compose) | Where the built-in node forwards media: LiveKit's host on this machine or network |
| `STOOP_LIVEKIT_TCP_PORT`   | `7881`                      | LiveKit's TCP media port. Under compose this one setting also configures and publishes it; with a bare binary, match it to `livekit.yaml` |
| `STOOP_LIVEKIT_UDP_PORTS`  | `50000-50100`               | LiveKit's UDP media range, as `start-end`. Same as above |
| `STOOP_LIVEKIT_NODE_IP_FILE` | (empty)                   | File Stoop writes the tailnet address to for the LiveKit sidecar's `NODE_IP`. Defaults to `node-ip` beside `STOOP_LIVEKIT_KEY_FILE`, which is what lands it on the shared volume under compose |
| `STOOP_OIDC_ISSUER`        | (empty)                     | One OIDC login provider from the environment: the issuer URL exactly as its discovery document states it. The admin page's saved list overrides this |
| `STOOP_OIDC_CLIENT_ID`     | (empty)                     | The provider's client id; set together with the secret and issuer |
| `STOOP_OIDC_CLIENT_SECRET` | (empty)                     | The provider's client secret |
| `STOOP_OIDC_NAME`          | `Continue with single sign-on` | The sign-in button's entire text |
| `STOOP_OIDC_ID`            | `sso`                       | The provider's stable id; part of the callback URL, and identities link under it |
| `STOOP_SESSION_LIFETIME_DAYS` | `30`                    | How long a sign-in lasts, 1-365 days. The admin page's saved value overrides it; a change applies to sign-ins from then on |
| `STOOP_PASSWORD_SIGN_IN`   | `everyone`                  | Who may use the username/password form: `everyone`, `admins`, or `off` (sign in through login providers instead). The admin page's saved value overrides it; admins are always honoured as a fallback |

### Compose settings

These are read by the compose file, not by the server, so they apply to
the Docker Compose install only.

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMPOSE_PROFILES` | `bundled-postgres` | Which bundled services run. Empty to [use your own Postgres](#using-your-own-postgres) |
| `STOOP_PORT` | `8080` | The port the web app is published on |
| `TZ` | `UTC` | Time zone of the timestamps in `docker compose logs` |
| `STOOP_DATA_PATH` | `stoop-data` volume | Where uploads and the Tailscale node identity live; see [Where the data lives](#where-the-data-lives) |
| `POSTGRES_DATA_PATH` | `postgres-data` volume | Where the bundled Postgres keeps its data |
| `PUID`, `PGID` | `65532` | The user and group Stoop runs as; match the owner of `STOOP_DATA_PATH` |
| `POSTGRES_PASSWORD` | (none) | Password of the bundled Postgres |
| `POSTGRES_ARGS` | (empty) | `postgres -c name=value` flags for the bundled Postgres; see [Tuning the bundled Postgres](#tuning-the-bundled-postgres) |
| `NODE_IP` | (empty) | The address LiveKit offers browsers for media; see [Voice](#voice) |

## File storage

Uploaded files — avatars, space icons, and message attachments (up to
100 MB each by default, ten per message) — are stored on the local
filesystem under `STOOP_STORAGE_DIR`: `./data` for the bare binary, `/data`
on the `stoop-data` volume in the compose file. Stoop serves them itself
at `/files/{id}` with the same sign-in checks as everything else, so
nothing in that directory needs to be reachable by the web.

Files attached to a message are deleted with it. Uploads that were never
sent and attachments of deleted channels and spaces are removed by the
sweep described under [Upload storage](#upload-storage-the-sweep-and-the-quota).

### Video and audio

Video and audio attachments play in the message, straight from the
uploaded bytes: the server does no transcoding and makes no thumbnails.
What plays is what the viewer's browser can decode. Safe everywhere: MP4
with H.264 video and AAC audio, WebM with VP8/VP9/AV1, MP3, and M4A. An
iPhone's `.mov` plays where the browser supports its codecs. A clip the
browser can't play shows as a download card.

The hard ceiling is 100 MB per file, which is also the largest request
Cloudflare Tunnel's free plan accepts. Long videos are best shared as a
link.

There is no object-storage option: `fs` is the only value `STOOP_STORAGE`
accepts, and the server refuses to start on any other. If you need an
S3-compatible backend, open an issue and say which provider you would
point it at.

## Backups

Two things hold your data: the Postgres database and the uploads directory
(`STOOP_STORAGE_DIR`; the `stoop-data` volume in the compose file), which
holds avatars, space icons, message attachments and link preview images.
Back up both — a database dump alone restores every message but points at
files that are gone. LiveKit holds no state.

### Taking a backup

From the install directory, with everything running:

```sh
docker compose exec -T postgres pg_dump -U stoop -Fc stoop > stoop.dump
docker run --rm --volumes-from "$(docker compose ps -q stoop)" -v "$PWD":/backup \
  alpine tar -C /data -cf /backup/stoop-data.tar .
```

The dump is a consistent snapshot while the server keeps running. Take
it before the files, in that order: a file uploaded between the two is
then an extra in the archive the sweep will remove, never a row in the
database whose file is missing. The second command borrows the app
container's mounts to reach the volume, so it needs no volume name.

The uploads directory also holds the built-in Tailscale node's identity
and, for a bare binary, the LiveKit key pair, so a backup carries those
too.

### Restoring onto a fresh install

Set up the install directory as in the [quick start](#quick-start-docker-compose)
with the **same release** the backup came from, or a newer one, and copy
the two backup files in. Then, before the server has ever started:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < stoop.dump
docker compose create stoop
docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v "$PWD":/backup \
  alpine sh -c 'tar -C /data -xf /backup/stoop-data.tar && chown -R 65532:65532 /data'
docker compose up -d
```

`create` makes the app container and its empty volume without starting
it, so the files can go in first.

The `chown` matters: the archive carries the files' old owner, and the
server runs as user 65532, so without it every restored file is readable
but nothing new can be written beside it, and uploads fail with "could
not store the file".

A dump from the same release starts with "no migrations to run"; from an
older release, the missing migrations run at startup. A dump from a newer
release is refused, as [Upgrading](#upgrading) describes: restore it
onto that release instead.

Then sign in with a password from before the backup. Everyone's sessions
are in the database, so people who were signed in still are. Open a
channel that had attachments and link previews, check avatars show, and
upload something.

To restore as a **different** Tailscale machine rather than take over the
old node's identity, delete `tailscale/` from the uploads directory before
starting.

### Restoring in place

To put a backup back into a running install, say after an upgrade that
went wrong past the point `rollback` can reach, stop the app, replace the
database, unpack the files over the volume, and start again. `<dir>` is
the backup directory (the upgrade tool names its
`backups/<date>-<from>-to-<to>`):

```sh
docker compose stop stoop
docker compose exec -T postgres psql -U stoop -d postgres -c 'DROP DATABASE stoop WITH (FORCE)' -c 'CREATE DATABASE stoop'
docker compose exec -T postgres pg_restore -U stoop -d stoop --no-owner < backups/<dir>/stoop.dump
docker run --rm --volumes-from "$(docker compose ps -aq stoop)" -v "$PWD/backups/<dir>":/backup alpine tar -C /data -xf /backup/stoop-data.tar
docker compose up -d
```

To go back to the release the backup came from at the same time, put its
compose file in place before the last line: `mv docker-compose.yml.prev
docker-compose.yml`. Files uploaded after the backup stay in the volume
with nothing pointing at them, and the sweep removes them.

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

## Retention: deleting old messages and files

Both settings are off until you set them, on the admin page's Storage
tab, under **Retention**. Leave a field blank to keep things forever.

- **Delete messages after** (1-3650 days): older messages are deleted
  everywhere, direct messages included, with their reactions and files.
- **Delete attachments after** (1-3650 days): older files are deleted
  with their names. The message stays and shows "Expired attachment" and
  the size. Expired files stop counting towards the storage limit.

Pinned messages and their files are kept, and so are avatars, icons and
link preview images. Both run hourly. Saving a shorter period first shows
how many messages and files it would delete now. Deleted data can't be
brought back except from a [backup](#backups).

## Webhooks

**To post into a channel from another tool**, open the space's settings →
Integrations, choose *New incoming webhook*, pick the channel, and paste
the URL into the tool. Anything with a webhook URL field works as is,
and so does curl:

```sh
curl -d 'disk is full' https://chat.example.com/hooks/stp_hook_…
```

The URL posts into that one channel as a bot and can do nothing else.
Treat it like a password: anyone with it can post there. Rotate it from
the same page if it leaks.

**To have Stoop call your own endpoint** when something happens, choose
*New outgoing webhook*, give it the URL and tick the events. Each event
is a JSON POST signed with the secret shown once at creation. Verifying
it, in Python:

```python
import hmac, hashlib, time
t, v1 = (p.split("=")[1] for p in headers["Stoop-Signature"].split(","))
mine = hmac.new(secret, f"{t}.".encode() + body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(mine, v1) and time.time() - int(t) < 300
```

Deliveries retry four times over two and a half minutes and then stop;
the page shows each hook's log and lets you send a failed one again.
`Stoop-Sequence` counts up per hook, so a receiver can tell when it
missed one. A receiver that answers `410 Gone`, or fails twenty times
in a row, turns the hook off until you turn it back on.

**A target on your LAN** (a Home Assistant box, a script on another
machine) is refused until you tick *Allow private targets* on Server
admin → Integrations. The cloud metadata address and link-local ranges
are never reachable. Your own scripts should use a personal token
against the API rather than a webhook; a program that can set a header
should use a bot token, made from the same admin page. Never paste a bot
token into someone else's appliance: a hook URL can only post, a bot
token can read everything its bot can.

`STOOP_WEBHOOKS=false` turns the whole feature off without deleting
anything; the two direction switches on the admin page do the same per
direction.

## Diagnostics

**When something feels slow or broken**, open Server admin → Diagnostics.
It is read-only and refreshes every 5 s while it is open; a dot on the nav
entry means a health row is at warn or danger.

| Panel | Answers |
| --- | --- |
| Health | Is each dependency up: Postgres, LiveKit, file storage, the public address, the webhook worker, the sweeps. An *off* row is something you have not configured, not a fault. Each row links to the tab that fixes it. |
| Right now | Connections, people online, people in voice, requests per minute, slow consumers dropped, each with its last fifteen minutes, and the webhook queue as it is now. |
| Database | The connection pool, ping, database size, backends, the oldest open transaction, and the Postgres and schema versions. |
| Requests | Calls, errors and p50 / p95 / max per procedure over the last 5 minutes. Since-start totals are on the metrics endpoint. |
| Background work | Every sweep and the webhook worker: when it last ran, how long it took, what it removed, when it is due. |

Reading it:

| They say | Look at | What it tells you |
| --- | --- | --- |
| "Voice is choppy" | Health: LiveKit, then Hosting | Unreachable means the sidecar. Reachable with people in rooms means media, not Stoop: TURN, the network, or the host itself. |
| "Messages take ages to load" | Requests, then Database | A high p95 on `ListMessages` with pool waits means Postgres is saturated. A high p95 with an idle pool means the query itself, or the disk. |
| "My webhook stopped firing" | Background work, then Integrations | Dead-lettered with a 5xx is the receiving end. Queued and never leased is the worker. |
| "People keep dropping" | Right now: Connections, Slow consumers dropped | A sawtooth in connections with drops climbing means the server is falling behind on fan-out. Flat drops with a sawtooth means their network or the proxy in front. |
| "Uploads fail" | Health: File storage | Volume full, quota reached, or the directory is not writable after a restore. |
| "It was fine yesterday" | Copy report | Paste it into an issue. |

On the Database panel, *Pool in use N of M* is connections busy right
now out of the most Stoop will open; M is `STOOP_DATABASE_POOL_MAX`.

**Copy report**, at the top of the tab, puts everything on the page into
one JSON document. It is what to paste into a bug report; it holds no
message content and no secrets.

**To scrape it with Prometheus**, make a personal token on your Profile →
Security page with *View server administration* ticked, then:

```sh
curl -H 'Authorization: Bearer stp_pat_…' https://chat.example.net/metrics
```

```yaml
scrape_configs:
  - job_name: stoop
    scheme: https
    static_configs:
      - targets: ["chat.example.net"]
    authorization:
      credentials: stp_pat_…
```

`stoop_health{check="…"}` is 0 ok, 1 warn, 2 danger, 3 off, so an alert
on `stoop_health >= 2` is the whole rule. Everything else on the endpoint
is what the tab shows: the gauges, `stoop_rpc_*` per procedure, and the
jobs. A request without a token gets 401; one whose account is not an
admin gets 403. Numbers live in memory and start over with the process;
history is the scraper's job.

## Privacy of direct messages

Direct messages are private *in the app*: nothing lets a server admin
list or read a conversation they are not part of, and a file sent in a
DM is served only to the people in it. They are not private from the
machine. Like every message, DMs sit in Postgres in plaintext and in
your backups, readable by anyone with the database password or the
disk. Stoop does not do end-to-end encryption today; tell your people
that before they assume otherwise.

## Security headers

Stoop sets these on every response; there is nothing to configure. **If
you put a reverse proxy in front, leave them alone.** A second
`Content-Security-Policy` header does not replace Stoop's: both apply, and
the intersection blocks part of the app. Don't add `includeSubDomains` or
`preload` on Stoop's behalf either unless you own every name under that
domain.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | see below |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone and screen share for Stoop itself; everything else refused |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000`, **only** over HTTPS |

HSTS is sent only when the request arrived over TLS — directly, or with
`X-Forwarded-Proto: https` from an address you named under Trusted
proxies — so a LAN or tailnet install reached over plain HTTP never gets
it. The content policy is "everything comes from this server". What each
directive allows, and why, is in
[architecture/runtime.md](architecture/runtime.md#security-headers).

`GET /version` tells anyone which Stoop version this is; the desktop app
needs it before login. The web app's asset names already change with
every release, so hiding it would gain nothing.

## Keeping people out

Two tools, at two levels:

- **Kick and ban** (space owners and admins): both live in *Space
  settings → Members* — a profile card never carries them, so nobody
  removes someone with a stray click. A kick only removes: they can
  come back with any invite link. A ban removes them *and* refuses
  every invite link until someone unbans them under *Space settings →
  Banned*. Either one also disconnects them from the space's voice
  channels.
- **Block** (anyone): from a person's card, undone from your profile
  page. No direct messages either way, and no mention, reply or DM
  alerts from them. Their messages in shared channels still show.

Neither tells the other person why. Deleting someone's account outright
is the server admin's job on the admin page.

## Who can create accounts

By default new accounts need a space invite code (the first account, created
during setup, is exempt and becomes the server admin). The admin can change
this at runtime under **Server admin**: *Invite only*,
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

People can sign in and create their account with an identity they
already have, instead of a Stoop password. Any OIDC
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

One provider can also come from the environment (`STOOP_OIDC_*` in the
[Configuration reference](#configuration-reference)); the admin page's
saved list overrides it, the same as the Hosting settings. Sign-ins
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

## Deleting your own account

Anyone can delete their own account from **Profile → Security**, after
typing their password again. Their messages stay in the channels and
conversations they were in, under their username marked "(deleted)";
their profile, avatar and bio go, every device is signed out, their tokens
stop working, and any space they owned passes to its longest-serving
admin, or to yours when it had none. The username stays taken, so nobody
can register it and be mistaken for them. There is no undo, and an admin
cannot reactivate the account.

To turn this off, untick **People can delete their own accounts** under
**Server admin → Accounts**. The account page then says to ask an admin,
and deactivating from that tab is what an admin does instead.

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
stoop admin transfer-owner <username>
stoop admin password-login everyone|admins|off
```

The first account owns the server: no admin can demote, deactivate or
reset it from the admin page. `reset-password` and `transfer-owner` work
on the owner from here. It refuses to demote the owner or the last active
admin. With the bare binary, run it
by path (`./stoop admin list`) or put it on your `PATH`. In Docker the
image installs it at `/usr/local/bin/stoop`, so:
`docker compose exec stoop stoop admin promote <username>` (the first
`stoop` is the compose service, the second the command).
