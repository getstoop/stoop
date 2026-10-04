# Configuration reference

Set any of these in `.env`; the compose file passes that file through to
the server. Two are pinned by the compose file itself and ignore what
`.env` says: `STOOP_STORAGE_DIR` and `STOOP_LIVEKIT_KEY_FILE`.
`STOOP_DATABASE_URL` defaults to the bundled Postgres; set it only when
[using your own](install.md#using-your-own-postgres).

Settings that also appear on the admin page (the instance name, password
sign-in, the `STOOP_OIDC_*` provider, and the public URL, trusted
proxies, TURN, Cloudflare and Tailscale settings) only pre-configure the
server. Each is copied into the database the first time the server
starts with it set. After that, changing the variable does nothing
(the server logs a warning naming it): change the setting on the admin
page.

| Variable                   | Default                     | Purpose                          |
| -------------------------- | --------------------------- | -------------------------------- |
| `STOOP_DATABASE_URL`       | (required)                  | Postgres connection string       |
| `STOOP_DATABASE_POOL_MAX`  | `0`                         | Most connections each Stoop process opens to Postgres, plus one the job dispatcher holds to be woken and, in the server, one that hears events from a `stoop jobs` process. `0` is the larger of 4 and the CPU count; otherwise at least 2. Keep it under Postgres `max_connections`, less what backups and `psql` need. Wins over `pool_max_conns` in the URL |
| `STOOP_LISTEN_ADDR`        | `:8080`                     | HTTP bind address                |
| `STOOP_PUBLIC_URL`         | (empty)                     | The address people use to reach the server; invite links use it, its host is an allowed WS origin. Defaults to the tailnet address with the built-in Tailscale listener |
| `STOOP_TRUST_PROXY`        | `false`                     | Removed. `true` refuses to start; name the proxy in `STOOP_TRUSTED_PROXIES` instead |
| `STOOP_TRUSTED_PROXIES`    | (empty)                     | Comma-separated addresses or CIDR ranges of your reverse proxy or tunnel (`172.18.0.0/16, 192.168.1.5`); only those callers' `X-Forwarded-*` headers are believed. |
| `STOOP_SECURE_COOKIES`     | `false`                     | Force session cookies Secure on every listener. Rarely needed: TLS listeners and trusted HTTPS proxies get it automatically |
| `STOOP_ALLOWED_WS_ORIGINS` | `localhost:*,127.0.0.1:*`   | Extra WebSocket origin patterns. The request's own host (and `STOOP_PUBLIC_URL`'s) is always allowed, so this is only needed behind a proxy that rewrites `Host` |
| `STOOP_AUTH_RATE_LIMIT`    | `20`                        | Sign-in and registration attempts allowed per client address per minute. `0` disables (dev/e2e only). The per-account lockout after 5 wrong passwords is always on |
| `STOOP_SIGNALING_RATE_LIMIT` | `30`                      | New voice signaling connections per client address per minute (the LiveKit proxy is unauthenticated; this keeps it from being an open relay). `0` disables |
| `STOOP_SEARCH_RATE_LIMIT`  | `30`                        | Message searches per user per minute. `0` disables |
| `STOOP_REGISTRATION`       | `invite`                    | Seeds the registration policy on first boot only (`open`, `invite`, `closed`); change it later from the admin page |
| `STOOP_INSTANCE_NAME`      | (random, e.g. `Chalk Avenue`) | The server's name, shown in the browser tab. Unset, a random two-word name is picked on first boot and kept, so several instances never all call themselves "Stoop" |
| `STOOP_STORAGE`            | `fs`                        | File storage backend. `fs` is the only one; any other value (including `s3`) refuses to start |
| `STOOP_STORAGE_DIR`        | `./data`                    | Directory for uploaded files (compose: `/data` on the `stoop-data` volume) |
| `STOOP_LIVEKIT_KEY_FILE`   | `<STOOP_STORAGE_DIR>/livekit/keys.yaml` | Where to write the LiveKit key pair for a sidecar started with `--key-file`. Written on every boot (minted or from the environment); the file is `0600` in a `0700` directory because LiveKit refuses a key file others can read |
| `STOOP_LINK_PREVIEWS`      | `true`                      | Fetch Open Graph cards for links in messages. The server fetches (readers' browsers never contact the site); set `false` if the server should make no outbound requests on members' behalf |
| `STOOP_UPDATE_CHECK`       | `true`                      | Read the release list on getstoop.org so Server admin can say a newer release exists, or that this one is no longer supported. Nothing about the server is sent; set `false` to stop the request |
| `STOOP_FILE_SWEEP_INTERVAL` | `6h`                       | How often unreferenced uploads, stray blobs and old read activity items are removed; `0` turns the timer off (the admin page can still sweep) |
| `STOOP_FILE_SWEEP_GRACE`   | `24h`                       | How old an unreferenced file must be before the sweep takes it |
| `STOOP_ACTIVITY_RETENTION` | `720h`                      | Read mention/reply/DM activity items older than this are removed on the sweep timer; `0` keeps them forever |
| `STOOP_UNFURL_ALLOW_PRIVATE` | `false`                   | Let link previews fetch private/loopback addresses. **Dev and tests only** — it is what stops the server being used as a proxy into your LAN |
| `STOOP_WEBHOOKS`           | `true`                      | `false` stops every incoming webhook post and outgoing delivery, whatever the admin settings say; nothing is deleted |
| `STOOP_WEBHOOK_RATE_LIMIT` | `60`                        | Posts per minute one incoming webhook may make; `0` removes the limit |
| `STOOP_WEBHOOK_DELIVERY_RETENTION` | `168h`              | How long finished outgoing webhook deliveries are kept in the log; `0` keeps them forever |
| `STOOP_JOBS_WORKERS`       | `4`                         | How many background jobs run at once |
| `STOOP_JOBS_POLL`          | `2s`                        | How often the dispatcher looks for due jobs |
| `STOOP_JOBS_RETENTION`     | `168h`                      | How long finished job rows are kept for the Background work panel; `0` keeps them forever |
| `STOOP_JOBS`               | `embedded`                  | Where the job dispatcher runs. `external` runs no jobs in the server, for the `jobs` compose service or your own `stoop jobs`; `child` has the server start and supervise `stoop jobs` itself. See [Running background jobs apart](install.md#running-background-jobs-apart) |
| `STOOP_DEV_WEB_URL`        | (empty)                     | Serve the web app from a Vite dev server at this address instead of the embedded build, allowing inline scripts for its hot reload. **Development only** — `make dev` sets it |
| `STOOP_VOICE`              | `true`                      | `false` runs a text-only server: LiveKit is ignored, no key pair is minted, and voice channels are hidden. Nothing is deleted |
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
| `STOOP_TAILSCALE`          | `false`                     | Join a tailnet from inside the binary and serve HTTPS on the tailnet address (see Tailscale, built in) |
| `STOOP_TAILSCALE_HOSTNAME` | `stoop`                     | Node name on the tailnet         |
| `STOOP_TAILSCALE_AUTHKEY`  | (empty)                     | Pre-authorise the node; otherwise a login URL is logged on first start |
| `STOOP_TAILSCALE_CONTROL_URL` | (empty)                  | Self-hosted control server (Headscale) |
| `STOOP_TAILSCALE_FUNNEL`   | `false`                     | Also expose the tailnet address publicly via Funnel (HTTP only — voice needs TURN) |
| `STOOP_TAILSCALE_VOICE`    | `true`                      | The built-in node also carries LiveKit's media ports, so voice rides the tailnet. `false` serves HTTPS over the tailnet only |
| `STOOP_LIVEKIT_MEDIA_HOST` | `127.0.0.1` (`livekit` in compose) | Where the built-in node forwards media: LiveKit's host on this machine or network |
| `STOOP_LIVEKIT_TCP_PORT`   | `7881`                      | LiveKit's TCP media port. Under compose this one setting also configures and publishes it; with a bare binary, match it to `livekit.yaml` |
| `STOOP_LIVEKIT_UDP_PORTS`  | `50000-50100`               | LiveKit's UDP media range, as `start-end`. Same as above |
| `STOOP_LIVEKIT_NODE_IP_FILE` | (empty)                   | File Stoop writes the tailnet address to for the LiveKit sidecar's `NODE_IP`. Defaults to `node-ip` beside `STOOP_LIVEKIT_KEY_FILE`, which is what lands it on the shared volume under compose |
| `STOOP_OIDC_ISSUER`        | (empty)                     | One OIDC login provider from the environment: the issuer URL exactly as its discovery document states it |
| `STOOP_OIDC_CLIENT_ID`     | (empty)                     | The provider's client id; set together with the secret and issuer |
| `STOOP_OIDC_CLIENT_SECRET` | (empty)                     | The provider's client secret |
| `STOOP_OIDC_NAME`          | `Continue with single sign-on` | The sign-in button's entire text |
| `STOOP_OIDC_ID`            | `sso`                       | The provider's stable id; part of the callback URL, and identities link under it |
| `STOOP_SESSION_LIFETIME_DAYS` | `30`                    | How long a sign-in lasts, 1-365 days. The admin page's saved value overrides it; a change applies to sign-ins from then on |
| `STOOP_PASSWORD_SIGN_IN`   | `everyone`                  | Who may use the username/password form: `everyone`, `admins`, or `off` (sign in through login providers instead); admins are always honoured as a fallback |

## Compose settings

These are read by the compose file, not by the server, so they apply to
the Docker Compose install only.

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMPOSE_PROFILES` | `bundled-postgres,bundled-livekit` | Which bundled services run. Without `bundled-postgres` you [use your own Postgres](install.md#using-your-own-postgres); without `bundled-livekit` you [run without voice](voice.md#running-without-voice); with `jobs` you [run the background jobs apart](install.md#running-background-jobs-apart) |
| `STOOP_PORT` | `8080` | The port the web app is published on |
| `TZ` | `UTC` | Time zone of the timestamps in `docker compose logs` |
| `STOOP_DATA_PATH` | `stoop-data` volume | Where uploads and the Tailscale node identity live; see [Where the data lives](install.md#where-the-data-lives) |
| `POSTGRES_DATA_PATH` | `postgres-data` volume | Where the bundled Postgres keeps its data |
| `PUID`, `PGID` | `65532` | The user and group Stoop runs as; match the owner of `STOOP_DATA_PATH` |
| `POSTGRES_PASSWORD` | (none) | Password of the bundled Postgres |
| `POSTGRES_ARGS` | (empty) | `postgres -c name=value` flags for the bundled Postgres; see [Tuning the bundled Postgres](install.md#tuning-the-bundled-postgres) |
| `NODE_IP` | (empty) | The address LiveKit offers browsers for media; see [Voice](voice.md) |
