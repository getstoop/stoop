# Webhooks: events out, posts in

Status: proposed 2026-09-13 (STOOP-256), revised the same day after a
long review, then rebased onto [the access model](access-model.md) once
STOOP-269 landed. Four decisions are still open; each is marked inline
with the answer this draft assumes. The decisions and how they moved are
at the end. Supersedes STOOP-113.

Let the things in the house talk to the room. A URL that posts into a
channel, and a channel that posts out to a URL, both sized for one
binary, one Postgres, and an operator who is not running infrastructure.

The person running Stoop is running other things beside it: Home
Assistant, an uptime monitor, Jellyfin, a CI runner, a pile of `*arr`
containers. Every one of those ships a "Discord webhook" or "Slack
webhook" field, and today the only way to get that traffic into Stoop is
to not use Stoop for it. In the other direction nothing can react to what
happens in a space: no bridge, no archive, no "when someone joins, open a
ticket". STOOP-113 covered the incoming half and bot tokens and never
mentioned the outgoing half. This replaces it with one feature that goes
both ways, because the two share a module, a settings page, a permission
and a docs page.

## Decisions at a glance

| | |
| --- | --- |
| Module | A seventh, `internal/integrations`, service `stoop.integrations.v1.IntegrationService`. Named for the concept: it owns bots and their credentials' admin surface too, and slash commands (STOOP-6) land beside them. |
| Tables | `incoming_webhooks`, `outgoing_webhooks`, `webhook_deliveries`. Two hook tables, not one with a direction column: `channel_id` needs a different cascade rule in each. Migration `00033_integrations.sql`, expand-only. |
| Incoming | `POST /hooks/{token}`, synchronous, no queue. The token is a `credentials` row of kind `incoming_hook`; the handler coerces the vendor body and calls the same `SendMessage` every client calls. |
| Outgoing | A bus subscriber enqueues, a worker leases, POSTs with an HMAC signature, acks. Postgres queue behind a five-method port. |
| Identity | The bot is the member; hooks and API tokens are its credentials. Deleting a hook removes a credential, never the member. |
| Authorisation | Grants from the access model's vocabulary; no capability strings of this feature's own. Only instance admins create or configure anything (`instance.integrations.manage`). |
| Delivery promise | At-least-once, best effort, with detectable loss. `Stoop-Sequence` per hook; gaps close by re-reading `ListMessages(after_id)`. |
| Retry ladder | Four attempts over 2½ minutes. Twenty consecutive dead deliveries disable the hook. |
| Egress | Private targets refused unless the operator allows them; link-local never. One guard shared with link previews. |
| DMs | Unreachable by an outgoing hook by construction. Bots not messageable by default. |

## Two directions, two different animals

**Incoming** is a capability URL that posts into one channel. An instance
admin creates it; an appliance the operator configures calls it. The
handler verifies the token, coerces the vendor's body, puts the hook's
bot and credential on the context, and calls `SendMessage`. There is no
second write path.

**Outgoing** is a durable queue that posts to a URL somebody else hosts.
A hook holds a URL, a signing secret, a set of event types and optionally
one channel. A bus subscriber enqueues matching events; a worker leases
them, POSTs, and acks.

```
        incoming — synchronous, no queue            outgoing — queued

  uptime monitor                              chat.SendMessage
        │ POST /hooks/{token}                        │ publish
        ▼                                            ▼
  coerce vendor body                            events.Bus   topic space:ID
        │ verify the hook's credential               │ subscribe
        ▼                                            ▼
  chat.SendMessage — the same one            Queue.Enqueue — one item per hook
        │  membership, mentions, blocks              │       lane = hook id
        ├──▶ 200 ok to the caller                    ▼
        └──▶ events.Bus ──▶ /ws ──▶ tabs      Queue.Lease ──▶ POST ──▶ Ack
                                │                    │    0s · 5s · 30s · 2m, then dead
                                └────────────────────┘
                                                     ▼
                                              the operator's endpoint
```

An incoming post re-enters the fan-out everything else uses, which is why
it can itself fire an outgoing hook, once. Deliveries are never
re-published to the bus.

Direct messages are unreachable from an outgoing hook, not filtered. DM
events publish to `user:ID` topics; an outgoing hook subscribes to
`space:ID`, and there is no path between them.

### The bet on payload compatibility

The highest-value decision here is that an incoming hook understands the
body shapes appliances already send. It turns "write an adapter" into
"paste a URL" for the whole homelab ecosystem. Support is per vendor:
each one is a named coercion function with a table test, so a new sender
is a small ticket with a real payload attached, not a design change.

## Where it lives

| Option | What it costs | |
| --- | --- | --- |
| Inside `internal/chat` | Chat grows an HTTP client, a lease loop, a queue port and an egress policy, none of which are chat's subject. The bus consumer would be chat subscribing to its own publications. | No |
| Incoming in chat, outgoing in its own module | One user-facing object, two owners, two settings surfaces, two docs pages. | No |
| `internal/integrations`, owning both | One more module in the table, four ports to wire in `internal/app`. | Yes |

The module is named for the concept rather than for webhooks because it
also owns bots and the credentials that authenticate as them, and because
slash commands belong here when they land. A proto package rename after
1.0 is a breaking change for exactly the third-party clients this surface
exists for. The tables keep webhook names: `incoming_webhooks` holds
webhooks, and renaming them for symmetry would make them less accurate.

Ports, consumer-owned and wired in `internal/app` as
[modules.md](../architecture/modules.md) requires. Nothing imports
`internal/integrations`.

| Port | Backed by | What it answers |
| --- | --- | --- |
| `Poster` | chat | Post this request with this identity and credential on the context. No allowance to pass: whether `@everyone` pings is the credential's grant, checked where it always is. |
| `SpaceAccess` | chat | Which space owns this channel; the space's name for the envelope; add a bot as a member; set its role. |
| `BotIdentities` | auth | Create, rename and deactivate bot accounts; mint and revoke their credentials with grants and bounds; verify a hook token. Auth keeps owning `users` and `credentials`. |
| `Policy` | instance | Is this direction enabled; may private addresses be reached; the public URL. |

The backlog gains a matching **Integrations** product module beside the
six that mirror `docs/architecture/`; by the standing rule an area that
can never close is a module, not an epic.

## Schema

One migration, `00033_integrations.sql`, expand-only. Nothing is altered
and nothing backfills, so the previous release runs against this schema
unchanged and the migration is instant on any instance.

```sql
-- +goose Up
CREATE TABLE incoming_webhooks (
    id              uuid PRIMARY KEY,
    space_id        uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id      uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    bot_user_id     uuid NOT NULL REFERENCES users (id),
    credential_id   uuid UNIQUE REFERENCES credentials (id) ON DELETE SET NULL,
    name            text NOT NULL,
    created_by      uuid NOT NULL REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    disabled_at     timestamptz,
    disabled_reason text NOT NULL DEFAULT ''
);

CREATE TABLE outgoing_webhooks (
    id              uuid PRIMARY KEY,
    space_id        uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    channel_id      uuid REFERENCES channels (id) ON DELETE SET NULL,
    url             text NOT NULL,
    secret          bytea NOT NULL,
    event_types     text[] NOT NULL DEFAULT '{}',
    sequence        bigint NOT NULL DEFAULT 0,
    name            text NOT NULL,
    created_by      uuid NOT NULL REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    disabled_at     timestamptz,
    disabled_reason text NOT NULL DEFAULT ''
);

CREATE INDEX incoming_webhooks_space_idx ON incoming_webhooks (space_id);
CREATE INDEX outgoing_webhooks_space_idx ON outgoing_webhooks (space_id);

CREATE TABLE webhook_deliveries (
    id           uuid PRIMARY KEY,
    lane         uuid NOT NULL REFERENCES outgoing_webhooks (id) ON DELETE CASCADE,
    event_type   text NOT NULL,
    sequence     bigint NOT NULL,
    body         bytea,
    attempts     int NOT NULL DEFAULT 0,
    not_before   timestamptz NOT NULL DEFAULT now(),
    leased_until timestamptz,
    finished_at  timestamptz,
    status_code  int,
    response     text NOT NULL DEFAULT '',
    error        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (not_before, sequence)
    WHERE finished_at IS NULL;
CREATE INDEX webhook_deliveries_log_idx ON webhook_deliveries (lane, created_at DESC);

-- +goose Down
DROP TABLE webhook_deliveries;
DROP TABLE outgoing_webhooks;
DROP TABLE incoming_webhooks;
```

- **No token column, no capability column, no `bot_tokens` table.** A
  hook's token is a `credentials` row of kind `incoming_hook`, granted
  `messages.post` and bounded to the hook's channel; a bot's API token is
  a row of kind `bot_token`. `users.kind` already exists (00031) and so
  does `credentials.hint` (00032) for fingerprints.
- **`credential_id` is `ON DELETE SET NULL`, and NULL means disabled.**
  Revoking the credential, by an admin or by deactivating its bot,
  disables the hook and keeps its configuration; rotating mints a new
  credential. The hook is never deleted by a revocation.
- **Two tables killed a bug.** Under one table `channel_id` carried one
  cascade rule for two meanings. An incoming hook's channel is its
  target, so a deleted channel deletes the hook. An outgoing hook's
  channel is an optional filter, so a deleted channel must widen the
  hook and must not destroy its signing secret, which would force every
  receiver to be reconfigured. No CHECK constraint catches that.
- **`sequence` lives on the hook, not in the queue**, so the counter
  survives a backend swap: the hook tables stay in Postgres whatever the
  queue becomes.
- **A delivery's `id` is a UUIDv7**, the `Stoop-Delivery` header. The
  body is rendered at enqueue so an item is self-contained (a non-Postgres
  queue cannot join against `messages`) and cleared on success, so a
  finished row keeps only status, response head and timing. Redeliver
  therefore works for failures, which is the case anyone wants.
- **Finished rows are swept** after `STOOP_WEBHOOK_DELIVERY_RETENTION`
  (default 7 days) on the timer the file and activity sweeps use.

## Incoming

The endpoint exists for callers who cannot use the API: appliances that
emit a fixed JSON body to a URL field, with nowhere to put a header.
Anything that can set a header and shape its own JSON should use
`SendMessage` with a bot token, and the docs say so in those words.

```go
id, err := bots.VerifyHookToken(ctx, token)   // kind incoming_hook, else 404
body, err := adapt(contentType, raw)          // vendor coercion
ctx = authctx.WithIdentity(ctx, id)           // the bot, and the hook's credential
_, err = poster.Post(ctx, PostRequest{ChannelID: hook.ChannelID, Content: body})
```

That is the whole write path. `writableChannel` runs, the credential's
grant and channel bound are checked, membership is checked, blocks
apply, mentions resolve, and `@everyone` pings only if the hook is
granted `messages.notify_everyone` and its bot holds it. A separate write
path would have had to re-earn every one of those. The first draft's
`PostAs` port was a permission bypass with a polite name, and it is gone.

### Adapters

| Sender | Read from | Covers |
| --- | --- | --- |
| Stoop | `{"text": "…"}` | Anything you write yourself |
| Plain text | the body, verbatim | `curl -d`, shell scripts, cron |
| Discord | `{"content": "…"}` | The `*arr` stack, Uptime Kuma, most homelab tools |
| Slack / Mattermost | `text`, else `attachments[].title` + `.text` | Alertmanager, Grafana, CI |

Four to start, chosen by what the audience runs. `username`,
`icon_emoji`, `icon_url` and `blocks` are accepted and ignored.

> **Open — proposed: a payload's `username` is accepted and ignored.**
> Slack senders set it constantly, and honouring it means the author
> card can say something the account is not. The hook's own name is what
> shows. One hook fronting several tools then looks like one sender; the
> answer to that is a second hook, which is free.

### Answers

| Situation | Answer |
| --- | --- |
| Posted | `200 ok` |
| Unknown, revoked or disabled token | `404` |
| Operator has incoming hooks off | `404` |
| Body empty after coercion | `400` |
| Over the per-hook rate limit | `429` + `Retry-After` |
| Text over 4000 characters | `200 ok`, truncated with an ellipsis |

> **Open — proposed: truncate over-length text.** A monitoring tool that
> gets a 413 usually drops the alert entirely, and a truncated alert
> still wakes somebody up. Against: silent truncation is a lie about
> what was sent, and an ellipsis is a thin answer to that.

Unknown, revoked and disabled answer alike, for the reason `NotFound`
works that way everywhere else: telling them apart hands a guesser an
oracle. The rate limit (`STOOP_WEBHOOK_RATE_LIMIT`, default 60 a minute)
is keyed on the credential, not the client IP: the token is the identity,
and a monitoring host behind NAT should not share a bucket with a login
form.

The two presentations don't mix. `/hooks/{token}` accepts only an
`incoming_hook` credential, and the Connect interceptor refuses one as a
bearer token, so a hook URL is never an API key.

### The bot is the identity; the hook is one of its credentials

An integration that posts alerts through a hook and reads replies through
the API should be one member of the space, not two. So the bot is the
first-class object: a `users` row with `kind = 'bot'`, no password, never
given a session, with a `space_members` row. It holds credentials: hook
tokens, each pinned to one channel, and API tokens. Both authenticate as
the same member, and the space sees one name and one author card.

| | Hook token | API token |
| --- | --- | --- |
| Where it goes | in the URL, the only place some senders can put a secret | an `Authorization` header |
| What it can do | `messages.post` in one channel, optionally `messages.notify_everyone` | what it was granted, in the spaces it is bounded to, within what its bot holds |
| Can it read? | No | Yes |
| Safe to paste into someone else's appliance | Yes | No |

If someone's Grafana is compromised, the first lets them post noise and
the second lets them take the archive.

- Creating a hook makes a new bot by default, so the simple path stays
  one click; attaching to an existing bot is the deliberate choice.
- Deleting a hook removes a credential and never the member. The first
  draft's cascade would have deactivated a bot whose API token was still
  in use.
- A bot left holding no credentials deactivates itself, since it can do
  nothing anyway. Its messages stay either way, as any deactivated
  account's do.
- It shows in the member list with a marker: a person reading the
  channel can see what is posting and click it like any other author.
- Bots may hold an instance role. Every credential a bot holds is
  narrower than the bot, which is what makes that safe. Break-glass
  sign-in and the last-admin guard count people only.
- **Bots aren't reachable by DM, by default.** They are left out of
  `dm_candidates` and `OpenDirectMessage` refuses them, because a message
  to a bot is read by whatever runs it. The access model doesn't forbid
  it; a per-bot setting, with disclosure in the conversation, is the
  later feature that turns it on.

The alternative was authorless messages: a nullable `author_id` and a
`webhook_id` on `messages`. That is a column on the hottest table and a
null check in every author path, to describe something the member model
already describes. System messages are a different thing and stay
STOOP-248's problem.

### What a credential may do

Every credential carries a grant from the access model's vocabulary and
optional bounds, so "what can this thing do?" has one answer in one
place, the same answer a person's token gets. These five are what the
settings page offers; any grantable action may be granted, and
`account.security` never is.

| Grant | Allows | Typical holder |
| --- | --- | --- |
| `space.read` + `messages.read` | List and read messages, channels, members | A mirror or archive |
| `messages.post` | Send: to the bound channel for a hook, in the bound spaces for a token | Every alert hook |
| `messages.notify_everyone` | `@everyone` and `@here` | The UPS, not the deploy notifier |
| `channels.manage` | Create, edit, delete channels | Rare |
| `members.manage` | Kick, ban, set roles | A moderation bot |

**The grant gates the credential; the bot's role gates the identity;
both must pass.** That is the access model's rule, enforced by the gate
every procedure already goes through (`internal/app/procedures.go`), so
this feature adds no interceptor of its own. A moderation bot needs
`members.manage` on its token and admin on its bot; its hook, granted
only `messages.post`, still cannot kick.

**Notifying everyone.** An alert that should wake the house is a real
case: a UPS on battery, a failing disk. It takes two things, the grant
`messages.notify_everyone` on the hook and a bot that holds it, which
today means space admin. Ticking "may notify everyone" on a hook sets its
bot to admin in that space, and the hook's row says so ("admin, so it
can notify everyone"); unticking the last such grant returns the bot to
member. The hook's grant still lets it do nothing but post, so the role
gives it nothing else. The cost, accepted: a role change as a side effect
of a checkbox, and a bot in the admin list. Without both, `@everyone` and
`@here` render literally. The flag shows in the hook list, including the
read-only member view, so people can see which sources may ping them;
channel and space mutes still apply.

Two guardrails keep this from drifting into a half-built OAuth. The
vocabulary is closed and shared: a new action is a deliberate change to
the access model, not something a feature invents. And bot tokens are
RPC-only in v1: `/ws` refuses them, and a bot that wants realtime has the
outgoing half of this document.

## Outgoing

Two steps that never share a goroutine. The subscriber matches hooks and
enqueues; the worker does the HTTP. That separation is what keeps a hung
receiver from holding the bus's 256-event buffer and getting the module
dropped.

### Event catalogue, v1

| Type | `data` is | Note |
| --- | --- | --- |
| `message.created` | `chat.v1.Message` | Bridges, archives, keyword alerts. |
| `message.updated` | `chat.v1.Message` | Edits, and the later arrival of a link preview. |
| `message.deleted` | `{channel_id, message_id}` | So a mirror can delete too. |
| `member.joined` | `chat.v1.Member` | Greeting flows, ticketing. |
| `member.left` | `{space_id, user_id, reason}` | Left, kicked or banned. |
| `channel.created` | `chat.v1.Channel` | |
| `channel.deleted` | `{space_id, channel_id}` | |
| `webhook.test` | `{}` | Only ever sent by the Test button. |

Excluded on purpose: presence, typing, reads, reactions, voice state,
activity items and mutes. They are either per-user rather than per-space
or a firehose no homelab endpoint wants pointed at it. Adding one later
is an append to this table.

### The delivery

```http
POST /hooks/stoop HTTP/1.1
Content-Type: application/json
User-Agent: Stoop/0.1 (+https://github.com/getstoop/stoop)
Stoop-Event: message.created
Stoop-Delivery: 0199c2a4-7f31-7b9e-9c02-8d2b6e5a4f10
Stoop-Sequence: 41
Stoop-Attempt: 1
Stoop-Signature: t=1757649600,v1=4f2c…

{
  "id":       "0199c2a4-7f31-7b9e-9c02-8d2b6e5a4f10",
  "type":     "message.created",
  "ts":       "2026-09-13T04:20:00Z",
  "instance": "https://stoop.example.com",
  "space":    { "id": "0199a1…", "name": "The Stoop" },
  "data":     { … protojson of stoop.chat.v1.Message … }
}
```

- `Stoop-Delivery` is stable across attempts, so receivers dedupe on it.
- `Stoop-Sequence` is per hook; a jump tells the receiver how many events
  it missed.
- `Stoop-Signature` is `HMAC-SHA256(secret, "<t>." + body)` in Stripe's
  shape, because a receiver's verification code probably already exists
  in that form. The timestamp is inside the signed string, so a captured
  delivery cannot be replayed a week later.
- `data` is protojson of the existing proto, so there is no second schema
  to keep in step.

Verifying it, whole. If the operator docs cannot show verification in
five lines, the format is wrong:

```python
import hmac, hashlib
t, v1 = (p.split("=")[1] for p in headers["Stoop-Signature"].split(","))
mine = hmac.new(secret, f"{t}.".encode() + body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(mine, v1) and time.time() - int(t) < 300
```

### Attempts

| Attempt | After | Cumulative |
| --- | --- | --- |
| 1 | immediately | 0s |
| 2 | 5s | 5s |
| 3 | 30s | 35s |
| 4 | 2m | 2m 35s |

Jittered, so a restart does not fire every backlogged delivery in the
same second. Success is any 2xx. A `410 Gone` disables the hook
immediately: the receiver is saying the endpoint is finished, and Slack
reads it the same way. A `429` honours `Retry-After` up to the ladder's
end. A 3xx is a failure: the redirect target is not the URL an admin
approved, so the client never follows one. Twenty consecutive dead
deliveries disable the hook with a reason the settings page shows.

The ladder is short because of what receives these events. A bridge wants
no gaps, and no ladder is long enough for that; reconciliation is the
answer. A notifier wants it now or not at all. An automation actively
wants staleness dropped: firing "someone said lights off" six hours later
is worse than never firing it. Short delays also keep delay-capped
backends viable.

### Secrets

Secrets appear exactly once. `CreateIncoming`, `CreateOutgoing` and
`RotateSecret` are the only responses that ever carry a hook's token or
signing secret; every read answers with the fingerprint. Incoming tokens
are stored hashed, because they are only ever verified. Outgoing secrets
are stored raw, because a signature must be produced from them. The docs
say so plainly.

## The queue contract

Postgres is the v1 backend because it is already here, already backed up,
and at one delivery a minute it is bored. But the delivery path is not
written against Postgres: it goes through a port, the same move
`events.Bus` already makes for the realtime fan-out.

```go
type Queue interface {
    Enqueue(ctx context.Context, it Item) error
    // Lease hands out due items, invisible to others until the deadline,
    // at most one in flight per lane. The deadline must exceed the
    // maximum work time (10s HTTP timeout) or items go out twice.
    Lease(ctx context.Context, n int, until time.Duration) ([]Leased, error)
    Ack(ctx context.Context, id string) error
    Nack(ctx context.Context, id string, retryAfter time.Duration, r Attempt) error
    Dead(ctx context.Context, id string, r Attempt) error
}

type Item struct {
    ID        string    // UUIDv7; the Stoop-Delivery header
    Lane      string    // hook id: ordering and one-in-flight scope
    Event     string
    Sequence  uint64    // per lane, for gap detection
    Body      []byte    // self-contained: rendered at enqueue
    NotBefore time.Time
}
```

The acceptance test for the abstraction is "someone could write the Redis
one in an afternoon". Not a registry, a factory or a config matrix. A
second backend is STOOP-267, configuration only.

### What a lease is doing here

A lease is a claim with an expiry. The naive version is an `in_progress`
boolean, and it breaks on exactly one case: the worker dies, and the item
is marked as being worked on by a process that no longer exists. A lease
is that boolean with the expiry built in, so recovery needs no janitor
and no guesswork: `leased_until < now()` means nobody is working on it,
whatever happened to whoever was.

It also keeps a ten-second HTTP call to a third party out of a database
transaction. Claim in a fast transaction, close it, do the slow thing
outside any transaction, come back and ack. Holding a row lock across
that call would pin a pool connection and hold back the vacuum horizon
every time a receiver is slow.

And it does double duty: "does this lane have a live lease?" is how
one-in-flight-per-hook is enforced, so the ordering guarantee needs no
separate lock. A shared worker pool would let message 2 land before
message 1 in a mirror. Head-of-line blocking within a hook is chosen
deliberately, bounded by the ladder.

| Backend | Lease | Ack | Nack |
| --- | --- | --- | --- |
| Postgres (v1) | `leased_until` + `SKIP LOCKED` | mark finished | set `not_before` |
| Redis Streams | XREADGROUP + idle | XACK | re-add with delay |
| NATS JetStream | fetch + AckWait | Ack | NakWithDelay |
| SQS | visibility timeout | DeleteMessage | ChangeMessageVisibility |
| Kafka | Doesn't fit. A log with consumer offsets has no per-message ack; an implementation would be emulating this interface, not satisfying it. | | |

Three consequences to hold onto. **At-least-once is unavoidable**: a
worker can deliver and die before acking, which is why `Stoop-Delivery`
is stable across attempts. **Lease expiry counts as an attempt**, or a
poison item that crashes the worker retries forever. **Enqueue signals
the worker directly** rather than waiting for a poll, since both live in
one process today; the ticker is only a backstop, and a networked backend
replaces the signal with its own blocking read.

### Not a transactional outbox

Enqueueing inside the message's own transaction would close the last
loss window and pin the queue to Postgres forever. We enqueue from the
bus subscriber and accept one small loss window instead, and make it
visible.

## Reliability

The promise is **at-least-once delivery, best effort, with detectable
loss**. Gaps happen by construction: a hook disabled after twenty dead
deliveries has one, and so does the window between a message committing
and the bus subscriber enqueueing it.

So `Stoop-Sequence` earns its ten lines. A per-hook counter on the hook
row, taken at enqueue: a receiver that sees 41 then 43 knows exactly what
it missed. "We might miss one, and you will always know" is defensible
for a self-hosted chat server. "We might miss one silently" is not.

Push is a hint; the API is the truth. Messages are already durable and
time-ordered, so a consumer that cannot tolerate gaps reconciles by
re-deriving from state rather than replaying a log:

| Event | The consumer calls | Recoverable? |
| --- | --- | --- |
| `message.created` | `ListMessages(channel, after_id)`, walk forward | Fully; UUIDv7 ids are a total order |
| `message.updated` | re-read a window, compare `edited_at` | Only inside that window |
| `message.deleted` | notice an id stops coming back | Never; hard delete, no tombstone |
| `member.*` | `ListMembers`, diff | Yes; current state is the truth |
| `channel.*` | `ListChannels`, diff | Yes |

That makes the reconcile path depend on a bot token, which is a
sequencing constraint: STOOP-266 lands before the outgoing work, or v1
ships a delivery mechanism whose recovery story does not exist yet.

**The limit, stated plainly.** If a mirror must never show a message the
source deleted, best-effort push cannot give you that and neither can a
longer ladder: deletes are hard and leave nothing to derive from. That
would need an append-only event table with tombstones. It is not a
requirement today and should not be built on speculation.

## The sharp edge: an outgoing hook is a server-side request somebody else chose

Naming a URL the Stoop process will POST to is the SSRF shape link
previews already have, with one difference that pulls the other way: for
this audience a target on the LAN is frequently the point. Admin-only
creation changes who the guard protects against. Not a space admin
reaching past their authority, but a phished admin session and the
operator's own slip, which is worth one boolean of defence in depth
either way.

| Target | Default | With private targets allowed |
| --- | --- | --- |
| Public address | Allowed | Allowed |
| RFC1918, CGNAT, loopback | Refused | Allowed |
| Link-local, incl. `169.254.169.254` | Refused | Refused |
| Anything but http(s) | Refused | Refused |
| A redirect to any of the above | Refused | Refused |

STOOP-261 lifts the address predicate out of `internal/unfurl`'s dialer
into `internal/netguard`, resolve-then-check ordering intact so a
rebinding name cannot slip through, and has both callers consult it with
their own policy. One guard, one table test, two callers, instead of a
second copy of an SSRF check, which is how the first one ends up subtly
weaker. The metadata address stays refused whatever the policy says: on
a VPS it turns a webhook into a credential read. A hook whose target
stops resolving to an allowed address is disabled with a reason, not
left failing into a log nobody reads.

### Instance policy

Three settings in `instance_settings` (JSON, no migration):
`webhooks_incoming`, `webhooks_outgoing`, `webhooks_allow_private_targets`.
`STOOP_WEBHOOKS=false` is the floor beneath all three. These are incident
switches and a safety default rather than policy boundaries: stop every
delivery on the server without deleting anything.

> **Open — proposed: outgoing hooks are on from a fresh install, private
> targets off.** Mostly settled by admin-only creation: nothing exists
> until an admin makes it, so the switch only decides whether they must
> flip a setting before making their first one. It stays in the design
> as an incident switch, not a policy boundary.

## Who may, and who can see

| Level | Controls | Where |
| --- | --- | --- |
| Instance admin | Everything: the three policy settings, and creating, editing, disabling, revoking and deleting every bot, hook and token on the server. No space role required. `instance.integrations.manage`, which only the instance admin role holds. | Space settings → Integrations for the channel context; an instance-wide list in Admin settings |
| Space owner and admin | The member's view, deliberately. They can remove a misbehaving bot from the space, which stops every credential it holds there; revoking is the instance admin's. | |
| Member | Read the list: name, direction, target host, bound channel, enabled state, whether it may notify everyone, and each credential's grants and bounds. No token, no secret, no bodies. | The same section, read-only |

> **Open — proposed: plain members see the hook list, read-only.**
> Members cannot create anything, so showing them the list carries no
> delegation with it: it is purely "here is what this space sends out,
> and which sources may ping you". Against: it shows everyone a little of
> how the server is wired.

Concentrating this at the instance level is what deletes the delegation
model: no new entry in the permission table, no rule that a credential
may never exceed its creator, and no question about what happens to a
delegated credential when the admin who made it is demoted. An instance
admin is already the ceiling. It is also the safe direction to be wrong
in: loosening later is non-breaking, tightening later breaks working
setups. Per-credential scoping of who may manage what is blast radius,
not escalation, and is deferred.

It buys one thing besides simplicity: because every hook on the server
is created in one place, Admin settings can answer "what is my server
talking to?" in a single list. That question has no good answer under a
delegated model.

The member row is a privacy position, not a feature. If a space copies
its messages to an external URL, the people whose messages those are
should be able to find out by looking.

## Surface

A sixth Connect service, `stoop.integrations.v1.IntegrationService`. The
two hook kinds are separate messages, `IncomingWebhook` and
`OutgoingWebhook`, rather than one type behind a direction enum, so a
client never has to ask which fields are meaningful. `ListWebhooks`
answers with both repeated fields in one round trip since the settings
page renders both lists. Grants on the wire use
`stoop.access.v1.Permission`.

- Hooks: `ListWebhooks`, `CreateIncoming`, `CreateOutgoing`,
  `UpdateIncoming`, `UpdateOutgoing` (two, for the same reason the
  messages are two), `DeleteWebhook`, `RotateSecret`, `TestWebhook`,
  `ListDeliveries`, `RedeliverDelivery`. An empty `space_id` on
  `ListWebhooks` is the server-wide list, instance admins only.
- Bots: `ListBots`, `CreateBot`, `UpdateBot`, `DeactivateBot`,
  `CreateBotToken`, `RevokeBotToken`. Fronted here, backed by auth's
  `users` and `credentials` through the `BotIdentities` port, so a client
  has one service.
- One non-RPC endpoint, `POST /hooks/{token}`, which earns its place the
  way `/files/upload` does: its callers are appliances, not generated
  clients.

Every procedure gets a rule in `internal/app/procedures.go`; the registry
test refuses one without.

| Refusal | Code |
| --- | --- |
| Caller lacks `instance.integrations.manage`, or their credential isn't granted it | `PermissionDenied` |
| Operator has that direction off | `Unavailable` |
| Target refused by the egress guard | `FailedPrecondition` |
| Past 20 hooks in the space | `ResourceExhausted` |
| Unknown event type, bad URL, empty name | `InvalidArgument` |

On the web side, two surfaces sharing their row components: an
Integrations section in the space settings frame, where the channel
context lives and where members get the read-only view, and an
instance-wide list in Admin settings. Files follow
[conventions.md](../conventions.md): `SpaceSettings/IntegrationsSection.tsx`
with `WebhookRow`, `WebhookForm`, `BotRow` and `DeliveryLog` beside it,
one stylesheet. The lists are labelled by what they do rather than by
direction: "Post into this space" and "Send events out".

## Order of work

Ten children, each a shippable PR. The order is carried in the titles.

| Ticket | Lands |
| --- | --- |
| STOOP-257 | This document, with the open decisions settled. |
| STOOP-258 | Migration 00033, the module skeleton and its ports, the protos, the instance policy, the access rules. |
| STOOP-259 | Incoming: `POST /hooks/{token}`, the four adapters, bots and their hook credentials, the DM default, the per-hook limit. |
| STOOP-266 | Bot API tokens: minting and revoking `bot_token` credentials for an existing bot. Moved ahead of 260 because it is the reconcile path. |
| STOOP-260 | Outgoing: the `Queue` port and its Postgres implementation, bus subscriber, lease worker, signatures, sequence, auto-disable, retention. |
| STOOP-261 | `internal/netguard`: one egress guard for unfurling and webhooks. |
| STOOP-262 | The RPCs behind `instance.integrations.manage`, the members' read-only view, secrets once. |
| STOOP-263 | Web: the Integrations section, the copy-once panel, the delivery log. |
| STOOP-264 | Docs: `docs/architecture/integrations.md`, the operator recipes, the registrations in existing docs. |
| STOOP-265 | Verification: the httptest receiver, lease expiry and ordering tests, the guard table, the DM-never-delivers assertion, one gated browser spec. |

The first useful moment is after STOOP-259: a curl line lands in a
channel, with no UI yet. The first moment worth announcing is after
STOOP-263. A second queue backend is STOOP-267.

Two adjacent tickets will meet the bot machinery in STOOP-259 and 266:
STOOP-284 (a bot with a password 500s at `Login` instead of a clean
refusal) and STOOP-285 (`ListUsers` doesn't carry `users.kind`, which
the admin UI needs to show bots).

## Deliberately not

- **A transactional outbox.** It would close the last loss window and
  pin the queue to Postgres forever. The sequence header makes that
  window visible instead.
- **Gapless mirroring as a promise.** That needs an append-only event
  table with tombstones. Not a requirement today.
- **Slash commands and interactive components.** A request/response
  shape with a person waiting is a different feature; STOOP-6 owns it.
- **Outgoing DM events.** Not filtered; there is no path. If it is ever
  wanted it is a new design with consent in it, not a checkbox.
- **Attachments in either direction.** Incoming posts are text;
  deliveries carry attachment metadata and a `/files/{id}` URL, not
  bytes.
- **Per-hook payload templates.** A templating language in a settings
  page is a product; receivers can transform JSON.
- **An audit trail.** The delivery log is for debugging and is swept.
  Admin-action records are STOOP-121.

## Decisions taken

Settled by the maintainer on 2026-09-13, in review and after the
access-model rebase.

1. **The module is `internal/integrations`**, not `internal/webhooks`.
   It owns bots and credentials too, and slash commands land there.
2. **The bot is the identity; hooks and API tokens are its
   credentials.** Ownership inverted from the first draft, where a hook
   owned its bot and deleting one deactivated the other.
3. **Only instance admins create or configure integrations, bots and
   credentials.** It deleted a `manage_webhooks` permission, the rule
   that a credential may never exceed its creator, a demotion policy,
   an `authctx` change and a read-only interceptor.
4. **Credentials carry grants from the shared vocabulary.** The first
   draft's five capability strings (`read_messages`, `post_message`,
   `notify_everyone`, `manage_channels`, `manage_members`) map onto
   actions. A `notify_everyone` boolean was considered and rejected:
   shipping it would have meant deprecating a proto field later.
5. **Granting "may notify everyone" makes the bot a space admin for
   you**, shown on the row, reverting when the last such grant is
   removed.
6. **Postgres queue behind a five-method port.** Not Kafka, not an
   in-memory queue, not a transactional outbox. Reopen only with new
   evidence.
7. **Four attempts over 2½ minutes**, not six over seven hours.
8. **Bots may hold an instance role**, and "no DMs to bots" is a
   default, not a rule. Both from the access model.

Still open, each marked inline above with the answer this draft assumes:
the payload `username` override, truncating over-length text, outgoing
hooks on by default, and members seeing the hook list.

### What the review changed

One table became two, because the direction discriminator was hiding a
cascade bug. The outbox became a queue behind a port. The ladder went
from 6 attempts over 7 hours to 4 over 2½ minutes, driven by what
consumers do with a late event rather than by what Stripe does.
`Stoop-Sequence` was added, turning silent loss into detectable loss,
and reconciliation became part of the contract, which moved bot tokens
(STOOP-266) ahead of the outgoing work. The `PostAs` port was deleted.
Payload references became self-contained bodies, because a non-Postgres
queue cannot join against `messages`. An in-memory queue was considered
and rejected: once you count the ring buffer, the shutdown flush and the
reload staleness policy, it is more code than the table and makes a
weaker promise.

### What the access model changed

Tokens became credentials: no `bot_tokens` table and no token column on
a hook, both verified by the same code as a session. Capabilities became
grants, and the interceptor this proposal planned already exists. Bots
may be instance admins, where the first draft said never. "No DMs to
bots" became a default. Pinging everyone came to need the bot's role as
well as the grant, which raised and then settled decision 5. The
migration moved to 00033 and lost its `users.kind` column, which 00031
already added.
