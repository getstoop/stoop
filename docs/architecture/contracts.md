# Contracts: protobuf, Connect, and the wire

Protobuf under `proto/` is the single source of truth for everything that
crosses a process boundary — the HTTP API, the WebSocket event stream, and
the TypeScript client. There is no hand-written request or response type
anywhere in the codebase, and no place where the Go and TypeScript views of
a message can drift apart, because both are generated from the same file.

This is also the seam that makes the module boundaries meaningful. A port
between two modules is a Go interface today; the messages it moves are
already the messages a network call would carry.

## Layout

One directory per module, versioned, one file per entity — the same rule
the Go and SQL trees follow (`docs/conventions.md`).

```
proto/stoop/
  auth/v1/auth.proto
  chat/v1/{chat,space,channel,message,member,reaction,invite,activity}.proto
  files/v1/files.proto
  instance/v1/{instance,providers,reachability,user}.proto
  realtime/v1/realtime.proto
  voice/v1/voice.proto
```

The service definition lives in the file named after the module
(`chat.proto`); the domain types it moves live in files named after the
entity. That keeps `chat.proto` readable as a list of what the module does,
and puts `Message`'s fields next to the code that owns messages.

## The RPC surface

Five Connect services. Every procedure requires a session unless it is
listed as public below.

### `stoop.auth.v1.AuthService`

| Procedure | Notes |
| --------- | ----- |
| `Register` | **Public.** Subject to the registration policy; may carry an invite code. Honours a session when one is present, which is how an admin creates accounts under a closed policy. |
| `Login` | **Public.** Username and password; rate-limited per client IP. |
| `Logout` | Revokes the current session immediately. |
| `GetMe` | The signed-in user, including instance role. |
| `UpdateProfile` | Display name, username, pronouns, bio. |
| `GetUserProfile` | One person's public profile card. Visible to any signed-in user. |
| `ChangePassword` | Current password required, except for a provider-created account setting its first one. |
| `ListIdentities` / `UnlinkIdentity` | Linked OIDC accounts. |

### `stoop.chat.v1.ChatService`

Grouped by what they touch rather than declaration order:

- **Spaces** — `CreateSpace`, `ListSpaces`, `GetSpace`, `UpdateSpace`,
  `DeleteSpace`, `JoinSpace`, `LeaveSpace`, `TransferOwnership`
- **Members** — `ListMembers`, `GetMember`, `AddMember`, `SetMemberRole`,
  `KickMember`, `BanMember`, `UnbanMember`, `ListBans`
- **Blocks** — `BlockUser`, `UnblockUser`, `ListBlockedUsers`
- **Invites** — `CreateInvite`, `ListInvites`, `RevokeInvite`,
  `LookupInvite` (**public**)
- **Channels** — `CreateChannel`, `ListChannels`, `UpdateChannel`,
  `DeleteChannel`, `ReorderChannels`, `SetChannelMuted`, `SetSpaceMuted`
- **Messages** — `SendMessage`, `ListMessages`, `EditMessage`,
  `DeleteMessage`, `ToggleReaction`
- **Direct messages** — `OpenDirectMessage`, `ListDirectMessages`
- **Attention** — `MarkChannelRead`, `ListActivity`,
  `MarkActivityRead`

`LookupInvite` is public because an invited stranger has to see what they
are being invited to before they have an account to see it with. It answers
with the *public face* of a space only — name, icon, description, member
count, and the role the code grants — never the welcome text, which is for
people who joined.

### `stoop.instance.v1.InstanceService`

| Procedure | Notes |
| --------- | ----- |
| `GetInstanceStatus` | **Public.** What the setup and login screens need before anyone has an account: `needs_setup`, the registration and space-creation policies, the public URL invite links are built from, the login-provider summaries, whether the password form is offered, and the effective upload caps (so a client refuses an oversized file before sending it). |
| `UpdateSettings` | Admins. Registration policy, space-creation policy, upload limit, storage quota, password sign-in. |
| `ListUsers`, `SetUserRole`, `SetUserActive`, `ResetUserPassword`, `RenameUser`, `SetUsernameFrozen`, `ClearUserProfile` | Admins. The user administration tab; each is backed by the `UserAdmin` port into auth. |
| `GetReachability` / `UpdateReachability` | Admins. Public URL, TURN relay, Cloudflare TURN, Tailscale, trusted proxies. |
| `GetLoginProviders` / `UpdateLoginProviders` | Admins. The OIDC provider list, replaced whole. |
| `GetBuildInfo` | Admins. Version, commit, build time, Go version — admin-only because an exact version tells a stranger which bugs to try. |

### `stoop.files.v1.FileService`

`UploadAvatar`, `UploadSpaceIcon` (bytes ride inside the request; 2 MB cap),
`GetStorageUsage`, `SweepFiles` (admins).

### `stoop.voice.v1.VoiceService`

`JoinVoiceChannel` — returns a short-lived LiveKit room token, the
signaling URL, and any ICE servers the browser should use.

## The non-RPC surface

Some things are not RPCs, each for a specific reason.

| Endpoint | Why not Connect |
| -------- | --------------- |
| `GET /ws` | The realtime protocol is a long-lived bidirectional stream of binary frames, not a request/response. See [realtime.md](realtime.md). |
| `POST /files/upload` | Multipart, up to 100 MB. Base64 inside a JSON Connect body would inflate it by a third and buffer it entirely in memory. |
| `GET|HEAD /files/{id}` | Plain HTTP so the browser's `<img>`, `<video>` and download machinery work, including `Range` requests — which is what lets a video seek, and what iOS Safari requires before it will play at all. |
| `GET /auth/oidc/{id}/start`, `GET /auth/callback/{id}` | Browser redirects to and from an identity provider. |
| `/livekit/…` | A reverse proxy for LiveKit's own signaling WebSocket, so the whole app lives on one origin. |
| `GET /healthz` | For container health checks and the E2E harness's readiness loop. |
| `GET /` and everything unmatched | The embedded SPA, with unknown paths falling through to `index.html` so client-side routes survive a refresh. |

## The realtime wire format

`stoop.realtime.v1` defines no service. It defines two envelopes —
`ServerEvent` and `ClientEvent` — that travel as binary protobuf frames on
`/ws`.

The envelope's `oneof` has a numbering convention that is worth keeping:
**3–9 are protocol events, 10 and up are domain events.** `Ready` and `Ping`
sit in the low range; everything that describes something happening in a
space sits above it. New protocol events are rare and there is room for
them; new domain events append.

Note that several domain events carry *chat's* types directly —
`ServerEvent.message_created` is a `stoop.chat.v1.Message`, not a realtime
copy of one. There is one definition of a message on the wire, whether it
arrived from `ListMessages` or from the socket, which is what allows the
client to put both into the same cache entry without a conversion step.

## Code generation

The Buf toolchain generates three trees:

| Output | Plugin | Consumed by |
| ------ | ------ | ----------- |
| `gen/` | `protocolbuffers/go`, `connectrpc/go` | The Go server. |
| `web/src/gen/` | `bufbuild/es` (target `ts`) | The React client, via connect-es v2. |
| `internal/dbgen/` | sqlc (not Buf) | Every module's queries. |

**All three are committed.** A contributor should be able to clone, run
`go build`, and get a working binary without installing buf, sqlc, or
protoc. The cost is that generated code can drift from its source, so CI
regenerates both trees and fails on any diff:

```
buf generate  && git diff --exit-code -- gen web/src/gen
sqlc generate && git diff --exit-code -- internal/dbgen
```

**The generator versions are pinned** in `buf.gen.yaml`, and sqlc is
invoked at an exact version in CI. Unpinned, buf resolves whatever is
current — so the day a plugin publishes a release, CI regenerates a tree
that differs from the committed one, often by nothing but a `@generated by`
header, and the drift job fails on whatever commit happens to land next.
Pinned, a generator upgrade is a commit someone made on purpose.

Regenerate locally with `make generate`, which also runs `buf lint`.

## Compatibility rules

Stoop is pre-1.0 and self-hosted: an instance's server and its web client
are the same binary, so they upgrade together and cannot disagree. That
removes the usual pressure for wire compatibility *within* a deployment.
It does not remove it entirely — the typed protocol is meant to be usable
by third-party and future native clients, and `buf breaking` is configured
against `FILE` — so:

- **Never renumber or reuse a field.** Deleting a field means reserving its
  number.
- **New fields are optional by construction** (proto3 has no required), so
  adding one is always safe.
- **Enums always have an `_UNSPECIFIED = 0`.** A zero value that means
  "nobody set this" is distinguishable from a real value, which matters for
  `PresenceStatus` and `ActivityKind` where a default would otherwise
  be a silent lie.
- **`oneof` ranges follow the convention above**, so an event's number
  tells you what kind of thing it is.

## Errors

Handlers return `connect.Error`s, and the code is part of the contract:

| Code | Used for |
| ---- | -------- |
| `InvalidArgument` | Malformed or contradictory input — a message over 4000 characters, `before_id` and `around_id` together, a reply pointing at another channel's message. |
| `Unauthenticated` | No valid session on a non-public procedure. |
| `PermissionDenied` | A valid session that lacks the permission — see [permissions.md](permissions.md). |
| `NotFound` | Missing, *or* present but invisible to the caller. The two are deliberately not distinguished: an id lookup that answered "exists, but not for you" would be an enumeration oracle. |
| `ResourceExhausted` | Rate limit (with `Retry-After`) or storage quota. |
| `Unavailable` | A feature the operator hasn't configured — `JoinVoiceChannel` with no LiveKit. |

The web client maps codes to human sentences in `web/src/api/errors.ts` and
`loginErrors.ts` rather than showing the raw message, so a server-side
string is never load-bearing for the UI.
