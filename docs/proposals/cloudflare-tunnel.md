# Cloudflare Tunnel from the app

Status: decided 2026-09-17 (STOOP-300). Every decision below was settled
with the maintainer before the build; the renderings live in a design page
beside it.

Stoop runs Cloudflare's connector itself, the way it already runs a
Tailscale node. The operator creates a tunnel in Cloudflare, pastes its
token on Server admin → Hosting (or wizard step 3), ticks a box and saves.

## Decisions at a glance

| | |
| --- | --- |
| How cloudflared runs | A child process Stoop starts, restarts and stops. The Docker image ships a pinned `cloudflared`; a bare binary finds it on `PATH` or at `STOOP_CLOUDFLARED_PATH`. No new compose service. |
| Tunnel kind | Remotely managed: a token. The hostname and its service are set in Cloudflare's dashboard. Locally managed tunnels and quick tunnels are out. |
| The token | Write-only, like the Tailscale auth key. The field also takes the whole install command Cloudflare shows and keeps the token from it. It reaches cloudflared through the environment, never the command line. |
| Public address | Derived, never saved: saved value, then `STOOP_PUBLIC_URL`, then the tunnel's hostname, then the tailnet address. |
| Trusted proxies | Nothing derived. Ticking the box adds `127.0.0.1` to the Trusted proxies field, unticking removes it, and it saves with everything else. The list stays the one source of trust. |
| Status | `stopped`, `missing` (no cloudflared), `starting`, `running` (with the hostname), `error`. Read from cloudflared's own metrics endpoint on loopback. |
| Voice | One standing line in the section's description. The voice summary above Save gets a tunnel case. No relay fields repeated. |
| Environment | `STOOP_CLOUDFLARE_TUNNEL`, `STOOP_CLOUDFLARE_TUNNEL_TOKEN`, `STOOP_CLOUDFLARED_PATH`. With the environment alone, the operator names `127.0.0.1` in `STOOP_TRUSTED_PROXIES` too. |

## Placement

- **Admin → Hosting:** a Cloudflare Tunnel section directly above
  Tailscale, in Tailscale's shape: checkbox, token, status. LiveKit moves
  down beside Voice relay, so the page reads address, ways in, voice.
- **Public address row:** one muted line naming the derived address while
  the field is blank and the tunnel runs.
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
  anyway would keep it after the tunnel is gone without knowing why.
- **Loopback is the connector's address** because cloudflared is Stoop's
  child: the tunnel's service is `http://localhost:<port>`, which the
  section shows.

## Build

- `internal/cftunnel`: `Manager` reconciles like `tailnet.Manager`; the
  connector supervises the process with backoff and polls `/ready` and
  `/config` for the state and the hostname.
- `internal/instance/cloudflare_tunnel.go`: the setting
  (`cloudflare_tunnel`), the controller port, the token check.
- `reachability.proto`: `CloudflareTunnelSettings`,
  `CloudflareTunnelStatus`. No migration.
- Both Dockerfiles copy a pinned `cloudflared`; the release PR bumps it.
- Web: `ReachabilityForm/CloudflareTunnelSection.tsx`.

Tests run against a fake cloudflared (the test binary re-executed). A real
tunnel publishes the server, so that check is the maintainer's to start.
