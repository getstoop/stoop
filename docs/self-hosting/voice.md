# Voice

Voice rooms run on the LiveKit sidecar, and audio flows directly between
each browser and LiveKit. Voice needs three things:

1. **A LiveKit server.** The compose file runs one, and Stoop mints the
   key pair the two share on first boot; there is nothing to set. With
   `STOOP_LIVEKIT_URL` empty, voice is off, as it is when you
   [turn it off](#running-without-voice). To use a LiveKit you run elsewhere, or LiveKit Cloud,
   set `STOOP_LIVEKIT_URL` and that server's pair in
   `STOOP_LIVEKIT_API_KEY` / `STOOP_LIVEKIT_API_SECRET`.
2. **Media ports reachable**, or a [TURN relay](#turn-when-media-ports-cant-be-reached).
   Browsers must reach `7881/tcp` and `50000-50100/udp` on the machine.
   To move them, set `STOOP_LIVEKIT_TCP_PORT` and `STOOP_LIVEKIT_UDP_PORTS`
   in `.env`; nothing else needs editing. LiveKit discovers the public address to
   advertise (`use_external_ip: true`); on a LAN-only install, set
   `NODE_IP` in `.env` to the machine's LAN address instead.
3. **HTTPS**, see [Reaching your server](reaching-your-server.md).

## Running without voice

In `.env`, set `STOOP_VOICE=false` and take `bundled-livekit` out of
`COMPOSE_PROFILES`, leaving the rest of that line as it is. On the default
install that makes:

```sh
COMPOSE_PROFILES=bundled-postgres
STOOP_VOICE=false
```

Then:

```sh
docker compose up -d
docker compose rm -sf livekit
```

The second command stops a LiveKit that was already running, which `up`
leaves alone. Voice channels are hidden and none can be created. Nothing
is deleted: put both settings back and they return.

## TURN, when media ports can't be reached

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

## Video and screen share: what it costs

If voice works, video works: cameras and screen shares use the same ports
and the same relay. What changes is bandwidth. Every viewer gets their own
copy from the server, so a 1080p screen share watched by five people is
roughly **10–12 Mbps *up* from your server**, and a camera in the
spotlight is 3–4 Mbps per viewer. A 40 Mbps uplink runs out past a few
video viewers. Behind Cloudflare Tunnel that traffic goes through the
relay and counts against the TURN allowance. Screen sharing isn't
available from phone browsers; cameras are.

## Troubleshooting voice

| Symptom | Cause |
| --- | --- |
| No space has voice channels, and none can be added | `STOOP_LIVEKIT_URL` not set, or `STOOP_VOICE=false` |
| Joining fails with an error mentioning the microphone; or you join but the mic button is stuck muted | Not a secure origin — you need HTTPS off `localhost` |
| Joining fails after ~15 s with "Couldn't establish an audio connection" | Media ports unreachable from that network: not forwarded, wrong `NODE_IP`, or an HTTP-only tunnel with no TURN. `docker compose logs livekit` shows "removing participant without connection" with the ICE candidates it tried |
| Everyone shows as connected, nobody hears anyone | The same, but the media path broke after the join (a network change); leave and rejoin, then check the row above |
| A participant lingers after their tab closed | Their WebSocket to Stoop hadn't dropped yet; it clears when it does (seconds) |
