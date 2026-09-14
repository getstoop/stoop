# Integrations: webhooks in, webhooks out, and bots

`internal/integrations` owns what the server talks to: incoming webhooks
(a URL the server hosts that posts into one channel), outgoing webhooks
(a URL somebody else hosts that the server POSTs signed events to), the
delivery queue between the bus and those POSTs, and the admin surface for
bots and the credentials that authenticate as them. The reasoning behind
every choice here is in [the proposal](../proposals/webhooks.md); this
page is what the code does.

## The shape

```
        incoming — synchronous, no queue            outgoing — queued

  appliance                                   chat.SendMessage
        │ POST /hooks/{token}                        │ publish
        ▼                                            ▼
  vendor adapter                                events.Bus   topic space:ID
        │ verify the hook's credential               │ subscribe
        ▼                                            ▼
  chat.SendMessage — the same one            Queue.Enqueue — one item per hook
        │  membership, mentions, blocks              │       lane = hook id
        ├──▶ 200 ok to the caller                    ▼
        └──▶ events.Bus ──▶ /ws ──▶ tabs      Queue.Lease ──▶ POST ──▶ Ack
                                                     │    0s · 5s · 30s · 2m, then dead
                                                     ▼
                                              the operator's endpoint
```

## Bots

A bot is a `users` row with `kind = 'bot'`, no password and never a
session; a member of the spaces an instance admin puts it in
(`AddBotToSpace`, `RemoveBotFromSpace`; bans hold, removal is a kick), so
authorship, mentions and roles need no special case, and every member,
author and profile on the wire says which kind it is. Membership is set
on the bot and nowhere else: chat's `AddMember` refuses a bot, an
incoming hook for an existing bot is refused unless the bot is already in
the channel's space, and a bot's own token can't redeem an invite, leave
a space, create one, or open a direct message, whatever it was granted. A hook made with a new bot creates that bot as a
member of that one space. It acts only through the credentials it holds
([identity.md](identity.md#bots-and-their-credentials)):

| Credential | Kind | Grant | Bound to | Presented as |
| --- | --- | --- | --- | --- |
| hook token | `incoming_hook` | `messages.post`, optionally `messages.notify_everyone` | one channel | the path of `/hooks/{token}` |
| bot token | `bot_token` | any grantable actions | the bot's memberships | `Authorization: Bearer stp_bot_…` |

The grant gates the credential and the bot's role gates the identity;
both must pass, checked by the same gates every request goes through. A
hook token is refused as a bearer token everywhere, and a bot token is
refused in the hook path. Bot tokens are refused on `/ws` in v1.

Only instance admins create or change any of this
(`instance.integrations.manage`), including the bot's names, its avatar
(`FileService.UploadBotAvatar`) and its bio (`UpdateBot`), which shows on
the bot's profile card so a reader can tell what it does; a bot token
can't edit any of them. Deleting a hook or revoking a token
removes a credential, never the member; a bot left holding no credential
is deactivated, and its messages stay. Bots are refused as direct-message
targets and left out of the candidates list. A deleted channel or space
cascades its hook rows; the sweep revokes the credentials they pointed at
and retires bots left with nothing.

## Incoming

`POST /hooks/{token}` verifies the token, coerces the body, puts the bot
and the hook's credential on the context and calls chat's `SendMessage`
through the `Poster` port, after the app adapter runs the credential gate
the interceptor would have. There is no second write path: membership,
blocks, mentions and the `@everyone` refusal apply as they do to anyone.

| Body | Read from |
| --- | --- |
| `text/plain`, or anything that isn't JSON | verbatim |
| Stoop, Slack, Mattermost | `text`, then `attachments[].title` and `.text` |
| Discord | `content` |

`username`, `icon_emoji`, `icon_url` and `blocks` are accepted and
ignored. Text over the message limit is cut to fit with an ellipsis.

| Situation | Answer |
| --- | --- |
| Posted | `200 ok` |
| Unknown, revoked or disabled token; incoming turned off | `404` |
| Body empty after coercion | `400` |
| The bot may not post there (kicked, banned) | `403` |
| Over `STOOP_WEBHOOK_RATE_LIMIT` for this hook (default 60 a minute) | `429` + `Retry-After` |
| Body over 256 KB | `413` |
| Sent by a Stoop delivery worker (`User-Agent: Stoop/…`) | `403`, so a hook pointed at this server can't loop |

Ticking *may notify everyone* on a hook grants `messages.notify_everyone`
and makes the bot a space admin, since only admins hold it; unticking the
last such grant returns the bot to member. Rotating a hook mints a new
credential and revokes the old one.

## Outgoing

An outgoing hook holds a URL, a raw signing secret, a set of event types
and an optional channel filter. Two goroutines that never share work:

- **The subscriber** watches the `space:ID` topic of every space with an
  outgoing hook, translates events to the catalogue below, renders a
  self-contained envelope and queues one item per matching hook, taking
  the hook's next `Stoop-Sequence`. Direct messages publish to user
  topics and never reach it.
- **The worker** leases due items, one in flight per hook and in sequence
  order, POSTs with a 10 s timeout under a 30 s lease, and acks.

| Type | `data` |
| --- | --- |
| `message.created`, `message.updated` | `chat.v1.Message` |
| `message.deleted` | `{channel_id, message_id}` |
| `member.joined` | `chat.v1.Member` |
| `member.left` | `{space_id, user_id, reason}` |
| `channel.created` | `chat.v1.Channel` |
| `channel.deleted` | `{space_id, channel_id}` |
| `webhook.test` | `{}`, from the Test button |

The body is `{id, type, ts, instance, space: {id, name}, data}` with
`data` as protojson of the existing protos. Headers: `Stoop-Event`,
`Stoop-Delivery` (stable across attempts), `Stoop-Sequence`,
`Stoop-Attempt`, and `Stoop-Signature: t=<unix>,v1=<hex>` where `v1` is
HMAC-SHA256 with the secret over `<t>.<body>`.

Attempts run at 0 s, 5 s, 30 s and 2 min, jittered, then the item is
dead. Any 2xx acks. `410 Gone` disables the hook. `429` honours
`Retry-After` up to the ladder's end. A 3xx is a failure and is never
followed. Twenty consecutive dead deliveries disable the hook with a
reason. A dead item keeps its body and can be sent again from the log;
a delivered one has its body cleared. Finished rows are swept after
`STOOP_WEBHOOK_DELIVERY_RETENTION` (default 7 days).

The promise is **at-least-once, best effort, with detectable loss**: a
receiver dedupes on `Stoop-Delivery` and reads a gap off
`Stoop-Sequence`, then closes it by re-reading with a bot token
(`ListMessages(after_id=…)` for messages; `ListMembers` and
`ListChannels` for the rest). Hard-deleted messages are unrecoverable.

## The queue

The worker is written against a port, not Postgres:

```go
type Queue interface {
    Enqueue(ctx, Item) error
    Lease(ctx, n int, until time.Duration) ([]Leased, error)
    Ack(ctx, id string, Attempt) error
    Nack(ctx, id string, retryAfter time.Duration, Attempt) error
    Dead(ctx, id string, Attempt) error
}
```

`PostgresQueue` is the v1 implementation over `webhook_deliveries`:
leases are a `leased_until` column claimed with `SKIP LOCKED`, and a
lane's head is its lowest unfinished sequence. The queue takes the
caller's clock for due-ness and leases rather than `now()`, so one clock
decides and the contract test drives it with a fake one. A lease that
expires counts as an attempt.

## Egress

Every server-side request to a URL somebody chose goes through
`internal/netguard`: resolve the name, check every address, dial the
address checked. Public addresses always; RFC1918, loopback and CGNAT
only when `webhooks_allow_private_targets` is on; link-local, including
the cloud metadata address, never. A target is checked when a hook is
saved, and a hook whose target the policy refuses at delivery time is
disabled with a reason. Link previews use the same guard with their own
setting.

## Switches

`webhooks_incoming`, `webhooks_outgoing` and
`webhooks_allow_private_targets` are instance settings (on, on, off by
default), and `STOOP_WEBHOOKS=false` is the floor under all three. With a
direction off nothing is deleted: hooks answer 404 or wait, queued
deliveries wait, and the settings page says so.

## Who sees what

| Level | Controls | Sees |
| --- | --- | --- |
| Instance admin | everything, from Space settings → Integrations and Server admin → Integrations | everything but a token or secret after the moment it's shown |
| Space owner or admin | removing a bot from the space | the member's view |
| Member | nothing | the space's hooks: name, channel, grant, fingerprint, and an outgoing hook's host only |

Secrets appear once: `CreateIncoming`, `CreateOutgoing`, `RotateSecret`
and `CreateBotToken` are the only responses that carry one. Every read
answers with the last four characters.
