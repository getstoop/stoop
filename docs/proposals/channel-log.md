# Proposal: the channel log

Approved 2026-10-21. Replaces the client's request bookkeeping with a
per-channel sequence, makes deletes tombstones, moves messages out of the
query cache into their own store, and virtualises the message list.

## Why

Realtime today is best-effort with no position: no replay, no sequence
number, and recovery is "invalidate every query". The client reconstructs
ordering by bookkeeping about requests (events kept per in-flight request
and replayed over its answer, a reconnect counter that invalidates pages
asked for before it). That is about 1,200 lines of reducer and store code
and 1,100 lines of tests, all compensating for one number the server never
hands out.

## The contract

```sql
ALTER TABLE channels ADD COLUMN seq bigint NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN swept_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN seq bigint;            -- NOT NULL one release later
CREATE INDEX messages_channel_seq_idx ON messages (channel_id, seq);
```

- **Every render-affecting write stamps the row** in its own transaction:
  send, edit, delete, reaction, pin, link preview arrival, and the root's
  summary when a reply lands or goes. The seq comes from
  `UPDATE channels SET seq = seq + 1 WHERE id = $1 RETURNING seq`. The row
  lock is the point: a global sequence hands out numbers in allocation
  order but rows commit in another order, so a client could skip one. The
  lock makes "next seq" exact per channel.
- **`Message.seq`** on the proto, and **`channel_seq`** on
  `ListMessagesResponse`. The server reads the counter *before* running the
  page query, so anything committing after it has a higher seq and arrives
  as a change. A row in the page with a seq above `channel_seq` is
  harmless: the client keeps the higher.
- **`ListChanges(channel_id, since_seq, limit)`** returns rows with a
  higher seq in seq order, tombstones and thread replies included, plus
  `channel_seq` and `has_more`. As built there is no `too_old`: the sweep
  still records the highest seq it hard-deleted in `swept_seq`, but
  nothing reads it. Instead `ListChanges` and `ListMessages` both carry
  `retention_floor_id`, the sweep's own cutoff (one helper, so they never
  disagree; empty with retention off), and the client drops any held row
  whose id, or whose root's id, is below it. A hard delete leaves no
  tombstone and no event, and the floor is how it reaches a client.
- **Deletes are tombstones.** One path for roots, replies and top-level
  messages: set `deleted_at`, blank the content, drop reactions,
  attachments, mentions and links, delete the files through the port,
  bump the seq. The retention sweep hard-deletes tombstones with
  everything else. Every read that hands rows to a client skips them,
  except `ListChanges`.
- **Every socket event about a message carries its seq.** The plan was
  to shrink the events to `message_created` and `message_updated`, both
  carrying the full row; that was dropped at step 4, because the
  integrations subscriber forwards every `message_updated` to outgoing
  webhooks as `message.updated`, and full-row updates for reactions,
  pins and deletes would have changed what hooks receive. So the events
  keep their kinds, and `reactions_changed`, `message_pinned`,
  `thread_changed` and `message_deleted` each gained a `seq`: the row's
  position after that change. Webhook payloads are unchanged.
- **Per-viewer fields stay an overlay.** A thread's `unread_count`,
  `muted` and `participating` are not row facts; the server adds them per
  request (as `addThreadViewerStates` does) and the client applies its
  own read events on top.

Gaps in the sequence are fine (a rolled-back transaction, a hard delete
during a rollback to an older binary). The client rule needs monotonic,
not dense.

## The client

One store per channel: a seq, a map of rows by id, a sorted order. The
merge rule is one comparison: a row that arrives replaces the held copy
when its seq is higher. A live event whose seq is exactly next is applied;
any other gap triggers one `ListChanges` from the held seq. Reconnect is
that call for every channel with a store.

Views are ranges over the store. The channel view tracks a contiguous
range of top-level rows with `hasOlder`/`hasNewer`; a thread view tracks
its own range of its root's replies. A jump loads a page around a message
and sets a range that does not reach the newest row; rows beyond the
range are still merged into the map and counted on the "Jump to latest"
pill. Pending sends live in a separate list with no seq.

With a virtualised list the DOM is no longer a constraint. Rows are
pruned from memory only past a large cap (about 2,000) and only at the
older end in normal reading, so liveness never flips because of pruning.

The query cache keeps everything else. Member profile changes stop
invalidating messages: `MessageRow` renders the author from the members
query with the embedded author as fallback.

## Steps, one pull request each

1. Virtualise `MessageList` against the current cache, 300 cap still on.
2. Server: migration, backfill, seq stamping on every write; `Message.seq`
   and `channel_seq`. No behaviour change.
3. Server: tombstones. One delete path; `DeleteThread` as its bulk form;
   recomputes skip tombstones; sweep records `swept_seq`; publish
   `message_updated` alongside `message_deleted` for now. As built: the
   events are exactly today's (no `message_updated` for a row that used
   to vanish; that is step 4's job), a tombstone is shown only as the
   placeholder of a thread with live replies, `GetMessage` hides every
   other tombstone so each RPC answers as before, and a quote of a
   deleted message now reads as deleted rather than disappearing, since
   `reply_to_message_id` is kept.
4. Server: `ListChanges`, and a seq on every realtime event about a
   message. As built: the events keep their kinds, with `seq` added to
   `reactions_changed`, `message_pinned`, `thread_changed` and
   `message_deleted` (no `message_updated` for those, see The contract);
   `retention_floor_id` on `ListChanges` and `ListMessages` in place of
   `too_old`, with `swept_seq` left informational.
5. Web: the new store and loader, unit-tested, unwired.
6. Web: the switch. Delete `history.ts`, the timeline reducer modules and
   `timelineLoads.ts`; lift the cap; reconnect calls `ListChanges`.
7. Cleanup: drop the old queries the switched client no longer calls
   (the socket events stay, see The contract); rewrite the
   history and state sections of `realtime.md`, `web.md`, `messaging.md`
   and `data.md`.
8. Next release: backfill any `NULL` seq, set `NOT NULL`, raise the floor.

The mobile app's shared reducer import breaks at step 6; its contract is
still open and it re-points at the new store when its channel screen is
next touched.
