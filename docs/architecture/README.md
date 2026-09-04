# Stoop Architecture

Stoop is a self-hosted community chat and voice service: **one Go binary,
one Postgres database, and — only if voice is wanted — a LiveKit sidecar**.
The web app is compiled into the binary. There is no queue, no cache
server, no object store, no separate API gateway. Upgrading is pull the
new binary and restart; the schema migrates itself on the way up.

That shape is a deliberate answer to who runs it. The operator is a person
with a VPS, an old laptop, or a Raspberry Pi, hosting for a group of people
who know each other. Every part of the design below is downstream of the
rule that this person should never have to operate infrastructure to keep
their friends talking.

Inside the binary the code is a **modular monolith**: strict internal
module boundaries, enforced by the linter, so that any module could later
be extracted into its own service without touching the others. Extraction
would be a wiring change in one package, not a rewrite. Nothing has been
extracted, and nothing needs to be.

## The running system

```
                    ┌───────────────────────────────────────────────────────┐
                    │                   stoop (one process)                 │
                    │                                                       │
  browser ─ HTTPS ─►│  :8080  Connect RPC   auth · chat · instance · files  │
                    │         plain HTTP    /auth/… /files/… /healthz       │
                    │         WebSocket     /ws  ──►  realtime gateway      │
                    │         WebSocket     /livekit ─► signaling proxy ──┐ │
                    │         static        embedded web app (go:embed)   │ │
                    │                                                     │ │
                    │  chat ──► events bus ──► gateway ──► connected tabs  │ │
                    │  background: file sweep · activity sweep         │ │
                    │  optional:  tsnet listener (HTTPS on the tailnet)    │ │
                    └───────┬─────────────────────────────────────────────┼─┘
                            │                                             │
                     ┌──────▼──────┐                          ┌───────────▼──────────┐
                     │  Postgres   │                          │   LiveKit sidecar    │
                     │  (all state)│                          │  signaling + SFU     │
                     └─────────────┘                          └───────────┬──────────┘
                                                                          │
  browser ◄─── WebRTC media (UDP, TCP 7881) ──────────────────────────────┘
              never through Stoop
```

Two things are worth reading off that diagram immediately.

**Everything a browser needs arrives on one origin.** The API, the
WebSocket, the file downloads, the SPA, and even LiveKit's signaling socket
are all served by the Stoop process on one hostname with one certificate.
An operator configures one thing in their reverse proxy, not five.

**Media is the one exception, and it is not negotiable.** Voice and video
are WebRTC between the browser and LiveKit's own ports. They never pass
through the Stoop process, which means a front door that carries only HTTP
— a Cloudflare Tunnel, a Tailscale Funnel — gives a silent voice room
unless a TURN relay is configured. Stoop can supply one
([voice.md](voice.md)), but it cannot make an HTTP tunnel carry UDP. Any
document, wizard step or error message about reaching the server has to say
this plainly.

## Modules

| Package             | Owns |
| ------------------- | ---- |
| `internal/auth`     | users (incl. instance role), sessions, password hashing, OIDC sign-in and account linking, self-service profiles, the auth interceptor |
| `internal/chat`     | spaces, members (incl. space role), channels + read markers + mutes, messages (replies, edits, reactions, attachments), mentions, activity, invites, bans, blocks, direct messages, link records |
| `internal/instance` | instance status, runtime settings (registration policy, quotas, reachability, login providers), user administration |
| `internal/realtime` | the WebSocket gateway; in-memory presence, status, typing and voice state (no database access at all) |
| `internal/voice`    | LiveKit token minting, the `/livekit` signaling proxy, ICE/TURN sources |
| `internal/files`    | uploaded files: the `files` table, upload RPCs, `GET /files/{id}`, the sweep, the quota |

Support packages, which are not modules and own no domain: `internal/events`
(the bus), `internal/db` (pool + migrations), `internal/dbgen` (sqlc output),
`internal/config`, `internal/authctx` (the shared identity contract),
`internal/blob` (the storage port and its backends), `internal/unfurl`
(the link fetcher), `internal/ratelimit`, `internal/trustedproxy`,
`internal/tailnet` (the optional embedded Tailscale node), `internal/webui`
(the embedded SPA), `internal/app` (the composition root), and `cmd/stoop`.

## The five rules

These are the load-bearing constraints. [modules.md](modules.md) gives each
one its reasoning, its enforcement, and what it costs.

1. **Modules never import each other.**
2. **Cross-module needs are consumer-owned interfaces — "ports" — wired in
   `internal/app`.**
3. **Each module owns its tables.** Foreign keys may cross module lines;
   queries may not.
4. **Async fan-out goes through the events bus**, never a direct call into
   the gateway.
5. **`internal/app` is the only package that knows everything.**

## Where to read next

| Document | What it covers |
| -------- | -------------- |
| [modules.md](modules.md) | Module boundaries, the full port catalogue, the composition root, startup and shutdown, and what extraction would actually involve. |
| [contracts.md](contracts.md) | Protobuf as the source of truth, the complete RPC and HTTP surface, code generation, and compatibility rules. |
| [data.md](data.md) | The Postgres schema table by table, who owns what, migrations, sqlc, transactions, and what is deliberately not stored. |
| [realtime.md](realtime.md) | The events bus, the WebSocket gateway, the wire protocol, ephemeral state, and how the client applies events to its cache. |
| [identity.md](identity.md) | Accounts, passwords, sessions, OIDC sign-in, rate limiting, and the CSRF posture. |
| [permissions.md](permissions.md) | The two permission axes, the fixed permission table, invites, bans, and blocks. |
| [messaging.md](messaging.md) | Messages and their Markdown, mentions and activity, unreads, history windows, direct messages, and link previews. |
| [files.md](files.md) | Uploads, image normalisation, the blob port, the download handler, the sweep, and the quota. |
| [voice.md](voice.md) | LiveKit tokens, the signaling proxy, ICE and TURN, the stage, and why media never touches Stoop. |
| [web.md](web.md) | The React client: routing, the query cache as the single source of truth, stores, themes, and the design system. |
| [runtime.md](runtime.md) | Process model, configuration precedence, front doors, security headers, background work, and how a build is produced. |

Related documents outside this directory: [../vision.md](../vision.md) for
why Stoop exists, [../conventions.md](../conventions.md) for how files are
laid out, [../self-hosting.md](../self-hosting.md) for the operator's view,
and [../agent-workflow.md](../agent-workflow.md) for how a change is built
and lands.

## Deliberately deferred

Federation, end-to-end encryption, mobile apps, plugins, a SQLite mode, and
multi-node scaling. The `events.Bus` interface is the only concession made
to the last of those today, and it is a real one: a NATS or Redis
implementation is a marshal/unmarshal wrapper behind the same interface,
because every payload on the bus is already a protobuf message.
