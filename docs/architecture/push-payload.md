# Push: what is sent, and the payload a device decrypts

The server sends each activity item (a mention, a reply, a direct message,
a thread reply) to the recipient's registered devices as a Web Push
message. This document is the contract a device's decryption is written
against: the payload's fields, the headers the push service is given, and
when nothing is sent. The code is `internal/push` (`listener.go`,
`deliver.go`, `payload.go`). The examples below are the fixtures in
`internal/push/testdata/`, each one line followed by a newline that is
not part of the payload. The Go test decodes every fixture and checks
that the server writes the uncut ones byte for byte; the cut one is
illustrative (a payload that short would never be cut).

## When a device gets one

`internal/push` hears every `ActivityItemCreated` on the personal topic
of anyone with a subscription (topics are read at start and added on
registration, as the webhook subscriber does for spaces with hooks; the
event carries `user_id`, the recipient). It then drops the item, cheapest
check first, when:

1. it was **born read** (`read_at` set), or it is **muted** for the
   recipient (`muted`, their channel or space mute);
2. push is **off** server-wide (the `Policy` port; there is no setting
   yet, so it is always on);
3. the recipient is on **do not disturb**;

and drops one device when:

4. the device's subscription does **not want the kind** (`kinds`);
5. the device's session has a **live socket** now
   (`Gateway.SessionConnected`; a silently dead socket reads as open for
   up to about 40 seconds, and an item in that window is not pushed);
6. the device's session has **expired** (it is swept later).

Every device left gets one `deliver_push` job. The checks are made once,
when the item is heard; the job only sends.

## The message

Encrypted with `aes128gcm` to the subscription's `p256dh` and `auth`
(RFC 8291), one record, padded to a multiple of 256 bytes; signed with the
server's VAPID key (RFC 8292) with no `sub` claim (no operator contact is
configured anywhere yet).

| Header | Value |
| --- | --- |
| `TTL` | What is left of one day from when the item was heard, in whole seconds. |
| `Topic` | 32 base64url characters: the first 24 bytes of SHA-256 of the collapse key, so the push service sees no id. |
| `Urgency` | Not sent (the push service's default). |

**The collapse key** is `<kind>:<key>`, `kind` the `ActivityKind` number
and `key` the mobile app's grouping (`activityEntryKey` in
`web/src/core/activity.ts`, which names its notification identifier): a
direct message's `channelId`, a thread reply's `threadRootId`, any other
item's own `itemId`. A newer message under the same topic replaces one
the push service still holds undelivered, as a newer notification
replaces the shown one on the device.

## The payload

UTF-8 JSON, one object, written compactly with no HTML escaping (`<`, `>`
and `&` appear as themselves). **Every field is always present**; a
string the item has none of is `""`. A reader should ignore fields it
does not know, and refuse a `v` it does not know.

| Field | Type | What it is |
| --- | --- | --- |
| `v` | integer | The payload version: `1`. Raised only for a change a version 1 reader would misread. |
| `serverId` | string | The device's own name for this server: the `local_server_id` it registered with. Never empty. |
| `itemId` | string | The activity item's id (a UUID). Never empty. |
| `kind` | integer | `chat.v1.ActivityKind`: `1` mention, `2` reply, `3` direct message, `4` thread reply. |
| `spaceId` | string | The space; `""` for a direct message. |
| `channelId` | string | The channel or conversation. Never empty. |
| `threadRootId` | string | The thread the message is in; `""` when it is in no thread. |
| `messageId` | string | The message. Never empty. |
| `actorName` | string | Who did it: their display name, else their username; `""` when neither is known. |
| `preview` | string | The message excerpt, at most 140 characters as chat makes it (an attachment's name when there is no text); may be `""`. |
| `previewCut` | boolean | `true` when the server shortened `preview` further to fit the limit below. |
| `spaceName` | string | The space's name; `""` for a direct message. |
| `channelName` | string | The channel's name, without `#`; `""` for a direct message. |
| `waiting` | integer | The recipient's total on this server, what the app's icon counts for it (`alertingTotal`: alerts over every space plus one per open, unmuted conversation with unread messages), read when the job ran. |

The first seven of these, less `v`, are the app's `NotificationData`
(`mobile/src/notifications/content.ts`) with the same names and types.
The rest are raw facts: the device composes the title, subtitle and body
itself and applies its own "hide text" setting. Whether to name the space
(the app names it only when the account is in more than one) is the
device's call; the payload always carries it.

**The limit.** The payload is at most `webpush.MaxPayloadBytes` (2559)
bytes. When the whole would be longer, `preview` alone is cut: as many
whole characters (Unicode code points) from its start as fit, never
splitting one, and `previewCut` is `true`. A delivery never fails for
length. Invalid UTF-8 in a preview arrives as U+FFFD. Today's caps (a
140-character preview, names of 32 to 50 characters) keep every payload
far below the limit, so a cut is rare. Should the other fields alone ever
pass the limit, `actorName`, `spaceName` and `channelName` are also cut,
to at most 64 characters ending in `…`, before the preview is fitted;
`previewCut` is `true` then too.

## Examples

A mention (`testdata/payload-mention.json`):

```json
{"v":1,"serverId":"k3x9pq","itemId":"0193a5b2-7c1e-7000-8000-000000000001","kind":1,"spaceId":"0193a5b2-7c1e-7000-8000-0000000000a1","channelId":"0193a5b2-7c1e-7000-8000-0000000000c1","threadRootId":"","messageId":"0193a5b2-7c1e-7000-8000-0000000000e1","actorName":"Bea Marsh","preview":"@ada can you look at the build? It says \"<no tests>\" & stops","previewCut":false,"spaceName":"The Stoop","channelName":"general","waiting":3}
```

A direct message (`testdata/payload-dm.json`): no space, no names.

```json
{"v":1,"serverId":"home_server-2","itemId":"0193a5b2-7c1e-7000-8000-000000000002","kind":3,"spaceId":"","channelId":"0193a5b2-7c1e-7000-8000-0000000000d1","threadRootId":"","messageId":"0193a5b2-7c1e-7000-8000-0000000000e2","actorName":"Joaquín","preview":"café at 4? ☕","previewCut":false,"spaceName":"","channelName":"","waiting":1}
```

A thread reply (`testdata/payload-thread-reply.json`):

```json
{"v":1,"serverId":"k3x9pq","itemId":"0193a5b2-7c1e-7000-8000-000000000003","kind":4,"spaceId":"0193a5b2-7c1e-7000-8000-0000000000a1","channelId":"0193a5b2-7c1e-7000-8000-0000000000c1","threadRootId":"0193a5b2-7c1e-7000-8000-0000000000e0","messageId":"0193a5b2-7c1e-7000-8000-0000000000e3","actorName":"dee","preview":"Agreed, ship it.","previewCut":false,"spaceName":"The Stoop","channelName":"releases","waiting":12}
```

A reply whose preview was cut, from an actor with no name known
(`testdata/payload-cut.json`, illustrative):

```json
{"v":1,"serverId":"k3x9pq","itemId":"0193a5b2-7c1e-7000-8000-000000000004","kind":2,"spaceId":"0193a5b2-7c1e-7000-8000-0000000000a1","channelId":"0193a5b2-7c1e-7000-8000-0000000000c1","threadRootId":"","messageId":"0193a5b2-7c1e-7000-8000-0000000000e4","actorName":"","preview":"The first part of a reply far too long to fit","previewCut":true,"spaceName":"The Stoop","channelName":"general","waiting":0}
```

## What the push service's answer does

One attempt per job run (`DeliverPush`); the answer decides what happens
to the subscription row, and the relay's design depends on it:

| Answer | What happens |
| --- | --- |
| 2xx (Accepted) | Done. `last_success_at` set, `failures` back to 0. |
| 404, 410 (Gone) | The row is deleted. The only answer that deletes one. |
| 429, 5xx (Retry) | Recorded; tried again after the backoff (30 s, 2 min, 10 min, 30 min, then hourly) or the push service's `Retry-After` (capped at 24 h) when longer. Given up, and recorded as given up, once the wait would pass the day. |
| No answer (refused, timed out, name lookup failed) | As Retry. |
| Anything else: 400, 401, 403, 413 … (Rejected) | Recorded; not tried again; the row is kept. |
| An endpoint that is not a public address, or cannot be used | Recorded; not tried again; the row is kept. |

**Failures never delete a row**, however many in a row: a push service
that is down would otherwise take every device with it. Each failed
attempt adds one to `failures` and sets `last_failure_at` and
`last_failure` (fixed words, never an endpoint, key or token); the
Diagnostics tab's `push` row reads them
([diagnostics.md](diagnostics.md#the-health-check-port)). A job still
waiting when its subscription is deleted, or whose channel has gone,
finds nothing and ends.

## Known and accepted

- **A burst can be missed.** The listener checks the rules for each item
  as it hears it, a few database reads each, on a bus subscription that
  holds 256 events. A message reaching hundreds of people with devices at
  once can make it fall behind; the bus then drops it, it subscribes
  again, and the items in between are not pushed (logged, and counted in
  `bus_dropped_total`). The webhook subscriber has the same shape.
- **No `sub` claim.** Stoop has no operator contact setting, so the VAPID
  token carries none.
