Stoop 0.8.0

Stoop 0.8.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.7.x, and `stoop upgrade rollback`
can take it back to 0.7.x, 0.6.x or 0.5.x. Going below 0.5.0 needs a
backup, as before.

**What's new.**

- **New replies on a thread.** The line under a message shows "2 new"
  when a thread you're in has replies you haven't read. You're in a
  thread if you started it, replied in it, or were @mentioned by name in
  it. Opening the thread reads it.
- **Thread replies in Activity.** A thread you're in gets one Activity
  entry while it has unread replies, not one per reply, and the entry
  opens the thread. Thread replies no longer add to a channel's or a
  space's red count; an @mention or a quote-reply inside a thread still
  does. Someone @mentioned by name in a thread now hears about its later
  replies too.
- **Mute a thread.** The bell in a thread's panel mutes it: no new count,
  no Activity entry and no banner for its replies, until you unmute it.
  Replying doesn't unmute it. An @mention or a quote-reply to you inside
  a muted thread still reaches Activity, without a banner, as in a muted
  channel. A muted thread shows a red bell, and Profile → Muted lists it
  with an Unmute.
- **Also send to channel.** A checkbox under a thread's message box sends
  the reply to the channel as well. In the channel it carries a line
  naming the thread, which opens the thread on it; in the thread it is
  tagged "Also sent to #channel".

**For operators.**

- **API additions for scripts.** `SetThreadMuted`, `ListThreadMutes` and
  `MarkThreadRead` are new. The thread summary on a message carries the
  caller's `participating`, `muted` and `unread_count`;
  `SendMessage` takes `also_send_to_channel`; a reply also sent to the
  channel carries `thread_root`. Activity has a new kind,
  `thread_reply`, so a script that reads Activity should expect it. Two
  events are new, `ThreadMuted` and `ThreadRead`. Nothing was removed.

**Schema.** Migrations 00058 and 00059 run at startup. Both only add, and
the schema floor stays at 53.

- 00058 adds `thread_mutes` and `thread_reads`, with an index on each.
- 00059 lets `activity_items` hold the `thread_reply` kind.

After a rollback to 0.7.x, thread entries in Activity read as mentions,
mutes and new counts are ignored, and a reply also sent to the channel
shows in both places without its line.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.7.0.

**Known issues.**

- On a phone, picking a channel from the drawer while a thread is open
  leaves one extra step in the browser's history, so Back stays on the
  same page once.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.7.0:

- STOOP-433: thread mutes and read markers schema (82e5cf1)
- STOOP-433: regenerate models for the thread tables (d5076e0)
- STOOP-433: index thread mutes and reads by root (d02acce)
- STOOP-433, STOOP-434: thread mutes contract (1691206)
- STOOP-433: MarkThreadRead's comment names reply_id (f8cc7e8)
- STOOP-433: thread mutes and read markers on the server (ea95970)
- STOOP-433: muted threads in hidden voice channels stay off the list (16f117b)
- STOOP-434: thread replies as one activity entry per thread (e96c037)
- STOOP-435: thread mutes and new replies in the web app (6ddb613)
- STOOP-435: the thread's bell matches the header's icons (9968b81)
- STOOP-435: a muted thread shows a red bell (c179044)
- STOOP-435: thread replies leave the red badges alone (6303c53)
- STOOP-435: review fixes for thread mutes in the web app (9ed34ed)
- STOOP-436: also send to channel contract (76dd2b7)
- STOOP-436: also send a thread reply to the channel (1aeddc0)
- STOOP-436: a page builds each thread root's line once (cdb1107)
- STOOP-436: also send to channel in the web app (e1d1145)
- STOOP-436: deleted roots update their also-sent replies live (f67b7e2)
- Threads phase 2: browser spec for thread mutes and also send (0772381)
