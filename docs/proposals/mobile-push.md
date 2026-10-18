# Push notifications for the phone app: an encrypted relay

Status: direction decided 2026-10-16 (encrypted Web Push; the app picks
the relay; group by server); open questions below; nothing built. The
screens this serves are the Notifications row of the mobile first-screens
mockup (lock screen, in-app banner, notification settings).

## What exists

- Every mention, reply, DM and thread reply already becomes an activity
  item, written once per person by `notify` after blockers and room
  membership are filtered out, with a 140-character preview
  ([architecture/messaging.md → Activity](../architecture/messaging.md#activity)).
- Each item carries `muted`, the recipient's effective mute stamped by the
  server. The messaging doc already names it as "the derivation push
  notifications will need once banners leave the browser."
- Do not disturb is on the account, per server, and holds every alert on
  every device; `do_not_disturb_changed` tells the other devices
  ([architecture/realtime.md](../architecture/realtime.md)).
- `activity_item_created` goes out on the events bus. The webhook
  subscriber is the pattern for acting on it: bus events in, fan-out jobs
  out, deliveries through `internal/jobs`
  ([architecture/runtime.md](../architecture/runtime.md)).
- Every request to a URL somebody chose goes through `internal/netguard`
  ([architecture/integrations.md → Egress](../architecture/integrations.md#egress)).
- A session is a row in `credentials`; revoking one is a `DELETE`
  ([architecture/identity.md → Sessions](../architecture/identity.md#sessions)).

Today a banner only exists while a browser tab or the desktop app is open.

## The problem

A phone app is closed most of the time, and only Apple (APNs) and Google
(FCM) can wake it. Both deliver only for the app's publisher: the signing
keys belong to whoever ships the app, so a self-hosted server cannot push
to the Stoop app on its own. Something has to sit in the middle. Two
things must not follow from that:

1. **The middle must not read messages.** A relay that sees every
   community's text in the clear undoes the reason to self-host.
2. **No server may be tied to one relay.** Relays must be replaceable,
   retirable and regional without touching servers, and people must be
   able to run their own instead of relying on the project's.

## Options considered

### Who knows the relay

**A. The server registers with a relay.** The operator signs the server
up with a relay, which issues it credentials and keeps a record of it.
- Good: the relay can apply per-server limits.
- Watch: every server is tied to that relay and holds an account with it;
  moving relays means every server signs up again, and nobody can choose
  a relay of their own.

**B. The app picks the relay (chosen).** Each device tells each server
"send my pushes to this URL"; the server sends there and nowhere else.
- Good: servers never know which relay they use, so relays are retired,
  replaced or made regional without touching them, and anyone can run
  their own. Nothing anywhere holds a server's identity.
- Watch: no per-server account to hang limits on; the relay limits by the
  key each push is signed with instead (below).

### What the push carries

**A. Content-free wake-up.** The push carries only `{server, item id}`;
the phone wakes, fetches the item from its server and builds the
notification.
- Good: the relay never holds anything sensitive, even encrypted.
- Watch: every notification depends on the phone reaching the server
  within the few seconds iOS gives a notification extension. Servers
  behind a tailnet, on a home line or on a Pi are the normal case for
  Stoop, so the fallback ("New mention on Maple Street") would be common,
  and every notification is a request back to a small server.

**B. Encrypted payload (chosen).** The server encrypts the notification
to a key the phone made; the relay forwards bytes it cannot read; the
phone decrypts and shows it. This is Web Push message encryption
(RFC 8291), the standard web browsers use.
- Good: the text arrives with the push however the server is reached, and
  costs the server nothing afterwards. A published standard with libraries
  on every side.
- Watch: keys are kept per device per server (below). The relay, Apple
  and Google still see that a push happened, its size and time.

Neither is end-to-end encryption between people: the server reads every
message, as it always has. Both only keep the text away from the relay and
the platforms.

## The design

### The server is a plain Web Push sender

The server speaks standard Web Push (RFC 8030 delivery, RFC 8291
encryption, RFC 8292 VAPID identification). It knows nothing about APNs,
FCM, or which relay a device uses. A device registers a **subscription**,
the same shape a browser's Push API produces:

- `endpoint` — a URL, opaque to the server
- `p256dh` — the device's public key for this server (P-256)
- `auth` — a 16-byte secret the device generated

The server has one VAPID key pair, made on first use and kept with the
other instance secrets. It signs every push with it and hands the public
half to devices, so a relay can tie an endpoint to this server.

The server contacts nobody on its own: no directory, no registration, no
account. Its only outbound push traffic is to endpoints its own signed-in
devices gave it.

### When the app tells the server where to send

One subscription per session.

**After sign-in on a server, once:**

1. The app asks the phone for notification permission (at a sensible
   moment, not on first launch) and gets an APNs or FCM token.
2. It makes a key pair and `auth` secret for this server, kept in the
   keychain (iOS, in an access group the extension can read) or Android
   Keystore.
3. It calls `GetPushConfig`: whether push is on for this server, and the
   server's VAPID public key.
4. It asks **its relay** for an endpoint, handing over the platform token
   and the server's VAPID key. The relay returns a URL with both sealed
   inside it, encrypted to the relay's own key.
5. It calls `RegisterPushSubscription` with the endpoint, `p256dh`, `auth`
   and the kind toggles. The server stores it against the calling session.

**It registers again (an idempotent upsert) when:**

- the app is launched or returns to the foreground, which keeps things
  fresh and repairs any drift;
- Apple or Google rotates the platform token (both tell the app);
- the app moves relay — one retired, a regional one opened — for which
  it mints a new endpoint and registers it with every server it holds;
- the person changes the alert toggles (`UpdatePushSubscription`).

**Clean-up mostly happens by itself:**

- signing out or removing a server calls `DeletePushSubscription`, and
  even without it the subscription goes with its session;
- a session that expires or is revoked takes its subscription with it;
  the next sign-in registers again;
- an uninstalled app makes Apple or Google refuse the relay's next push,
  the relay answers the server `410`, and the server deletes the row.

### Which relay, and choosing your own

The relay is the app's choice, never the server's. The official app ships
with the project's relay list (refreshable from `getstoop.com`, so relays
can be retired or made regional without an app release); a build someone
signs themselves names their own. The server needs no change either way.

What limits the choice is the phone platform, not Stoop:

| Who | Can they use their own relay? |
| --- | --- |
| **A build someone signs themselves** (iOS or Android) | **Yes.** Their app names their relay, which holds their own APNs or FCM keys. |
| **The App Store app** (iOS) | **No.** Apple accepts pushes to the published app only from the holder of its push key, the project. |
| **The Play Store app** (Android) | **Yes, through UnifiedPush.** The person picks a distributor app, which can be self-hosted, and it supplies a Web Push endpoint. No Google services needed, and nothing new on the server. |

The same sender would also serve browsers (an installed PWA, or the web
app with the tab closed) later, with no second code path.

### Sending

A push subscriber in the server, beside the webhook subscriber, takes
`activity_item_created` and enqueues one delivery job per subscription of
that person when all of these hold:

1. the item is not `muted`;
2. the person is not on do not disturb on this server;
3. the person has **no connected session** on this server. Anywhere they
   are connected — the phone app in front, the desktop app, a browser tab
   — they are alerted there, so the phone is not rung as well. The
   gateway already knows which sessions are connected; a computer that
   sleeps drops off within about 40 seconds (the 30-second ping and its
   10-second timeout), so it stops counting on its own;
4. the subscription wants this kind (mentions and replies, DMs, thread
   replies). The toggles live on the subscription, because an iOS
   extension cannot drop a notification once it arrives.

The connected-session rule is deliberately plain: no delay, no check for
whether the other device can show a banner. A device whose banners are
off is the person's own choice, and the app says how the rule works
rather than hiding it — notification settings carries "While Stoop is
open on another device, your phone stays quiet. You'll be notified there
instead." The known gap is a computer that stays awake and connected
with nobody at it; if that proves common, the desktop app can report
when the computer is idle (it can read system idle time) and the rule
treats an idle desktop as not there.

As a backstop, a push that arrives while the app is in front is not
displayed; the in-app banner covers it.

The plaintext before encryption is small and fixed:

```json
{ "v": 1, "server": "maple.example.net", "kind": "mention",
  "item": "<id>", "space": "Book club", "channel": "general",
  "actor": "Priya Shah", "preview": "<140 chars>", "unread": 3 }
```

That is well under the 4 KB both platforms allow, because the activity
preview is already capped at 140 characters, so there is no fetch
fallback to build. `unread` is this server's alerting count; the phone
sums its servers for the app-icon badge.

Deliveries go through `netguard` (an endpoint is a URL a client chose) and
the jobs queue, with retries. A `404` or `410` deletes the subscription,
as Web Push intends.

### The relay forwards and forgets

- **Minting.** Given a platform token and a server's VAPID key, it returns
  an endpoint whose path is both, encrypted to the relay's key.
- **Forwarding.** It opens the path, checks the push is signed by the
  VAPID key sealed there (so a leaked endpoint is useless to any other
  server), wraps the ciphertext in an APNs or FCM message and sends it.
- **Storing.** Nothing: no server list, no device database, no tokens at
  rest. Rotating its key invalidates every endpoint, which phones replace
  on their next registration.
- **Limits.** Per VAPID key and per endpoint, in memory. Blocking a
  misbehaving server early is a short denylist of its key.
- **Logs.** Counts, never payloads.

### Operator controls

- An instance setting to turn push off, with an environment floor
  (`STOOP_PUSH=false`) as webhooks have. Off is never silent:
  `GetPushConfig` says so, the server deletes its subscriptions, and the
  app keeps the server in its notification settings with "Push
  notifications have been disabled by this server's admin" in place of
  the switch. The person still sees activity when they open the app.
- An optional list of relay hosts the server will post to. The default is
  any public address `netguard` allows; an operator who wants pushes only
  to their own relay locks it down here.
- Server admin shows the count of subscriptions by relay host, so an
  operator can see where their server's pushes go.

### The tables and the API

- `push_subscriptions`: `id`, `user_id`, `credential_id` (the session that
  registered it, `ON DELETE CASCADE`), `endpoint`, `p256dh`, `auth`, the
  kind toggles, `created_at`, `last_success_at`, `failures`.
- `GetPushConfig`, `RegisterPushSubscription`, `UpdatePushSubscription`,
  `DeletePushSubscription`.
- The VAPID key pair with the instance secrets.

Which module owns this is a modules.md question to settle in the ticket;
it reads activity items and do not disturb through ports, like the webhook
subscriber.

### The phone

- **iOS.** The relay sends an alert with `mutable-content: 1` and a
  generic placeholder; a notification service extension decrypts, sets the
  title and body, `threadIdentifier` = the server's address (one stack per
  server) and the badge. If decryption fails the placeholder shows: "New
  notification on Maple Street".
- **Android.** The relay sends a high-priority FCM data message (or a
  UnifiedPush distributor delivers it); the app decrypts and posts the
  notification itself, with a group per server and a group summary, in a
  notification channel group per server (Mentions, Direct messages,
  Thread replies) made when the server is added.
- **Show message text** is a phone setting: off, the phone writes a
  generic body ("Someone mentioned you in Book club") after decrypting.
- **Tapping** opens the item's server, switching to it if needed, then the
  channel, thread or conversation.

## Phases

1. **Server sender.** The table, the RPCs, the push subscriber and
   delivery job, VAPID keys, the operator settings. Tested against a fake
   relay that decrypts what it receives with a known device key.
2. **Relay.** Minting, APNs and FCM forwarding, the VAPID check, limits;
   the relay list on `getstoop.com`. Deployable on its own.
3. **Phone.** Keys and registration per server, the refresh triggers, the
   iOS extension, the Android handler, grouping, badge sums, the settings
   screen.
4. **Later.** UnifiedPush on Android; browser push for the web app.

## Open questions

1. **Who runs the project's relays, and where.** They are the first
   services the project operates rather than ships: uptime, the APNs key
   and the FCM service account, their own release process.
2. **Where the relay's code lives.** A subcommand of the `stoop` binary
   (one artifact, in keeping with the rest) or its own small program in
   this repo. Either way it is published, so anyone can run one.
3. **The relay list.** Built into the app only, or also refreshed from a
   file on `getstoop.com`; whether that file is signed; how long a retired
   relay keeps forwarding so phones left closed have time to move.
4. **Endpoint lifetime.** Whether endpoints carry an expiry the relay
   enforces, or live until the platform token or relay key changes.
5. **Expo.** Whether `expo-notifications` exposes Android data-message
   handling, group summaries and channel groups, and how the iOS
   notification service extension is added (a config plugin); unchecked.
   This decides how much native code phase 3 carries.
6. **Library or standard library.** A maintained Go Web Push package, or
   the encryption written over `crypto/ecdh`, `crypto/hkdf` and AES-GCM.

## Decisions

- 2026-10-16: an encrypted payload over a content-free wake-up.
- 2026-10-16: notifications group by server on both platforms.
- 2026-10-16: the app picks the relay and tells each server where to send;
  the server is a plain Web Push sender with no registration, directory
  or account anywhere. Relays can be retired or made regional without
  touching servers, and anyone can run their own. (This replaces an
  earlier draft in which servers asked `getstoop.com` for a relay and
  registered with it.)
- 2026-10-16: no push while the person has any connected session on the
  server; they are alerted where they are. The app explains this on
  notification settings. An admin can turn push off, and the app says so
  rather than failing silently.
