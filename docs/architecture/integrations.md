# Integrations: webhooks in, webhooks out, and bots

`internal/integrations` owns what the server talks to: incoming webhooks
(a URL the server hosts that posts into one channel), outgoing webhooks
(a URL somebody else hosts that the server POSTs signed events to), the
delivery log and the job that makes those POSTs, and the admin surface for
bots and the credentials that authenticate as them. This page is
what the code does.

## The shape

```
        incoming — synchronous, no queue            outgoing — a job per delivery

  appliance                                   chat.SendMessage
        │ POST /hooks/{token}                        │ publish
        ▼                                            ▼
  vendor adapter                                events.Bus   topic space:ID
        │ verify the hook's credential               │ subscribe
        ▼                                            ▼
  chat.SendMessage — the same one            a log row + a job per hook
        │  membership, mentions, blocks              │       lane = hook id
        ├──▶ 200 ok to the caller                    ▼
        └──▶ events.Bus ──▶ /ws ──▶ tabs      jobs dispatcher ──▶ POST ──▶ the log
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
a space, create one, or open a direct message, whatever it was granted. A
hook made with a new bot creates that bot as a member of that one space. It acts only through the credentials it holds
([identity.md](identity.md#bots-and-their-credentials)):

| Credential | Kind | Grant | Bound to | Presented as |
| --- | --- | --- | --- | --- |
| hook token | `incoming_hook` | `messages.post`, optionally `messages.notify_everyone` | one channel | the path of `/hooks/{token}` |
| bot token | `bot_token` | any grantable actions | the bot's memberships | `Authorization: Bearer stp_bot_…` |

The grant gates the credential and the bot's role gates the identity;
both must pass, checked by the same gates every request goes through. A
hook token is refused as a bearer token everywhere, and a bot token is
refused in the hook path. Bot tokens are refused on `/ws`.

Only instance admins create or change any of this
(`instance.integrations.manage`), including the bot's names, its avatar
(`FileService.UploadBotAvatar`) and its bio (`UpdateBot`), which shows on
the bot's profile card so a reader can tell what it does; a bot token
can't edit any of them. Deleting a hook or revoking a token
removes a credential, never the member; a bot left holding no credential
is deactivated, and its messages stay. Bots are refused as direct-message
targets and left out of the candidates list. A deleted channel or space
cascades its hook rows; the sweep revokes the credentials they pointed at
and retires bots left with nothing. A bot posts in an
[announcement channel](messaging.md#announcement-channels) whatever its
space role, so a hook needn't be made an admin to feed one.

## Incoming

`POST /hooks/{token}` verifies the token, coerces the body, puts the bot
and the hook's credential on the context and calls chat's `SendMessage`
through the `Poster` port, after the app adapter runs the credential gate
the interceptor would have. There is no second write path: membership,
blocks, mentions and the `@everyone` refusal apply as they do to anyone.

| Body | Read from |
| --- | --- |
| `text/plain`, or anything that isn't JSON | verbatim |
| JSON with `text` (Stoop's own shape; Alertmanager, Grafana, most CI) | `text`, then `attachments[].title` and `.text` |
| JSON with `content` (Uptime Kuma, the `*arr` stack) | `content` |

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

A hook whose bot has left its space, by any path, reads and is stored as
off with the reason "the bot was removed from this space": removal from
the bot's settings turns it off at once, a kick or a ban is caught by the
list on read and by the sweep on its timer. Adding the bot back doesn't
turn the hook on again; the admin does, and *Turn on* is refused while
the bot is out.

Ticking *may notify everyone* on a hook grants `messages.notify_everyone`
and makes the bot a space admin, since only admins hold it; unticking,
deleting or sweeping away the last such grant returns the bot to member.
Rotating a hook mints a new credential with the old one's grant and
revokes the old one; a hook that was off stays off, unless it was off only
because its token was revoked, which rotating is the remedy for (the grant
went with the token, so it comes back post-only). A create that fails
part-way takes back the credential, the admin role and a bot it made.

## Outgoing

An outgoing hook holds a URL, a raw signing secret, a set of event types
and an optional channel filter. A goroutine and two job kinds that never
share work:

- **The subscriber** watches the `space:ID` topic of every space with an
  outgoing hook and translates events to the catalogue below. When an
  enabled hook in the space wants the event, it queues one
  `fan_out_webhook_event` job in the space's lane; that insert is all it
  writes, so it keeps up with the bus. Direct messages publish to user
  topics and never reach it.
- **The `fan_out_webhook_event` job** (`FanOutWebhookEvent`) reads the
  space's hooks again and, per matching hook, takes the hook's next
  `Stoop-Sequence`, renders a self-contained envelope, writes a log row
  and queues a `deliver_webhook` job in the hook's lane, all in one
  transaction: a failed attempt leaves nothing and its retry starts over.
  A delivery's id is derived from the bus event's id and the hook's, so
  a fan-out run again after it committed skips the hooks it already
  queued, and a receiver never sees one event under two ids.
  The space's lane keeps each hook's sequence in message order. The
  lane's sequence is the event's time in nanoseconds, moved past the
  previous one so it never goes back.
- **The `deliver_webhook` job** (`DeliverWebhook`, run by the jobs
  dispatcher) makes one POST with a 10 s timeout and writes what the
  receiver said to the log row. The lane keeps one delivery per hook in
  flight, in sequence order; a retry waiting on its backoff holds the
  lane.

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

Attempts run at 0 s, 5 s, 30 s and 2 min (`DeliveryBackoff`), then the
delivery is dead. A try that can't read the hook or
the outgoing switch sends nothing and spends no attempt (`NotSent`, handed
back to the jobs module). Any 2xx acks. `410 Gone` disables the hook. `429` honours
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

## Deliveries as jobs

`webhook_deliveries` is the delivery log the Integrations page reads:
one row per delivery with the hook, event, sequence, body, attempts,
status code, error and when it finished. The receiver's reply is not
kept: it is logged at debug level with the delivery id. The fan-out inserts
it pending; the performer rewrites it after every attempt and
clears the body once a receiver accepted. The queue is the jobs module's
([runtime.md](runtime.md#background-work)): the job's arguments carry
the delivery id, the hook id, the event, the sequence and the body, so
the performer never reads the log to deliver, and the hook id is the
lane.

The module reaches the queue through its `Jobs` port: `EnqueueInLane`
from the subscriber; `EnqueueInLaneTx` from the fan-out, the Test button
and Send again, inside the transaction that writes the log row;
`DiscardLane` when a
hook is deleted, since the `jobs` table carries no foreign key to the
hook. `DeliverWebhook` answers with a `DeliveryResult` (delivered, dead,
or retry after a chosen wait) that `internal/app` maps onto the
dispatcher's outcomes; the module never imports `jobs`. A delivery
found queued while outgoing is off is dead with that reason, and Send
again works once the switch is back on.

The log row keeps its job's id. A job can end without the performer
finishing the row (a lease lapsed on the last attempt), so `sweep_hooks` finishes an unfinished row older than
five minutes whose job is discarded or gone as dead with the reason: Send
again works on it and it counts toward the twenty.

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
direction off nothing is deleted: hooks answer 404 or wait, a delivery
already queued is dead with the reason and can be sent again once the
switch is on, and the settings page says so.

## Who sees what

| Level | Controls | Sees |
| --- | --- | --- |
| Instance admin | everything, from Space settings → Integrations and Server admin → Integrations | everything but a token or secret after the moment it's shown |
| Space owner or admin | removing a bot from the space | the member's view |
| Member | nothing | the space's hooks: name, channel, grant, fingerprint, and an outgoing hook's host only |

Secrets appear once: `CreateIncoming`, `CreateOutgoing`, `RotateSecret`
and `CreateBotToken` are the only responses that carry one. Every read
answers with the last four characters.
