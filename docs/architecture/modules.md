# Modules, ports, and the composition root

Stoop is one process, and the code inside it is organised as if it weren't.
This document explains what the boundaries are, how they are enforced, what
they cost, and what they buy.

## Why a modular monolith

A five-person community does not need a service mesh, and an operator with
a Raspberry Pi cannot run one. So Stoop ships as a single binary. But
"single binary" and "single ball of mud" are different claims, and only the
first one is a virtue.

The boundaries exist so that if one part of Stoop ever does need to run
separately — a voice service somewhere with better connectivity, a file
service on the box with the big disk — the change is confined to the
package that wires things together. Everything a module knows about the
outside world it knows through an interface it declared itself. Swapping
that interface's implementation for a Connect client that talks to another
process is a change in `internal/app` and nowhere else.

The boundaries also pay for themselves before any extraction: they make it
possible to read one module and know that nothing outside it is reaching
into its tables, and they make a change's blast radius legible from the
import graph.

## Modules and support packages

A **module** owns a slice of the domain, owns the tables that slice lives
in, and usually exposes a Connect service. There are six: `auth`, `chat`,
`instance`, `realtime`, `voice`, `files`.

A **support package** owns a mechanism, not a domain, and may be imported
by anyone (subject to the rules below): `events`, `db`, `dbgen`, `config`,
`authctx`, `blob`, `unfurl`, `ratelimit`, `trustedproxy`, `tailnet`,
`webui`.

`internal/app` is neither. It is the composition root, and it is allowed to
know everything.

## Rule 1 — modules never import each other

`internal/chat` must not import `internal/auth`, and so on for every pair.

What a module *may* import: `gen/` (generated protobuf and Connect code),
`internal/db` helpers, its own slice of `internal/dbgen`, `internal/events`,
`internal/config`, `internal/authctx`, the standard library, and
third-party libraries.

**Enforcement is mechanical.** `.golangci.yml` configures `depguard` with
one rule block per module, denying the other five module paths by import
path. A violation fails `make lint` and therefore fails CI, which is what
makes the rule a rule rather than a preference. Some deny entries are
written as globs (`…/internal/auth{,/**}`) so that `internal/authctx` — a
different package whose path merely starts the same way — stays allowed.

Two extra deny entries encode boundaries that are not module-to-module:

- **`internal/realtime` may not import `internal/dbgen`.** The gateway has
  no database access at all. Everything it knows about who may hear what,
  it learns through a port. This is what keeps it a pure fan-out layer, and
  it is why a multi-node deployment could move it behind a network bus
  without dragging query code along.
- **`internal/blob` may not import `internal/dbgen`.** The blob store is
  bytes by key; the metadata that gives those bytes meaning belongs to the
  files module.

## Rule 2 — cross-module needs are consumer-owned ports

When a module needs something another module has, it does **not** get a
reference to that module. It declares an interface, in its own package,
describing the narrowest thing it needs — and `internal/app` supplies an
adapter.

The direction matters. If `chat` imported an interface that `auth` defined,
the coupling would still be there, just spelled differently. Because the
interface belongs to the consumer, it is shaped by what the consumer needs
rather than by what the provider happens to expose, and it stays small.

### The port catalogue

| Consumer | Port | Backed by | What it buys |
| -------- | ---- | --------- | ------------ |
| `chat` | `UserDirectory` | auth | Author and member records for rendering messages and rosters. |
| `chat` | `PresenceLister` | realtime | Which of these users are connected — the whole of `@here`. |
| `chat` | `InstancePolicy` | instance | Whether members may create spaces. |
| `chat` | `FileDirectory` | files | Verify an attachment claim; delete a deleted message's files. |
| `chat` | `Unfurler` | `internal/unfurl` | Fetch a URL's Open Graph metadata. |
| `chat` | `PreviewImages` | files | Store a fetched preview image as a file. |
| `auth` | `RegistrationPolicy` | instance | May this registration proceed? |
| `auth` | `InviteRedeemer` | chat | Validate a code before creating an account; redeem it after. |
| `auth` | `ProviderSource` | instance | The effective OIDC provider config and its exact callback URL. |
| `auth` | `PasswordPolicy` | instance | Whether the password form is open to this account. |
| `instance` | `UserAdmin` | auth | List, promote, deactivate, rename, reset — the admin page's user tab. |
| `instance` | `TailscaleController` | `internal/tailnet` | Apply saved settings to the embedded node; report its status. |
| `instance` | `LiveKitReporter` | `internal/app` | What the Hosting page can say about the voice sidecar. |
| `realtime` | `SessionVerifier` | auth | Authenticate the WebSocket upgrade. |
| `realtime` | `MembershipLister` | chat | Which space topics this connection subscribes to. |
| `realtime` | `ChannelLookup` | chat | Resolve a voice channel's space; list a DM's participants. |
| `voice` | `ChannelDirectory` | chat | Is the caller a member of this channel, and is it a voice channel? |
| `voice` | `UserDirectory` | auth | The display name other participants see. |
| `voice` | `RelayProvider` | instance | The TURN relay in force, read per join. |
| `files` | `Avatars` | auth | Set the avatar pointer; report which files are still someone's avatar. |
| `files` | `Spaces` | chat | Set the icon pointer, authorise downloads, report referenced files. |
| `files` | `SessionVerifier` | auth | Authenticate the plain-HTTP download handler. |
| `files` | `Policy` | instance | The storage quota and the per-upload cap. |

Two patterns recur in that table and are worth naming.

**Authorisation is asked, never re-implemented.** `files` does not know what
a space member is. It asks chat — `Spaces.ChannelSpaceForMember`,
`Spaces.RequireManageSpace`, `Spaces.IsSpaceMember` — and gets back either
an answer or a Connect error it can return unchanged. There is exactly one
implementation of "may this person read this channel", and it lives in the
module that owns membership.

**The sweep is a question, not a scan.** `files` cannot look for orphans by
querying other modules' tables, so instead it asks: *of these ids, which do
you still point at?* (`Avatars.ReferencedFiles`, `Spaces.ReferencedFiles`).
The boundary forced a design that is also the better one — a batched
question with a bounded answer, where a future module that starts holding
file pointers only has to implement the same method.

### The one cycle

`auth` needs `instance` (registration policy, password policy, providers)
and `instance` needs `auth` (user administration). Both cannot be
constructor arguments, so the cycle is closed with setters after both
services exist:

```go
authSvc := auth.New(pool, opts)
instSvc := instance.New(pool, userAdmin{authSvc})    // instance ← auth
chatSvc := chat.New(pool, bus, userDirectory{authSvc})
authSvc.UseRegistrationPorts(instSvc, chatSvc)       // auth ← instance, chat
authSvc.UseProviders(providerSource{instSvc})
authSvc.UsePasswordPolicy(instSvc)
```

Every port wired this way has a documented nil behaviour, so a module works
before its optional ports arrive and in tests that never wire them: no
`RegistrationPolicy` means registration behaves as open, no
`PresenceLister` means `@here` reaches nobody, no `FileDirectory` means
`SendMessage` refuses attachments, no `Policy` means uploads are unlimited.
This is not defensive coding for its own sake — it is what lets each
module's tests construct it alone.

## Rule 3 — each module owns its tables

| Module | Tables |
| ------ | ------ |
| `auth` | `users`, `sessions`, `user_identities` |
| `chat` | `spaces`, `space_members`, `space_bans`, `user_blocks`, `channels`, `channel_reads`, `channel_mutes`, `dm_members`, `messages`, `message_mentions`, `message_reactions`, `message_attachments`, `message_links`, `link_previews`, `activity_items`, `invites` |
| `instance` | `instance_settings` |
| `files` | `files` |
| `realtime` | *(none — by rule)* |
| `voice` | *(none)* |

Ownership is auditable from the filesystem: sqlc query files live one
directory per module (`internal/db/queries/{auth,chat,instance,files}/`),
one file per entity. A query against another module's columns would have to
be written into that module's directory, where it would be obvious in
review.

**Foreign keys across module lines are fine.** `spaces.owner_id` references
`users(id)`; `users.avatar_file_id` references `files(id)`. Referential
integrity is the database's job, and giving it up would be a real cost for
a notional benefit. What is forbidden is *reading* another module's columns
— that goes through a port. A future extraction would drop those
constraints and keep the ports; that is a known, bounded consequence rather
than a surprise.

## Rule 4 — async decoupling via the events bus

`chat` never calls the gateway. It publishes a
`stoop.realtime.v1.ServerEvent` to a topic; the gateway subscribes to the
topics each connection is entitled to and writes frames. Neither package
imports the other. [realtime.md](realtime.md) covers the protocol, the
topics, the delivery guarantees (there are deliberately almost none), and
the recovery model.

## Rule 5 — `internal/app` is the only all-knowing package

`app.New` is the whole assembly, in order:

1. **Connect and migrate.** `db.Connect` opens the pgx pool and pings it;
   `db.Migrate` applies the embedded goose migrations. Both must succeed
   before anything else is constructed — a server that started on an
   unmigrated schema would fail later and less clearly.
2. **Build the bus and the blob store.** `blob.NewFS` is the only place a
   store is constructed anywhere in the codebase, which is what makes a
   second backend a change here rather than a change in `files`.
3. **Construct the modules** and seed the instance settings from the
   environment (first boot only).
4. **Wire the ports**, including the cyclic pair via setters.
5. **Settle the LiveKit credentials** (`livekitKeys`). This is the one
   piece of startup logic with real policy in it, and it lives here because
   it spans config, instance settings, and the filesystem — see
   [voice.md](voice.md).
6. **Build the interceptor chain**: a 4 MiB read cap on every Connect
   message, then the rate-limit interceptor — which must run *before* auth,
   since its whole job is protecting unauthenticated procedures — then the
   auth interceptor.
7. **Mount one mux**: five Connect handlers, the multipart upload endpoint,
   the file download handler, `/ws`, `/auth/` for the OIDC redirects,
   `/livekit/` for the signaling proxy, `/healthz`, and the embedded SPA at
   `/` as the fallback.
8. **Wrap the mux**: `securityHeaders` inside, `secureTransport` outside.
   The order is load-bearing — the headers read the TLS verdict that
   `secureTransport` puts on the context, so HSTS is only promised on a
   request that actually arrived over HTTPS.
9. **Wire the environment fallbacks** for reachability and login providers,
   so that saved settings override the environment and clearing a setting
   falls back to it rather than to nothing.

`cmd/stoop/main.go` stays about thirty lines: dispatch the `admin`
subcommand, load config, install a signal-cancelled context, `app.New`,
`app.Run`.

`app.Run` starts the plain listener, the Tailscale manager, the file sweep
and the activity sweep, then blocks. On cancellation it gives the HTTP
server ten seconds to drain and closes the pool. A failure on the Tailscale
listener is logged, never fatal: the plain listener is the baseline and
must not be taken down by an optional front door.

## What extraction would actually involve

Take `voice`, the easiest case. It owns no tables, and its ports are two
lookups and a settings read. To run it as its own service:

1. Give it a `main` that constructs `voice.New` with Connect clients in
   place of the adapters.
2. In `internal/app`, replace `voiceSvc` with a Connect client for
   `stoop.voice.v1.VoiceService` and drop the local mount.
3. Point the browser's `/livekit` proxy at wherever the new service lives.

Nothing in `internal/voice` changes. `chat` and `auth` never learn about
it. The proto contract the modules already speak is the same contract the
network would carry — which is the entire reason the contracts are protobuf
rather than Go interfaces over Go structs.

`chat` would be the hard case, because both the gateway's fan-out and the
attachment-claim transaction currently benefit from being in-process. That
is a genuine cost of extraction, and it is why nothing is extracted today:
the boundaries are kept honest so the option stays open, not because the
option is about to be taken.
