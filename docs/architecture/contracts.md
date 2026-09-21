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
  access/v1/access.proto      the Permission and IdentityKind enums, shared by every service
  auth/v1/auth.proto
  chat/v1/{chat,space,channel,message,member,reaction,invite,activity,pin}.proto
  common/v1/field_violation.proto   an error detail, attached by any service (see Errors)
  files/v1/files.proto
  instance/v1/{instance,providers,reachability,user}.proto
  integrations/v1/{integrations,webhook,bot}.proto
  realtime/v1/realtime.proto
  voice/v1/voice.proto
```

The service definition lives in the file named after the module
(`chat.proto`); the domain types it moves live in files named after the
entity. That keeps `chat.proto` readable as a list of what the module does,
and puts `Message`'s fields next to the code that owns messages.

## The RPC surface

Six Connect services. Every procedure requires a credential — a session
or a token — unless it is listed as public below.

### `stoop.auth.v1.AuthService`

| Procedure | Notes |
| --------- | ----- |
| `Register` | **Public.** Subject to the registration policy; may carry an invite code. Honours a session when one is present, which is how an admin creates accounts under a closed policy. |
| `Login` | **Public.** Username and password; rate-limited per client IP. |
| `Logout` | Revokes the current session immediately. |
| `GetMe` | The signed-in user, including instance role, and the instance and own-account permissions their credential covers. |
| `UpdateProfile` | Display name, username, pronouns, bio. |
| `SetDoNotDisturb` | Turns do not disturb on, with an optional end in the future, or off. Stored on the account (`users.dnd`, `users.dnd_until`) and published to the person's own topic as `DoNotDisturbChanged`, so every device follows. Refused for bots. |
| `GetUserProfile` | One account's public profile card, with its `kind` (person or bot). Visible to any signed-in user. |
| `ChangePassword` | Current password required, except for a provider-created account setting its first one. |
| `ListIdentities` / `UnlinkIdentity` | Linked OIDC accounts. |
| `DeleteAccount` | The caller's own account, when the server allows it. See [identity.md](identity.md#deleting-your-account). |
| `ListSessions` / `RevokeOtherSessions` | Where the caller is signed in, and signing every other session out. Need a session (`account.security`); only the caller's own. |
| `CreatePersonalToken` / `ListPersonalTokens` / `RevokePersonalToken` | The caller's personal tokens. Need a session (`account.security`); the token is returned once, by `CreatePersonalToken`. |

### `stoop.chat.v1.ChatService`

Grouped by what they touch rather than declaration order:

- **Spaces** — `CreateSpace`, `ListSpaces` (`all` lists every space on
  the server, for holders of `spaces.join_any`), `ListAllSpaces` (the
  server admin's Spaces page: every space as a `SpaceSummary`, with its
  owner, member count and whether the caller is a member; needs
  `instance.read`), `GetSpace`, `UpdateSpace`, `DeleteSpace`,
  `JoinSpace`, `LeaveSpace`, `TransferOwnership`
- **Members** — `ListMembers`, `GetMember`, `AddMember`, `SetMemberRole`,
  `KickMember`, `BanMember`, `UnbanMember`, `ListBans`
- **Blocks** — `BlockUser`, `UnblockUser`, `ListBlockedUsers`
- **Invites** — `CreateInvite`, `ListInvites`, `RevokeInvite`,
  `LookupInvite` (**public**)
- **Channels** — `CreateChannel`, `ListChannels`, `UpdateChannel`,
  `DeleteChannel`, `ReorderChannels`, `SetChannelMuted`, `SetSpaceMuted`
- **Messages** — `SendMessage`, `ListMessages`, `SearchMessages`,
  `EditMessage`, `DeleteMessage`, `ToggleReaction`, `SetMessagePinned`,
  `ListPinnedMessages`
- **Direct messages** — `OpenDirectMessage`, `ListDirectMessages`,
  `ListDirectMessageCandidates`, `SetDirectMessageClosed`
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
| `UpdateSettings` | Admins. Registration policy, space-creation policy, upload limit, storage quota, password sign-in, personal tokens, session lifetime, instance name, self-deletion, message and attachment retention, the webhook switches. |
| `PreviewRetention` | Admins. How many messages or attachments a retention setting would delete, before it is saved. |
| `ListUsers`, `SetUserRole`, `SetUserActive`, `ResetUserPassword`, `RenameUser`, `SetUsernameFrozen`, `ClearUserProfile` | Admins. The user administration tab; each is backed by the `UserAdmin` port into auth. Each user carries its `kind` and whether it is the `owner`; a password reset or a username freeze on a bot is refused, and demoting, deactivating or resetting the owner is refused. `RenameUser` and `ClearUserProfile` need the caller to outrank the account: the owner over admins, admins over members. |
| `TransferOwnership` | The owner only, to an active admin. See [identity.md](identity.md#the-server-owner). |
| `GetReachability` / `UpdateReachability` | Admins. Public URL, TURN relay, Cloudflare TURN, Tailscale, trusted proxies. |
| `GetLoginProviders` / `UpdateLoginProviders` | Admins. The OIDC provider list, replaced whole. |
| `GetBuildInfo` | Admins. Version, commit, build time, Go version — admin-only because an exact version tells a stranger which bugs to try. |
| `GetHealth` / `GetLiveStats` / `GetDatabaseStats` / `GetRequestStats` / `ListJobs` | Admins. The Diagnostics tab, read-only, polled every 5 s while it is open. See [diagnostics.md](diagnostics.md). |
| `ListUserTokens` / `RevokeUserToken` | Admins. Another account's personal tokens, never the token itself. |

### `stoop.files.v1.FileService`

`UploadAvatar`, `UploadBotAvatar` (a bot's, by an instance admin),
`UploadSpaceIcon` (bytes ride inside the request; 2 MB cap),
`GetStorageUsage`, `SweepFiles` (admins).

### `stoop.voice.v1.VoiceService`

`JoinVoiceChannel` — returns a short-lived LiveKit room token, the
signaling URL, and any ICE servers the browser should use.

### `stoop.integrations.v1.IntegrationService`

Webhooks and bots ([integrations.md](integrations.md)):
`ListWebhooks` (members, per space; the server-wide list is admins only),
`CreateIncoming`, `CreateOutgoing`, `UpdateIncoming`, `UpdateOutgoing`,
`DeleteWebhook`, `RotateSecret`, `TestWebhook`, `ListDeliveries`,
`RedeliverDelivery`, `ListBots`, `CreateBot`, `UpdateBot`, `AddBotToSpace`,
`RemoveBotFromSpace`, `DeactivateBot`,
`CreateBotToken`, `RevokeBotToken` — all behind
`instance.integrations.manage`, except `ListWebhooks` per space, which
any member may call and which never carries a token, a secret or more of
a receiver's URL than its host.

## The non-RPC surface

Some things are not RPCs, each for a specific reason.

| Endpoint | Why not Connect |
| -------- | --------------- |
| `GET /ws` | The realtime protocol is a long-lived bidirectional stream of binary frames, not a request/response. See [realtime.md](realtime.md). |
| `POST /files/upload` | Multipart, up to 100 MB. Base64 inside a JSON Connect body would inflate it by a third and buffer it entirely in memory. |
| `POST /hooks/{token}` | Its callers are appliances with a URL field, not generated clients: the token rides in the path and the body is whatever the vendor sends (see [integrations.md](integrations.md#incoming)). |
| `GET|HEAD /files/{id}` | Plain HTTP so the browser's `<img>`, `<video>` and download machinery work, including `Range` requests — which is what lets a video seek, and what iOS Safari requires before it will play at all. |
| `GET /auth/oidc/{id}/start`, `GET /auth/callback/{id}` | Browser redirects to and from an identity provider. |
| `POST /auth/desktop/start`, `POST /auth/desktop/complete` | The desktop app's sign-in hand-off. See [identity.md](identity.md#sign-in-from-the-desktop-app). |
| `/livekit/…` | A reverse proxy for LiveKit's own signaling WebSocket, so the whole app lives on one origin. |
| `GET /healthz` | For container health checks and the E2E harness's readiness loop. |
| `GET /version` | Public and unauthenticated, so the desktop shell can ask before anyone signs in. See [desktop.md](desktop.md). |
| `GET /metrics` | The instruments in Prometheus text format, for a scraper: a bearer token holding `instance.read`, 401 with a challenge without one. See [diagnostics.md](diagnostics.md#get-metrics). |
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
  `ActivityKind`, where a default would otherwise be a silent lie.
- **`oneof` ranges follow the convention above**, so an event's number
  tells you what kind of thing it is.

## Errors

Handlers return `connect.Error`s, and the code is part of the contract:

| Code | Used for |
| ---- | -------- |
| `InvalidArgument` | Malformed or contradictory input — a message over 4000 characters, `before_id` and `around_id` together, a reply pointing at another channel's message. |
| `Unauthenticated` | No valid credential on a non-public procedure. |
| `PermissionDenied` | A valid session that lacks the permission — see [permissions.md](permissions.md). |
| `NotFound` | Missing, *or* present but invisible to the caller. The two are deliberately not distinguished: an id lookup that answered "exists, but not for you" would be an enumeration oracle. |
| `ResourceExhausted` | Rate limit (with `Retry-After`) or storage quota. |
| `Unavailable` | A feature the operator hasn't configured — `JoinVoiceChannel` with no LiveKit. |

The sentence is part of the contract too: it is written for the person
who made the request, and clients show it as it is (`errorText` in
`web/src/api/errors.ts`; the `stoop admin` CLI prints it). Only the
provider sign-in redirect maps codes to sentences on the client
(`loginErrors.ts`), because its error arrives in a URL.

### A refusal that is about one field

An `InvalidArgument`, `AlreadyExists` or `FailedPrecondition` about one
request field carries a `stoop.common.v1.FieldViolation` error detail
naming it, built with `apierr.Field(code, field, err)`:

```go
return nil, apierr.Field(connect.CodeInvalidArgument, "topic",
	fmt.Errorf("topic must be %d characters or fewer", maxChannelTopic))
```

- **`field` is the proto field name**, as the request spells it: `name`,
  `new_password`. A nested field is a dotted path and a repeated one takes
  an index: `turn.urls`, `providers[2].client_id`.
- **The sentence stands alone.** The detail adds where to show it, never
  what it says, so a client that ignores details loses nothing.
- **One violation per error.** A handler stops at its first refusal. A
  refusal that involves two fields names the one to change.
- **A validator shared by several requests takes the field name as a
  parameter** rather than guessing it.
- **Only where the field says no more than the sentence does.** Never on
  a lookup by id that answers `NotFound`: naming the field would say which
  id was the wrong one. Never on wrong sign-in credentials, which must not
  say which of the two was wrong. A code the person typed is different:
  "invite not found" is already about the invite code, so `Register` names
  `invite_code` whatever the code of the refusal.
- **A refusal that came back through a port** is named by the handler that
  knows the request, with `apierr.WithField(err, field)`.

The web client reads it with `fieldError(err)`, which returns the field as
the generated request type spells it (`newPassword`), and a form places it
with `useFieldErrors`
([design-system.md](design-system.md#fields)). Validation sites move to
`apierr.Field` with the forms in front of them; one without it still shows
its sentence, on the form's own line.