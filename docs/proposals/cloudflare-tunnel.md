# Cloudflare Tunnel from the app

Status: decided 2026-09-17 (STOOP-300); the public address decision was
reversed 2026-09-18, during review of the build. Every decision below was
settled with the maintainer; the renderings live in a design page beside
it.

Stoop runs Cloudflare's connector itself, the way it already runs a
Tailscale node. The operator creates a tunnel in Cloudflare, pastes its
token on Server admin → Hosting (or wizard step 3), ticks a box and saves.

## Decisions at a glance

| | |
| --- | --- |
| How cloudflared runs | A child process Stoop starts, restarts and stops. The Docker image ships a pinned `cloudflared`; a bare binary finds it on `PATH` or at `STOOP_CLOUDFLARED_PATH`. No new compose service. |
| Tunnel kind | Remotely managed: a token. The hostname and its service are set in Cloudflare's dashboard. Locally managed tunnels and quick tunnels are out. |
| The token | Write-only, like the Tailscale auth key. The field takes the token and nothing else; checked the way cloudflared decodes it, so a bad paste is refused at save. It reaches cloudflared through the environment, never the command line. A token from `.env` stays there: saving the switch with the field blank never copies it into the database. |
| Public address | The operator's to fill in, as with any other proxy. Not read from the tunnel. While the tunnel runs and the field is blank, one hint asks for it. |
| Trusted proxies | Nothing derived. Ticking the box adds `127.0.0.1` and `::1` to the Trusted proxies field (localhost resolves to either), unticking removes them, and it saves with everything else. The list stays the one source of trust. |
| Status | `stopped`, `missing` (no cloudflared), `starting`, `running`, `error`. Read from cloudflared's `/ready` on loopback. |
| Voice | One standing line in the section's description. The voice summary above Save gets a tunnel case. No relay fields repeated. |
| Environment | `STOOP_CLOUDFLARE_TUNNEL`, `STOOP_CLOUDFLARE_TUNNEL_TOKEN`, `STOOP_CLOUDFLARED_PATH`. With the environment alone, the operator names `127.0.0.1, ::1` in `STOOP_TRUSTED_PROXIES` too. |

## Placement

- **Admin → Hosting:** a Cloudflare Tunnel section directly above
  Tailscale, in Tailscale's shape: checkbox, token, status. LiveKit moves
  down beside Voice relay, so the page reads address, ways in, voice.
- **Wizard step 3:** the same form, so the section appears there unchanged.
- Nowhere else: no new tab, no indicator outside the admin page.

## Why

- **A child process, not a sidecar.** One code path for compose and the
  bare binary, and on and off take effect at once. A sidecar would keep
  cloudflared out of `/data`, but cloudflared already sees every message in
  plaintext, because TLS ends at Cloudflare's edge. Managing a container
  over the Docker socket would give Stoop root on the host.
- **Trust written into the list, not derived.** Derived trust would be a
  second source the list doesn't show, and an operator who adds `127.0.0.1`
  anyway would keep it after the tunnel is gone without knowing why. Both
  loopback addresses go in because `localhost` resolves to either.
- **Loopback is the connector's address** because cloudflared is Stoop's
  child, so the usual service is `http://localhost:<port>`. The page never
  says so: Stoop can't see what sits between cloudflared and itself (a
  proxy, a listener bound elsewhere), and someone running a homelab knows
  where their tunnel points. The status reports the connector and nothing
  else; the docs carry the address for the compose setup.
- **The hostname is not read from the tunnel.** The first build took it
  from cloudflared's `/config`: the rule pointed at `localhost` on Stoop's
  port, else the only one. That endpoint is a debugging dump with no
  promised shape, which rule is this server is a guess from inside the
  process, and the answer fed invite links and the OIDC `redirect_uri`
  and changed on every read. Reversed in review; if operators miss it, a
  suggestion the operator confirms into Public address is the easy add.

## Build

- `internal/cftunnel`: `Manager` reconciles like `tailnet.Manager`; the
  connector supervises the process with backoff and polls `/ready` for
  the state.
- `internal/instance/cloudflare_tunnel.go`: the setting
  (`cloudflare_tunnel`), the controller port, the token check.
- `reachability.proto`: `CloudflareTunnelSettings`,
  `CloudflareTunnelStatus`. No migration.
- Both Dockerfiles copy a pinned `cloudflared`; the release PR bumps it.
- Web: `ReachabilityForm/CloudflareTunnelSection.tsx`.

Tests run against a fake cloudflared (the test binary re-executed). A real
tunnel publishes the server, so that check is the maintainer's to start.
