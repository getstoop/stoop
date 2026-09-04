# Stoop — vision & the gap we fill

**Stoop is an open-source, self-hostable chat and voice app for small
communities.** You run it on your own hardware — a VPS, an old laptop, a
Raspberry Pi — and invite your people. Spaces contain channels; text chat is
realtime; voice rooms are backed by LiveKit. One static binary plus Postgres,
and your community's conversations live on hardware you control.

## The gap

Group chat today forces a bad choice.

- **Discord** is the UX benchmark for hangout-style communities, but it is a
  closed platform: your community's entire history lives on their servers,
  subject to their moderation, monetization, and continuity decisions.
- **Slack** is built for companies — per-workspace identities, per-seat
  pricing, message history held hostage on free tiers.
- **Matrix** gets the ownership story right but pays for federation with real
  complexity: homeserver operations are heavy, clients are uneven, and the UX
  tax is felt daily.
- **IRC** owns simplicity but lacks history, media, identity, and voice.

The unserved middle: *a friend group or small community that wants Discord's
experience — spaces, channels, instant messaging, low-latency voice — with
ownership of their data, on hardware one member of the group can realistically
run.* That's the stoop we're building: the place in front of the building
where everyone hangs out.

## What we optimize for

- **Trivial self-hosting.** One static Go binary with the web UI embedded,
  Postgres, and LiveKit via docker-compose. Migrations run automatically at
  startup: upgrading is pull-and-restart. Builds target linux/amd64 and arm64 —
  a Pi is a first-class host.
- **One host, many communities.** The technical friend hosts once; everyone
  else just joins. One account participates in many spaces on an instance —
  Discord's identity model, not Slack's.
- **Typed, open protocol.** Protobuf contracts (Connect RPC) drive the HTTP
  API, the WebSocket event stream, and the TypeScript client alike.
  Third-party clients and future native apps get generated types for free.
- **Boring, sturdy tech.** Go, Postgres, React. Each self-hosted instance is
  its own shard — no planet-scale infrastructure for a five-person community.

## Deliberate non-goals (for now)

Federation, end-to-end encryption, mobile apps, plugins, and multi-node
scaling are consciously deferred. The architecture reserves seams for them
(an event-bus interface, strict module boundaries — see
[architecture/](architecture/README.md)), but the near-term mission is a complete,
polished single-instance experience.

## Where things stand

The single-instance experience is built and verified: accounts and
sessions, spaces and channels, realtime messaging over a protobuf WebSocket
protocol, roles and permissions, invites, an activity feed with per-space
and per-channel mutes, presence, message editing, replies, reactions, Markdown, link previews, file uploads
(avatars, space icons, attachments), direct messages, voice channels on LiveKit, ten
client-side themes, and the space and server admin tooling — all from a
single binary with the web app embedded. Reaching the server is a product
question, not an ops one: the setup wizard walks an operator through a
reverse proxy, Cloudflare Tunnel (with Cloudflare TURN so voice works
through it), or the built-in Tailscale node — which carries LiveKit's
media ports as well as the web app, so voice rides the tailnet with
nothing installed on the server — and says plainly which of them can
carry voice audio. The roadmap from here — an S3
storage backend, slash commands, group DMs, Markdown lists and spoilers, and a
sweep for orphaned files — is tracked in the project's issue tracker.
