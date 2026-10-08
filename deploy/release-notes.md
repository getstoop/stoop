Stoop 0.8.1

Stoop 0.8.1 is a security fix. It upgrades in place from 0.8.0 with no
schema change, and `stoop upgrade rollback` takes it back to 0.8.0.

**Fixed.**

- **Removed members could still read quoted replies.** Someone who had
  left a space, or been kicked or banned from it, still got a "replied
  to you" entry in Activity, with a desktop banner, whenever anyone
  quote-replied to one of their old messages. The entry's preview
  carried the new message's text, so they could keep reading parts of
  the conversation. Activity now reaches only people who can still read
  the channel. Every earlier release has this problem; upgrading closes
  it.

**For operators.**

- **Bots and scripts can reply in threads.** This already worked through
  `SendMessage`; the webhook guide now says how, and where a script
  finds a thread's id. Incoming webhooks still post into the channel.

**Schema.** No migrations. 0.8.0 and 0.8.1 share schema 59.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.8.0.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below includes a database change for webhooks that was added
and reverted before release; it is not in 0.8.1.

Changes since 0.8.0:

- STOOP-437: incoming webhook thread keys schema (c71e9c8)
- Revert "STOOP-437: incoming webhook thread keys schema" (d3b1900)
- STOOP-437: bots and scripts reply in threads through SendMessage (00884df)
- STOOP-438: activity reaches only people still in the room (7d68322)
