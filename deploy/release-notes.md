Stoop 0.5.0

Stoop 0.5.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.4.x, and `stoop upgrade rollback`
can take it back to 0.4.x. **It carries two security fixes; anyone whose
server is reachable from the internet should upgrade.**

**Security.**

- **Sign-in could exhaust a server's memory.** Each password check holds
  64 MiB while it runs, and nothing limited how many ran at once, even for
  usernames that don't exist. A burst of sign-in requests could run a
  server out of memory: 64 at once took a test server to 3.3 GB. Password
  checks now run at most four at a time (679 MiB in the same test). A
  request that waits more than 5 seconds is answered "the server is busy;
  try again in a moment".
- **One IPv6 host could skip the sign-in rate limit.** The limit kept one
  allowance per address, and an IPv6 host can change its address on every
  request. Rate limits now count an IPv6 caller by its /64; IPv4 is
  unchanged.

**What's new.** A webhook whose receiver is gone for good is switched off
after 20 failed deliveries in a row, as documented; before, it was retried
forever. A few slow webhook receivers no longer hold up every other hook
and the scheduled sweeps. The delivery log no longer shows what a
receiver answered. The direct-messages button in the rail has a new icon.

**For operators.**

- **Background jobs run on 16 workers by default** (was 4), and webhook
  deliveries may use at most three quarters of them, so receivers that
  answer slowly leave the rest for everything else. A waiting delivery
  holds no database connection. `STOOP_JOBS_WORKERS` still sets the
  number.
- **A webhook receiver's reply is no longer stored.** When a receiver
  refuses a delivery (a status outside 2xx), the server logs the first
  500 bytes of its reply at info level, with the delivery and hook ids.
- **The compose file no longer passes `STOOP_TRUST_PROXY`.** It was
  removed in 0.4.0. Because the server still reads `.env`,
  `STOOP_TRUST_PROXY=true` there still refuses to start. Name your proxy
  in `STOOP_TRUSTED_PROXIES` or under Server admin → Hosting.
- **API changes for scripts.** The realtime `Ready` event no longer
  carries `online_user_ids`; read `presences`. A browser tab still running
  the web app from 0.3.x shows nobody online until it is reloaded. A
  webhook delivery's `response` field is now always empty, and goes away
  in the next release.

**Schema.** Migration 00053 runs at startup. It is a contract migration:
it drops the legacy `sessions` table and raises the schema floor to 52.
0.4.x still starts against the result, so `stoop upgrade rollback` to
0.4.x works without a restore. 0.3.x and older are refused, as they
already were after 0.4.0.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.4.0.

**Known issues.**

- Webhook deliveries can use 12 of the 16 workers. Once 12 or more hooks
  answer slowly at the same time, they fill those and the other hooks wait
  until the slow backlog drains. Nothing is lost.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below is every change merged since 0.4.0.

Changes since 0.4.0:


- Proxies: drop STOOP_TRUST_PROXY from compose and config (e27900b)
- Auth: drop the legacy sessions table, floor to 50 (4911224)
- STOOP-413: Ready stops sending online_user_ids (47528dc)
- STOOP-399: 16 workers by default, and deliveries hold at most three quarters (f902e25)
- Draw the DM rail button as the stoop mark outline (748fc6c)
- STOOP-399: the docs say one worker goes to deliveries, and the cap is shared (4938842)
- STOOP-350: a receiver's reply is logged, not stored (7d79323)
- STOOP-372: integrations starts with a policy that is off (a3535f3)
- STOOP-372: the management RPCs open with one guard (8082c18)
- STOOP-372: one check for a deactivated bot, one for a bot out of the space (18adbec)
- STOOP-372: the delivery ladder is written once (d48de39)
- STOOP-350: the test checks the API carries no reply; the log's comment matches (e974a27)
- STOOP-350: format the delivery log (70520f4)
- STOOP-350: a refused delivery logs the receiver's reply at info (3311b4b)
- STOOP-374: move chat's channel access helpers into one file (56518b2)
- STOOP-374: move loadMessage beside hydrateMessages (98c175a)
- STOOP-374: move refuseBot into chat's permissions file (25fdd0d)
- STOOP-374: fix comments that no longer match the code (37ce796)
- STOOP-374: trim auth comments that restate docs/architecture (675ce94)
- STOOP-374: trim chat comments that restate docs/architecture (46d7d89)
- STOOP-374: trim files comments that restate docs/architecture (511b0c1)
- STOOP-374: trim voice comments that restate docs/architecture (b49e77a)
- STOOP-374: trim app comments that restate docs/architecture (ae54017)
- STOOP-374: reword "slack" in the upload size allowance (799cd6a)
- STOOP-348: lint single-letter names in new Go code; ST1005 off (0c7c122)
- STOOP-400: count only finished deliveries toward the twenty-dead disable (fff6461)
- STOOP-400: the new test names its fixture (3df4798)
- STOOP-402: at most four password hashes run at once (c6c1ef5)
- STOOP-416: rate limits group an IPv6 caller by its /64 (e3dbdbf)
- STOOP-402: a caller that has gone never gets a hash slot (01bb06b)
