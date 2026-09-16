Stoop 0.2.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.1.0 and can be rolled back to 0.1.0
by putting the previous image tag back.

**What's new.** Message search. Pinned messages. Group DMs, and closing a
conversation to take it off your own list. Integrations: incoming
webhooks that post into a channel, outgoing webhooks signed with a
per-hook secret, bots, and personal and bot access tokens for the API.
People can delete their own accounts. Do not disturb is stored on the
account, and presence has a shape for each state. A live indicator shows
when your microphone, camera or screen is being captured, and a device
plugged in mid-call is offered without reconnecting. Seventeen new
themes with a filtered picker. `GET /version` reports the running build.
A long list of fixes to Markdown, emoji shortcodes, link previews and
realtime presence is in the list below.

**For operators.**

- **Every variable in `.env` now reaches the server.** The compose file
  gained `env_file: .env`, so any setting in
  [docs/self-hosting.md → Configuration reference](https://github.com/getstoop/stoop/blob/v0.2.0/docs/self-hosting.md#configuration-reference)
  can be set there. Fetch this release's `docker-compose.yml` rather than
  editing the tag in your old one, or add that line yourself.
- **Webhooks are on by default.** `STOOP_WEBHOOKS=false` turns them off
  without deleting anything. Outgoing webhooks refuse LAN targets until
  an admin ticks *Allow private targets* under Server admin →
  Integrations; cloud metadata and link-local addresses are never
  reachable. New tunables: `STOOP_WEBHOOK_RATE_LIMIT` (60),
  `STOOP_WEBHOOK_DELIVERY_RETENTION` (168h), `STOOP_SEARCH_RATE_LIMIT` (30).
- **People can delete their own accounts by default.** Untick *People can
  delete their own accounts* under Server admin → Accounts to leave that
  to admins.
- **Backups:** [docs/self-hosting.md → Backups](https://github.com/getstoop/stoop/blob/v0.2.0/docs/self-hosting.md#backups)
  now has a restore runbook, written from a drill.

**Schema.** Migrations 00029 to 00037 run at startup. All of them only
add; none is a contract migration, so the schema floor does not move and
0.1.0 still starts against a 0.2.0 database.

**Pinned alongside this release:** LiveKit v1.13.6 and Postgres 16, both
unchanged from 0.1.0.

**Known issues:** none known at release. What turns up goes in
[GitHub issues](https://github.com/getstoop/stoop/issues); security
problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below is every change merged since 0.1.0.
