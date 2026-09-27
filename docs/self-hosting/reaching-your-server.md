# Reaching your server

Stoop listens on one plain HTTP port (`8080` in the compose file). Put
whatever you already use in front of it.

> **Your front door carries chat and voice *signaling*. Voice *audio* does
> not go through it.** Audio goes from each browser straight to LiveKit's
> media ports, or to a TURN relay. Behind a tunnel or proxy that only
> forwards HTTP, joining a voice channel fails after ~15 s with "Couldn't
> establish an audio connection" unless a relay is set. See [Voice](voice.md).

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

## A reverse proxy you already run

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
[security headers](accounts-and-security.md#security-headers) in the proxy; Stoop sends its own.

## Cloudflare Tunnel

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
5. Set up a [voice relay](voice.md#turn-when-media-ports-cant-be-reached):
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

## Tailscale, built in

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
[TURN](voice.md#turn-when-media-ports-cant-be-reached) server.

**Headscale.** "I run a custom control server", or
`STOOP_TAILSCALE_CONTROL_URL`, points the node at a self-hosted
[Headscale](https://headscale.net). The auth key has to come from
whichever control server you point at.

**A Tailscale client already on the machine** does the same job as the
built-in node. For voice, a LiveKit container on the compose bridge
network can't see the tailnet interface, so set `NODE_IP` in `.env` to
the output of `tailscale ip -4`.

## A LAN without HTTPS

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

## Who can read your traffic

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
