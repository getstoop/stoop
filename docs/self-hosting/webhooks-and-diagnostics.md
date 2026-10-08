# Webhooks and diagnostics

## Webhooks

**To post into a channel from another tool**, open the space's settings →
Integrations, choose *New incoming webhook*, pick the channel, and paste
the URL into the tool. Anything with a webhook URL field works as is,
and so does curl:

```sh
curl -d 'disk is full' https://chat.example.com/hooks/stp_hook_…
```

To keep related posts together, add `?thread=` and any name up to 100
characters, such as a build number or a service. The first post with a
name starts a thread in the channel and later ones reply in it; if that
thread's first message is deleted, the next post starts a new one.

```sh
curl -d 'tests passed' 'https://chat.example.com/hooks/stp_hook_…?thread=build-41'
```

The URL posts into that one channel as a bot and can do nothing else.
Treat it like a password: anyone with it can post there. Rotate it from
the same page if it leaks.

**To have Stoop call your own endpoint** when something happens, choose
*New outgoing webhook*, give it the URL and tick the events. Each event
is a JSON POST signed with the secret shown once at creation. Verifying
it, in Python:

```python
import hmac, hashlib, time
t, v1 = (p.split("=")[1] for p in headers["Stoop-Signature"].split(","))
mine = hmac.new(secret, f"{t}.".encode() + body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(mine, v1) and time.time() - int(t) < 300
```

Deliveries retry four times over two and a half minutes and then stop;
the page shows each hook's log and lets you send a failed one again.
`Stoop-Sequence` counts up per hook, so a receiver can tell when it
missed one. A receiver that answers `410 Gone`, or fails twenty times
in a row, turns the hook off until you turn it back on.

**A target on your LAN** (a Home Assistant box, a script on another
machine) is refused until you tick *Allow private targets* on Server
admin → Integrations. The cloud metadata address and link-local ranges
are never reachable. Your own scripts should use a personal token
against the API rather than a webhook; a program that can set a header
should use a bot token, made from the same admin page. Never paste a bot
token into someone else's appliance: a hook URL can only post, a bot
token can read everything its bot can.

`STOOP_WEBHOOKS=false` turns the whole feature off without deleting
anything; the two direction switches on the admin page do the same per
direction.

## Diagnostics

**When something feels slow or broken**, open Server admin → Diagnostics.
It is read-only and refreshes every 5 s while it is open; a dot on the nav
entry means a health row is at warn or danger.

| Panel | Answers |
| --- | --- |
| Health | Is each dependency up: Postgres, LiveKit, file storage, the public address, webhook deliveries, the sweeps, the job runner. An *off* row is something you have not configured, not a fault. Each row links to the tab that fixes it. |
| Right now | Connections, people online, people in voice, requests per minute, slow consumers dropped, each with its last fifteen minutes, and the webhook queue as it is now. |
| Database | The connection pool, ping, database size, backends, the oldest open transaction, and the Postgres and schema versions. |
| Requests | Calls, errors and p50 / p95 / max per procedure over the last 5 minutes. Since-start totals are on the metrics endpoint. |
| Background work | Every sweep: when it last ran, how long it took, what it removed, when it is due. |

Reading it:

| They say | Look at | What it tells you |
| --- | --- | --- |
| "Voice is choppy" | Health: LiveKit, then Hosting | Unreachable means the sidecar. Reachable with people in rooms means media, not Stoop: TURN, the network, or the host itself. |
| "Messages take ages to load" | Requests, then Database | A high p95 on `ListMessages` with pool waits means Postgres is saturated. A high p95 with an idle pool means the query itself, or the disk. |
| "My webhook stopped firing" | Health: Webhooks, then Integrations | Dead-lettered with a 5xx is the receiving end. Queued with the oldest waiting for minutes is the job dispatcher; the Webhooks queued tile shows the backlog. |
| "People keep dropping" | Right now: Connections, Slow consumers dropped | A sawtooth in connections with drops climbing means the server is falling behind on fan-out. Flat drops with a sawtooth means their network or the proxy in front. |
| "Uploads fail" | Health: File storage | Volume full, quota reached, or the directory is not writable after a restore. |
| "It was fine yesterday" | Copy report | Paste it into an issue. |

On the Database panel, *Pool in use N of M* is connections busy right
now out of the most Stoop will open; M is `STOOP_DATABASE_POOL_MAX`.

**Copy report**, at the top of the tab, puts everything on the page into
one JSON document. It is what to paste into a bug report; it holds no
message content and no secrets.

**To scrape it with Prometheus**, make a personal token on your Profile →
Security page with *View server administration* ticked, then:

```sh
curl -H 'Authorization: Bearer stp_pat_…' https://chat.example.net/metrics
```

```yaml
scrape_configs:
  - job_name: stoop
    scheme: https
    static_configs:
      - targets: ["chat.example.net"]
    authorization:
      credentials: stp_pat_…
```

`stoop_health{check="…"}` is 0 ok, 1 warn, 2 danger, 3 off, so an alert
on `stoop_health >= 2` is the whole rule. Everything else on the endpoint
is what the tab shows: the gauges, `stoop_rpc_*` per procedure, and the
jobs. A request without a token gets 401; one whose account is not an
admin gets 403. Numbers live in memory and start over with the process;
history is the scraper's job.
