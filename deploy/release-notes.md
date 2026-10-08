Stoop 0.7.0

Stoop 0.7.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.6.x, and `stoop upgrade rollback`
can take it back to 0.6.x or 0.5.x. Going below 0.5.0 needs a backup, as
it did for 0.6.0.

**What's new.**

- **Threads.** Hover a message and pick **Reply in thread** to talk about
  it without filling the channel. The thread opens in a panel on the
  right, beside the channel, and stays open while you move between
  channels until you close it. Under the message, a line shows how many
  replies it has and who answered last. Threads work in text and voice
  channels and in direct messages, but not in announcement channels.
- **Thread notifications.** A reply notifies the person who started the
  thread and everyone who has replied in it, in Activity. Thread replies
  don't mark the channel unread.
- **Links to threads.** **Copy link to thread** is in the panel's header,
  and a message's link opens its thread when the message is a reply in
  one.
- **Deleting in a thread.** Deleting a message that has replies leaves
  "Original message deleted" in its place, so the thread can still be
  read, but it takes no new replies. The placeholder goes when the last
  reply does. Anyone who can delete others' messages in a space also gets
  **Delete thread**, which removes the message and every reply.

**For operators.**

- **Retention keeps threads whole.** The message sweep goes by the age of
  the message a thread started from. When that message expires, every
  reply under it goes too, however recent, pinned replies included.
  Pinning the first message keeps the whole thread.
- **API additions for scripts.** `SendMessage` takes `thread_root_id` to
  reply in a thread, `ListMessages` takes `thread_id` to page one, and a
  `Message` carries `thread_root_id`, `in_channel`, `deleted` and a
  `thread` summary. `DeleteThread` is new. Nothing was removed.

**Schema.** Migrations 00056 and 00057 run at startup. Both only add, and
the schema floor stays at 53.

- 00056 adds the thread columns to `messages`, a `threads` summary
  table, two indexes, and the new columns to the `message_with_reply`
  view. Each index is built in one pass over `messages`, so a very large
  instance takes a little longer to start the first time.
- 00057 makes a quote of a deleted thread's first message read as a
  quote of a deleted message.

After a rollback to 0.6.x, thread replies show in their channel as
ordinary messages, and a deleted message kept for its thread shows as an
empty message.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.6.0.

**Known issues.**

- On a phone, picking a channel from the drawer while a thread is open
  leaves one extra step in the browser's history, so Back stays on the
  same page once.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.6.0:

- STOOP-421: threads schema (c3137ec)
- STOOP-422: threads contract (203d810)
- STOOP-422: DeleteMessage needs messages.moderate, not manage_channels (04676bb)
- STOOP-423: send into a thread, page a thread (e972dd0)
- STOOP-423: thread replies don't count as unread or join the channel view (7a4a511)
- STOOP-423: test that a thread reply leaves the read marker alone (d4c40af)
- STOOP-424: thread delete rules (5548fdd)
- STOOP-424: edits and reactions refuse a placeholder in the write itself (716f730)
- STOOP-425: retention sweeps a thread by its root (e009fcd)
- STOOP-426: thread activity and search (432ced5)
- STOOP-426: thread notifications only reach current members, for earlier replies (00f53ae)
- STOOP-427: a reusable side panel (4612480)
- STOOP-427: the side panel slides in and out (afe08c4)
- STOOP-427: the side panel opens without jolting the app (f2ad36e)
- STOOP-427: side panel review fixes (6e7a758)
- STOOP-428, STOOP-429: threads in the web app (006fc4f)
- STOOP-429: a thread shows each time with its day, no day dividers (de3dc3f)
- STOOP-428, STOOP-429: thread review fixes (c897ecb)
- STOOP-428: specs expect the Reply in thread button (c6fdb66)
- STOOP-429: a quote of the root jumps to it in a long thread (2221da3)
- STOOP-430: links that open a thread (0874fab)
- STOOP-430: open a linked reply's thread from the first answer (8926e02)
- STOOP-430: thread links land the channel, and a used thread is forgotten (7d923e3)
- STOOP-431: browser spec for threads (fe3c1f5)
- STOOP-432: say how retention treats a thread (2616ab0)
